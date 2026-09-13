import { google, type sheets_v4 } from "googleapis";
import type { Config } from "../config.js";

export interface SheetsContext {
  api: sheets_v4.Sheets;
  spreadsheetId: string;
  transactionsSheet: string;
  configSheet: string;
}

export function createSheetsContext(config: Config): SheetsContext {
  const auth = new google.auth.JWT({
    email: config.serviceAccount.client_email,
    key: config.serviceAccount.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return {
    api: google.sheets({ version: "v4", auth }),
    spreadsheetId: config.spreadsheetId,
    transactionsSheet: config.transactionsSheet,
    configSheet: config.configSheet,
  };
}

/**
 * A1 notation needs the tab name quoted if it contains anything but letters and
 * digits, and an internal apostrophe doubled. Getting this wrong produces a
 * confusing "Unable to parse range" rather than an obvious failure.
 */
export function quoteSheetName(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

/** The spreadsheet is reachable but not shaped the way we need. */
export class SheetStructureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SheetStructureError";
  }
}

const sheetIdCache = new Map<string, number>();

/** Resolve a tab's numeric sheetId (its gid), which row deletion requires. */
export async function getSheetId(ctx: SheetsContext, title: string): Promise<number> {
  const cacheKey = `${ctx.spreadsheetId}:${title}`;
  const cached = sheetIdCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const res = await ctx.api.spreadsheets.get({
    spreadsheetId: ctx.spreadsheetId,
    fields: "sheets.properties(sheetId,title)",
  });
  const match = res.data.sheets?.find((s) => s.properties?.title === title);
  const sheetId = match?.properties?.sheetId;
  if (sheetId === null || sheetId === undefined) {
    const available = (res.data.sheets ?? [])
      .map((s) => s.properties?.title)
      .filter(Boolean)
      .join(", ");
    throw new SheetStructureError(
      `The spreadsheet has no tab named "${title}". Tabs present: ${available || "(none)"}. ` +
        "Run `npm run bootstrap` to create the expected tabs.",
    );
  }
  sheetIdCache.set(cacheKey, sheetId);
  return sheetId;
}

/** Turns the common Google API failures into messages that say what to do. */
export function describeSheetsError(error: unknown): string {
  const status = (error as { code?: number; status?: number } | null)?.code ??
    (error as { status?: number } | null)?.status;
  const message = error instanceof Error ? error.message : String(error);

  if (status === 403) {
    return (
      "Google refused access to the spreadsheet. Share it with the service account's " +
      "client_email as an Editor, and make sure the Sheets API is enabled."
    );
  }
  if (status === 404) {
    return "No spreadsheet with that SPREADSHEET_ID. Check the id in the sheet's URL.";
  }
  if (status === 401) {
    return "Google rejected the service account key. Check GOOGLE_SERVICE_ACCOUNT_JSON.";
  }
  return `Google Sheets error: ${message}`;
}
