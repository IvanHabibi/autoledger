import type { SheetConfig } from "../types.js";
import { quoteSheetName, type SheetsContext } from "./client.js";

/**
 * Starting categories, written by `npm run bootstrap`. Edit them in the sheet
 * afterwards — the bot reads the live list, and the parser is constrained to
 * whatever is there, so it can never invent a category that breaks a pivot.
 */
export const DEFAULT_CATEGORIES = [
  "Makanan & Minuman",
  "Belanja Harian",
  "Transportasi",
  "Rumah & Utilitas",
  "Kesehatan",
  "Pendidikan",
  "Anak",
  "Komunikasi & Internet",
  "Hiburan",
  "Pakaian",
  "Perawatan Diri",
  "Hadiah & Sosial",
  "Cicilan & Pinjaman",
  "Tabungan & Investasi",
  "Pajak & Administrasi",
  "Gaji",
  "Bonus & THR",
  "Pendapatan Lain",
  "Lain-lain",
] as const;

export const CONFIG_HEADERS = ["Category", "Notes", "Telegram ID", "Member Name"] as const;

/** Category edits should take effect without a restart, but not cost a read per message. */
const CACHE_TTL_MS = 5 * 60 * 1000;

let cache: { at: number; value: SheetConfig } | null = null;

export function parseConfigValues(rows: unknown[][]): SheetConfig {
  const categories: string[] = [];
  const members = new Map<number, string>();

  for (const row of rows) {
    const category = String(row[0] ?? "").trim();
    if (category !== "") categories.push(category);

    const idText = String(row[2] ?? "").trim();
    const name = String(row[3] ?? "").trim();
    if (idText !== "") {
      const id = Number(idText);
      if (Number.isSafeInteger(id) && id > 0 && name !== "") members.set(id, name);
    }
  }

  return {
    categories: categories.length > 0 ? categories : [...DEFAULT_CATEGORIES],
    members,
  };
}

export async function readSheetConfig(
  ctx: SheetsContext,
  options: { force?: boolean } = {},
): Promise<SheetConfig> {
  if (!options.force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.value;
  }

  const res = await ctx.api.spreadsheets.values.get({
    spreadsheetId: ctx.spreadsheetId,
    range: `${quoteSheetName(ctx.configSheet)}!A2:D`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });

  const value = parseConfigValues((res.data.values ?? []) as unknown[][]);
  cache = { at: Date.now(), value };
  return value;
}

export function clearConfigCache(): void {
  cache = null;
}

/** Falls back to the Telegram display name when the member isn't mapped. */
export function resolvePayer(
  config: SheetConfig,
  telegramId: number,
  displayName: string,
): string {
  return config.members.get(telegramId) ?? displayName;
}
