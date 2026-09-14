/**
 * Cloud Functions entrypoint: Telegram delivers updates by webhook instead of
 * the bot polling for them.
 *
 * Why a separate entrypoint at all: `src/index.ts` calls `bot.start()`, which
 * long-polls forever. A Cloud Function is request-triggered and scales to zero,
 * so there is no process to hold that loop open — polling and serverless are
 * mutually exclusive. Same bot, same handlers, different way of being fed.
 */
import * as functions from "@google-cloud/functions-framework";
import { webhookCallback } from "grammy";
import { createApp } from "./bot/app.js";
import { createBot } from "./bot/index.js";
import { loadConfig } from "./config.js";
import { Parser } from "./parse/claude.js";
import { createSheetsContext } from "./sheets/client.js";

/**
 * Telegram gives up on a slow webhook and redelivers the update, which would
 * record the same transaction twice. Returning 200 on timeout instead of
 * throwing keeps a slow-but-succeeding request from being retried; an error
 * response would guarantee the retry.
 *
 * This makes duplicates unlikely rather than impossible — genuinely exactly-once
 * delivery needs shared state across instances, which is more machinery than a
 * household ledger warrants. If a duplicate ever does appear, the entry carries
 * its own Undo button.
 */
const WEBHOOK_TIMEOUT_MS = 55_000;

/**
 * Built once per cold start, not per request: constructing the bot and calling
 * `bot.init()` costs a Telegram round trip, and the handlers are stateless.
 */
const ready = (async () => {
  const config = loadConfig();

  if (!config.webhookSecret) {
    throw new Error(
      "TELEGRAM_WEBHOOK_SECRET is required in webhook mode. The function URL is " +
        "public and unauthenticated, so without it anyone who learns the URL could " +
        "post fabricated updates. Generate one with `openssl rand -hex 32`.",
    );
  }

  const app = createApp({
    config,
    sheets: createSheetsContext(config),
    parser: new Parser({
      apiKey: config.anthropicApiKey,
      model: config.claudeModel,
      timeZone: config.timeZone,
    }),
  });

  const bot = createBot(app);
  // Webhook mode never calls bot.start(), so the bot has to be initialised
  // explicitly before it can handle its first update.
  await bot.init();

  console.log(
    `[boot] webhook ready as @${bot.botInfo.username} ` +
      `model=${config.claudeModel} credentials=${
        config.serviceAccount ? "service-account-key" : "ADC"
      }`,
  );

  return webhookCallback(bot, "express", {
    secretToken: config.webhookSecret,
    timeoutMilliseconds: WEBHOOK_TIMEOUT_MS,
    onTimeout: "return",
  });
})();

functions.http("telegram", async (req, res) => {
  let handle;
  try {
    handle = await ready;
  } catch (error) {
    // A misconfiguration must not look like a Telegram problem. Log it and
    // return 500 so the failure is visible in Cloud Logging rather than silent.
    console.error("[boot] failed to initialise", error);
    res.status(500).send("misconfigured");
    return;
  }
  await handle(req, res);
});
