import type { User } from "grammy/types";
import type { Config } from "../config.js";
import type { Parser } from "../parse/claude.js";
import type { SheetsContext } from "../sheets/client.js";
import { RecentEntries } from "./recent.js";

/** Everything the handlers need, assembled once at startup. */
export interface App {
  config: Config;
  sheets: SheetsContext;
  parser: Parser;
  recent: RecentEntries;
}

export function createApp(parts: Omit<App, "recent">): App {
  return { ...parts, recent: new RecentEntries() };
}

/** Name to put in the payer column when the member isn't mapped in Config. */
export function displayName(from: User): string {
  const full = [from.first_name, from.last_name].filter(Boolean).join(" ").trim();
  return full || from.username || String(from.id);
}
