import { z } from "zod";
import type { Confidence, Intent, QuerySpec, TxType } from "../types.js";
import { isIsoDate, monthBounds } from "../util/date.js";

/**
 * The wire schema Claude fills in.
 *
 * Two deliberate shape decisions, both learned from what the SDK actually
 * sends to the API rather than assumed:
 *
 *  1. It is flat — nullable scalars and arrays only, no nested or nullable
 *     objects. That keeps it inside the corner of the JSON-schema subset that
 *     constrained decoding supports everywhere, so the shape can never be the
 *     reason a request is rejected.
 *
 *  2. Closed sets are typed as plain strings, not `z.enum`. The SDK's schema
 *     conversion downgrades an enum to `type: "string"` with the allowed values
 *     carried only in the description, so the API does not structurally enforce
 *     it — but the zod side still would, and a single off-list value (a category
 *     the model invented) would throw and lose the entry entirely. Accepting a
 *     string here and validating it in `toIntent` turns that into a harmless
 *     fallback. The allowed values stay in `.describe()`, so the model is still
 *     told exactly what they are, and the system prompt lists them again.
 *
 * Everything the model says is untrusted until it has been through `toIntent`.
 */
export function buildIntentSchema(categories: readonly string[]) {
  if (categories.length === 0) {
    throw new Error("Cannot build a parse schema with no categories — check the Config tab.");
  }
  const categoryList = categories.map((c) => `"${c}"`).join(", ");

  return z.object({
    kind: z.string().describe('Exactly one of "transaction", "query", "unclear".'),

    // For kind === "transaction"; null otherwise.
    tx_type: z.string().nullable().describe('"expense" or "income".'),
    amount_idr: z.number().int().nullable().describe("Positive whole number of rupiah."),
    category: z.string().nullable().describe(`Exactly one of: ${categoryList}.`),
    description: z.string().nullable().describe("Short human summary, language of the message."),
    merchant: z.string().nullable().describe("Shop or person, only if actually named."),
    date: z.string().nullable().describe("YYYY-MM-DD."),
    confidence: z.string().nullable().describe('"high", "medium" or "low".'),

    // For kind === "query"; null otherwise.
    q_scope: z.string().nullable().describe('"expense", "income" or "both".'),
    q_start_date: z.string().nullable().describe("YYYY-MM-DD, inclusive."),
    q_end_date: z.string().nullable().describe("YYYY-MM-DD, inclusive."),
    q_categories: z
      .array(z.string())
      .nullable()
      .describe(`Subset of: ${categoryList}. Empty array means every category.`),
    q_keyword: z.string().nullable().describe("Free-text term to match, if any."),
    q_group_by: z.string().nullable().describe('"none", "category", "month" or "payer".'),
    q_label: z.string().nullable().describe('Short period label, e.g. "bulan ini".'),

    // For kind === "unclear".
    note: z.string().nullable().describe("One short sentence saying what is missing."),
  });
}

export type IntentWire = z.infer<ReturnType<typeof buildIntentSchema>>;

export interface NarrowOptions {
  /** Today in the household timezone, YYYY-MM-DD. */
  today: string;
  /** The live category list; anything outside it is replaced. */
  categories: readonly string[];
  /** Category to fall back on. */
  fallbackCategory: string;
  /** The original message, used as a last-resort description. */
  rawText: string;
}

/**
 * Anything above this is far likelier to be a misparse (a dropped "rb", a phone
 * number read as an amount) than a real household transaction. We still record
 * it — refusing would lose the entry — but flag it so the reply carries a
 * warning and invites an undo.
 */
const IMPLAUSIBLE_AMOUNT_IDR = 10_000_000_000;

const TX_TYPES = ["expense", "income"] as const;
const CONFIDENCES = ["high", "medium", "low"] as const;
const SCOPES = ["expense", "income", "both"] as const;
const GROUP_BYS = ["none", "category", "month", "payer"] as const;

