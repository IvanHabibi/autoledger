/**
 * Fixture eval against the real API. Run with `npm run test:parse`.
 *
 * Skipped unless ANTHROPIC_API_KEY is set, because it makes real calls and
 * costs real (very small) money. This is the only test that proves the parser
 * actually understands Indonesian shorthand rather than merely compiling.
 *
 * The dotenv import matters: vitest does not put `.env` into `process.env` by
 * itself, and `.env` is where every other secret in this project lives. Without
 * it, a key in `.env` leaves the whole suite silently skipped — a green run
 * that verified nothing, which is worse than a red one.
 */
import "dotenv/config";
import { describe, expect, it } from "vitest";
import { Parser } from "../../src/parse/claude.js";
import { DEFAULT_ACCOUNTS, DEFAULT_CATEGORIES } from "../../src/sheets/config.js";
import { addDays, todayInTimeZone } from "../../src/util/date.js";

const apiKey = process.env.ANTHROPIC_API_KEY;
const TIME_ZONE = "Asia/Jakarta";
const PER_CASE_TIMEOUT_MS = 90_000;

/**
 * A real, always-running assertion rather than a console warning — vitest
 * discards module-scope logging from a skipped file, so a warning here would be
 * invisible and the run would look green.
 *
 * Failing is the honest outcome: `npm run test:parse` is only ever run
 * deliberately, and if it cannot reach the API then the parser was not verified.
 * `npm test` runs test/unit only, so this never breaks the keyless path.
 */
describe("live eval preconditions", () => {
  it("has ANTHROPIC_API_KEY set", () => {
    expect(
      apiKey,
      "ANTHROPIC_API_KEY is not set, so every case below was skipped and the " +
        "parser was NOT verified. Put it in .env or export it, then re-run.",
    ).toBeTruthy();
  });
});

interface TransactionCase {
  text: string;
  amount: number;
  type: "expense" | "income" | "transfer";
  /** Checked only when set. */
  date?: string;
  merchantContains?: string;
  account?: string;
}

