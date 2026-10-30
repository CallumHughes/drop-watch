import type { ExtractionResult } from "@drop-watch/core/extract";
import { extract } from "@drop-watch/core/extract";
import type { FetchPageResult } from "@drop-watch/core/fetch";
import { describe, expect, it } from "vitest";
import { toCheckOutcome } from "./outcome";

const okFetch: FetchPageResult = {
  body: "<html></html>",
  durationMs: 120,
  httpStatus: 200,
  status: "ok",
  url: "https://example.com/p",
};

const okExtraction: ExtractionResult = {
  confidence: "high",
  currency: "GBP",
  evidence: { candidateCount: 1, type: "jsonld:singleton" },
  ok: true,
  price: "51.77",
  strategy: "jsonld",
};

describe("toCheckOutcome", () => {
  // An interstitial answers 200 with no product on it, so the chain's verdict
  // ("no price found") is true and sends the reader off to write a selector
  // against a page that has none.
  it("names the protection vendor rather than reporting a page with no price", () => {
    const interstitial: FetchPageResult = {
      body: '<html><head><title>Pardon Our Interruption</title><script src="/_Incapsula_Resource"></script></head></html>',
      durationMs: 90,
      httpStatus: 200,
      status: "ok",
      url: "https://www.boots.com/p/10332063",
    };
    const outcome = toCheckOutcome(interstitial, extract(interstitial.body), null);

    expect(outcome.status).toBe("extract_failed");
    expect(outcome.error).toBe(
      "boots.com blocked this request (Imperva bot protection). A saved selector will not help: it would match the interstitial, not the product."
    );
  });

  it('explains a bodiless 403 instead of recording "HTTP 403"', () => {
    const forbidden: FetchPageResult = {
      durationMs: 40,
      error: "HTTP 403",
      httpStatus: 403,
      status: "http_error",
    };
    const outcome = toCheckOutcome(forbidden, null, null, {
      render: "http",
      url: "https://www.superdrug.com/p/814543",
    });

    expect(outcome.status).toBe("http_error");
    expect(outcome.error).toContain("superdrug.com blocked this request");
  });

  it("leaves an ordinary HTTP error's own message alone", () => {
    const notFound: FetchPageResult = {
      durationMs: 40,
      error: "HTTP 404 Not Found",
      httpStatus: 404,
      status: "http_error",
    };
    expect(
      toCheckOutcome(notFound, null, null, { render: "http", url: "https://store.test/p/1" }).error
    ).toBe("HTTP 404 Not Found");
  });

  it("records a price point when a price and currency were found", () => {
    expect(toCheckOutcome(okFetch, okExtraction, "GBP")).toEqual({
      extractorUsed: "jsonld",
      httpStatus: 200,
      recordPricePoint: true,
      status: "ok",
    });
  });

  it("treats 304 as a successful check with nothing to record", () => {
    const notModified: FetchPageResult = {
      durationMs: 30,
      httpStatus: 304,
      status: "not_modified",
    };
    expect(toCheckOutcome(notModified, null, "GBP")).toEqual({
      httpStatus: 304,
      recordPricePoint: false,
      status: "ok",
    });
  });

  it("does not name an extractor on a 304", () => {
    const notModified: FetchPageResult = {
      durationMs: 30,
      httpStatus: 304,
      status: "not_modified",
    };
    expect(toCheckOutcome(notModified, null, "GBP").extractorUsed).toBeUndefined();
  });

  it("maps a 200 with no price to extract_failed", () => {
    const failed: ExtractionResult = { error: "no price found", ok: false };
    expect(toCheckOutcome(okFetch, failed, "GBP")).toEqual({
      error: "no price found",
      httpStatus: 200,
      recordPricePoint: false,
      status: "extract_failed",
    });
  });

  it("refuses a price with no currency from either the page or the product", () => {
    const noCurrency: ExtractionResult = {
      confidence: "high",
      evidence: { matchCount: 1, type: "selector:configured" },
      ok: true,
      price: "12.00",
      strategy: "selector",
    };
    const outcome = toCheckOutcome(okFetch, noCurrency, null);
    expect(outcome.status).toBe("extract_failed");
    expect(outcome.recordPricePoint).toBe(false);
    expect(outcome.extractorUsed).toBe("selector");
    expect(outcome.error).toContain("no currency");
  });

  it("rejects an ambiguous John Lewis-style multi-candidate extraction", () => {
    const html = `<script type="application/ld+json">${JSON.stringify([
      {
        "@context": "https://schema.org",
        "@type": "Product",
        name: "Coat - Red",
        offers: { price: "99.00", priceCurrency: "GBP", sku: "red" },
      },
      {
        "@context": "https://schema.org",
        "@type": "Product",
        name: "Coat - Blue",
        offers: { price: "109.00", priceCurrency: "GBP", sku: "blue" },
      },
    ])}</script>`;
    const extraction = extract(html, { url: okFetch.url });

    expect(extraction).toMatchObject({
      confidence: "low",
      evidence: { candidateCount: 2, type: "jsonld:multiple-candidates" },
      ok: true,
      strategy: "jsonld",
    });

    const outcome = toCheckOutcome(okFetch, extraction, "GBP");
    expect(outcome).toMatchObject({
      extractorUsed: "jsonld",
      httpStatus: 200,
      recordPricePoint: false,
      status: "extract_failed",
    });
    expect(outcome.error).toContain("ambiguous");
    expect(outcome.error).toContain("2 candidates");
    expect(outcome.error).toContain("Configure a selector or JSONPath");
  });

  it("accepts a high-confidence pinned selector extraction", () => {
    const extraction = extract('<span class="price">GBP 42.00</span>', {
      expression: ".price",
      strategies: ["selector"],
      url: okFetch.url,
    });

    expect(extraction).toMatchObject({ confidence: "high", ok: true, strategy: "selector" });
    expect(toCheckOutcome(okFetch, extraction, "GBP")).toEqual({
      extractorUsed: "selector",
      httpStatus: 200,
      recordPricePoint: true,
      status: "ok",
    });
  });

  it("records a sole offer whose URL merely carries a query parameter", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Product",
      name: "Rug",
      offers: { price: "499.00", priceCurrency: "GBP" },
    })}</script>`;
    const extraction = extract(html, { url: "https://shop.example.com/p?ProductID=99" });

    expect(extraction).toMatchObject({
      confidence: "low",
      evidence: { candidateCount: 1, type: "jsonld:queried-url" },
    });
    expect(toCheckOutcome(okFetch, extraction, "GBP")).toMatchObject({
      recordPricePoint: true,
      status: "ok",
    });
  });

  it("records a lone OpenGraph price, which is never high confidence", () => {
    const extraction = extract(
      '<meta property="product:price:amount" content="24.99" /><meta property="product:price:currency" content="GBP" />',
      { url: okFetch.url }
    );

    expect(extraction).toMatchObject({ confidence: "low", strategy: "opengraph" });
    expect(toCheckOutcome(okFetch, extraction, "GBP")).toMatchObject({
      recordPricePoint: true,
      status: "ok",
    });
  });

  it("maps an HTTP failure to http_error and keeps the status code", () => {
    const httpError: FetchPageResult = {
      durationMs: 90,
      error: "HTTP 503 Service Unavailable",
      httpStatus: 503,
      status: "http_error",
    };
    expect(toCheckOutcome(httpError, null, "GBP")).toEqual({
      error: "HTTP 503 Service Unavailable",
      httpStatus: 503,
      recordPricePoint: false,
      status: "http_error",
    });
  });

  it("keeps a transport failure distinct from an HTTP failure", () => {
    const networkError: FetchPageResult = {
      durationMs: 40,
      error: "getaddrinfo ENOTFOUND shop.invalid",
      status: "network_error",
    };
    const outcome = toCheckOutcome(networkError, null, "GBP");
    expect(outcome.status).toBe("network_error");
    expect(outcome.httpStatus).toBeUndefined();
  });

  it("maps a timeout to timeout", () => {
    const timeout: FetchPageResult = {
      durationMs: 20_000,
      error: "timed out after 20000ms",
      status: "timeout",
    };
    expect(toCheckOutcome(timeout, null, "GBP").status).toBe("timeout");
  });

  it("falls back to extract_failed when a 200 was never extracted from", () => {
    expect(toCheckOutcome(okFetch, null, "GBP").status).toBe("extract_failed");
  });
});
