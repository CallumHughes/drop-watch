import type { RetrieveResult } from "@drop-watch/core/render";
import { describe, expect, it } from "vitest";

import {
  decidePreviewPreflight,
  orchestratePreview,
  PreviewCache,
  type PreviewEntry,
  previewFailure,
  previewTarget,
  previewTransports,
  toPreviewExtraction,
} from "./preview";

const NOW = new Date("2026-07-27T12:00:00.000Z");

function at(minutes: number): Date {
  return new Date(NOW.getTime() + minutes * 60_000);
}

function entry(url: string, storedAt = NOW): PreviewEntry {
  return { html: `<html lang="en">${url}</html>`, storedAt, url };
}

function fetched(body: string): RetrieveResult {
  return {
    body,
    durationMs: 10,
    httpStatus: 200,
    status: "ok",
    url: "https://example.com/product",
  };
}

describe("decidePreviewPreflight", () => {
  it("rejects a denied automatic URL as a bad request before transport selection", () => {
    expect(
      decidePreviewPreflight("auto", "http://renderer:3002", {
        ok: false,
        reason: "example.test resolves to 127.0.0.1, which is not public",
      })
    ).toEqual({
      code: "BAD_REQUEST",
      kind: "rejected",
      message: "example.test resolves to 127.0.0.1, which is not public",
    });
  });

  it("preserves explicit unconfigured-browser priority over URL policy denial", () => {
    expect(
      decidePreviewPreflight("browser", undefined, {
        ok: false,
        reason: "not public",
      })
    ).toEqual({
      code: "PRECONDITION_FAILED",
      kind: "rejected",
      message: "Browser rendering is not configured (RENDER_URL is unset).",
    });
  });

  it("requires the common URL check for every configured request mode", () => {
    expect(decidePreviewPreflight("auto", undefined, null)).toEqual({ kind: "check_url" });
    expect(decidePreviewPreflight("http", undefined, null)).toEqual({ kind: "check_url" });
    expect(decidePreviewPreflight("browser", "http://renderer:3002", null)).toEqual({
      kind: "check_url",
    });
  });
});

describe("preview transports", () => {
  it("uses HTTP once for automatic previews without a renderer", () => {
    expect(previewTransports("auto", undefined)).toEqual(["http"]);
    expect(previewTarget("auto", undefined)).toBe("http");
  });

  it("tries browser then HTTP for automatic previews with a renderer", () => {
    expect(previewTransports("auto", "http://renderer:3002")).toEqual(["browser", "http"]);
  });

  it("uses the browser when browser mode has a renderer", () => {
    expect(previewTarget("browser", "http://renderer:3002")).toBe("browser");
  });

  it("marks browser mode unconfigured without a renderer", () => {
    expect(previewTarget("browser", undefined)).toBe("unconfigured");
  });
});

describe("orchestratePreview", () => {
  it("keeps a successful browser extraction without fetching HTTP", async () => {
    const transports: string[] = [];
    const outcome = await orchestratePreview({
      extractPage: () => ({ ok: true, price: "12.99", strategy: "jsonld" }),
      render: "auto",
      renderUrl: "http://renderer:3002",
      retrieve: (transport) => {
        transports.push(transport);
        return Promise.resolve(fetched("<browser />"));
      },
    });

    expect(outcome.kind).toBe("extracted");
    expect(transports).toEqual(["browser"]);
    if (outcome.kind !== "failed") {
      expect(outcome.attempt.transport).toBe("browser");
    }
  });

  it("falls back from a failed browser retrieval to an HTTP extraction", async () => {
    const transports: string[] = [];
    const outcome = await orchestratePreview({
      extractPage: () => ({ ok: true, price: "12.99", strategy: "jsonld" }),
      render: "auto",
      renderUrl: "http://renderer:3002",
      retrieve: (transport) => {
        transports.push(transport);
        if (transport === "browser") {
          return Promise.resolve({
            durationMs: 5,
            error: "renderer unavailable",
            status: "renderer_error" as const,
          });
        }
        return Promise.resolve(fetched("<http />"));
      },
    });

    expect(outcome.kind).toBe("extracted");
    expect(transports).toEqual(["browser", "http"]);
    if (outcome.kind !== "failed") {
      expect(outcome.attempt.transport).toBe("http");
    }
  });

  it("falls back when the browser body has no automatic extraction", async () => {
    const outcome = await orchestratePreview({
      extractPage: (html) =>
        html === "<http />"
          ? { ok: true, price: "12.99", strategy: "jsonld" }
          : { error: "no price found", ok: false },
      render: "auto",
      renderUrl: "http://renderer:3002",
      retrieve: (transport) =>
        Promise.resolve(fetched(transport === "browser" ? "<browser />" : "<http />")),
    });

    expect(outcome.kind).toBe("extracted");
    if (outcome.kind !== "failed") {
      expect(outcome.attempt.transport).toBe("http");
    }
  });

  it("keeps the browser DOM when neither body has an automatic extraction", async () => {
    const transports: string[] = [];
    const outcome = await orchestratePreview({
      extractPage: () => ({ error: "no price found", ok: false }),
      render: "auto",
      renderUrl: "http://renderer:3002",
      retrieve: (transport) => {
        transports.push(transport);
        return Promise.resolve(fetched(transport === "browser" ? "<rendered />" : "<origin />"));
      },
    });

    expect(outcome.kind).toBe("no_extraction");
    expect(transports).toEqual(["browser", "http"]);
    if (outcome.kind !== "failed") {
      expect(outcome.attempt.result.body).toBe("<rendered />");
      expect(outcome.attempt.transport).toBe("browser");
    }
  });

  it("does not require a renderer for automatic HTTP previews", async () => {
    const transports: string[] = [];
    await orchestratePreview({
      extractPage: () => ({ ok: true, price: "12.99", strategy: "jsonld" }),
      render: "auto",
      renderUrl: undefined,
      retrieve: (transport) => {
        transports.push(transport);
        return Promise.resolve(fetched("<origin />"));
      },
    });

    expect(transports).toEqual(["http"]);
  });

  it("does not attempt an unconfigured explicit browser preview", async () => {
    const transports: string[] = [];
    const outcome = await orchestratePreview({
      extractPage: () => ({ ok: true, price: "12.99", strategy: "jsonld" }),
      render: "browser",
      renderUrl: undefined,
      retrieve: (transport) => {
        transports.push(transport);
        return Promise.resolve(fetched("<page />"));
      },
    });

    expect(outcome.kind).toBe("failed");
    expect(transports).toEqual([]);
  });

  it.each(["browser", "http"] as const)(
    "uses exactly the explicitly requested %s transport",
    async (render) => {
      const transports: string[] = [];
      await orchestratePreview({
        extractPage: () => ({ ok: true, price: "12.99", strategy: "jsonld" }),
        render,
        renderUrl: "http://renderer:3002",
        retrieve: (transport) => {
          transports.push(transport);
          return Promise.resolve(fetched("<page />"));
        },
      });
      expect(transports).toEqual([render]);
    }
  );

  it("returns a combined, useful failure when no transport retrieves a body", async () => {
    const outcome = await orchestratePreview({
      extractPage: () => ({ ok: true, price: "12.99", strategy: "jsonld" }),
      render: "auto",
      renderUrl: "http://renderer:3002",
      retrieve: (transport) => {
        if (transport === "browser") {
          return Promise.resolve({
            durationMs: 5,
            error: "renderer unavailable",
            status: "renderer_error" as const,
          });
        }
        return Promise.resolve({
          durationMs: 10,
          error: "origin unreachable",
          status: "network_error" as const,
        });
      },
    });

    expect(outcome.kind).toBe("failed");
    if (outcome.kind === "failed") {
      expect(previewFailure(outcome.attempts)).toEqual({
        code: "BAD_GATEWAY",
        message:
          "Unable to retrieve the page (browser: renderer unavailable; http: origin unreachable).",
      });
    }
  });
});

