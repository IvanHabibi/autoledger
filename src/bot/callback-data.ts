import { isUlid } from "../util/id.js";

/**
 * Telegram caps callback_data at 64 bytes, so the buttons carry a one-letter
 * verb plus the entry's 26-character id (and, for a category, its index in the
 * live list). Nothing here is trusted — callback data can be replayed by the
 * client, so every field is re-validated on the way in.
 */

export type CallbackAction =
  | { kind: "undo"; id: string }
  | { kind: "pick-category"; id: string }
  | { kind: "set-category"; id: string; index: number }
  | { kind: "dismiss"; id: string };

export function encodeUndo(id: string): string {
  return `u:${id}`;
}

/** Carries the id so closing the picker can restore the entry's own buttons
 *  rather than leaving the message with no way to undo. */
export function encodeDismiss(id: string): string {
  return `x:${id}`;
}

export function encodePickCategory(id: string): string {
  return `k:${id}`;
}

export function encodeSetCategory(id: string, index: number): string {
  return `c:${id}:${index}`;
}

export function decodeCallback(data: string): CallbackAction | null {
  const parts = data.split(":");
  const verb = parts[0];

  if (verb === "u" && parts.length === 2 && isUlid(parts[1]!)) {
    return { kind: "undo", id: parts[1]! };
  }
  if (verb === "x" && parts.length === 2 && isUlid(parts[1]!)) {
    return { kind: "dismiss", id: parts[1]! };
  }
  if (verb === "k" && parts.length === 2 && isUlid(parts[1]!)) {
    return { kind: "pick-category", id: parts[1]! };
  }
  if (verb === "c" && parts.length === 3 && isUlid(parts[1]!)) {
    const index = Number(parts[2]);
    if (Number.isInteger(index) && index >= 0 && index < 1000) {
      return { kind: "set-category", id: parts[1]!, index };
    }
  }
  return null;
}
