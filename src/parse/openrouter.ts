/**
 * OpenRouter implementation of the Parser contract.
 *
 * Shares everything that decides quality with the Anthropic path — the same
 * prompts, the same wire schema, and the same `toIntent` validation — so the
 * eval compares providers rather than two different parsers.
 */
import { OpenRouter } from "@openrouter/sdk";
import * as z from "zod";
import type { Intent } from "../types.js";
import { todayInTimeZone } from "../util/date.js";
import { buildMessagePrompt, buildReceiptPrompt, type PromptContext } from "./prompt.js";
import {
  ParseFailure,
  fallbackCategoryOf,
  type ParseConfig,
  type Parser,
  type ReceiptImage,
} from "./provider.js";
import { buildIntentSchema, toIntent } from "./schema.js";

/**
 * Total attempts per message, including the first.
 *
 * Measured, not guessed: three attempts scored 20/33 on the eval at 42s per
 * entry, and a single attempt fails at roughly the same rate. Failures are
 * correlated per input rather than independent — certain phrasings defeat the
 * free models consistently — so extra attempts bought about one point of
 * accuracy for triple the latency. Two keeps the benefit for the genuinely
 * variable inputs while staying inside the webhook's budget.
 */
const MAX_ATTEMPTS = 2;

/**
 * Per-attempt ceiling. The webhook answers Telegram at 55s and Cloud Run
 * throttles CPU once a response is sent, so an attempt allowed to run long can
 * have its sheet write starved after the user was already told nothing. Two
 * attempts at 20s stay well inside that, which turns a silent write failure
 * into an ordinary visible error.
 */
const ATTEMPT_TIMEOUT_MS = 20_000;

/** Rejects rather than hanging, so a slow attempt yields to the next one. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new ParseFailure(`The model did not answer within ${ms / 1000}s.`)),
      ms,
    );
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Worth another roll of the dice, or not.
 *
 * A bad key, an unknown model or exhausted credits will fail identically every
 * time, so retrying those just makes the user wait longer for the same error.
 * Everything else here is the router handing us a model that could not produce
 * usable output, which a different one may well manage.
 */
export function isRetryable(error: unknown): boolean {
  if (!(error instanceof ParseFailure)) return false;
  const permanent = [
    "rejected the API key",
    "does not recognise that model",
    "insufficient credits",
  ];
  return !permanent.some((p) => error.message.includes(p));
}

export interface OpenRouterParserOptions {
  apiKey: string;
  model: string;
  timeZone: string;
}

/**
 * Free models are chattier than the task needs: they wrap JSON in markdown
 * fences, or put a sentence before it, even under a json_schema response
 * format. Pull the first balanced object out rather than losing the entry over
 * formatting the user never sees.
 */
export function extractJsonObject(raw: string): string | null {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Rewrite `type: ["string", "null"]` as `anyOf: [{type:"string"},{type:"null"}]`.
 *
 * zod emits the type-array form, which some providers' schema parsers reject
 * outright — Minimax answers `invalid params, Mismatch type string with value
 * array`. The anyOf form expresses the same thing and is accepted more widely.
 */
export function toAnyOfNullable(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toAnyOfNullable);
  if (!node || typeof node !== "object") return node;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    out[key] = toAnyOfNullable(value);
  }

  const type = out["type"];
  if (Array.isArray(type) && type.includes("null")) {
    const { type: _dropped, description, ...rest } = out;
    const others = type.filter((t) => t !== "null");
    return {
      ...(description === undefined ? {} : { description }),
      anyOf: [...others.map((t) => ({ type: t, ...rest })), { type: "null" }],
    };
  }
  return out;
}

/**
 * Spell the output contract out in the prompt.
 *
 * Models advertising `structured_outputs: false` accept a json_schema and then
 * ignore it: Minimax returned tidy JSON under keys it invented
 * ("record_type", "item", "quantity"), which fails validation every time. Naming
 * the keys in the prompt is what actually makes those models comply — measured,
 * it produced all 17 keys with none missing or extra. It costs a couple of
 * hundred tokens and does no harm to models that do honour the schema.
 */
