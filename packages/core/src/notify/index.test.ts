import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { type NotificationPayload, sendNotification, webhookUrl } from "./index";

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

let server: Server | undefined;

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
  }
});

/** A throwaway receiver standing in for Home Assistant. */
function listen(
  handler: (body: string, path: string) => { body?: string; status: number }
): Promise<{ origin: string; received: { body: string; path: string }[] }> {
  const received: { body: string; path: string }[] = [];
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      received.push({ body, path: req.url ?? "" });
      const { body: responseBody = "ok", status } = handler(body, req.url ?? "");
      res.writeHead(status).end(responseBody);
    });
  });
  return new Promise((resolve) => {
    server?.listen(0, "127.0.0.1", () => {
      const { port } = server?.address() as AddressInfo;
      resolve({ origin: `http://127.0.0.1:${port}`, received });
    });
  });
}

describe("webhookUrl", () => {
  it("builds the Home Assistant webhook path", () => {
    expect(webhookUrl("http://homeassistant:8123", "price_tracker")).toBe(
      "http://homeassistant:8123/api/webhook/price_tracker"
    );
  });

  it("tolerates a trailing slash on the base URL", () => {
    expect(webhookUrl("http://homeassistant:8123/", "price_tracker")).toBe(
      "http://homeassistant:8123/api/webhook/price_tracker"
    );
  });

  it("ignores a path on the base URL rather than nesting under it", () => {
    expect(webhookUrl("http://ha.local:8123/lovelace", "abc")).toBe(
      "http://ha.local:8123/api/webhook/abc"
    );
  });
});

describe("sendNotification", () => {
  it("posts the payload as JSON to the webhook path", async () => {
    const { origin, received } = await listen(() => ({ status: 200 }));
    const result = await sendNotification({ haUrl: origin, webhookId: "price_tracker" }, payload);

    expect(result).toEqual({ httpStatus: 200, ok: true });
    expect(received).toHaveLength(1);
    expect(received[0]?.path).toBe("/api/webhook/price_tracker");
    expect(JSON.parse(received[0]?.body ?? "")).toEqual(payload);
  });

  it("reports a non-2xx response as a failure without throwing", async () => {
    const { origin } = await listen(() => ({ status: 500 }));
    const result = await sendNotification({ haUrl: origin, webhookId: "wh" }, payload);

    expect(result).toEqual({
      error: "Home Assistant returned HTTP 500",
      httpStatus: 500,
      ok: false,
    });
  });

  it("reports a refused connection rather than rejecting", async () => {
    // Port 1 on loopback: nothing is listening, and nothing ever will be.
    const result = await sendNotification(
      { haUrl: "http://127.0.0.1:1", webhookId: "wh" },
      payload
    );

    expect(result.ok).toBe(false);
  });

  it("reports an unusable base URL rather than throwing", async () => {
    const result = await sendNotification({ haUrl: "not a url", webhookId: "wh" }, payload);

    expect(result).toEqual({ error: "invalid Home Assistant URL: not a url", ok: false });
  });
});
