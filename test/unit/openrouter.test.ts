/**
 * Free models are chattier than paid ones. Even asked for a json_schema
 * response they tend to wrap the object in markdown fences or introduce it with
 * a sentence, and losing a grocery entry to that would be absurd. These cases
 * are the shapes that actually show up.
 */
import { describe, expect, it } from "vitest";
import { extractJsonObject, isRetryable, readContent } from "../../src/parse/openrouter.js";
import { ParseFailure } from "../../src/parse/provider.js";

const INTENT = '{"kind":"transaction","amount_idr":50000}';

describe("extractJsonObject", () => {
  it("passes a bare object through", () => {
    expect(extractJsonObject(INTENT)).toBe(INTENT);
    expect(extractJsonObject(`  ${INTENT}\n`)).toBe(INTENT);
  });

  it("unwraps markdown fences", () => {
    expect(extractJsonObject("```json\n" + INTENT + "\n```")).toBe(INTENT);
    expect(extractJsonObject("```\n" + INTENT + "\n```")).toBe(INTENT);
  });

  it("ignores a preamble before the object", () => {
    expect(extractJsonObject(`Sure! Here is the result:\n${INTENT}`)).toBe(INTENT);
  });

  it("ignores trailing commentary after the object", () => {
    expect(extractJsonObject(`${INTENT}\n\nLet me know if you need anything else.`)).toBe(INTENT);
  });

  it("keeps nested objects intact rather than stopping at the first brace", () => {
    const nested = '{"a":{"b":{"c":1}},"d":2}';
    expect(extractJsonObject(`noise ${nested} noise`)).toBe(nested);
  });

  it("is not fooled by braces inside strings", () => {
    // A description can legitimately contain a brace; naive brace counting
    // would truncate the object here.
    const tricky = '{"description":"beli } beras {","amount_idr":50000}';
    expect(extractJsonObject(tricky)).toBe(tricky);
  });

  it("is not fooled by an escaped quote before a brace", () => {
    const tricky = '{"description":"say \\"hi\\" }","amount_idr":1}';
    expect(extractJsonObject(tricky)).toBe(tricky);
  });

  it("returns null when there is no object at all", () => {
    expect(extractJsonObject("")).toBeNull();
    expect(extractJsonObject("I cannot help with that.")).toBeNull();
    expect(extractJsonObject("[1,2,3]")).toBeNull();
  });

  it("returns null for an unterminated object rather than a broken slice", () => {
    expect(extractJsonObject('{"kind":"transaction"')).toBeNull();
  });
});

describe("readContent", () => {
  it("reads a plain string content", () => {
    expect(readContent({ choices: [{ message: { content: "hello" } }] })).toBe("hello");
  });

  it("joins content returned as parts", () => {
    expect(
      readContent({ choices: [{ message: { content: [{ text: "a" }, { text: "b" }] } }] }),
    ).toBe("ab");
  });

  it("returns null for shapes that carry no text", () => {
    expect(readContent({ choices: [] })).toBeNull();
    expect(readContent({})).toBeNull();
    expect(readContent(null)).toBeNull();
    expect(readContent({ choices: [{ message: {} }] })).toBeNull();
  });
});

describe("isRetryable", () => {
  it("retries the failures a different underlying model might not produce", () => {
    for (const m of [
      "The model returned an empty response.",
      "The model's answer did not contain JSON.",
      "The model's answer was not valid JSON.",
      "The model's answer did not match the expected shape.",
      "OpenRouter rate limit reached — the free tier caps requests. Try again shortly.",
    ]) {
      expect(isRetryable(new ParseFailure(m)), m).toBe(true);
    }
  });

  it("does not retry failures that will fail identically every time", () => {
    // Retrying these only makes the user wait longer for the same error.
    for (const m of [
      "OpenRouter rejected the API key. Check OPENROUTER_API_KEY.",
      "OpenRouter does not recognise that model. Check OPENROUTER_MODEL.",
      "OpenRouter reports insufficient credits for this model.",
    ]) {
      expect(isRetryable(new ParseFailure(m)), m).toBe(false);
    }
  });

  it("ignores anything that is not a ParseFailure", () => {
    expect(isRetryable(new Error("boom"))).toBe(false);
    expect(isRetryable(null)).toBe(false);
  });
});

describe("attempt timeout", () => {
  it("is retryable, so a slow attempt yields to the next one", () => {
    expect(isRetryable(new ParseFailure("The model did not answer within 20s."))).toBe(true);
  });
});