describe.skipIf(!apiKey)("parser (live API)", () => {
  const parser = new Parser({
    apiKey: apiKey ?? "",
    model: process.env.CLAUDE_MODEL ?? "claude-opus-5",
    timeZone: TIME_ZONE,
  });
  const today = todayInTimeZone(TIME_ZONE);
  const yesterday = addDays(today, -1);
  const config = { categories: DEFAULT_CATEGORIES, accounts: DEFAULT_ACCOUNTS };

  const transactions: TransactionCase[] = [
    { text: "beli beras 50rb di indomaret", amount: 50_000, type: "expense", merchantContains: "ndomaret" },
    { text: "bensin 100k", amount: 100_000, type: "expense" },
    { text: "kopi 18000", amount: 18_000, type: "expense" },
    { text: "bayar listrik 350.000", amount: 350_000, type: "expense" },
    { text: "beli pulsa 25 rb", amount: 25_000, type: "expense" },
    { text: "grab ke kantor 32rb", amount: 32_000, type: "expense" },
    { text: "setengah juta buat servis motor", amount: 500_000, type: "expense" },
    { text: "seratus ribu buat obat", amount: 100_000, type: "expense" },
    { text: "kemarin makan siang 45rb", amount: 45_000, type: "expense", date: yesterday },
    { text: "gaji 15jt", amount: 15_000_000, type: "income" },
    { text: "dapat bonus 2,5jt", amount: 2_500_000, type: "income" },
    { text: "thr 5jt", amount: 5_000_000, type: "income" },
    { text: "jual lemari bekas 1jt", amount: 1_000_000, type: "income" },
    { text: "groceries 75rb", amount: 75_000, type: "expense" },

    // Money that only moved between our own accounts. Before a `transfer` type
    // existed these all counted as spending.
    { text: "transfer ke rekening mandiri 1jt", amount: 1_000_000, type: "transfer" },
    { text: "tarik tunai 500rb", amount: 500_000, type: "transfer" },
    { text: "top up gopay 200rb", amount: 200_000, type: "transfer" },
    { text: "pindah ke tabungan 2jt", amount: 2_000_000, type: "transfer" },
    { text: "setor tunai 1jt", amount: 1_000_000, type: "transfer" },

    // The discriminating pair: same verb, different destination. Money sent to
    // another person has left the household, so it is an expense.
    { text: "transfer ke ibu 200rb", amount: 200_000, type: "expense" },

    // Account tagging.
    { text: "bayar listrik 350rb pake bca", amount: 350_000, type: "expense", account: "BCA" },
    { text: "beli kopi 25rb pake gopay", amount: 25_000, type: "expense", account: "GoPay" },
  ];

  it.each(transactions)(
    "reads “$text” as $type $amount",
    async ({ text, amount, type, date, merchantContains, account }) => {
      const intent = await parser.parseText(text, config);

      expect(intent.kind, `"${text}" should be a transaction`).toBe("transaction");
      if (intent.kind !== "transaction") return;

      expect(intent.transaction.amountIdr, `amount for "${text}"`).toBe(amount);
      expect(intent.transaction.type, `direction for "${text}"`).toBe(type);
      expect(DEFAULT_CATEGORIES).toContain(intent.transaction.category);

      if (date) expect(intent.transaction.date, `date for "${text}"`).toBe(date);
      if (account) expect(intent.transaction.account, `account for "${text}"`).toBe(account);
      if (merchantContains) {
        expect(intent.transaction.merchant ?? "").toContain(merchantContains);
      }
    },
    PER_CASE_TIMEOUT_MS,
  );

  it(
    "reads a bare sub-1000 number as thousands, but flags it",
    async () => {
      const intent = await parser.parseText("beras 50", config);
      expect(intent.kind).toBe("transaction");
      if (intent.kind !== "transaction") return;
      expect(intent.transaction.amountIdr).toBe(50_000);
      expect(intent.transaction.confidence).toBe("low");
    },
    PER_CASE_TIMEOUT_MS,
  );

  it(
    "leaves the account null when the message does not mention one",
    async () => {
      const intent = await parser.parseText("beli beras 50rb", config);
      expect(intent.kind).toBe("transaction");
      if (intent.kind !== "transaction") return;
      expect(intent.transaction.account).toBeNull();
    },
    PER_CASE_TIMEOUT_MS,
  );

  const questions = [
    "berapa pengeluaran makanan bulan ini?",
    "total belanja bulan lalu",
    "habis berapa buat transport minggu ini",
    "how much did we spend on food this month?",
  ];

  it.each(questions)(
    "treats “%s” as a question",
    async (text) => {
      const intent = await parser.parseText(text, config);
      expect(intent.kind, `"${text}" should be a query`).toBe("query");
      if (intent.kind !== "query") return;
      expect(intent.query.startDate <= intent.query.endDate).toBe(true);
      expect(intent.query.endDate <= today).toBe(true);
    },
    PER_CASE_TIMEOUT_MS,
  );

  it(
    "resolves “bulan lalu” to the whole previous month",
    async () => {
      const intent = await parser.parseText("total belanja bulan lalu", config);
      expect(intent.kind).toBe("query");
      if (intent.kind !== "query") return;
      // Starts on the 1st and ends before this month begins.
      expect(intent.query.startDate.endsWith("-01")).toBe(true);
      expect(intent.query.endDate < `${today.slice(0, 7)}-01`).toBe(true);
    },
    PER_CASE_TIMEOUT_MS,
  );

  it.each(["halo", "makasih ya", "oke"])(
    "does not invent a transaction from “%s”",
    async (text) => {
      const intent = await parser.parseText(text, config);
      expect(intent.kind, `"${text}" should not be recorded`).not.toBe("transaction");
    },
    PER_CASE_TIMEOUT_MS,
  );
});
