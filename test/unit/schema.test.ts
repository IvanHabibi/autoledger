import { describe, expect, it } from "vitest";
import { buildIntentSchema, toIntent, type IntentWire } from "../../src/parse/schema.js";
import { fallbackCategoryOf } from "../../src/parse/claude.js";

const CATEGORIES = ["Makanan & Minuman", "Transportasi", "Gaji", "Lain-lain"];

const NARROW = {
  today: "2026-09-13",
  categories: CATEGORIES,
  fallbackCategory: "Lain-lain",
  rawText: "beli beras 50rb",
};

/** A wire object with everything null, so each test sets only what it means to. */
function wire(overrides: Partial<IntentWire>): IntentWire {
  return {
    kind: "unclear",
    tx_type: null,
    amount_idr: null,
    category: null,
    description: null,
    merchant: null,
    date: null,
    confidence: null,
    q_scope: null,
    q_start_date: null,
    q_end_date: null,
    q_categories: null,
    q_keyword: null,
    q_group_by: null,
    q_label: null,
    note: null,
    ...overrides,
  };
}

describe("buildIntentSchema", () => {
  it("accepts an off-list category rather than throwing away the whole entry", () => {
    // The API does not structurally enforce enums — it only receives them as a
    // description hint — so the schema has to tolerate a value the model
    // invented. toIntent is what maps it back onto a real category.
    const schema = buildIntentSchema(CATEGORIES);
    const base = wire({ kind: "transaction", tx_type: "expense", amount_idr: 1000 });

    expect(schema.safeParse({ ...base, category: "Transportasi" }).success).toBe(true);
    expect(schema.safeParse({ ...base, category: "Kripto" }).success).toBe(true);
  });

  it("still rejects a structurally wrong payload", () => {
    const schema = buildIntentSchema(CATEGORIES);
    const base = wire({ kind: "transaction", tx_type: "expense", amount_idr: 1000 });

    expect(schema.safeParse({ ...base, amount_idr: "50rb" }).success).toBe(false);
    expect(schema.safeParse({ ...base, amount_idr: 1000.5 }).success).toBe(false);
    expect(schema.safeParse({ ...base, q_categories: "Makanan" }).success).toBe(false);
    const { kind: _omitted, ...missingKind } = base;
    expect(schema.safeParse(missingKind).success).toBe(false);
  });

  it("lists the categories in the description, so the model is still told them", () => {
    const schema = buildIntentSchema(CATEGORIES);
    const described = schema.shape.category.description ?? "";
    for (const category of CATEGORIES) expect(described).toContain(category);
  });

  it("refuses to build with no categories at all", () => {
    expect(() => buildIntentSchema([])).toThrow(/no categories/i);
  });
});

