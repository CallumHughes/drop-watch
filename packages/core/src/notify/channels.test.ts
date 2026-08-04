/**
 * Fan-out behaviour.
 *
 * No mocking library here either: a channel is already a function the caller
 * supplies, so a "fake" channel is just a channel — which is the point of
 * injecting them in the first place. The three cases below are the ones the
 * rest of the system reads `delivered` for.
 */

import { describe, expect, it } from "vitest";

import type { AlertChannel, ChannelSendResult } from "./channels";
import { deliverAlert, webhookChannel } from "./channels";
import type { NotificationPayload } from "./index";

const payload: NotificationPayload = {
  consecutiveFailures: null,
  currency: "GBP",
  error: null,
  imageUrl: null,
  inStock: true,
  listingId: "9e6a1a3c-2f0e-4a9b-8c3d-1f2e3a4b5c6d",
  pctChange: "-12.0",
  previousPrice: "63.00",
  price: "55.44",
  productId: "8a2652d2-cf09-40c9-a6eb-69443792f784",
  rule: "target",
  title: "Bulbasaur",
  url: "https://scrapeme.live/shop/Bulbasaur/",
};

/** A channel that reports whatever it is told to, and records what it was sent. */
function fakeChannel(
  channel: Pick<AlertChannel, "name" | "target">,
  result: ChannelSendResult
): { channel: AlertChannel; sent: NotificationPayload[] } {
  const sent: NotificationPayload[] = [];
  return {
    channel: {
      ...channel,
      send: (received) => {
        sent.push(received);
        return Promise.resolve(result);
      },
    },
    sent,
  };
}

describe("deliverAlert", () => {
  it("sends the same payload on every configured channel", async () => {
    const webhook = fakeChannel(
      { name: "webhook", target: "http://ha.local/api/webhook/x" },
      {
        httpStatus: 200,
        ok: true,
      }
    );
    const email = fakeChannel({ name: "email", target: "someone@example.com" }, { ok: true });

    const outcome = await deliverAlert({ channels: [webhook.channel, email.channel], payload });

    expect(outcome.delivered).toBe(true);
    expect(webhook.sent).toEqual([payload]);
    expect(email.sent).toEqual([payload]);
    expect(outcome.results).toEqual([
      {
        error: null,
        httpStatus: 200,
        name: "webhook",
        ok: true,
        target: "http://ha.local/api/webhook/x",
      },
      { error: null, httpStatus: null, name: "email", ok: true, target: "someone@example.com" },
    ]);
  });

  it("reports delivered when only one of two channels lands", async () => {
    const webhook = fakeChannel(
      { name: "webhook", target: "http://ha.local/api/webhook/x" },
      { error: "Home Assistant returned HTTP 500", ok: false }
    );
    const email = fakeChannel({ name: "email", target: "someone@example.com" }, { ok: true });

    const outcome = await deliverAlert({ channels: [webhook.channel, email.channel], payload });

    // The worker gates `alert_state` on this: one channel landing is a
    // delivered alert, and re-sending it later would be a duplicate.
    expect(outcome.delivered).toBe(true);
    expect(outcome.results.map((result) => result.ok)).toEqual([false, true]);
    expect(outcome.results[0]?.error).toBe("Home Assistant returned HTTP 500");
  });

  it("reports every failure separately when nothing lands", async () => {
    const webhook = fakeChannel(
      { name: "webhook", target: "http://ha.local/api/webhook/x" },
      { error: "connect ECONNREFUSED", ok: false }
    );
    const email = fakeChannel(
      { name: "email", target: "someone@example.com" },
      { error: "email is not configured", ok: false }
    );

    const outcome = await deliverAlert({ channels: [webhook.channel, email.channel], payload });

    expect(outcome.delivered).toBe(false);
    expect(outcome.results).toHaveLength(2);
    expect(outcome.results.every((result) => result.ok)).toBe(false);
  });

  it("turns a channel that throws into a failed result rather than rejecting", async () => {
    const exploding: AlertChannel = {
      name: "email",
      send: () => Promise.reject(new Error("boom")),
      target: "someone@example.com",
    };

    const outcome = await deliverAlert({ channels: [exploding], payload });

    expect(outcome.delivered).toBe(false);
    expect(outcome.results[0]?.error).toBe("boom");
  });

  it("treats no configured channels as a quiet outcome, not a failure", async () => {
    const outcome = await deliverAlert({ channels: [], payload });

    // `delivered: false` with *no results* is what distinguishes "nothing was
    // set up" from "everything we tried failed". The settings page renders it
    // as its own state, and the worker must not log it as a delivery failure.
    expect(outcome).toEqual({ delivered: false, results: [] });
  });

  it("keeps a slow channel from delaying the others", async () => {
    const order: string[] = [];
    const slow: AlertChannel = {
      name: "webhook",
      send: () =>
        new Promise((resolve) => {
          setTimeout(() => {
            order.push("webhook");
            resolve({ ok: true });
          }, 20);
        }),
      target: "http://ha.local",
    };
    const fast: AlertChannel = {
      name: "email",
      send: () => {
        order.push("email");
        return Promise.resolve({ ok: true });
      },
      target: "someone@example.com",
    };

    const outcome = await deliverAlert({ channels: [slow, fast], payload });

    // Concurrent, so the fast channel finishes first even though it is second
    // in the list — a Home Assistant timeout must not hold up the email.
    expect(order).toEqual(["email", "webhook"]);
    // Results stay in channel order regardless of who finished when.
    expect(outcome.results.map((result) => result.name)).toEqual(["webhook", "email"]);
  });
});

describe("webhookChannel", () => {
  it("reports the endpoint it will POST to as its target", () => {
    const channel = webhookChannel({ haUrl: "http://ha.local:8123", webhookId: "drop_watch" });

    expect(channel.name).toBe("webhook");
    expect(channel.target).toBe("http://ha.local:8123/api/webhook/drop_watch");
  });

  it("stays a channel when the configured URL is unusable", () => {
    // A URL the user typed wrongly is still a channel they asked for: it has
    // to fail visibly rather than vanish from the results.
    const channel = webhookChannel({ haUrl: "not a url", webhookId: "wh" });

    expect(channel.target).toBe("not a url");
  });
});
