/**
 * Chooses the parser implementation from configuration.
 *
 * Both providers answer the same interface and run the same prompts and
 * validation, so switching is one environment variable and the 33-case eval
 * measures the difference rather than anyone guessing at it.
 */
import type { Config } from "../config.js";
import { AnthropicParser } from "./claude.js";
import { OpenRouterParser } from "./openrouter.js";
import {
  ParseFailure,
  type ParseConfig,
  type Parser,
  type ReceiptImage,
} from "./provider.js";
import type { Intent } from "../types.js";

export type ProviderName = "anthropic" | "openrouter";

/**
 * Text through one provider, receipt photos through another.
 *
 * The free models that parse Indonesian well are text-only — nemotron, the best
 * of them measured, does not accept images at all. Sending a photo there would
 * turn a working feature into a confusing parse error, so photos go to the
 * provider that can actually read them. They are a small share of entries, so
 * this keeps the cost saving while keeping the feature.
 */
class SplitModalityParser implements Parser {
  constructor(
    private readonly text: Parser,
    private readonly vision: Parser | null,
  ) {}

  parseText(text: string, config: ParseConfig): Promise<Intent> {
    return this.text.parseText(text, config);
  }

  parseReceipt(
    image: ReceiptImage,
    caption: string | null,
    config: ParseConfig,
  ): Promise<Intent> {
    if (!this.vision) {
      // Say which setting is missing rather than letting a text-only model
      // fail on an image and look like a bad photo.
      return Promise.reject(
        new ParseFailure(
          "Foto struk belum bisa dibaca: model teks gratis tidak menerima gambar. " +
            "Set ANTHROPIC_API_KEY, atau kirim sebagai teks biasa.",
        ),
      );
    }
    return this.vision.parseReceipt(image, caption, config);
  }
}

export function createParser(config: Config): Parser {
  if (config.llmProvider === "openrouter") {
    if (!config.openRouterApiKey) {
      throw new Error(
        "LLM_PROVIDER is openrouter but OPENROUTER_API_KEY is not set. " +
          "Add it to .env locally, or to Secret Manager for the deployed function.",
      );
    }
    const text = new OpenRouterParser({
      apiKey: config.openRouterApiKey,
      model: config.openRouterModel,
      timeZone: config.timeZone,
    });
    const vision = config.anthropicApiKey
      ? new AnthropicParser({
          apiKey: config.anthropicApiKey,
          model: config.claudeModel,
          timeZone: config.timeZone,
        })
      : null;
    return new SplitModalityParser(text, vision);
  }

  if (!config.anthropicApiKey) {
    throw new Error("LLM_PROVIDER is anthropic but ANTHROPIC_API_KEY is not set.");
  }
  return new AnthropicParser({
    apiKey: config.anthropicApiKey,
    model: config.claudeModel,
    timeZone: config.timeZone,
  });
}

/** What the boot log should say about where parsing goes. */
export function describeProvider(config: Config): string {
  if (config.llmProvider !== "openrouter") return `anthropic:${config.claudeModel}`;
  const photos = config.anthropicApiKey ? `anthropic:${config.claudeModel}` : "unavailable";
  return `openrouter:${config.openRouterModel} (photos: ${photos})`;
}

export { SplitModalityParser };
export type { Parser };
