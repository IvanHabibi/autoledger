import { randomBytes } from "node:crypto";

/** Crockford base32 — no I, L, O or U, so ids survive being read aloud. */
const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_LEN = 10;
const RANDOM_LEN = 16;

function encodeTime(ms: number): string {
  let remaining = ms;
  let out = "";
  for (let i = 0; i < TIME_LEN; i++) {
    const mod = remaining % 32;
    out = ENCODING[mod]! + out;
    remaining = (remaining - mod) / 32;
  }
  return out;
}

function encodeRandom(): string {
  // 256 is an exact multiple of 32, so the modulo below is unbiased.
  const bytes = randomBytes(RANDOM_LEN);
  let out = "";
  for (let i = 0; i < RANDOM_LEN; i++) out += ENCODING[bytes[i]! % 32];
  return out;
}

/**
 * A ULID: 26 chars, lexicographically sortable by creation time.
 *
 * This is the handle we write into column A and later use to find a row again.
 * Row numbers can't serve that purpose — the moment anyone else appends an
 * entry, a remembered row number points at someone else's transaction.
 */
export function ulid(now: number = Date.now()): string {
  return encodeTime(now) + encodeRandom();
}

/** Cheap shape check, used to reject junk in callback data before we go to the API. */
export function isUlid(value: string): boolean {
  if (value.length !== TIME_LEN + RANDOM_LEN) return false;
  for (const ch of value) if (!ENCODING.includes(ch)) return false;
  return true;
}
