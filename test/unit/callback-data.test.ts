import { describe, expect, it } from "vitest";
import {
  decodeCallback,
  encodeDismiss,
  encodePickCategory,
  encodeSetCategory,
  encodeUndo,
} from "../../src/bot/callback-data.js";
import { ulid } from "../../src/util/id.js";

const ID = "01JQ8Z9K7NA1B2C3D4E5F6G7H8";

describe("callback data", () => {
  it("round-trips every action", () => {
    expect(decodeCallback(encodeUndo(ID))).toEqual({ kind: "undo", id: ID });
    expect(decodeCallback(encodePickCategory(ID))).toEqual({ kind: "pick-category", id: ID });
    expect(decodeCallback(encodeSetCategory(ID, 7))).toEqual({
      kind: "set-category",
      id: ID,
      index: 7,
    });
    expect(decodeCallback(encodeDismiss(ID))).toEqual({ kind: "dismiss", id: ID });
  });

  it("stays inside Telegram's 64-byte callback_data limit", () => {
    const id = ulid();
    for (const data of [
      encodeUndo(id),
      encodePickCategory(id),
      encodeDismiss(id),
      encodeSetCategory(id, 999),
    ]) {
      expect(Buffer.byteLength(data, "utf8")).toBeLessThanOrEqual(64);
    }
  });

  it("rejects malformed or replayed data rather than trusting it", () => {
    expect(decodeCallback("")).toBeNull();
    expect(decodeCallback("u")).toBeNull();
    expect(decodeCallback("u:not-a-ulid")).toBeNull();
    expect(decodeCallback(`u:${ID}:extra`)).toBeNull();
    expect(decodeCallback(`z:${ID}`)).toBeNull();
    // A category index has to be a plain non-negative integer in range.
    expect(decodeCallback(`c:${ID}:-1`)).toBeNull();
    expect(decodeCallback(`c:${ID}:1000`)).toBeNull();
    expect(decodeCallback(`c:${ID}:abc`)).toBeNull();
    expect(decodeCallback(`c:${ID}:1.5`)).toBeNull();
  });
});
