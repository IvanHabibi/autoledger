import type { Bot } from "grammy";
import { summarize } from "../../report/aggregate.js";
import {
  clearConfigCache,
  membersMissingFromAllowlist,
  readSheetConfig,
} from "../../sheets/config.js";
import { readTransactions } from "../../sheets/transactions.js";
import { monthBounds, previousMonthBounds, todayInTimeZone } from "../../util/date.js";
import type { App } from "../app.js";
import { HELP_TEXT, escapeHtml, renderSummary } from "../format.js";

export function registerCommandHandlers(bot: Bot, app: App): void {
  bot.command(["start", "help"], async (ctx) => {
    await ctx.reply(HELP_TEXT, { parse_mode: "HTML" });
  });

  bot.command("categories", async (ctx) => {
    const sheetConfig = await readSheetConfig(app.sheets, { force: true });
    const list = sheetConfig.categories.map((c) => `• ${escapeHtml(c)}`).join("\n");
    await ctx.reply(
      `<b>Kategori</b>\n${list}\n\n<i>Ubah daftarnya di tab ${escapeHtml(
        app.config.configSheet,
      )} pada sheet.</i>`,
      { parse_mode: "HTML" },
    );
  });

  bot.command("summary", async (ctx) => {
    await ctx.replyWithChatAction("typing");

    const today = todayInTimeZone(app.config.timeZone);
    const wantsPrevious = /\b(lalu|last|kemarin|prev)\b/i.test(ctx.match ?? "");

    // Month-to-date for the current month; the full month when asked for the last one.
    const { start, end } = wantsPrevious
      ? previousMonthBounds(today)
      : { start: monthBounds(today).start, end: today };

    const rows = await readTransactions(app.sheets);
    await ctx.reply(renderSummary(summarize(rows, start, end)), { parse_mode: "HTML" });
  });

  bot.command("reload", async (ctx) => {
    clearConfigCache();
    const sheetConfig = await readSheetConfig(app.sheets, { force: true });

    const lines = [
      `♻️ Konfigurasi dimuat ulang: ${sheetConfig.categories.length} kategori, ` +
        `${sheetConfig.members.size} anggota, ${sheetConfig.accounts.length} akun.`,
    ];

    // The most likely moment to catch the mistake: someone has just added a
    // person to the Config tab and is expecting that to let them in.
    const blocked = membersMissingFromAllowlist(sheetConfig, app.config.allowedTelegramIds);
    for (const { id, name } of blocked) {
      lines.push(
        "",
        `⚠️ <b>${escapeHtml(name)}</b> (<code>${id}</code>) ada di tab Config tapi ` +
          "belum bisa pakai bot ini.",
        "Tab Config cuma untuk nama di kolom <code>payer</code>. Izin akses diatur di " +
          "<code>ALLOWED_TELEGRAM_IDS</code> — tambahkan id-nya di sana, lalu restart bot.",
      );
    }

    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
  });
}
