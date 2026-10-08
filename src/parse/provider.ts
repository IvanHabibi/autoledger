/**
 * The contract both model providers implement.
 *
 * Parsing is the one part of this app with a real quality risk: a misread
 * sentence writes a wrong number into a financial record. Keeping the providers
 * behind one interface means the same 33-case eval runs against either, so a
 * switch is a measured decision rather than a hopeful one — and so a provider
 * that turns out to be rate-limited or flaky can be swapped back with one
 * environment variable.
 */
import type { Intent } from "../types.js";

/** What the parser needs from the Config tab. Readonly: nothing here mutates it. */
export interface ParseConfig {
  categories: readonly string[];
  accounts: readonly string[];
}

/** The image types both providers accept. */
export type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

export interface ReceiptImage {
  base64: string;
  mediaType: ImageMediaType;
}

export interface Parser {
  /** A free-text message: a ledger entry, a question, or neither. */
  parseText(text: string, config: ParseConfig): Promise<Intent>;
  /** A photographed receipt, as a single entry. */
  parseReceipt(
    image: ReceiptImage,
    caption: string | null,
    config: ParseConfig,
  ): Promise<Intent>;
}

/** Raised when the model answered but the answer was unusable. */
export class ParseFailure extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "ParseFailure";
  }
}

/** Prefer an explicit catch-all category if the household defined one. */
export function fallbackCategoryOf(categories: readonly string[]): string {
  const preferred = ["Lain-lain", "Other", "Lainnya", "Uncategorized"];
  for (const name of preferred) {
    const hit = categories.find((c) => c.toLowerCase() === name.toLowerCase());
    if (hit) return hit;
  }
  return categories[categories.length - 1]!;
}

/** Sniff the real image type; Telegram sends JPEG but forwarded files vary. */
export function detectImageMediaType(bytes: Uint8Array): ImageMediaType {
  if (bytes.length >= 12) {
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      return "image/png";
    }
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
    if (
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    ) {
      return "image/webp";
    }
  }
  return "image/jpeg";
}
