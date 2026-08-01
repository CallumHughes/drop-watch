/**
 * Which channels get built, and — the case that matters — which do not.
 *
 * No mocking library: the email channel is already an injected factory, so a
 * fake one is just a factory. Every assertion below is really the same
 * assertion from a different angle: an unconfigured destination produces no
 * channel at all, because a channel that exists is a channel `deliverAlert`
 * reports on, and reporting on a mailer nobody installed is the phantom
 * "email failed" line this whole design exists to avoid.
 */

import { describe, expect, it } from "vitest";

import type { AlertChannel, AlertTargets } from "./channels";
import { alertChannels } from "./targets";

const webhook = { haUrl: "http://ha.local:8123", webhookId: "drop_watch" };

/** Records what it was asked to build, so "never built" is assertable. */
function fakeEmailFactory(): {
  build: (recipients: readonly string[]) => AlertChannel;
  calls: string[][];
} {
  const calls: string[][] = [];
  return {
    build: (recipients) => {
      calls.push([...recipients]);
      return {
        name: "email",
        send: () => Promise.resolve({ ok: true as const }),
        target: recipients.join(", "),
      };
    },
    calls,
  };
}

function targets(overrides: Partial<AlertTargets> = {}): AlertTargets {
  return { discord: null, ntfy: null, recipients: [], telegram: null, webhook: null, ...overrides };
}

describe("alertChannels", () => {
  it("builds nothing when nothing is configured", () => {
    const email = fakeEmailFactory();
    const channels = alertChannels(targets(), email.build);

    expect(channels).toEqual([]);
    expect(email.calls).toEqual([]);
  });

  it("builds only the webhook when there are no recipients", () => {
    const email = fakeEmailFactory();
    const channels = alertChannels(targets({ webhook }), email.build);

    expect(channels.map((channel) => channel.name)).toEqual(["webhook"]);
    expect(channels[0]?.target).toBe("http://ha.local:8123/api/webhook/drop_watch");
    // The load-bearing one: no mailer means the factory is never even called.
    expect(email.calls).toEqual([]);
  });

  it("builds only email when Home Assistant is not configured", () => {
    const email = fakeEmailFactory();
    const channels = alertChannels(targets({ recipients: ["someone@example.com"] }), email.build);

    expect(channels.map((channel) => channel.name)).toEqual(["email"]);
    expect(email.calls).toEqual([["someone@example.com"]]);
  });

  it("builds both, webhook first, when both are configured", () => {
    const email = fakeEmailFactory();
    const channels = alertChannels(
      targets({ recipients: ["a@example.com", "b@example.com"], webhook }),
      email.build
    );

    expect(channels.map((channel) => channel.name)).toEqual(["webhook", "email"]);
    expect(channels[1]?.target).toBe("a@example.com, b@example.com");
  });

  it("still builds the webhook channel for an unusable base URL", () => {
    // A configured-but-broken destination is a failure to report, not a
    // channel to drop: the user asked for it, so they get told it did not work.
    const email = fakeEmailFactory();
    const channels = alertChannels(
      targets({ webhook: { haUrl: "not a url", webhookId: "x" } }),
      email.build
    );

    expect(channels.map((channel) => channel.name)).toEqual(["webhook"]);
    expect(channels[0]?.target).toBe("not a url");
  });

  it("builds ntfy, discord and telegram only when each is configured", () => {
    const email = fakeEmailFactory();
    const channels = alertChannels(
      targets({
        discord: "https://discord.com/api/webhooks/1/a",
        ntfy: { token: null, url: "https://ntfy.sh/my-topic" },
        telegram: { botToken: "tk", chatId: "42" },
      }),
      email.build
    );

    expect(channels.map((channel) => channel.name)).toEqual(["ntfy", "discord", "telegram"]);
    expect(channels[2]?.target).toBe("telegram:42");
  });

  it("orders every channel webhook, ntfy, discord, telegram, email", () => {
    const email = fakeEmailFactory();
    const channels = alertChannels(
      targets({
        discord: "https://discord.com/api/webhooks/1/a",
        ntfy: { token: null, url: "https://ntfy.sh/my-topic" },
        recipients: ["a@example.com"],
        telegram: { botToken: "tk", chatId: "42" },
        webhook,
      }),
      email.build
    );

    expect(channels.map((channel) => channel.name)).toEqual([
      "webhook",
      "ntfy",
      "discord",
      "telegram",
      "email",
    ]);
  });
});
