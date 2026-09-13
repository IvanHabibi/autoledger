import Anthropic, {
  APIConnectionError,
  APIError,
  AuthenticationError,
  BadRequestError,
  PermissionDeniedError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Intent } from "../types.js";
import { todayInTimeZone } from "../util/date.js";
import { buildMessagePrompt, buildReceiptPrompt, type PromptContext } from "./prompt.js";
import { buildIntentSchema, toIntent } from "./schema.js";

/** The image types the Messages API accepts. */
export type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

export interface ReceiptImage {
  base64: string;
  mediaType: ImageMediaType;
}

/** Raised when the model answered but the answer was unusable. */
export class ParseFailure extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "ParseFailure";
  }
}

/**
 * A cap is not a charge — you pay for tokens generated, not for the ceiling —
 * so this is set generously rather than tuned. Thinking tokens count against
 * it, and a truncated structured output is unrecoverable.
 */
const MAX_TOKENS = 16_000;

/**
 * Models that reject `output_config.effort` with a 400.
 *
 * Effort is supported across the current Opus/Sonnet/Fable line but not on
 * Haiku 4.5 or Sonnet 4.5, so sending it unconditionally makes CLAUDE_MODEL
 * only appear configurable: pointing it at Haiku failed outright with
 * "This model does not support the effort parameter."
 *
 * The default is to send effort, since current and future top-tier models take
 * it; only known exceptions are listed.
 */
const MODELS_WITHOUT_EFFORT = new Set(["claude-haiku-4-5", "claude-sonnet-4-5"]);

export function supportsEffort(model: string): boolean {
  return !MODELS_WITHOUT_EFFORT.has(model);
}

export interface ParserOptions {
  apiKey: string;
  model: string;
  timeZone: string;
}

/**
 * What the parser needs from the Config tab. Declared with readonly arrays
 * because nothing here mutates them — a `SheetConfig` satisfies it as-is, and so
 * does a literal list of defaults in a test.
 */
export interface ParseConfig {
  categories: readonly string[];
  accounts: readonly string[];
}

export class Parser {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly timeZone: string;
  /** Schema and prompt only change when the category or account list does. */
  private cache: {
    signature: string;
    ctx: PromptContext;
    schema: ReturnType<typeof buildIntentSchema>;
  } | null = null;

  constructor(options: ParserOptions) {
    this.client = new Anthropic({ apiKey: options.apiKey });
    this.model = options.model;
    this.timeZone = options.timeZone;
  }

  private prepare(config: ParseConfig) {
    const { categories, accounts } = config;
    const today = todayInTimeZone(this.timeZone);
    const signature = `${today}|${categories.join(" ")}|${accounts.join(" ")}`;
    if (this.cache?.signature === signature) return this.cache;

    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: this.timeZone,
      weekday: "long",
    }).format(new Date());

    const ctx: PromptContext = {
      categories,
      accounts,
      fallbackCategory: fallbackCategoryOf(categories),
      today,
      weekday,
      timeZone: this.timeZone,
    };
    const prepared = { signature, ctx, schema: buildIntentSchema(categories, accounts) };
    this.cache = prepared;
    return prepared;
  }

  /** Parse a free-text message: a ledger entry, a question, or neither. */
  async parseText(text: string, config: ParseConfig): Promise<Intent> {
    const { ctx, schema } = this.prepare(config);
    const wire = await this.call(buildMessagePrompt(ctx), [{ type: "text", text }], schema);
    return toIntent(wire, {
      today: ctx.today,
      categories: config.categories,
      accounts: config.accounts,
      fallbackCategory: ctx.fallbackCategory,
      rawText: text,
    });
  }

  /** Parse a photographed receipt into a single entry. */
  async parseReceipt(
    image: ReceiptImage,
    caption: string | null,
    config: ParseConfig,
  ): Promise<Intent> {
    const { ctx, schema } = this.prepare(config);
    const instruction = caption?.trim()
      ? `Record this receipt as one ledger entry. The sender added: "${caption.trim()}"`
      : "Record this receipt as one ledger entry.";

    const wire = await this.call(
      buildReceiptPrompt(ctx),
      [
        {
          type: "image",
          source: { type: "base64", media_type: image.mediaType, data: image.base64 },
        },
        { type: "text", text: instruction },
      ],
      schema,
    );

    return toIntent(wire, {
      today: ctx.today,
      categories: config.categories,
      accounts: config.accounts,
      fallbackCategory: ctx.fallbackCategory,
      rawText: caption?.trim() || "(struk foto)",
    });
  }

  private async call(
    system: string,
    content: Anthropic.ContentBlockParam[],
    schema: ReturnType<typeof buildIntentSchema>,
  ) {
    let response;
    try {
      // effort "low" keeps thinking on (the default on Opus 5) but shallow,
      // which is the right trade for extracting a few fields from one sentence.
      // Omitted entirely on models that reject the parameter.
      const outputConfig = supportsEffort(this.model)
        ? { effort: "low" as const, format: zodOutputFormat(schema) }
        : { format: zodOutputFormat(schema) };

      response = await this.client.messages.parse({
        model: this.model,
        max_tokens: MAX_TOKENS,
        system,
        messages: [{ role: "user", content }],
        output_config: outputConfig,
      });
    } catch (error) {
      throw new ParseFailure(describeApiError(error), error);
    }

    if (response.stop_reason === "refusal") {
      throw new ParseFailure("The model declined to answer this message.");
    }
    // parsed_output is null when the response did not validate — never assert it.
    if (!response.parsed_output) {
      throw new ParseFailure("The model's answer did not match the expected shape.");
    }
    return response.parsed_output;
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

/**
 * Most specific first. The BadRequestError branch matters more than it looks:
 * a 400 here is the signature of the output schema being rejected, which is
 * a configuration problem to fix rather than something to retry.
 */
function describeApiError(error: unknown): string {
  if (error instanceof AuthenticationError) {
    return "Anthropic rejected the API key. Check ANTHROPIC_API_KEY.";
  }
  if (error instanceof PermissionDeniedError) {
    return "This API key is not allowed to use that model. Check CLAUDE_MODEL.";
  }
  if (error instanceof RateLimitError) {
    return "Rate limited by Anthropic. Try again in a moment.";
  }
  if (error instanceof BadRequestError) {
    return `Anthropic rejected the request (400): ${error.message}`;
  }
  if (error instanceof APIConnectionError) {
    return "Could not reach the Anthropic API. Check the network.";
  }
  if (error instanceof APIError) {
    return `Anthropic returned ${error.status ?? "an error"}: ${error.message}`;
  }
  return error instanceof Error ? error.message : "Unknown error calling the Anthropic API.";
}

/** Sniff the real image type; Telegram sends JPEG but forwarded files vary. */
export function detectImageMediaType(bytes: Uint8Array): ImageMediaType {
  if (bytes.length >= 8) {
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
