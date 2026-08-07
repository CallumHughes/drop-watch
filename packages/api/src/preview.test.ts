import type { ExtractionResult } from "@drop-watch/core/extract";
import type { RetrieveResult } from "@drop-watch/core/render";
import { describe, expect, it } from "vitest";

import {
  decidePreviewPreflight,
  orchestratePreview,
  PreviewCache,
  type PreviewEntry,
  type PreviewOrchestration,
  type PreviewRequestMode,
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

function fetched(body: string, transport: "browser" | "http" = "http"): RetrieveResult {
  return {
    body,
    durationMs: 10,
    httpStatus: 200,
    status: "ok",
    url: `https://example.com/${transport}`,
  };
}

type SuccessfulExtraction = Extract<ExtractionResult, { ok: true }>;

function extracted(
  confidence: "high" | "low",
  overrides: Partial<Omit<SuccessfulExtraction, "confidence" | "ok">> = {}
): SuccessfulExtraction {
  return {
    confidence,
    evidence: { type: "opengraph:page-metadata" },
    ok: true,
    price: "12.99",
    strategy: "opengraph",
    ...overrides,
  };
}

const NO_EXTRACTION: ExtractionResult = { error: "no price found", ok: false };

interface OrchestrationScenario {
  browserExtraction?: ExtractionResult;
  browserResult?: RetrieveResult;
  httpExtraction?: ExtractionResult;
  httpResult?: RetrieveResult;
  render?: PreviewRequestMode;
  renderUrl?: string;
}

async function runScenario({
  browserExtraction = NO_EXTRACTION,
  browserResult = fetched("<browser />", "browser"),
  httpExtraction = NO_EXTRACTION,
  httpResult = fetched("<http />"),
  render = "auto",
  renderUrl = "http://renderer:3002",
}: OrchestrationScenario): Promise<{
  outcome: PreviewOrchestration;
  transports: Array<"browser" | "http">;
}> {
  const transports: Array<"browser" | "http"> = [];
  const outcome = await orchestratePreview({
    extractPage: (html) => (html === "<browser />" ? browserExtraction : httpExtraction),
    render,
    renderUrl,
    retrieve: (transport) => {
      transports.push(transport);
      return Promise.resolve(transport === "browser" ? browserResult : httpResult);
    },
  });
  return { outcome, transports };
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

  it("tries HTTP then browser for automatic previews with a renderer", () => {
    expect(previewTransports("auto", "http://renderer:3002")).toEqual(["http", "browser"]);
  });

  it("uses the browser when browser mode has a renderer", () => {
    expect(previewTarget("browser", "http://renderer:3002")).toBe("browser");
  });

  it("marks browser mode unconfigured without a renderer", () => {
    expect(previewTarget("browser", undefined)).toBe("unconfigured");
  });
});

