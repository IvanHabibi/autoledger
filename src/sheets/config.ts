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
  "Pindah Dana",
  "Gaji",
  "Bonus & THR",
  "Pendapatan Lain",
  "Lain-lain",
] as const;

/**
 * Account / payment-method names. Purely descriptive tags for slicing spending
 * by where the money went through — no balances are tracked against them, on
 * purpose: a balance is only true if capture is complete, and a chat ledger
 * cannot guarantee that. The bank app remains the source of truth for balances.
 */
export const DEFAULT_ACCOUNTS = ["Cash", "BCA", "Mandiri", "GoPay", "OVO"] as const;

export const CONFIG_HEADERS = [
  "Category",
  "Notes",
  "Telegram ID (payer name only)",
  "Member Name",
  "Account",
] as const;

/** Category edits should take effect without a restart, but not cost a read per message. */
const CACHE_TTL_MS = 5 * 60 * 1000;

let cache: { at: number; value: SheetConfig } | null = null;

export function parseConfigValues(rows: unknown[][]): SheetConfig {
  const categories: string[] = [];
  const accounts: string[] = [];
  const members = new Map<number, string>();

  for (const row of rows) {
    const category = String(row[0] ?? "").trim();
    if (category !== "") categories.push(category);

    const account = String(row[4] ?? "").trim();
    if (account !== "") accounts.push(account);

    const idText = String(row[2] ?? "").trim();
    const name = String(row[3] ?? "").trim();
    if (idText !== "") {
      const id = Number(idText);
      if (Number.isSafeInteger(id) && id > 0 && name !== "") members.set(id, name);
    }
  }

  return {
    categories: categories.length > 0 ? categories : [...DEFAULT_CATEGORIES],
    // An empty Account column is fine — the tag is optional, so an empty list
    // just means nothing gets normalised and whatever the model reads is kept.
    accounts,
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
    range: `${quoteSheetName(ctx.configSheet)}!A2:E`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });

  const value = parseConfigValues((res.data.values ?? []) as unknown[][]);
  cache = { at: Date.now(), value };
  return value;
}

export function clearConfigCache(): void {
  cache = null;
}

/**
 * Members named in the Config tab who cannot actually use the bot.
 *
 * Mapping someone here only gives their entries a nicer `payer` name; access is
 * granted solely by ALLOWED_TELEGRAM_IDS. Adding a person to the sheet and
 * expecting them to be let in is the obvious mistake, and silently doing
 * nothing is a poor way to report it — so boot and /reload call this and say so.
 *
 * The allowlist deliberately stays out of the spreadsheet: the bot edits that
 * sheet with its own credentials, so anyone able to edit it could otherwise
 * grant themselves access to the household's finances.
 */
export function membersMissingFromAllowlist(
  config: SheetConfig,
  allowedIds: ReadonlySet<number>,
): Array<{ id: number; name: string }> {
  const missing: Array<{ id: number; name: string }> = [];
  for (const [id, name] of config.members) {
    if (!allowedIds.has(id)) missing.push({ id, name });
  }
  return missing;
}

/** Falls back to the Telegram display name when the member isn't mapped. */
export function resolvePayer(
  config: SheetConfig,
  telegramId: number,
  displayName: string,
): string {
  return config.members.get(telegramId) ?? displayName;
}
