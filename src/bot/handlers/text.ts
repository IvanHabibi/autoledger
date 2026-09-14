import type { Bot } from "grammy";
import { aggregate } from "../../report/aggregate.js";
import { readSheetConfig } from "../../sheets/config.js";
import { readTransactions } from "../../sheets/transactions.js";
import type { App } from "../app.js";
import { HELP_TEXT, escapeHtml, renderReport } from "../format.js";
import { recordTransaction } from "../record.js";

export function registerTextHandler(bot: Bot, app: App): void {
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();
    if (text === "") return;
    if (!ctx.from) return;

    // Known commands were handled earlier; anything else starting with "/" is a
    // typo, and sending it to the parser would just bill an API call to be told
    // it is unclear.
    if (text.startsWith("/")) {
      await ctx.reply(HELP_TEXT, { parse_mode: "HTML" });
      return;
    }

    // Parsing takes a couple of seconds; show that something is happening.
    await ctx.replyWithChatAction("typing");

    const sheetConfig = await readSheetConfig(app.sheets);
    const intent = await app.parser.parseText(text, sheetConfig);

    switch (intent.kind) {
      case "transaction":
        await recordTransaction(
          app,
          ctx,
          sheetConfig,
          ctx.from,
          intent.transaction,
          "text",
          text,
        );
        return;

      case "query": {
        const rows = await readTransactions(app.sheets);
        const result = aggregate(rows, intent.query);
        await ctx.reply(renderReport(intent.query, result), { parse_mode: "HTML" });
        return;
      }

      case "unclear":
        await ctx.reply(`🤔 ${escapeHtml(intent.note)}`, { parse_mode: "HTML" });
        return;
    }
  });
}
