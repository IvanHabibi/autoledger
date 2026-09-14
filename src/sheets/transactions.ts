import type { LedgerRow, TxType } from "../types.js";
import { addDays, isIsoDate } from "../util/date.js";
import { getSheetId, quoteSheetName, type SheetsContext } from "./client.js";

/** Column order of the Transactions tab. Changing this changes the sheet. */
export const HEADERS = [
  "id",
  "timestamp_utc",
  "date",
  "type",
  "amount_idr",
  "category",
  "description",
  "merchant",
  "account",
  "payer",
  "source",
  "raw_text",
] as const;

const LAST_COLUMN = "L";
/** 1-based column of `category`, used when correcting one in place. */
const CATEGORY_COLUMN = "F";

/**
 * Sheets counts days from 1899-12-30. Values written as `2026-09-13` with
 * USER_ENTERED become real dates — which is what makes the user's own SUMIFs
 * work — and come back as serial numbers, so reads have to convert.
 */
const SHEETS_EPOCH = "1899-12-30";

export function rowToValues(row: LedgerRow): (string | number)[] {
  return [
    row.id,
    row.timestampUtc,
    row.date,
    row.type,
    row.amountIdr,
    row.category,
    row.description,
    row.merchant ?? "",
    row.account ?? "",
    row.payer,
    row.source,
    row.rawText,
  ];
}

/** Accepts a serial number, an ISO string, or a hand-typed DD/MM/YYYY. */
export function coerceIsoDate(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return addDays(SHEETS_EPOCH, Math.trunc(value));
  }
  if (typeof value !== "string") return null;

  const text = value.trim();
  if (isIsoDate(text)) return text;

  const slashed = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (slashed) {
    const [, d, m, y] = slashed as unknown as [string, string, string, string];
    const iso = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    return isIsoDate(iso) ? iso : null;
  }
  return null;
}

/** Amounts may arrive as a number, or as text if someone retyped a cell. */
export function coerceAmount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value !== "string") return null;
  const digits = value.replace(/[^\d-]/g, "");
  if (digits === "" || digits === "-") return null;
  const parsed = Number(digits);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

/**
 * Map one sheet row to a LedgerRow, or null if it is not usable.
 *
 * People will edit this sheet by hand, so a row with a blank amount or a
 * mistyped date must be skipped rather than poison a total.
 */
export function valuesToRow(values: unknown[]): LedgerRow | null {
  const id = String(values[0] ?? "").trim();
  const date = coerceIsoDate(values[2]);
  const type = String(values[3] ?? "").trim().toLowerCase();
  const amountIdr = coerceAmount(values[4]);

  if (id === "" || date === null || amountIdr === null) return null;
  if (type !== "expense" && type !== "income" && type !== "transfer") return null;

  const merchant = String(values[7] ?? "").trim();
  const account = String(values[8] ?? "").trim();
  const source = String(values[10] ?? "").trim() === "photo" ? "photo" : "text";

  return {
    id,
    timestampUtc: String(values[1] ?? ""),
    date,
    type: type as TxType,
    amountIdr,
    category: String(values[5] ?? "").trim() || "Lain-lain",
    description: String(values[6] ?? "").trim(),
    merchant: merchant === "" ? null : merchant,
    account: account === "" ? null : account,
    payer: String(values[9] ?? "").trim(),
    source,
    rawText: String(values[11] ?? ""),
    confidence: "high",
  };
}

export async function appendTransaction(ctx: SheetsContext, row: LedgerRow): Promise<void> {
  await ctx.api.spreadsheets.values.append({
    spreadsheetId: ctx.spreadsheetId,
    range: `${quoteSheetName(ctx.transactionsSheet)}!A:${LAST_COLUMN}`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [rowToValues(row)] },
  });
}

export async function readTransactions(ctx: SheetsContext): Promise<LedgerRow[]> {
  const res = await ctx.api.spreadsheets.values.get({
    spreadsheetId: ctx.spreadsheetId,
    range: `${quoteSheetName(ctx.transactionsSheet)}!A2:${LAST_COLUMN}`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const rows = res.data.values ?? [];
  const out: LedgerRow[] = [];
  for (const raw of rows) {
    const row = valuesToRow(raw as unknown[]);
    if (row) out.push(row);
  }
  return out;
}

/**
 * Find a row by its id, returning the 1-based sheet row number.
 *
 * Row numbers are never cached anywhere: the moment the other member of the
 * household adds an entry, a remembered row number points at their transaction
 * instead. Re-resolving by id on every mutation is what keeps Undo honest.
 */
export async function findRowNumberById(
  ctx: SheetsContext,
  id: string,
): Promise<number | null> {
  const res = await ctx.api.spreadsheets.values.get({
    spreadsheetId: ctx.spreadsheetId,
    range: `${quoteSheetName(ctx.transactionsSheet)}!A2:A`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const rows = res.data.values ?? [];
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i]?.[0] ?? "").trim() === id) return i + 2; // +1 header, +1 to 1-based
  }
  return null;
}

/** Deletes the row with this id. Returns false if it was already gone. */
export async function deleteTransactionById(
  ctx: SheetsContext,
  id: string,
): Promise<boolean> {
  const rowNumber = await findRowNumberById(ctx, id);
  if (rowNumber === null) return false;

  const sheetId = await getSheetId(ctx, ctx.transactionsSheet);
  await ctx.api.spreadsheets.batchUpdate({
    spreadsheetId: ctx.spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: rowNumber - 1, // this range is 0-based and end-exclusive
              endIndex: rowNumber,
            },
          },
        },
      ],
    },
  });
  return true;
}

/** Rewrites just the category cell of one row. Returns false if it is gone. */
export async function updateCategoryById(
  ctx: SheetsContext,
  id: string,
  category: string,
): Promise<boolean> {
  const rowNumber = await findRowNumberById(ctx, id);
  if (rowNumber === null) return false;

  await ctx.api.spreadsheets.values.update({
    spreadsheetId: ctx.spreadsheetId,
    range: `${quoteSheetName(ctx.transactionsSheet)}!${CATEGORY_COLUMN}${rowNumber}`,
    valueInputOption: "RAW",
    requestBody: { values: [[category]] },
  });
  return true;
}
