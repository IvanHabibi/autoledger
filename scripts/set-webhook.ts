/**
 * Points Telegram at the deployed function, or takes it back off.
 *
 *   npm run webhook:set -- https://REGION-PROJECT.cloudfunctions.net/autoledger
 *   npm run webhook:info
 *   npm run webhook:delete        # back to long polling
 *
 * Registering the webhook and running the bot are deliberately separate: a
 * webhook is account-wide state on Telegram's side, not something a function
 * should reconfigure on every cold start.
 */
import "dotenv/config";
import { Bot } from "grammy";

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

if (!token) {
  console.error("✖ TELEGRAM_BOT_TOKEN is not set. See .env.example.");
  process.exit(1);
}

const [command, url] = process.argv.slice(2);
const bot = new Bot(token);

async function main(): Promise<void> {
  switch (command) {
    case "set": {
      if (!url) throw new Error("Usage: npm run webhook:set -- <https URL>");
      if (!url.startsWith("https://")) {
        throw new Error("Telegram only accepts an HTTPS webhook URL.");
      }
      if (!secret) {
        throw new Error(
          "TELEGRAM_WEBHOOK_SECRET is not set. Without it the public function URL " +
            "would accept updates from anyone. Generate one with `openssl rand -hex 32`.",
        );
      }
      await bot.api.setWebhook(url, {
        secret_token: secret,
        // Only the update types this bot actually handles, so Telegram does not
        // wake the function for edits, joins, polls and the rest.
        allowed_updates: ["message", "callback_query"],
        drop_pending_updates: true,
      });
      console.log(`✓ webhook set to ${url}`);
      console.log("  secret token sent; the function will reject requests without it");
      break;
    }

    case "delete": {
      await bot.api.deleteWebhook({ drop_pending_updates: true });
      console.log("✓ webhook removed — `npm start` (long polling) works again");
      break;
    }

    case "info": {
      const info = await bot.api.getWebhookInfo();
      console.log(JSON.stringify(info, null, 2));
      if (!info.url) console.log("\n(no webhook set — the bot is in polling mode)");
      break;
    }

    default:
      throw new Error("Usage: set <url> | delete | info");
  }
}

main().catch((error: unknown) => {
  console.error(`\n✖ ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
