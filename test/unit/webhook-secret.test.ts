/**
 * The webhook endpoint has to be deployed with --allow-unauthenticated, because
 * Telegram cannot present a Google identity token. The shared secret is
 * therefore the only thing standing between a public URL and fabricated ledger
 * entries, so it gets a test.
 *
 * This also exercises the functions-framework request path end to end (its
 * express/body-parser/qs stack), which matters because those are pinned through
 * an `overrides` block in package.json to pick up security fixes — if an
 * override ever breaks request parsing, this test is what notices.
 */
import { getTestServer } from "@google-cloud/functions-framework/testing";
import * as functions from "@google-cloud/functions-framework";
import { Bot, webhookCallback } from "grammy";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SECRET = "test-secret-at-least-16-chars-long";

/** A minimal well-formed Telegram update. */
const UPDATE = {
  update_id: 1,
  message: {
    message_id: 1,
    date: 1_700_000_000,
    chat: { id: 999, type: "private" },
    from: { id: 999, is_bot: false, first_name: "Nobody" },
    text: "beli beras 50rb",
  },
};

let server: ReturnType<typeof getTestServer>;

beforeAll(async () => {
  // A bot that is never initialised and has no network access: enough to build
  // the callback, and the secret check runs before any update is dispatched.
  const bot = new Bot("000000:test-token-not-used-for-any-request", {
    botInfo: {
      id: 1,
      is_bot: true,
      first_name: "test",
      username: "test_bot",
      can_join_groups: false,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: false,
      allows_users_to_create_topics: false,
      can_manage_bots: false,
      supports_join_request_queries: false,
    },
  });
  // No handlers registered, so an accepted update is simply ignored — we are
  // asserting on the gate, not on behaviour behind it.
  const handler = webhookCallback(bot, "express", { secretToken: SECRET });
  functions.http("webhook-secret-test", handler);
  server = getTestServer("webhook-secret-test");
  await new Promise<void>((resolve) => server.listen(0, resolve));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function url(): string {
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return `http://127.0.0.1:${address.port}/`;
}

async function post(headers: Record<string, string>): Promise<number> {
  const res = await fetch(url(), {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(UPDATE),
  });
  return res.status;
}

describe("webhook secret gate", () => {
  it("rejects a request with no secret token", async () => {
    expect(await post({})).toBe(401);
  });

  it("rejects a request with the wrong secret token", async () => {
    expect(await post({ "x-telegram-bot-api-secret-token": "wrong" })).toBe(401);
  });

  it("accepts a request carrying the right secret token", async () => {
    // Proves both the gate and that the framework parsed the JSON body — a
    // broken body parser would surface here as a 400 or 500, not a 200.
    expect(await post({ "x-telegram-bot-api-secret-token": SECRET })).toBe(200);
  });
});
