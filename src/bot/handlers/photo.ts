import type { Bot, Context } from "grammy";
import { detectImageMediaType, type ReceiptImage } from "../../parse/claude.js";
import { readSheetConfig } from "../../sheets/config.js";
import type { App } from "../app.js";
import { escapeHtml } from "../format.js";
import { recordTransaction } from "../record.js";

/**
 * Base64 inflates by about a third and the API caps an image at 5 MB, so this
 * is the largest raw payload that is certain to fit. Telegram's compressed
 * photos are an order of magnitude smaller; this only catches an original-size
 * image sent as a file.
 */
const MAX_IMAGE_BYTES = 3_750_000;

async function downloadTelegramFile(
  ctx: Context,
  botToken: string,
  fileId: string,
): Promise<Buffer> {
  const file = await ctx.api.getFile(fileId);
  if (!file.file_path) {
    throw new Error("Telegram did not return a download path for that file.");
  }
  const url = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Downloading the photo failed with HTTP ${response.status}.`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export function registerPhotoHandler(bot: Bot, app: App): void {
  bot.on(["message:photo", "message:document"], async (ctx) => {
    if (!ctx.from) return;

    let fileId: string | undefined;
    let declaredSize: number | undefined;

    if (ctx.message.photo) {
      // Telegram lists sizes smallest first; the last is the best available.
      const largest = ctx.message.photo[ctx.message.photo.length - 1];
      fileId = largest?.file_id;
      declaredSize = largest?.file_size;
    } else if (ctx.message.document?.mime_type?.startsWith("image/")) {
      // Receipts sent "as a file" to avoid compression land here.
      fileId = ctx.message.document.file_id;
      declaredSize = ctx.message.document.file_size;
    }

    if (!fileId) {
      await ctx.reply("📎 Kirim struknya sebagai foto atau gambar ya.");
      return;
    }
    if (declaredSize !== undefined && declaredSize > MAX_IMAGE_BYTES) {
      await ctx.reply("🖼 Fotonya terlalu besar. Kirim versi terkompresi (sebagai foto) ya.");
      return;
    }

    await ctx.replyWithChatAction("typing");

    const bytes = await downloadTelegramFile(ctx, app.config.telegramBotToken, fileId);
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      await ctx.reply("🖼 Fotonya terlalu besar. Kirim versi terkompresi (sebagai foto) ya.");
      return;
    }

    const image: ReceiptImage = {
      base64: bytes.toString("base64"),
      mediaType: detectImageMediaType(bytes),
    };

    const caption = ctx.message.caption?.trim() ?? null;
    const sheetConfig = await readSheetConfig(app.sheets);
    const intent = await app.parser.parseReceipt(image, caption, sheetConfig.categories);

    if (intent.kind === "transaction") {
      await recordTransaction(
        app,
        ctx,
        sheetConfig,
        ctx.from,
        intent.transaction,
        "photo",
        caption ?? "(struk foto)",
      );
      return;
    }

    if (intent.kind === "unclear") {
      await ctx.reply(`🤔 ${escapeHtml(intent.note)}`, { parse_mode: "HTML" });
      return;
    }

    // A receipt should never parse as a question; say so rather than stay silent.
    await ctx.reply("🤔 Struknya tidak terbaca sebagai transaksi. Coba foto yang lebih jelas.");
  });
}
