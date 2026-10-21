/**
 * Fast triage across candidate OpenRouter models.
 *
 *   npx tsx scripts/screen-models.ts model-a model-b ...
 *
 * The full eval is 33 cases and takes ~25 minutes per model, which is the wrong
 * tool for deciding which models are even worth that. This runs a small set
 * chosen to separate good parsers from bad ones quickly — the Indonesian
 * shorthand, the transfer-vs-expense distinction, an account tag, and a
 * question — and reports what each model got wrong, not just a count.
 *
 * A model that screens well still needs `npm run test:parse` before it goes
 * anywhere near production.
 */
import "dotenv/config";
import { OpenRouterParser } from "../src/parse/openrouter.js";
import { DEFAULT_ACCOUNTS, DEFAULT_CATEGORIES } from "../src/sheets/config.js";
import type { Intent } from "../src/types.js";

const TIME_ZONE = "Asia/Jakarta";

interface Case {
  text: string;
  /** Returns null when correct, or a description of what was wrong. */
  check: (intent: Intent) => string | null;
}

const expectTx = (
  type: "expense" | "income" | "transfer",
  amount: number,
  opts: { category?: string; account?: string | null } = {},
): Case["check"] => {
  return (intent) => {
    if (intent.kind !== "transaction") return `got ${intent.kind}`;
    const t = intent.transaction;
    const wrong: string[] = [];
    if (t.type !== type) wrong.push(`type=${t.type}`);
    if (t.amountIdr !== amount) wrong.push(`amount=${t.amountIdr}`);
    if (opts.category && t.category !== opts.category) wrong.push(`category=${t.category}`);
    if (opts.account !== undefined && t.account !== opts.account) wrong.push(`account=${t.account}`);
    return wrong.length > 0 ? wrong.join(" ") : null;
  };
};

const CASES: Case[] = [
  { text: "beli beras 50rb di indomaret", check: expectTx("expense", 50_000) },
  { text: "bayar listrik 350rb pake bca", check: expectTx("expense", 350_000, { account: "BCA" }) },
  { text: "setengah juta buat servis motor", check: expectTx("expense", 500_000) },
  { text: "gaji 15jt", check: expectTx("income", 15_000_000) },
  // The discriminating pair: same verb, different destination.
  { text: "tarik tunai 500rb", check: expectTx("transfer", 500_000) },
  { text: "transfer ke ibu 200rb", check: expectTx("expense", 200_000) },
  { text: "kemarin makan siang 45rb", check: expectTx("expense", 45_000) },
  {
    text: "berapa pengeluaran makanan bulan ini?",
    check: (i) => (i.kind === "query" ? null : `got ${i.kind}`),
  },
];

/** Same input repeated, because a model that is right once but not reliably is unusable. */
const STABILITY_TEXT = "gaji 15jt";
const STABILITY_RUNS = 4;

async function screen(model: string): Promise<void> {
  const parser = new OpenRouterParser({
    apiKey: process.env.OPENROUTER_API_KEY ?? "",
    model,
    timeZone: TIME_ZONE,
  });
  const config = { categories: [...DEFAULT_CATEGORIES], accounts: [...DEFAULT_ACCOUNTS] };

  console.log(`\n=== ${model} ===`);
  let passed = 0;
  const times: number[] = [];

  for (const testCase of CASES) {
    const started = Date.now();
    let verdict: string;
    try {
      const problem = testCase.check(await parser.parseText(testCase.text, config));
      if (problem === null) {
        passed++;
        verdict = "ok";
      } else {
        verdict = `WRONG (${problem})`;
      }
    } catch (error) {
      verdict = `ERROR (${error instanceof Error ? error.message : String(error)})`;
    }
    const seconds = (Date.now() - started) / 1000;
    times.push(seconds);
    console.log(`  ${seconds.toFixed(1).padStart(5)}s  ${verdict.padEnd(34)} ${testCase.text}`);
  }

  let stable = 0;
  for (let run = 0; run < STABILITY_RUNS; run++) {
    try {
      const intent = await parser.parseText(STABILITY_TEXT, config);
      // `unclear` is a returned value, not a thrown error — counting it as a
      // success is exactly how a flaky model looks reliable.
      if (intent.kind === "transaction") stable++;
    } catch {
      /* counts as unstable */
    }
  }

  const median = [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)] ?? 0;
  console.log(
    `  -> ${passed}/${CASES.length} correct, ` +
      `${stable}/${STABILITY_RUNS} stable on repeat, median ${median.toFixed(1)}s`,
  );
}

const models = process.argv.slice(2);
if (models.length === 0) {
  console.error("Usage: npx tsx scripts/screen-models.ts <model-id> [model-id ...]");
  process.exit(1);
}
if (!process.env.OPENROUTER_API_KEY) {
  console.error("OPENROUTER_API_KEY is not set.");
  process.exit(1);
}

for (const model of models) {
  await screen(model);
}
