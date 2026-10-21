/** Shared domain types. Nothing in here depends on Telegram, Claude, or Sheets. */

/**
 * `transfer` is money moved between the household's own accounts — an ATM
 * withdrawal, a top-up, a move to savings. It is neither income nor expense,
 * and counting it as either would inflate the totals it appears in.
 */
export type TxType = "expense" | "income" | "transfer";

export type Confidence = "high" | "medium" | "low";

/** A transaction as understood from a message, before we record it. */
export interface ParsedTransaction {
  type: TxType;
  /** Whole rupiah. Never fractional — IDR has no practical subunit. */
  amountIdr: number;
  category: string;
  description: string;
  merchant: string | null;
  /**
   * Which account or payment method the money moved through, when the message
   * said. Purely descriptive: a tag for slicing, never a balance. Null is normal.
   */
  account: string | null;
  /** Transaction date as YYYY-MM-DD in the household timezone. */
  date: string;
  confidence: Confidence;
}

/** A transaction as stored in the sheet — one row of the Transactions tab. */
export interface LedgerRow extends ParsedTransaction {
  id: string;
  timestampUtc: string;
  payer: string;
  source: "text" | "photo";
  rawText: string;
}

/** What to measure, when a message turns out to be a question. */
export interface QuerySpec {
  /**
   * `"both"` means income and expense together, and deliberately excludes
   * transfers — including them would double-count money that only moved.
   */
  scope: TxType | "both";
  startDate: string;
  endDate: string;
  /** Empty means every category. */
  categories: string[];
  keyword: string | null;
  groupBy: "none" | "category" | "month" | "payer" | "account";
  /** Human-readable period label for the reply, e.g. "bulan ini". */
  label: string;
}

/**
 * What a message turned out to mean. The wire schema Claude fills is flat
 * (see parse/schema.ts); this is the narrowed form the rest of the app uses.
 */
export type Intent =
  | { kind: "transaction"; transaction: ParsedTransaction }
  | { kind: "query"; query: QuerySpec }
  | { kind: "unclear"; note: string };

export interface AggregateGroup {
  key: string;
  total: number;
  count: number;
}

export interface AggregateResult {
  total: number;
  count: number;
  groups: AggregateGroup[];
}

/** Household settings read from the Config tab. */
export interface SheetConfig {
  categories: string[];
  /** Known account / payment-method names, used to normalise what the model returns. */
  accounts: string[];
  /** Telegram user id → display name used in the payer column. */
  members: Map<number, string>;
}