export function buildFieldContract(jsonSchema: Record<string, unknown>): string {
  const properties = (jsonSchema["properties"] ?? {}) as Record<string, Record<string, unknown>>;
  const lines = Object.entries(properties).map(([name, spec]) => {
    const anyOf = spec["anyOf"] as Array<{ type?: string }> | undefined;
    const type = spec["type"] ?? anyOf?.map((a) => a.type).filter(Boolean).join("|") ?? "string";
    const description = spec["description"] ? `  // ${String(spec["description"])}` : "";
    return `  "${name}": ${JSON.stringify(type)}${description}`;
  });
  return [
    "",
    "OUTPUT FORMAT — reply with ONE JSON object and nothing else: no prose, no",
    "markdown fences. Use exactly these keys, all of them, with null where a key",
    "does not apply to the kind you chose:",
    "{",
    ...lines,
    "}",
  ].join("\n");
}

export class OpenRouterParser implements Parser {
  private readonly client: OpenRouter;
  private readonly model: string;
  private readonly timeZone: string;
  /** Flips once and stays flipped when a provider rejects json_schema. */
  private schemaMode: "schema" | "json_object" = "schema";
  private cache: {
    signature: string;
    ctx: PromptContext;
    schema: ReturnType<typeof buildIntentSchema>;
    jsonSchema: Record<string, unknown>;
  } | null = null;

  constructor(options: OpenRouterParserOptions) {
    this.client = new OpenRouter({ apiKey: options.apiKey });
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
    const schema = buildIntentSchema(categories, accounts);
    // zod emits additionalProperties:false with every property required, which
    // is exactly what strict json_schema mode wants.
    const jsonSchema = toAnyOfNullable(z.toJSONSchema(schema)) as Record<string, unknown>;
    const prepared = { signature, ctx, schema, jsonSchema };
    this.cache = prepared;
    return prepared;
  }

  async parseText(text: string, config: ParseConfig): Promise<Intent> {
    const { ctx, schema, jsonSchema } = this.prepare(config);
    const wire = await this.call(
      buildMessagePrompt(ctx),
      [{ type: "text", text }],
      schema,
      jsonSchema,
    );
    return toIntent(wire, {
      today: ctx.today,
      categories: config.categories,
      accounts: config.accounts,
      fallbackCategory: ctx.fallbackCategory,
      rawText: text,
    });
  }

  async parseReceipt(
    image: ReceiptImage,
    caption: string | null,
    config: ParseConfig,
  ): Promise<Intent> {
    const { ctx, schema, jsonSchema } = this.prepare(config);
    const instruction = caption?.trim()
      ? `Record this receipt as one ledger entry. The sender added: "${caption.trim()}"`
      : "Record this receipt as one ledger entry.";

    const wire = await this.call(
      buildReceiptPrompt(ctx),
      [
        {
          type: "image_url",
          image_url: { url: `data:${image.mediaType};base64,${image.base64}` },
        },
        { type: "text", text: instruction },
      ],
      schema,
      jsonSchema,
    );

    return toIntent(wire, {
      today: ctx.today,
      categories: config.categories,
      accounts: config.accounts,
      fallbackCategory: ctx.fallbackCategory,
      rawText: caption?.trim() || "(struk foto)",
    });
  }

