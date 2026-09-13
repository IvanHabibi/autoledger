import { GrammyError, HttpError, type Context, type Middleware } from "grammy";
import { ParseFailure } from "../parse/claude.js";
import { describeSheetsError } from "../sheets/client.js";

function isGoogleError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; errors?: unknown; config?: unknown };
  return (
    typeof candidate.code === "number" ||
    Array.isArray(candidate.errors) ||
    candidate.config !== undefined
  );
}

/** A short, actionable sentence for the chat. Detail goes to the log. */
export function friendlyMessage(error: unknown): string {
  if (error instanceof ParseFailure) return error.message;
  if (error instanceof GrammyError) return "Telegram menolak permintaan ini.";
  if (error instanceof HttpError) return "Koneksi ke Telegram terputus.";
  if (isGoogleError(error)) return describeSheetsError(error);
  return "Ada yang error di sisi saya. Coba lagi sebentar.";
}

/**
 * Catches anything a handler throws, tells the user in one line, and keeps the
 * bot running. Without this a single bad update ends the polling loop.
 */
export function errorBoundary(): Middleware<Context> {
  return async (ctx, next) => {
    try {
      await next();
    } catch (error) {
      console.error("[handler]", error);
      try {
        await ctx.reply(`⚠️ ${friendlyMessage(error)}`);
      } catch (replyError) {
        console.error("[handler] could not deliver the error message", replyError);
      }
    }
  };
}
