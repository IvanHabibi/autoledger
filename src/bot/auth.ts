import type { Context, Middleware } from "grammy";

/**
 * Only listed Telegram accounts get through.
 *
 * A bot token is effectively public — anyone who discovers the bot's username
 * can message it — so this is the single control keeping the household ledger
 * private. Unknown senders get no reply at all rather than an error: a silent
 * bot gives a stranger nothing to confirm, and costs no API calls.
 */
export function allowlist(allowed: ReadonlySet<number>): Middleware<Context> {
  return async (ctx, next) => {
    const id = ctx.from?.id;
    if (id === undefined || !allowed.has(id)) {
      console.warn(
        `[auth] ignored update from telegram id=${id ?? "unknown"} username=${
          ctx.from?.username ?? "-"
        }`,
      );
      return;
    }
    await next();
  };
}
