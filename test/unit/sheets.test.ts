import { describe, expect, it } from "vitest";
import { quoteSheetName } from "../../src/sheets/client.js";
import {
  DEFAULT_CATEGORIES,
  parseConfigValues,
  resolvePayer,
} from "../../src/sheets/config.js";
import {
  HEADERS,
  coerceAmount,
  coerceIsoDate,
  rowToValues,
  valuesToRow,
} from "../../src/sheets/transactions.js";
import type { LedgerRow } from "../../src/types.js";

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

describe("quoteSheetName", () => {
  it("quotes the name and doubles any apostrophe", () => {
    expect(quoteSheetName("Transactions")).toBe("'Transactions'");
    expect(quoteSheetName("My Tab")).toBe("'My Tab'");
    expect(quoteSheetName("Ivan's Tab")).toBe("'Ivan''s Tab'");
  });
});

describe("row serialisation", () => {
  it("writes one value per header, in order", () => {
    const values = rowToValues(ROW);
    expect(values).toHaveLength(HEADERS.length);
    expect(values[0]).toBe(ROW.id);
    expect(values[4]).toBe(50_000); // a number, so the sheet's own SUMIFs work
  });

  it("writes an absent merchant or account as an empty cell, not the text 'null'", () => {
    expect(rowToValues({ ...ROW, merchant: null })[7]).toBe("");
    expect(rowToValues({ ...ROW, account: null })[8]).toBe("");
  });

  it("survives a round trip", () => {
    const back = valuesToRow(rowToValues(ROW));
    expect(back).not.toBeNull();
    expect(back).toMatchObject({
      id: ROW.id,
      date: ROW.date,
      type: ROW.type,
      amountIdr: ROW.amountIdr,
      category: ROW.category,
      merchant: ROW.merchant,
      account: ROW.account,
      payer: ROW.payer,
      source: ROW.source,
      rawText: ROW.rawText,
    });
  });

  it("round-trips a transfer", () => {
    const back = valuesToRow(rowToValues({ ...ROW, type: "transfer", category: "Pindah Dana" }));
    // Before `transfer` was a valid type this returned null, which silently
    // dropped every transfer row from every report.
    expect(back?.type).toBe("transfer");
  });
});

describe("coerceIsoDate", () => {
  it("converts the date serial Sheets hands back", () => {
    // Sheets counts days from 1899-12-30, so 46278 is 2026-09-13.
    expect(coerceIsoDate(46_278)).toBe("2026-09-13");
    expect(coerceIsoDate(1)).toBe("1899-12-31");
  });

  it("accepts an ISO string unchanged", () => {
    expect(coerceIsoDate("2026-09-13")).toBe("2026-09-13");
    expect(coerceIsoDate("  2026-09-13 ")).toBe("2026-09-13");
  });

  it("accepts a hand-typed DD/MM/YYYY, since people edit this sheet", () => {
    expect(coerceIsoDate("13/09/2026")).toBe("2026-09-13");
    expect(coerceIsoDate("1/2/2026")).toBe("2026-02-01");
  });

  it("rejects what it cannot understand", () => {
    expect(coerceIsoDate("")).toBeNull();
    expect(coerceIsoDate("kemarin")).toBeNull();
    expect(coerceIsoDate("32/01/2026")).toBeNull();
    expect(coerceIsoDate(null)).toBeNull();
    expect(coerceIsoDate(undefined)).toBeNull();
  });
});

describe("coerceAmount", () => {
  it("takes numbers as they are", () => {
    expect(coerceAmount(50_000)).toBe(50_000);
    expect(coerceAmount(50_000.4)).toBe(50_000);
  });

  it("strips formatting from a retyped text cell", () => {
    expect(coerceAmount("50000")).toBe(50_000);
    expect(coerceAmount("Rp 50.000")).toBe(50_000);
    expect(coerceAmount("50,000")).toBe(50_000);
  });

  it("rejects cells with no digits", () => {
    expect(coerceAmount("")).toBeNull();
    expect(coerceAmount("-")).toBeNull();
    expect(coerceAmount("n/a")).toBeNull();
    expect(coerceAmount(null)).toBeNull();
  });
});

