import { InlineKeyboard } from "grammy";
import {
  encodeDismiss,
  encodePickCategory,
  encodeSetCategory,
  encodeUndo,
} from "./callback-data.js";

export function entryKeyboard(id: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("↩️ Batalkan", encodeUndo(id))
    .text("🏷 Ganti kategori", encodePickCategory(id));
}

/**
 * Categories are passed by index to stay inside the 64-byte callback_data
 * limit, which a name like "Komunikasi & Internet" would otherwise blow past
 * once combined with the id.
 */
export function categoryKeyboard(id: string, categories: readonly string[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  categories.forEach((name, index) => {
    keyboard.text(name, encodeSetCategory(id, index));
    if (index % 2 === 1) keyboard.row();
  });
  return keyboard.row().text("✕ Tutup", encodeDismiss(id));
}
