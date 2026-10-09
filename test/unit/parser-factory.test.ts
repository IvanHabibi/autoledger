/**
 * The free text models that parse Indonesian well do not accept images, so
 * receipt photos have to go somewhere else or the feature quietly breaks.
 * These cases pin that routing.
 */
import { describe, expect, it, vi } from "vitest";
import { SplitModalityParser } from "../../src/parse/index.js";
import { ParseFailure, type ParseConfig, type Parser } from "../../src/parse/provider.js";
import type { Intent } from "../../src/types.js";

const CONFIG: ParseConfig = { categories: ["Lain-lain"], accounts: [] };
const IMAGE = { base64: "AAAA", mediaType: "image/jpeg" as const };
const UNCLEAR: Intent = { kind: "unclear", note: "n/a" };

function stub(label: string): Parser & { parseText: ReturnType<typeof vi.fn> } {
  return {
    parseText: vi.fn(async () => ({ kind: "unclear", note: label }) as Intent),
    parseReceipt: vi.fn(async () => ({ kind: "unclear", note: label }) as Intent),
  } as never;
}

describe("SplitModalityParser", () => {
  it("sends text to the text provider", async () => {
    const text = stub("text");
    const vision = stub("vision");
    const parser = new SplitModalityParser(text, vision);

    await parser.parseText("beli beras 50rb", CONFIG);
    expect(text.parseText).toHaveBeenCalledOnce();
    expect(vision.parseText).not.toHaveBeenCalled();
  });

  it("sends receipts to the vision provider, not the text one", async () => {
    const text = stub("text");
    const vision = stub("vision");
    const parser = new SplitModalityParser(text, vision);

    const intent = await parser.parseReceipt(IMAGE, null, CONFIG);
    expect(intent).toEqual({ kind: "unclear", note: "vision" });
    // The whole point: a text-only model must never receive the image.
    expect(text.parseReceipt).not.toHaveBeenCalled();
    expect(vision.parseReceipt).toHaveBeenCalledOnce();
  });

  it("passes the caption through to the vision provider", async () => {
    const vision = stub("vision");
    const parser = new SplitModalityParser(stub("text"), vision);

    await parser.parseReceipt(IMAGE, "struk indomaret", CONFIG);
    expect(vision.parseReceipt).toHaveBeenCalledWith(IMAGE, "struk indomaret", CONFIG);
  });

  it("explains which setting is missing when no vision provider is configured", async () => {
    const parser = new SplitModalityParser(stub("text"), null);

    await expect(parser.parseReceipt(IMAGE, null, CONFIG)).rejects.toBeInstanceOf(ParseFailure);
    // The message has to name the cause; otherwise it reads as a bad photo.
    await expect(parser.parseReceipt(IMAGE, null, CONFIG)).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });

  it("still parses text when no vision provider is configured", async () => {
    const text = stub("text");
    const parser = new SplitModalityParser(text, null);

    await expect(parser.parseText("gaji 15jt", CONFIG)).resolves.toEqual(UNCLEAR.kind === "unclear" ? { kind: "unclear", note: "text" } : UNCLEAR);
    expect(text.parseText).toHaveBeenCalledOnce();
  });
});
