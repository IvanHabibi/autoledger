import { Bot } from "grammy";
import type { App } from "./app.js";
import { allowlist } from "./auth.js";
import { errorBoundary } from "./errors.js";
import { registerCallbackHandler } from "./handlers/callbacks.js";
import { registerCommandHandlers } from "./handlers/commands.js";
import { registerPhotoHandler } from "./handlers/photo.js";
import { registerTextHandler } from "./handlers/text.js";

export const BOT_COMMANDS = [
  { command: "summary", description: "Ringkasan bulan ini" },
  { command: "categories", description: "Daftar kategori" },
  { command: "reload", description: "Muat ulang konfigurasi dari sheet" },
  { command: "help", description: "Cara pakai" },
];

export function createBot(app: App): Bot {
  const bot = new Bot(app.config.telegramBotToken);

  // Order matters: reject strangers before anything else runs, and wrap the
  // handlers in the error boundary so one bad update can't stop polling.
  bot.use(allowlist(app.config.allowedTelegramIds));
  bot.use(errorBoundary());

  // Commands first — a generic text handler registered earlier would swallow them.
  registerCommandHandlers(bot, app);
  registerCallbackHandler(bot, app);
  registerPhotoHandler(bot, app);
  registerTextHandler(bot, app);

  bot.catch((error) => {
    console.error("[bot] unhandled", error);
  });

  return bot;
}
