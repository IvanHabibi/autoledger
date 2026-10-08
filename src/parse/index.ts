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
import type { Parser } from "./provider.js";

export type ProviderName = "anthropic" | "openrouter";

export function createParser(config: Config): Parser {
  if (config.llmProvider === "openrouter") {
    if (!config.openRouterApiKey) {
      throw new Error(
        "LLM_PROVIDER is openrouter but OPENROUTER_API_KEY is not set. " +
          "Add it to .env locally, or to Secret Manager for the deployed function.",
      );
    }
    return new OpenRouterParser({
      apiKey: config.openRouterApiKey,
      model: config.openRouterModel,
      timeZone: config.timeZone,
    });
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
  return config.llmProvider === "openrouter"
    ? `openrouter:${config.openRouterModel}`
    : `anthropic:${config.claudeModel}`;
}

export type { Parser };
