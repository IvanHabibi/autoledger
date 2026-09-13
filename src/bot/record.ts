import type { Context } from "grammy";
import type { User } from "grammy/types";
import { resolvePayer } from "../sheets/config.js";
import { appendTransaction } from "../sheets/transactions.js";
import type { LedgerRow, ParsedTransaction, SheetConfig } from "../types.js";
import { ulid } from "../util/id.js";
import type { App } from "./app.js";
import { displayName } from "./app.js";
import { renderEntry } from "./format.js";
import { entryKeyboard } from "./keyboards.js";

/**
 * Write one parsed transaction to the sheet and confirm it in chat.
 *
 * Shared by the text and photo paths, so a receipt and a typed sentence end up
 * as the same kind of row with the same buttons.
 */
export async function recordTransaction(
  app: App,
  ctx: Context,
  sheetConfig: SheetConfig,
  from: User,
  parsed: ParsedTransaction,
  source: LedgerRow["source"],
  rawText: string,
): Promise<LedgerRow> {
  const row: LedgerRow = {
    ...parsed,
    id: ulid(),
    timestampUtc: new Date().toISOString(),
    payer: resolvePayer(sheetConfig, from.id, displayName(from)),
    source,
    rawText,
  };

  await appendTransaction(app.sheets, row);
  app.recent.set(row);

  await ctx.reply(renderEntry(row), {
    parse_mode: "HTML",
    reply_markup: entryKeyboard(row.id),
  });

  return row;
}