describe("orchestratePreview", () => {
  it("intentionally short-circuits high-confidence HTTP without currency", async () => {
    const { outcome, transports } = await runScenario({
      httpExtraction: extracted("high"),
    });

    expect(outcome).toMatchObject({
      attempt: { transport: "http" },
      fallbackReason: null,
      kind: "extracted",
    });
    expect(transports).toEqual(["http"]);
    if (outcome.kind === "extracted") {
      // Confidence measures variant identity; missing currency alone does not
      // make a high-confidence HTTP observation inconclusive.
      expect(outcome.attempt.extraction.currency).toBeUndefined();
    }
  });

  it("carries HTTP currency into a higher-confidence browser winner only", async () => {
    const browserExtraction = extracted("high");
    const { outcome, transports } = await runScenario({
      browserExtraction,
      httpExtraction: extracted("low", {
        availability: "InStock",
        currency: "GBP",
        imageUrl: "https://example.com/http.jpg",
        inStock: true,
        title: "HTTP title",
      }),
    });

    expect(transports).toEqual(["http", "browser"]);
    expect(outcome).toMatchObject({
      attempt: { transport: "browser" },
      fallbackReason: "http_low_confidence",
      kind: "extracted",
    });
    if (outcome.kind === "extracted") {
      const [, originalBrowserAttempt] = outcome.attempts;
      expect(originalBrowserAttempt?.extraction?.ok).toBe(true);
      if (originalBrowserAttempt?.extraction?.ok) {
        expect(originalBrowserAttempt.extraction.currency).toBeUndefined();
        expect(outcome.attempt).not.toBe(originalBrowserAttempt);
        expect(outcome.attempt.extraction.evidence).toBe(
          originalBrowserAttempt.extraction.evidence
        );
      }
      expect(outcome.attempt.extraction).toMatchObject({ currency: "GBP" });
      expect(outcome.attempt.extraction.availability).toBeUndefined();
      expect(outcome.attempt.extraction.imageUrl).toBeUndefined();
      expect(outcome.attempt.extraction.inStock).toBeUndefined();
      expect(outcome.attempt.extraction.title).toBeUndefined();
      expect(toPreviewExtraction(outcome.attempt.extraction)?.currency).toBe("GBP");
    }
  });

  it.each([
    ["price", extracted("low", { price: "14.99" })],
    ["currency", extracted("low", { currency: "USD" })],
    ["availability", extracted("low", { availability: "OutOfStock" })],
    ["stock state", extracted("low", { inStock: false })],
  ])("chooses equal-low browser evidence when it changes %s", async (_field, browserExtraction) => {
    const { outcome } = await runScenario({
      browserExtraction,
      httpExtraction: extracted("low"),
    });

    expect(outcome).toMatchObject({
      attempt: { transport: "browser" },
      fallbackReason: "http_low_confidence",
      kind: "extracted",
    });
  });

  it("retains equal-low HTTP when browser only changes untracked presentation fields", async () => {
    const { outcome } = await runScenario({
      browserExtraction: extracted("low", {
        imageUrl: "https://example.com/browser.jpg",
        title: "Browser title",
      }),
      httpExtraction: extracted("low", {
        imageUrl: "https://example.com/http.jpg",
        title: "HTTP title",
      }),
    });

    expect(outcome).toMatchObject({
      attempt: { transport: "http" },
      fallbackReason: "http_low_confidence",
      kind: "extracted",
    });
  });

  it("retains richer equal-low HTTP when browser omits optional tracked values", async () => {
    const { outcome } = await runScenario({
      browserExtraction: extracted("low"),
      httpExtraction: extracted("low", {
        availability: "InStock",
        currency: "GBP",
        inStock: true,
      }),
    });

    expect(outcome).toMatchObject({
      attempt: { transport: "http" },
      fallbackReason: "http_low_confidence",
      kind: "extracted",
    });
  });

  it("retains HTTP when browser adds one tracked value but omits another", async () => {
    const { outcome } = await runScenario({
      browserExtraction: extracted("low", { currency: "USD" }),
      httpExtraction: extracted("low", { availability: "InStock", inStock: true }),
    });

    expect(outcome).toMatchObject({
      attempt: { transport: "http" },
      fallbackReason: "http_low_confidence",
      kind: "extracted",
    });
  });

  it("chooses browser when it adds a tracked value without losing HTTP observations", async () => {
    const { outcome } = await runScenario({
      browserExtraction: extracted("low", {
        availability: "InStock",
        currency: "GBP",
        inStock: true,
      }),
      httpExtraction: extracted("low", { availability: "InStock", inStock: true }),
    });

    expect(outcome).toMatchObject({
      attempt: { transport: "browser" },
      fallbackReason: "http_low_confidence",
      kind: "extracted",
    });
  });

  it("chooses browser when concrete tracked values differ and none disappear", async () => {
    const { outcome } = await runScenario({
      browserExtraction: extracted("low", {
        availability: "InStock",
        currency: "USD",
        inStock: true,
      }),
      httpExtraction: extracted("low", {
        availability: "InStock",
        currency: "GBP",
        inStock: true,
      }),
    });

    expect(outcome).toMatchObject({
      attempt: { extraction: { currency: "USD" }, transport: "browser" },
      fallbackReason: "http_low_confidence",
      kind: "extracted",
    });
  });

  it("carries HTTP currency into an equal-low changed-price browser winner", async () => {
    const { outcome } = await runScenario({
      browserExtraction: extracted("low", { price: "14.99" }),
      httpExtraction: extracted("low", {
        availability: "InStock",
        currency: "GBP",
        inStock: true,
      }),
    });

    expect(outcome).toMatchObject({
      attempt: { transport: "browser" },
      fallbackReason: "http_low_confidence",
      kind: "extracted",
    });
    if (outcome.kind === "extracted") {
      const [, originalBrowserAttempt] = outcome.attempts;
      expect(originalBrowserAttempt?.extraction?.ok).toBe(true);
      if (originalBrowserAttempt?.extraction?.ok) {
        expect(originalBrowserAttempt.extraction.currency).toBeUndefined();
      }
      expect(outcome.attempt.extraction).toMatchObject({ currency: "GBP", price: "14.99" });
      expect(outcome.attempt.extraction.availability).toBeUndefined();
      expect(outcome.attempt.extraction.inStock).toBeUndefined();
    }
  });

  it("uses a low-confidence browser extraction when HTTP has no extraction", async () => {
    const { outcome } = await runScenario({
      browserExtraction: extracted("low"),
    });

    expect(outcome).toMatchObject({
      attempt: { transport: "browser" },
      fallbackReason: "http_no_extraction",
      kind: "extracted",
    });
  });

  it("uses browser extraction after HTTP retrieval failure", async () => {
    const { outcome } = await runScenario({
      browserExtraction: extracted("low"),
      httpResult: { durationMs: 10, error: "origin unreachable", status: "network_error" },
    });

    expect(outcome).toMatchObject({
      attempt: { transport: "browser" },
      fallbackReason: "http_failed",
      kind: "extracted",
    });
  });

  it.each([
    ["no extraction", fetched("<browser />", "browser")],
    [
      "retrieval failure",
      { durationMs: 5, error: "renderer unavailable", status: "renderer_error" } as const,
    ],
  ])("salvages low-confidence HTTP after browser %s", async (_case, browserResult) => {
    const { outcome } = await runScenario({
      browserResult,
      httpExtraction: extracted("low"),
    });

    expect(outcome).toMatchObject({
      attempt: { transport: "http" },
      fallbackReason: "http_low_confidence",
      kind: "extracted",
    });
  });

  it("prefers the browser body when neither body extracts", async () => {
    const { outcome, transports } = await runScenario({});

    expect(transports).toEqual(["http", "browser"]);
    expect(outcome).toMatchObject({
      attempt: {
        result: { body: "<browser />", url: "https://example.com/browser" },
        transport: "browser",
      },
      fallbackReason: "http_no_extraction",
      kind: "no_extraction",
    });
  });

  it("keeps the HTTP body for manual selection when browser retrieval fails", async () => {
    const { outcome } = await runScenario({
      browserResult: { durationMs: 5, error: "renderer unavailable", status: "renderer_error" },
    });

    expect(outcome).toMatchObject({
      attempt: { result: { body: "<http />" }, transport: "http" },
      kind: "no_extraction",
    });
  });

  it("keeps the browser body when HTTP retrieval fails and browser does not extract", async () => {
    const { outcome } = await runScenario({
      httpResult: { durationMs: 10, error: "origin unreachable", status: "network_error" },
    });

    expect(outcome).toMatchObject({
      attempt: { result: { body: "<browser />" }, transport: "browser" },
      fallbackReason: "http_failed",
      kind: "no_extraction",
    });
  });

  it("uses HTTP only when automatic mode has no renderer", async () => {
    const transports: Array<"browser" | "http"> = [];
    const outcome = await orchestratePreview({
      extractPage: () => extracted("low"),
      render: "auto",
      renderUrl: undefined,
      retrieve: (transport) => {
        transports.push(transport);
        return Promise.resolve(fetched("<http />"));
      },
    });

    expect(outcome).toMatchObject({
      attempt: { transport: "http" },
      fallbackReason: null,
      kind: "extracted",
    });
    expect(transports).toEqual(["http"]);
  });

  it("does not attempt an unconfigured explicit browser preview", async () => {
    const transports: Array<"browser" | "http"> = [];
    const outcome = await orchestratePreview({
      extractPage: () => extracted("high"),
      render: "browser",
      renderUrl: undefined,
      retrieve: (transport) => {
        transports.push(transport);
        return Promise.resolve(fetched("<browser />", "browser"));
      },
    });

    expect(outcome.kind).toBe("failed");
    expect(transports).toEqual([]);
  });

  it.each(["browser", "http"] as const)(
    "uses exactly the explicitly requested %s transport",
    async (render) => {
      const extraction = extracted("low");
      const { outcome, transports } = await runScenario({
        browserExtraction: extraction,
        httpExtraction: extraction,
        render,
      });

      expect(outcome).toMatchObject({ fallbackReason: null, kind: "extracted" });
      expect(transports).toEqual([render]);
    }
  );

  it("returns a combined, useful failure when no transport retrieves a body", async () => {
    const { outcome } = await runScenario({
      browserResult: { durationMs: 5, error: "renderer unavailable", status: "renderer_error" },
      httpResult: { durationMs: 10, error: "origin unreachable", status: "network_error" },
    });

    expect(outcome.kind).toBe("failed");
    if (outcome.kind === "failed") {
      expect(outcome.fallbackReason).toBe("http_failed");
      expect(previewFailure(outcome.attempts)).toEqual({
        code: "BAD_GATEWAY",
        message:
          "Unable to retrieve the page (http: origin unreachable; browser: renderer unavailable).",
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
    expect(toPreviewExtraction(extracted("high", { strategy: "selector" }))).toEqual({
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
      toPreviewExtraction(
        extracted("high", {
          availability: "OutOfStock",
          currency: "GBP",
          imageUrl: "https://example.com/a.jpg",
          inStock: false,
          price: "1234.56",
          strategy: "jsonld",
          title: "A Thing",
        })
      )
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
