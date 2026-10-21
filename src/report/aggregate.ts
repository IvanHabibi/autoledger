import type { AggregateGroup, AggregateResult, LedgerRow, QuerySpec } from "../types.js";
import { isWithin, monthKey } from "../util/date.js";

/**
 * Reporting is deliberately pure arithmetic over rows, with no model in the
 * loop. Claude decides *what* to measure (the QuerySpec); the sums below are
 * the only thing that decides *how much*. A ledger that quietly mis-adds is
 * worse than no ledger, and language models are not adding machines.
 */

/**
 * `"both"` is income and expense, NOT everything: a transfer is money that only
 * moved between our own accounts, so counting it in an unscoped total would
 * report spending that never happened. Ask for it explicitly to see it.
 */
export function inScope(type: LedgerRow["type"], scope: QuerySpec["scope"]): boolean {
  return scope === "both" ? type !== "transfer" : type === scope;
}

export function matchesQuery(row: LedgerRow, query: QuerySpec): boolean {
  if (!isWithin(row.date, query.startDate, query.endDate)) return false;
  if (!inScope(row.type, query.scope)) return false;

  if (query.categories.length > 0) {
    const wanted = query.categories.map((c) => c.toLowerCase());
    if (!wanted.includes(row.category.toLowerCase())) return false;
  }

  if (query.keyword) {
    const needle = query.keyword.toLowerCase();
    const haystack = `${row.description} ${row.merchant ?? ""} ${row.account ?? ""} ${row.rawText}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }

  return true;
}

function groupKeyOf(row: LedgerRow, groupBy: QuerySpec["groupBy"]): string {
  switch (groupBy) {
    case "category":
      return row.category;
    case "month":
      return monthKey(row.date);
    case "payer":
      return row.payer || "(tanpa nama)";
    case "account":
      return row.account || "(tanpa akun)";
    case "none":
      return "total";
  }
}

export function aggregate(rows: readonly LedgerRow[], query: QuerySpec): AggregateResult {
  const matched = rows.filter((row) => matchesQuery(row, query));

  const buckets = new Map<string, AggregateGroup>();
  let total = 0;

  for (const row of matched) {
    total += row.amountIdr;
    const key = groupKeyOf(row, query.groupBy);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.total += row.amountIdr;
      bucket.count += 1;
    } else {
      buckets.set(key, { key, total: row.amountIdr, count: 1 });
    }
  }

  const groups = [...buckets.values()].sort((a, b) =>
    // Months read naturally in chronological order; everything else by size.
    query.groupBy === "month" ? a.key.localeCompare(b.key) : b.total - a.total,
  );

  return { total, count: matched.length, groups };
}

export interface Summary {
  startDate: string;
  endDate: string;
  income: number;
  expense: number;
  /** Money moved between our own accounts. Reported, but in neither total above. */
  transferred: number;
  transferCount: number;
  /** Positive means the household took in more than it spent. Transfers excluded. */
  net: number;
  count: number;
  expenseByCategory: AggregateGroup[];
}

/**
 * The /summary command: both directions of money over one period.
 *
 * The three types are handled explicitly rather than as "income, or else
 * expense". That earlier shape is what silently counted every transfer as
 * spending — an ATM withdrawal would show up as money gone.
 */
export function summarize(
  rows: readonly LedgerRow[],
  startDate: string,
  endDate: string,
): Summary {
  let income = 0;
  let expense = 0;
  let transferred = 0;
  let transferCount = 0;
  let count = 0;
  const buckets = new Map<string, AggregateGroup>();

  for (const row of rows) {
    if (!isWithin(row.date, startDate, endDate)) continue;
    count += 1;

    switch (row.type) {
      case "income":
        income += row.amountIdr;
        break;

      case "transfer":
        transferred += row.amountIdr;
        transferCount += 1;
        break;

      case "expense": {
        expense += row.amountIdr;
        const bucket = buckets.get(row.category);
        if (bucket) {
          bucket.total += row.amountIdr;
          bucket.count += 1;
        } else {
          buckets.set(row.category, { key: row.category, total: row.amountIdr, count: 1 });
        }
        break;
      }
    }
  }

  return {
    startDate,
    endDate,
    income,
    expense,
    transferred,
    transferCount,
    net: income - expense,
    count,
    expenseByCategory: [...buckets.values()].sort((a, b) => b.total - a.total),
  };
}