describe("valuesToRow", () => {
  const base = rowToValues(ROW);

  it("skips rows a human broke rather than poisoning a total", () => {
    expect(valuesToRow([])).toBeNull();
    expect(valuesToRow(base.map((_, i) => (i === 0 ? "" : base[i])))).toBeNull(); // no id
    expect(valuesToRow(base.map((_, i) => (i === 4 ? "" : base[i])))).toBeNull(); // no amount
    expect(valuesToRow(base.map((_, i) => (i === 2 ? "besok" : base[i])))).toBeNull(); // bad date
    expect(valuesToRow(base.map((_, i) => (i === 3 ? "spend" : base[i])))).toBeNull(); // bad type
  });

  it("normalises the type column's casing", () => {
    const values = base.map((v, i) => (i === 3 ? "Income" : v));
    expect(valuesToRow(values)?.type).toBe("income");
  });

  it("treats an unknown source as text", () => {
    const values = base.map((v, i) => (i === 10 ? "whatsapp" : v));
    expect(valuesToRow(values)?.source).toBe("text");
  });

  it("accepts transfer as a type", () => {
    const values = base.map((v, i) => (i === 3 ? "Transfer" : v));
    expect(valuesToRow(values)?.type).toBe("transfer");
  });

  it("reads the columns after the new account column from the right places", () => {
    const row = valuesToRow(base);
    expect(row?.account).toBe("BCA");
    expect(row?.payer).toBe("Ivan");
    expect(row?.source).toBe("text");
    expect(row?.rawText).toBe(ROW.rawText);
  });
});

describe("parseConfigValues", () => {
  it("reads categories from A, members from C and D, accounts from E", () => {
    const config = parseConfigValues([
      ["Makanan", "", "111", "Ivan", "Cash"],
      ["Transportasi", "", "222", "Dina", "BCA"],
      ["Lain-lain", "", "", "", ""],
    ]);
    expect(config.categories).toEqual(["Makanan", "Transportasi", "Lain-lain"]);
    expect(config.accounts).toEqual(["Cash", "BCA"]);
    expect(config.members.get(111)).toBe("Ivan");
    expect(config.members.get(222)).toBe("Dina");
    expect(config.members.size).toBe(2);
  });

  it("ignores member rows that are half filled in", () => {
    const config = parseConfigValues([
      ["Makanan", "", "333", ""],
      ["", "", "abc", "Nobody"],
    ]);
    expect(config.members.size).toBe(0);
  });

  it("falls back to the default categories when the tab is empty", () => {
    expect(parseConfigValues([]).categories).toEqual([...DEFAULT_CATEGORIES]);
  });

  it("keeps gaps in the category column from becoming blank categories", () => {
    const config = parseConfigValues([["Makanan"], [""], ["Transportasi"]]);
    expect(config.categories).toEqual(["Makanan", "Transportasi"]);
  });

  it("leaves accounts empty when the column is unused, since the tag is optional", () => {
    expect(parseConfigValues([["Makanan"]]).accounts).toEqual([]);
    expect(parseConfigValues([]).accounts).toEqual([]);
  });

  it("includes Pindah Dana among the defaults, so transfers have a category", () => {
    expect(DEFAULT_CATEGORIES).toContain("Pindah Dana");
  });
});

describe("resolvePayer", () => {
  const config = parseConfigValues([["Makanan", "", "111", "Ivan"]]);

  it("prefers the configured household name", () => {
    expect(resolvePayer(config, 111, "ivanhabibi")).toBe("Ivan");
  });

  it("falls back to the Telegram display name for an unmapped member", () => {
    expect(resolvePayer(config, 999, "Someone Else")).toBe("Someone Else");
  });
});
