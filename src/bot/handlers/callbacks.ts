import type { Bot } from "grammy";
import { readSheetConfig } from "../../sheets/config.js";
import { deleteTransactionById, updateCategoryById } from "../../sheets/transactions.js";
import type { App } from "../app.js";
import { decodeCallback } from "../callback-data.js";
import { renderEntry, renderUndone } from "../format.js";
import { categoryKeyboard, entryKeyboard } from "../keyboards.js";

export function registerCallbackHandler(bot: Bot, app: App): void {
  bot.on("callback_query:data", async (ctx) => {
    const action = decodeCallback(ctx.callbackQuery.data);
    if (!action) {
      // Stale or malformed button. Release the client's spinner and move on.
      await ctx.answerCallbackQuery();
      return;
    }

    try {
      switch (action.kind) {
        case "undo": {
          const deleted = await deleteTransactionById(app.sheets, action.id);
          const row = app.recent.get(action.id);
          app.recent.delete(action.id);

          await ctx.answerCallbackQuery(deleted ? "Dibatalkan" : "Baris sudah tidak ada");
          await ctx.editMessageText(
            deleted ? renderUndone(row) : "🗑 <b>Baris itu sudah tidak ada di sheet.</b>",
            { parse_mode: "HTML" },
          );
          return;
        }

        case "pick-category": {
          const sheetConfig = await readSheetConfig(app.sheets);
          await ctx.answerCallbackQuery();
          await ctx.editMessageReplyMarkup({
            reply_markup: categoryKeyboard(action.id, sheetConfig.categories),
          });
          return;
        }

        case "set-category": {
          const sheetConfig = await readSheetConfig(app.sheets);
          const category = sheetConfig.categories[action.index];
          if (!category) {
            // The Config tab changed between rendering the keyboard and the tap.
            await ctx.answerCallbackQuery("Daftar kategori sudah berubah");
            return;
          }

          const updated = await updateCategoryById(app.sheets, action.id, category);
          if (!updated) {
            await ctx.answerCallbackQuery("Baris sudah tidak ada");
            return;
          }
          await ctx.answerCallbackQuery(`→ ${category}`);

          const previous = app.recent.get(action.id);
          if (previous) {
            const next = { ...previous, category };
            app.recent.set(next);
            await ctx.editMessageText(renderEntry(next), {
              parse_mode: "HTML",
              reply_markup: entryKeyboard(action.id),
            });
          } else {
            // Recorded before a restart: the sheet is already updated, so just
            // restore the buttons rather than re-render a row we no longer hold.
            await ctx.editMessageReplyMarkup({ reply_markup: entryKeyboard(action.id) });
          }
          return;
        }

        case "dismiss": {
          await ctx.answerCallbackQuery();
          await ctx.editMessageReplyMarkup({ reply_markup: entryKeyboard(action.id) });
          return;
        }
      }
    } catch (error) {
      // An unanswered callback query leaves the button spinning for a minute,
      // which reads as a hung bot. Release it, then let the error boundary log
      // and explain. A double-answer is harmless and ignored.
      await ctx.answerCallbackQuery("Gagal — coba lagi").catch(() => {});
      throw error;
    }
  });
}
