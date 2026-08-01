/**
 * ntfy, Discord and Telegram: URL, header and body construction, plus the
 * never-throws contract. `MockAgent` intercepts the undici dispatcher rather
 * than hitting real endpoints — the only option for Telegram, whose API host
 * is not configurable, and used for all three so the tests stay consistent.
 */

import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from "undici";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { discordChannel, ntfyChannel, telegramChannel } from "./http-channels";
import type { NotificationPayload } from "./index";

const payload: NotificationPayload = {
  consecutiveFailures: null,
  currency: "GBP",
  error: null,
  imageUrl: null,
  inStock: true,
  pctChange: "-12.0",
  previousPrice: "63.00",
  price: "55.44",
  productId: "8a2652d2-cf09-40c9-a6eb-69443792f784",
  rule: "target",
  title: "Bulbasaur",
  url: "https://scrapeme.live/shop/Bulbasaur/",
};

/** Unwraps a value captured inside a mock reply, failing loudly if it never ran. */
function captured<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error("mock interceptor never ran");
  }
  return value;
}

let agent: MockAgent;
let originalDispatcher: ReturnType<typeof getGlobalDispatcher>;

beforeEach(() => {
  originalDispatcher = getGlobalDispatcher();
  agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
});

afterEach(() => {
  setGlobalDispatcher(originalDispatcher);
});

describe("ntfyChannel", () => {
  it("reports the topic URL as its target", () => {
    const channel = ntfyChannel({ token: null, url: "https://ntfy.sh/my-topic" });
    expect(channel.name).toBe("ntfy");
    expect(channel.target).toBe("https://ntfy.sh/my-topic");
  });

  it("posts the body as text with the title in a header, no auth when there is no token", async () => {
    let seen: { body: unknown; headers: unknown } | undefined;
    agent
      .get("https://ntfy.sh")
      .intercept({ method: "POST", path: "/my-topic" })
      .reply((opts) => {
        seen = { body: opts.body, headers: opts.headers };
        return { data: "ok", statusCode: 200 };
      });

    const channel = ntfyChannel({ token: null, url: "https://ntfy.sh/my-topic" });
    const result = await channel.send(payload);

    expect(result).toEqual({ httpStatus: 200, ok: true });
    expect(captured(seen).body).toContain(payload.url);
    expect((captured(seen).headers as Record<string, string>).title).toBe("Target hit: Bulbasaur");
    expect((captured(seen).headers as Record<string, string>).authorization).toBeUndefined();
  });

  it("adds a bearer token header when configured", async () => {
    let seen: { headers: unknown } | undefined;
    agent
      .get("https://ntfy.sh")
      .intercept({ method: "POST", path: "/secret-topic" })
      .reply((opts) => {
        seen = { headers: opts.headers };
        return { data: "ok", statusCode: 200 };
      });

    const channel = ntfyChannel({ token: "tk_abc123", url: "https://ntfy.sh/secret-topic" });
    await channel.send(payload);

    expect((captured(seen).headers as Record<string, string>).authorization).toBe(
      "Bearer tk_abc123"
    );
  });

  it("strips non-ASCII from the title header", async () => {
    let seen: { headers: unknown } | undefined;
    agent
      .get("https://ntfy.sh")
      .intercept({ method: "POST", path: "/my-topic" })
      .reply((opts) => {
        seen = { headers: opts.headers };
        return { data: "ok", statusCode: 200 };
      });

    const channel = ntfyChannel({ token: null, url: "https://ntfy.sh/my-topic" });
    await channel.send({ ...payload, title: "Pokémon café" });

    expect((captured(seen).headers as Record<string, string>).title).toBe(
      "Target hit: Pok?mon caf?"
    );
  });

  it("reports a non-2xx response as a failure without throwing", async () => {
    agent
      .get("https://ntfy.sh")
      .intercept({ method: "POST", path: "/my-topic" })
      .reply(500, "boom");

    const channel = ntfyChannel({ token: null, url: "https://ntfy.sh/my-topic" });
    const result = await channel.send(payload);

    expect(result).toEqual({ error: "ntfy returned HTTP 500", httpStatus: 500, ok: false });
  });

  it("reports a refused connection rather than throwing", async () => {
    // No interceptor registered and net connect is disabled: undici rejects.
    const channel = ntfyChannel({ token: null, url: "https://ntfy.sh/unregistered" });
    const result = await channel.send(payload);

    expect(result.ok).toBe(false);
  });
});

describe("discordChannel", () => {
  it("reports the webhook URL as its target", () => {
    const channel = discordChannel("https://discord.com/api/webhooks/123/abc");
    expect(channel.name).toBe("discord");
    expect(channel.target).toBe("https://discord.com/api/webhooks/123/abc");
  });

  it("posts JSON content built from the title and body", async () => {
    let seen: { body: unknown; headers: unknown } | undefined;
    agent
      .get("https://discord.com")
      .intercept({ method: "POST", path: "/api/webhooks/123/abc" })
      .reply((opts) => {
        seen = { body: opts.body, headers: opts.headers };
        return { data: "ok", statusCode: 204 };
      });

    const channel = discordChannel("https://discord.com/api/webhooks/123/abc");
    const result = await channel.send(payload);

    expect(result).toEqual({ httpStatus: 204, ok: true });
    const sent = JSON.parse(captured(seen).body as string);
    expect(sent.content).toContain("Target hit: Bulbasaur");
    expect(sent.content).toContain(payload.url);
    expect((captured(seen).headers as Record<string, string>)["content-type"]).toBe(
      "application/json"
    );
  });

  it("reports a non-2xx response as a failure without throwing", async () => {
    agent
      .get("https://discord.com")
      .intercept({ method: "POST", path: "/api/webhooks/123/bad" })
      .reply(404, "unknown webhook");

    const channel = discordChannel("https://discord.com/api/webhooks/123/bad");
    const result = await channel.send(payload);

    expect(result).toEqual({ error: "Discord returned HTTP 404", httpStatus: 404, ok: false });
  });
});

describe("telegramChannel", () => {
  it("names the chat, never the bot token, as its target", () => {
    const channel = telegramChannel({ botToken: "123456:super-secret", chatId: "42" });
    expect(channel.name).toBe("telegram");
    expect(channel.target).toBe("telegram:42");
    expect(channel.target).not.toContain("super-secret");
  });

  it("posts to the Bot API's sendMessage with chat_id and text", async () => {
    let seen: { body: unknown } | undefined;
    agent
      .get("https://api.telegram.org")
      .intercept({ method: "POST", path: "/bot123456:super-secret/sendMessage" })
      .reply((opts) => {
        seen = { body: opts.body };
        return { data: JSON.stringify({ ok: true }), statusCode: 200 };
      });

    const channel = telegramChannel({ botToken: "123456:super-secret", chatId: "42" });
    const result = await channel.send(payload);

    expect(result).toEqual({ httpStatus: 200, ok: true });
    const sent = JSON.parse(captured(seen).body as string);
    expect(sent).toEqual({ chat_id: "42", text: expect.stringContaining("Target hit: Bulbasaur") });
  });

  it("reports a non-2xx response as a failure without throwing", async () => {
    agent
      .get("https://api.telegram.org")
      .intercept({ method: "POST", path: "/botbad-token/sendMessage" })
      .reply(401, "unauthorized");

    const channel = telegramChannel({ botToken: "bad-token", chatId: "42" });
    const result = await channel.send(payload);

    expect(result).toEqual({ error: "Telegram returned HTTP 401", httpStatus: 401, ok: false });
  });
});