describe("toIntent", () => {
  it("narrows a well-formed transaction", () => {
    const intent = toIntent(
      wire({
        kind: "transaction",
        tx_type: "expense",
        amount_idr: 50_000,
        category: "Makanan & Minuman",
        description: "beli beras",
        merchant: "Indomaret",
        date: "2026-09-12",
        confidence: "high",
      }),
      NARROW,
    );

    expect(intent).toEqual({
      kind: "transaction",
      transaction: {
        type: "expense",
        amountIdr: 50_000,
        category: "Makanan & Minuman",
        description: "beli beras",
        merchant: "Indomaret",
        date: "2026-09-12",
        confidence: "high",
      },
    });
  });

  it("will not record a transaction with no usable amount", () => {
    for (const amount of [null, 0, -500]) {
      const intent = toIntent(
        wire({ kind: "transaction", tx_type: "expense", amount_idr: amount }),
        NARROW,
      );
      expect(intent.kind).toBe("unclear");
    }
  });

  it("will not record a transaction with no direction", () => {
    const intent = toIntent(wire({ kind: "transaction", amount_idr: 50_000 }), NARROW);
    expect(intent.kind).toBe("unclear");
  });

  it("falls back to today for a missing or malformed date", () => {
    for (const date of [null, "not-a-date", "13/09/2026", "2026-02-30"]) {
      const intent = toIntent(
        wire({ kind: "transaction", tx_type: "expense", amount_idr: 1000, date }),
        NARROW,
      );
      expect(intent.kind === "transaction" && intent.transaction.date).toBe("2026-09-13");
    }
  });

  it("pulls a future date back to today and lowers confidence", () => {
    const intent = toIntent(
      wire({
        kind: "transaction",
        tx_type: "expense",
        amount_idr: 1000,
        date: "2027-01-01",
        confidence: "high",
      }),
      NARROW,
    );
    expect(intent.kind === "transaction" && intent.transaction.date).toBe("2026-09-13");
    expect(intent.kind === "transaction" && intent.transaction.confidence).toBe("low");
  });

  it("flags an implausibly large amount instead of silently trusting it", () => {
    const intent = toIntent(
      wire({
        kind: "transaction",
        tx_type: "expense",
        amount_idr: 50_000_000_000,
        confidence: "high",
      }),
      NARROW,
    );
    // Still recorded — refusing would lose the entry — but marked for review.
    expect(intent.kind).toBe("transaction");
    expect(intent.kind === "transaction" && intent.transaction.confidence).toBe("low");
  });

  it("uses the original message when no description came back", () => {
    const intent = toIntent(
      wire({ kind: "transaction", tx_type: "expense", amount_idr: 1000, description: "  " }),
      NARROW,
    );
    expect(intent.kind === "transaction" && intent.transaction.description).toBe(
      "beli beras 50rb",
    );
  });

  it("treats a blank merchant as absent", () => {
    const intent = toIntent(
      wire({ kind: "transaction", tx_type: "expense", amount_idr: 1000, merchant: "   " }),
      NARROW,
    );
    expect(intent.kind === "transaction" && intent.transaction.merchant).toBeNull();
  });

  it("defaults the category when the model left it out", () => {
    const intent = toIntent(
      wire({ kind: "transaction", tx_type: "income", amount_idr: 1000 }),
      NARROW,
    );
    expect(intent.kind === "transaction" && intent.transaction.category).toBe("Lain-lain");
  });

  it("narrows a query and defaults the period to month-to-date", () => {
    const intent = toIntent(wire({ kind: "query" }), NARROW);
    expect(intent).toEqual({
      kind: "query",
      query: {
        scope: "both",
        startDate: "2026-09-01",
        endDate: "2026-09-13",
        categories: [],
        keyword: null,
        groupBy: "category",
        label: "periode ini",
      },
    });
  });

  it("swaps a reversed range rather than returning nothing", () => {
    const intent = toIntent(
      wire({
        kind: "query",
        q_start_date: "2026-09-30",
        q_end_date: "2026-09-01",
      }),
      NARROW,
    );
    expect(intent.kind === "query" && intent.query.startDate).toBe("2026-09-01");
    expect(intent.kind === "query" && intent.query.endDate).toBe("2026-09-30");
  });

  it("maps an invented category onto the catch-all instead of failing", () => {
    const intent = toIntent(
      wire({
        kind: "transaction",
        tx_type: "expense",
        amount_idr: 1000,
        category: "Kripto",
      }),
      NARROW,
    );
    expect(intent.kind === "transaction" && intent.transaction.category).toBe("Lain-lain");
  });

  it("matches a category regardless of casing or stray whitespace", () => {
    const intent = toIntent(
      wire({
        kind: "transaction",
        tx_type: "expense",
        amount_idr: 1000,
        category: "  transportasi ",
      }),
      NARROW,
    );
    expect(intent.kind === "transaction" && intent.transaction.category).toBe("Transportasi");
  });

  it("treats an unrecognised kind as unclear rather than guessing", () => {
    for (const kind of ["", "TRANSAKSI", "spend", "queryy"]) {
      expect(toIntent(wire({ kind, amount_idr: 1000 }), NARROW).kind).toBe("unclear");
    }
  });

  it("accepts the right values case-insensitively", () => {
    const intent = toIntent(
      wire({ kind: "TRANSACTION", tx_type: "Expense", amount_idr: 1000 }),
      NARROW,
    );
    expect(intent.kind).toBe("transaction");
    expect(intent.kind === "transaction" && intent.transaction.type).toBe("expense");
  });

  it("refuses to guess the direction from an unrecognised tx_type", () => {
    // Defaulting to expense here would quietly file salary as a cost.
    const intent = toIntent(
      wire({ kind: "transaction", tx_type: "outgoing", amount_idr: 1000 }),
      NARROW,
    );
    expect(intent.kind).toBe("unclear");
  });

  it("falls back to medium for an unrecognised confidence", () => {
    const intent = toIntent(
      wire({ kind: "transaction", tx_type: "expense", amount_idr: 1000, confidence: "sangat" }),
      NARROW,
    );
    expect(intent.kind === "transaction" && intent.transaction.confidence).toBe("medium");
  });

  it("falls back to safe defaults for unrecognised query options", () => {
    const intent = toIntent(
      wire({ kind: "query", q_scope: "outgoing", q_group_by: "weekly" }),
      NARROW,
    );
    expect(intent.kind === "query" && intent.query.scope).toBe("both");
    expect(intent.kind === "query" && intent.query.groupBy).toBe("category");
  });

  it("drops unknown category filters and de-duplicates the rest", () => {
    const intent = toIntent(
      wire({
        kind: "query",
        q_categories: ["Kripto", "transportasi", "Transportasi", "Gaji"],
      }),
      NARROW,
    );
    expect(intent.kind === "query" && intent.query.categories).toEqual([
      "Transportasi",
      "Gaji",
    ]);
  });

  it("keeps an unclear note, with a fallback when it is empty", () => {
    expect(toIntent(wire({ kind: "unclear", note: "Nominalnya mana?" }), NARROW)).toEqual({
      kind: "unclear",
      note: "Nominalnya mana?",
    });
    const blank = toIntent(wire({ kind: "unclear", note: "  " }), NARROW);
    expect(blank.kind === "unclear" && blank.note.length).toBeGreaterThan(0);
  });
});

describe("fallbackCategoryOf", () => {
  it("prefers an explicit catch-all, whatever its casing", () => {
    expect(fallbackCategoryOf(["Makanan", "Lain-lain"])).toBe("Lain-lain");
    expect(fallbackCategoryOf(["Makanan", "other"])).toBe("other");
    expect(fallbackCategoryOf(["Makanan", "Lainnya"])).toBe("Lainnya");
  });

  it("uses the last category when there is no catch-all", () => {
    expect(fallbackCategoryOf(["Makanan", "Transportasi"])).toBe("Transportasi");
  });
});
