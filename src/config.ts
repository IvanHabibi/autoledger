import "dotenv/config";
import { z } from "zod";
import { assertValidTimeZone } from "./util/date.js";

const ServiceAccountSchema = z.object({
  client_email: z.string().min(3),
  private_key: z.string().min(1),
  project_id: z.string().optional(),
});

export type ServiceAccount = z.infer<typeof ServiceAccountSchema>;

const EnvSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(10, "looks too short to be a bot token"),
  ALLOWED_TELEGRAM_IDS: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(10),
  CLAUDE_MODEL: z.string().default("claude-opus-5"),
  // Optional on purpose. Running on Google Cloud with a service account attached
  // to the function, Application Default Credentials supply the identity and
  // there is no key file to store, leak, or rotate. Only set this off-cloud.
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().min(10).optional(),
  SPREADSHEET_ID: z.string().min(10),
  // Required in webhook mode: the function URL is public and unauthenticated,
  // so this shared secret is what proves a request really came from Telegram.
  TELEGRAM_WEBHOOK_SECRET: z.string().min(16).optional(),
  SHEET_TRANSACTIONS: z.string().default("Transactions"),
  SHEET_CONFIG: z.string().default("Config"),
  TIMEZONE: z.string().default("Asia/Jakarta"),
});

export interface Config {
  telegramBotToken: string;
  allowedTelegramIds: Set<number>;
  anthropicApiKey: string;
  claudeModel: string;
  /** Null means "use Application Default Credentials" — the norm on Google Cloud. */
  serviceAccount: ServiceAccount | null;
  spreadsheetId: string;
  transactionsSheet: string;
  configSheet: string;
  timeZone: string;
  webhookSecret: string | null;
}

/** Accepts the key either as raw JSON or base64-encoded JSON, since shell
 *  quoting of a multi-line private key is a common place to get stuck. */
function parseServiceAccount(raw: string): ServiceAccount {
  const trimmed = raw.trim();
  let text = trimmed;
  if (!trimmed.startsWith("{")) {
    text = Buffer.from(trimmed, "base64").toString("utf8");
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON is neither valid JSON nor base64-encoded JSON. " +
        "Paste the whole key file on one line, or base64 it.",
    );
  }

  const parsed = ServiceAccountSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON parsed but is missing client_email or private_key.",
    );
  }
  // A key pasted through a .env file often arrives with literal backslash-n.
  const privateKey = parsed.data.private_key.includes("\\n")
    ? parsed.data.private_key.replace(/\\n/g, "\n")
    : parsed.data.private_key;
  return { ...parsed.data, private_key: privateKey };
}

function parseAllowedIds(raw: string): Set<number> {
  const ids = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const id = Number(part);
      if (!Number.isSafeInteger(id) || id <= 0) {
        throw new Error(
          `ALLOWED_TELEGRAM_IDS contains "${part}", which is not a numeric Telegram user id. ` +
            "Message @userinfobot to get yours.",
        );
      }
      return id;
    });
  if (ids.length === 0) {
    throw new Error(
      "ALLOWED_TELEGRAM_IDS is empty. Without it the bot would answer anyone who finds it.",
    );
  }
  return new Set(ids);
}

/** Validates the whole environment up front, so a misconfiguration fails at
 *  startup with a readable message rather than mid-conversation. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => {
        const name = String(issue.path[0] ?? "(root)");
        // "expected string, received undefined" reads as a type puzzle; for a
        // first run the useful fact is simply that the variable is missing.
        const reason = env[name] === undefined ? "not set" : issue.message;
        return `  - ${name}: ${reason}`;
      })
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}\n\nSee .env.example.`);
  }
  const e = parsed.data;
  assertValidTimeZone(e.TIMEZONE);

  return {
    telegramBotToken: e.TELEGRAM_BOT_TOKEN,
    allowedTelegramIds: parseAllowedIds(e.ALLOWED_TELEGRAM_IDS),
    anthropicApiKey: e.ANTHROPIC_API_KEY,
    claudeModel: e.CLAUDE_MODEL,
    serviceAccount: e.GOOGLE_SERVICE_ACCOUNT_JSON
      ? parseServiceAccount(e.GOOGLE_SERVICE_ACCOUNT_JSON)
      : null,
    spreadsheetId: e.SPREADSHEET_ID,
    transactionsSheet: e.SHEET_TRANSACTIONS,
    configSheet: e.SHEET_CONFIG,
    timeZone: e.TIMEZONE,
    webhookSecret: e.TELEGRAM_WEBHOOK_SECRET ?? null,
  };
}
