import { createApp } from "./bot/app.js";
import { BOT_COMMANDS, createBot } from "./bot/index.js";
import { loadConfig } from "./config.js";
import { Parser } from "./parse/claude.js";
import {
  SheetStructureError,
  createSheetsContext,
  describeSheetsError,
  getSheetId,
} from "./sheets/client.js";
import { readSheetConfig } from "./sheets/config.js";

async function main(): Promise<void> {
  const config = loadConfig();

  const sheets = createSheetsContext(config);
  const parser = new Parser({
    apiKey: config.anthropicApiKey,
    model: config.claudeModel,
    timeZone: config.timeZone,
  });

  // Prove the sheet is reachable and shaped correctly before accepting any
  // messages. A permissions mistake should surface here, not halfway through
  // recording someone's groceries.
  try {
    await getSheetId(sheets, config.transactionsSheet);
    const sheetConfig = await readSheetConfig(sheets, { force: true });
    console.log(
      `[boot] sheet ok — ${sheetConfig.categories.length} categories, ` +
        `${sheetConfig.members.size} member(s) mapped`,
    );
  } catch (error) {
    if (error instanceof SheetStructureError) throw error;
    throw new Error(describeSheetsError(error));
  }

  const app = createApp({ config, sheets, parser });
  const bot = createBot(app);

  await bot.api.setMyCommands(BOT_COMMANDS);

  const stop = (signal: string) => {
    console.log(`[shutdown] ${signal} — stopping poller`);
    void bot.stop();
  };
  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));

  console.log(
    `[boot] model=${config.claudeModel} tz=${config.timeZone} ` +
      `allowed=${config.allowedTelegramIds.size} account(s)`,
  );

  // Long polling: the bot reaches out to Telegram, so no inbound port, no
  // public URL and no TLS certificate are needed anywhere.
  await bot.start({
    onStart: (me) => console.log(`[boot] polling as @${me.username}`),
  });
}

main().catch((error: unknown) => {
  console.error(`\n✖ ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