/** Case- and whitespace-tolerant membership check with a fallback. */
function oneOf<T extends string>(
  value: string | null,
  allowed: readonly T[],
  fallback: T,
): T {
  if (value === null) return fallback;
  const needle = value.trim().toLowerCase();
  return allowed.find((option) => option === needle) ?? fallback;
}

/** Resolves a model-supplied category name to one that actually exists. */
function resolveCategory(
  value: string | null,
  categories: readonly string[],
  fallback: string,
): string {
  if (value === null) return fallback;
  const needle = value.trim().toLowerCase();
  if (needle === "") return fallback;
  return categories.find((name) => name.toLowerCase() === needle) ?? fallback;
}

function unclear(note: string): Intent {
  return { kind: "unclear", note };
}

/**
 * Turn the flat wire object into a validated Intent.
 *
 * The model is guided towards the right values but not bound to them, so this
 * is the boundary where its output stops being a suggestion and becomes domain
 * data. Everything that would otherwise reach the sheet as a bad row is caught
 * here.
 */
export function toIntent(wire: IntentWire, opts: NarrowOptions): Intent {
  const kind = oneOf(wire.kind, ["transaction", "query", "unclear"] as const, "unclear");

  if (kind === "unclear") {
    return unclear(wire.note?.trim() || "Belum jelas — sebutkan nominalnya ya.");
  }

  if (kind === "transaction") {
    // An unrecognised direction is not guessable: expense would be the common
    // case, but silently filing income as a cost corrupts the ledger.
    const txType = wire.tx_type === null ? null : oneOfOrNull(wire.tx_type, TX_TYPES);
    if (txType === null) {
      return unclear("Tidak yakin ini pengeluaran atau pemasukan.");
    }
    if (wire.amount_idr === null || wire.amount_idr <= 0) {
      return unclear("Nominalnya belum terbaca. Contoh: “beli beras 50rb”.");
    }

    let confidence: Confidence = oneOf(wire.confidence, CONFIDENCES, "medium");
    if (wire.amount_idr > IMPLAUSIBLE_AMOUNT_IDR) confidence = "low";

    const parsedDate = wire.date && isIsoDate(wire.date) ? wire.date : opts.today;
    // A future date on a ledger entry is a parse slip, not a plan.
    const date = parsedDate > opts.today ? opts.today : parsedDate;
    if (date !== parsedDate) confidence = "low";

    const merchant = wire.merchant?.trim();

    return {
      kind: "transaction",
      transaction: {
        type: txType,
        amountIdr: wire.amount_idr,
        category: resolveCategory(wire.category, opts.categories, opts.fallbackCategory),
        description: wire.description?.trim() || opts.rawText.trim(),
        merchant: merchant && merchant.length > 0 ? merchant : null,
        date,
        confidence,
      },
    };
  }

  // kind === "query"
  const bounds = monthBounds(opts.today);
  const start =
    wire.q_start_date && isIsoDate(wire.q_start_date) ? wire.q_start_date : bounds.start;
  const end = wire.q_end_date && isIsoDate(wire.q_end_date) ? wire.q_end_date : opts.today;

  // Drop category filters that do not exist rather than silently matching nothing.
  const requested = wire.q_categories ?? [];
  const known = new Map(opts.categories.map((name) => [name.toLowerCase(), name]));
  const filtered: string[] = [];
  for (const name of requested) {
    const match = known.get(name.trim().toLowerCase());
    if (match && !filtered.includes(match)) filtered.push(match);
  }

  const query: QuerySpec = {
    scope: oneOf(wire.q_scope, SCOPES, "both"),
    // Swap rather than reject, so a reversed range still answers the question.
    startDate: start <= end ? start : end,
    endDate: start <= end ? end : start,
    categories: filtered,
    keyword: wire.q_keyword?.trim() || null,
    groupBy: oneOf(wire.q_group_by, GROUP_BYS, "category"),
    label: wire.q_label?.trim() || "periode ini",
  };

  return { kind: "query", query };
}

function oneOfOrNull<T extends string>(value: string, allowed: readonly T[]): T | null {
  const needle = value.trim().toLowerCase();
  return allowed.find((option) => option === needle) ?? null;
}

export type { TxType };