  /**
   * Retry, because `openrouter/free` is a router rather than a model: each call
   * can land on a different underlying model, and measured over five identical
   * requests two came back unusable — an empty body or JSON that did not match
   * the schema. Those failures are independent per attempt, so retrying is the
   * one thing that actually moves reliability.
   *
   * Capped at three because latency is already 3-30s per attempt and the
   * webhook has 55s before Telegram redelivers the update.
   */
  private async call(
    system: string,
    content: unknown[],
    schema: ReturnType<typeof buildIntentSchema>,
    jsonSchema: Record<string, unknown>,
  ) {
    let last: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await withTimeout(
          this.attempt(system, content, schema, jsonSchema),
          ATTEMPT_TIMEOUT_MS,
        );
      } catch (error) {
        last = error;
        if (!isRetryable(error) || attempt === MAX_ATTEMPTS) break;
      }
    }
    throw last;
  }

  private async attempt(
    system: string,
    content: unknown[],
    schema: ReturnType<typeof buildIntentSchema>,
    jsonSchema: Record<string, unknown>,
  ) {
    let response: unknown;
    try {
      response = await this.client.chat.send({
        chatRequest: {
          model: this.model,
          messages: [
            { role: "system", content: system + buildFieldContract(jsonSchema) },
            { role: "user", content },
          ],
          responseFormat:
            this.schemaMode === "schema"
              ? {
                  type: "json_schema",
                  jsonSchema: { name: "ledger_intent", strict: true, schema: jsonSchema },
                }
              : { type: "json_object" },
          stream: false,
        },
      } as never);
    } catch (error) {
      // A provider that cannot parse the schema says so by rejecting the
      // request. Drop to plain JSON mode for the rest of this process rather
      // than failing every message — the prompt already carries the contract.
      if (this.schemaMode === "schema" && looksLikeSchemaRejection(error)) {
        this.schemaMode = "json_object";
        console.warn(
          `[parse] ${this.model} rejected the json_schema response format; ` +
            "falling back to json_object with the field contract in the prompt.",
        );
        throw new ParseFailure("Retrying without the json_schema response format.");
      }
      throw new ParseFailure(describeOpenRouterError(error), error);
    }

    const text = readContent(response);
    if (!text) {
      throw new ParseFailure("The model returned an empty response.");
    }

    const json = extractJsonObject(text);
    if (!json) {
      throw new ParseFailure("The model's answer did not contain JSON.");
    }

    let candidate: unknown;
    try {
      candidate = JSON.parse(json);
    } catch (error) {
      throw new ParseFailure("The model's answer was not valid JSON.", error);
    }

    const parsed = schema.safeParse(candidate);
    if (!parsed.success) {
      throw new ParseFailure("The model's answer did not match the expected shape.");
    }
    return parsed.data;
  }
}

/**
 * Did the provider refuse the schema itself, rather than fail at the task?
 *
 * Minimax reports it as `invalid params, Mismatch type ...` inside a 200
 * response, so this matches on the wording rather than a status code. Matching
 * too broadly would hide real failures behind a silent mode change, so it stays
 * narrow.
 */
function looksLikeSchemaRejection(error: unknown): boolean {
  const text = JSON.stringify(
    (error as { body?: unknown } | null)?.body ??
      (error instanceof Error ? error.message : error) ??
      "",
  ).toLowerCase();
  return (
    text.includes("invalid params") ||
    text.includes("mismatched type") ||
    text.includes("mismatch type") ||
    text.includes("json_schema") ||
    text.includes("response_format")
  );
}

/** Reads the assistant text out of a chat completion, tolerating both shapes. */
export function readContent(response: unknown): string | null {
  const choices = (response as { choices?: unknown } | null)?.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = (choices[0] as { message?: { content?: unknown } } | null)?.message;
  const content = message?.content;
  if (typeof content === "string") return content;
  // Some providers return content as an array of parts.
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : ((part as { text?: string })?.text ?? "")))
      .join("");
  }
  return null;
}

/** Most specific first; the free tier's characteristic failure is rate limiting. */
function describeOpenRouterError(error: unknown): string {
  const status =
    (error as { statusCode?: number } | null)?.statusCode ??
    (error as { status?: number } | null)?.status;
  const message = error instanceof Error ? error.message : String(error);

  if (status === 401 || status === 403) {
    return "OpenRouter rejected the API key. Check OPENROUTER_API_KEY.";
  }
  if (status === 429) {
    return "OpenRouter rate limit reached — the free tier caps requests. Try again shortly.";
  }
  if (status === 402) {
    return "OpenRouter reports insufficient credits for this model.";
  }
  if (status === 404) {
    return "OpenRouter does not recognise that model. Check OPENROUTER_MODEL.";
  }
  return `OpenRouter error: ${message}`;
}
