import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  formatDateId,
  formatRange,
  renderEntry,
  renderReport,
  renderSummary,
} from "../../src/bot/format.js";
import { summarize } from "../../src/report/aggregate.js";
import type { AggregateResult, LedgerRow, QuerySpec } from "../../src/types.js";

const ROW: LedgerRow = {
  id: "01JQ8Z9K7NA1B2C3D4E5F6G7H8",
  timestampUtc: "2026-09-13T04:12:33.000Z",
  date: "2026-09-13",
  type: "expense",
  amountIdr: 50_000,
  category: "Belanja Harian",
  description: "beli beras",
  merchant: "Indomaret",
  account: "BCA",
  payer: "Ivan",
  source: "text",
  rawText: "beli beras 50rb di indomaret",
  confidence: "high",
};

describe("formatDateId", () => {
  it("renders Indonesian month abbreviations", () => {
    expect(formatDateId("2026-09-13")).toBe("13 Sep 2026");
    expect(formatDateId("2026-05-01")).toBe("1 Mei 2026");
    expect(formatDateId("2026-12-31")).toBe("31 Des 2026");
    expect(formatDateId("2026-08-07")).toBe("7 Agu 2026");
  });
});

describe("formatRange", () => {
  it("collapses a single-day range", () => {
    expect(formatRange("2026-09-13", "2026-09-13")).toBe("13 Sep 2026");
  });

  it("shows both ends otherwise", () => {
    expect(formatRange("2026-09-01", "2026-09-13")).toBe("1 Sep 2026 – 13 Sep 2026");
  });
});

describe("escapeHtml", () => {
  it("neutralises markup from user text", () => {
    expect(escapeHtml("<b>hi</b>")).toBe("&lt;b&gt;hi&lt;/b&gt;");
    expect(escapeHtml("Ben & Jerry")).toBe("Ben &amp; Jerry");
  });

  it("escapes the ampersand first so entities are not double-broken", () => {
    expect(escapeHtml("a & <b>")).toBe("a &amp; &lt;b&gt;");
  });
});

describe("renderEntry", () => {
  it("leads with the amount and category", () => {
    const text = renderEntry(ROW);
    expect(text).toContain("Pengeluaran dicatat");
    expect(text).toContain("Rp 50.000");
    expect(text).toContain("Belanja Harian");
    expect(text).toContain("Indomaret");
    expect(text).toContain("13 Sep 2026");
    expect(text).toContain("Ivan");
  });

  it("labels income differently", () => {
    expect(renderEntry({ ...ROW, type: "income" })).toContain("Pemasukan dicatat");
  });

  it("warns when the parse was shaky", () => {
    expect(renderEntry({ ...ROW, confidence: "low" })).toContain("⚠️");
    expect(renderEntry(ROW)).not.toContain("⚠️");
  });

  it("escapes a merchant name containing markup", () => {
    const text = renderEntry({ ...ROW, merchant: "Toko <b>Murah</b>" });
    expect(text).toContain("Toko &lt;b&gt;Murah&lt;/b&gt;");
    expect(text).not.toContain("Toko <b>Murah</b>");
  });

  it("omits the detail line when there is nothing to say", () => {
    const text = renderEntry({ ...ROW, description: "", merchant: null });
    expect(text).not.toContain("—");
  });
});

describe("renderReport", () => {
  const query: QuerySpec = {
    scope: "expense",
    startDate: "2026-09-01",
    endDate: "2026-09-13",
    categories: [],
    keyword: null,
    groupBy: "category",
    label: "bulan ini",
  };

  it("shows the total, the count and each share", () => {
    const result: AggregateResult = {
      total: 100_000,
      count: 3,
      groups: [
        { key: "Makanan & Minuman", total: 70_000, count: 2 },
        { key: "Transportasi", total: 30_000, count: 1 },
      ],
    };
    const text = renderReport(query, result);
    expect(text).toContain("Rp 100.000");
    expect(text).toContain("3 transaksi");
    expect(text).toContain("70%");
    expect(text).toContain("30%");
    expect(text).toContain("Makanan &amp; Minuman");
  });

  it("says so plainly when there is nothing recorded", () => {
    const text = renderReport(query, { total: 0, count: 0, groups: [] });
    expect(text).toContain("Belum ada catatan");
    // No division by zero creeping in as NaN%.
    expect(text).not.toContain("NaN");
  });

  it("truncates a very long breakdown", () => {
    const groups = Array.from({ length: 20 }, (_, i) => ({
      key: `Kategori ${i}`,
      total: 1_000,
      count: 1,
    }));
    const text = renderReport(query, { total: 20_000, count: 20, groups });
    expect(text).toContain("dan 8 kategori lain");
  });
});

describe("renderSummary", () => {
  it("shows both directions and the net", () => {
    const summary = summarize(
      [
        { ...ROW, date: "2026-09-02", amountIdr: 80_000 },
        { ...ROW, date: "2026-09-05", amountIdr: 15_000_000, type: "income", category: "Gaji" },
      ],
      "2026-09-01",
      "2026-09-30",
    );
    const text = renderSummary(summary);
    expect(text).toContain("Rp 15.000.000");
    expect(text).toContain("Rp 80.000");
    expect(text).toContain("+Rp 14.920.000");
  });

  it("marks an overspend with a minus rather than a stray sign", () => {
    const summary = summarize(
      [{ ...ROW, date: "2026-09-02", amountIdr: 500_000 }],
      "2026-09-01",
      "2026-09-30",
    );
    const text = renderSummary(summary);
    expect(text).toContain("−Rp 500.000");
    expect(text).not.toContain("−-");
  });
});
