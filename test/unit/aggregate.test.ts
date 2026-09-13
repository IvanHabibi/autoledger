import { describe, expect, it } from "vitest";
import { aggregate, matchesQuery, summarize } from "../../src/report/aggregate.js";
import type { LedgerRow, QuerySpec } from "../../src/types.js";

let counter = 0;

function row(overrides: Partial<LedgerRow>): LedgerRow {
  counter += 1;
  return {
    id: `id-${counter}`,
    timestampUtc: "2026-09-13T00:00:00.000Z",
    date: "2026-09-10",
    type: "expense",
    amountIdr: 10_000,
    category: "Makanan & Minuman",
    description: "makan",
    merchant: null,
    payer: "Ivan",
    source: "text",
    rawText: "makan 10rb",
    confidence: "high",
    ...overrides,
  };
}

function query(overrides: Partial<QuerySpec> = {}): QuerySpec {
  return {
    scope: "both",
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    categories: [],
    keyword: null,
    groupBy: "none",
    label: "bulan ini",
    ...overrides,
  };
}

describe("matchesQuery", () => {
  it("filters on the date range, inclusive", () => {
    const q = query({ startDate: "2026-09-10", endDate: "2026-09-10" });
    expect(matchesQuery(row({ date: "2026-09-10" }), q)).toBe(true);
    expect(matchesQuery(row({ date: "2026-09-09" }), q)).toBe(false);
    expect(matchesQuery(row({ date: "2026-09-11" }), q)).toBe(false);
  });

  it("filters on direction", () => {
    expect(matchesQuery(row({ type: "income" }), query({ scope: "expense" }))).toBe(false);
    expect(matchesQuery(row({ type: "income" }), query({ scope: "income" }))).toBe(true);
    expect(matchesQuery(row({ type: "income" }), query({ scope: "both" }))).toBe(true);
  });

  it("matches categories case-insensitively", () => {
    const q = query({ categories: ["makanan & minuman"] });
    expect(matchesQuery(row({ category: "Makanan & Minuman" }), q)).toBe(true);
    expect(matchesQuery(row({ category: "Transportasi" }), q)).toBe(false);
  });

  it("searches description, merchant and the original message for a keyword", () => {
    const q = query({ keyword: "indomaret" });
    expect(matchesQuery(row({ merchant: "Indomaret" }), q)).toBe(true);
    expect(matchesQuery(row({ description: "belanja di INDOMARET" }), q)).toBe(true);
    expect(matchesQuery(row({ rawText: "beli beras 50rb di indomaret" }), q)).toBe(true);
    expect(matchesQuery(row({ merchant: "Alfamart", rawText: "beli beras" }), q)).toBe(false);
  });
});

describe("aggregate", () => {
  const rows = [
    row({ date: "2026-09-02", amountIdr: 50_000, category: "Makanan & Minuman" }),
    row({ date: "2026-09-03", amountIdr: 30_000, category: "Transportasi" }),
    row({ date: "2026-09-04", amountIdr: 20_000, category: "Makanan & Minuman" }),
    row({ date: "2026-08-31", amountIdr: 99_000, category: "Makanan & Minuman" }),
    row({ date: "2026-09-05", amountIdr: 15_000_000, type: "income", category: "Gaji" }),
  ];

  it("totals only the rows inside the period and scope", () => {
    const result = aggregate(rows, query({ scope: "expense" }));
    expect(result.total).toBe(100_000);
    expect(result.count).toBe(3);
  });

  it("groups by category, largest first", () => {
    const result = aggregate(rows, query({ scope: "expense", groupBy: "category" }));
    expect(result.groups).toEqual([
      { key: "Makanan & Minuman", total: 70_000, count: 2 },
      { key: "Transportasi", total: 30_000, count: 1 },
    ]);
  });

  it("groups by month in chronological order", () => {
    const result = aggregate(
      rows,
      query({ scope: "expense", startDate: "2026-08-01", groupBy: "month" }),
    );
    expect(result.groups.map((g) => g.key)).toEqual(["2026-08", "2026-09"]);
  });

  it("groups by payer and names an empty payer rather than dropping it", () => {
    const result = aggregate(
      [row({ payer: "Ivan", amountIdr: 10_000 }), row({ payer: "", amountIdr: 5_000 })],
      query({ scope: "expense", groupBy: "payer" }),
    );
    expect(result.groups).toEqual([
      { key: "Ivan", total: 10_000, count: 1 },
      { key: "(tanpa nama)", total: 5_000, count: 1 },
    ]);
  });

  it("returns a zero total for an empty period instead of throwing", () => {
    const result = aggregate(rows, query({ startDate: "2020-01-01", endDate: "2020-01-31" }));
    expect(result).toEqual({ total: 0, count: 0, groups: [] });
  });
});

describe("summarize", () => {
  it("separates the two directions and nets them", () => {
    const summary = summarize(
      [
        row({ date: "2026-09-02", amountIdr: 50_000 }),
        row({ date: "2026-09-03", amountIdr: 30_000, category: "Transportasi" }),
        row({ date: "2026-09-05", amountIdr: 15_000_000, type: "income", category: "Gaji" }),
        row({ date: "2026-08-20", amountIdr: 1_000_000 }), // outside the period
      ],
      "2026-09-01",
      "2026-09-30",
    );

    expect(summary.income).toBe(15_000_000);
    expect(summary.expense).toBe(80_000);
    expect(summary.net).toBe(14_920_000);
    expect(summary.count).toBe(3);
    // Income never appears in the expense breakdown.
    expect(summary.expenseByCategory.map((g) => g.key)).toEqual([
      "Makanan & Minuman",
      "Transportasi",
    ]);
  });

  it("reports a negative net when the household overspent", () => {
    const summary = summarize(
      [
        row({ date: "2026-09-02", amountIdr: 500_000 }),
        row({ date: "2026-09-03", amountIdr: 100_000, type: "income" }),
      ],
      "2026-09-01",
      "2026-09-30",
    );
    expect(summary.net).toBe(-400_000);
  });
});
