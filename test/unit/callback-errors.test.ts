/**
 * Maya tapped "Ganti kategori" twice during a cold start and got
 * "Telegram menolak permintaan ini." The first tap had applied the keyboard;
 * the second asked Telegram for the identical markup, which it rejects with
 * 400 "message is not modified". The edit had succeeded, so the warning was
 * noise about a no-op.
 *
 * Built from a real GrammyError rather than a hand-rolled stand-in, so the
 * predicate cannot drift from the shape grammY actually throws.
 */
import { GrammyError } from "grammy";
import { describe, expect, it } from "vitest";
import { isUnchangedEdit } from "../../src/bot/handlers/callbacks.js";

function grammyError(description: string, method = "editMessageReplyMarkup"): GrammyError {
  return new GrammyError(
    `Call to '${method}' failed!`,
    { ok: false, error_code: 400, description },
    method,
    {},
  );
}

describe("isUnchangedEdit", () => {
  it("recognises the real not-modified rejection", () => {
    // Verbatim from the Cloud Functions log.
    const real =
      "Bad Request: message is not modified: specified new message content and " +
      "reply markup are exactly the same as a current content and reply markup of the message";
    expect(isUnchangedEdit(grammyError(real))).toBe(true);
  });

  it("recognises it for a text edit too, not just a markup edit", () => {
    // Re-picking the category a row already has produces identical text.
    expect(
      isUnchangedEdit(grammyError("Bad Request: message is not modified", "editMessageText")),
    ).toBe(true);
  });

  it("does not swallow other Telegram rejections", () => {
    for (const d of [
      "Bad Request: message to edit not found",
      "Bad Request: query is too old and response timeout expired",
      "Bad Request: MESSAGE_ID_INVALID",
      "Forbidden: bot was blocked by the user",
    ]) {
      expect(isUnchangedEdit(grammyError(d)), d).toBe(false);
    }
  });

  it("does not swallow non-Telegram failures", () => {
    expect(isUnchangedEdit(new Error("message is not modified"))).toBe(false);
    expect(isUnchangedEdit(null)).toBe(false);
    expect(isUnchangedEdit(undefined)).toBe(false);
  });
});