describe("PreviewCache", () => {
  it("returns a stored page", () => {
    const cache = new PreviewCache({ maxEntries: 3, ttlMs: 60_000 });
    cache.set("a", entry("https://example.com/a"), NOW);
    expect(cache.get("a", NOW)?.url).toBe("https://example.com/a");
  });

  it("forgets a page once its TTL has passed", () => {
    const cache = new PreviewCache({ maxEntries: 3, ttlMs: 60_000 });
    cache.set("a", entry("https://example.com/a"), NOW);
    expect(cache.get("a", at(0.5))?.url).toBe("https://example.com/a");
    expect(cache.get("a", at(2))).toBeUndefined();
    // The expired body is dropped, not merely hidden from the reader.
    expect(cache.size).toBe(0);
  });

  it("evicts the least recently used page when full", () => {
    const cache = new PreviewCache({ maxEntries: 2, ttlMs: 60_000 });
    cache.set("a", entry("https://example.com/a"), NOW);
    cache.set("b", entry("https://example.com/b"), NOW);
    // Touching "a" is what should save it from the next insert.
    cache.get("a", NOW);
    cache.set("c", entry("https://example.com/c"), NOW);

    expect(cache.get("a", NOW)).toBeDefined();
    expect(cache.get("b", NOW)).toBeUndefined();
    expect(cache.get("c", NOW)).toBeDefined();
    expect(cache.size).toBe(2);
  });

  it("prunes expired pages on write rather than letting them count towards the cap", () => {
    const cache = new PreviewCache({ maxEntries: 2, ttlMs: 60_000 });
    cache.set("old", entry("https://example.com/old"), NOW);
    cache.set("b", entry("https://example.com/b", at(2)), at(2));
    cache.set("c", entry("https://example.com/c", at(2)), at(2));

    expect(cache.size).toBe(2);
    expect(cache.get("old", at(2))).toBeUndefined();
    expect(cache.get("b", at(2))).toBeDefined();
    expect(cache.get("c", at(2))).toBeDefined();
  });

  it("overwrites an id in place instead of growing", () => {
    const cache = new PreviewCache({ maxEntries: 2, ttlMs: 60_000 });
    cache.set("a", entry("https://example.com/a"), NOW);
    cache.set("a", entry("https://example.com/a2"), NOW);
    expect(cache.size).toBe(1);
    expect(cache.get("a", NOW)?.url).toBe("https://example.com/a2");
  });
});

describe("toPreviewExtraction", () => {
  it("is null for a failed chain", () => {
    expect(toPreviewExtraction({ error: "no price found", ok: false })).toBeNull();
  });

  it("flattens absent optionals to null so the UI has one answer, not two", () => {
    expect(toPreviewExtraction({ ok: true, price: "12.99", strategy: "selector" })).toEqual({
      availability: null,
      currency: null,
      imageUrl: null,
      inStock: null,
      price: "12.99",
      strategy: "selector",
      title: null,
    });
  });

  it("keeps everything the chain did find, including a false inStock", () => {
    expect(
      toPreviewExtraction({
        availability: "OutOfStock",
        currency: "GBP",
        imageUrl: "https://example.com/a.jpg",
        inStock: false,
        ok: true,
        price: "1234.56",
        strategy: "jsonld",
        title: "A Thing",
      })
    ).toEqual({
      availability: "OutOfStock",
      currency: "GBP",
      imageUrl: "https://example.com/a.jpg",
      inStock: false,
      price: "1234.56",
      strategy: "jsonld",
      title: "A Thing",
    });
  });
});
