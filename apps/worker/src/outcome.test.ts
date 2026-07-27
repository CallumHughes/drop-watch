import type { ExtractionResult } from "@price-tracker/core/extract";
import type { FetchPageResult } from "@price-tracker/core/fetch";
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
  currency: "GBP",
  ok: true,
  price: "51.77",
  strategy: "jsonld",
};

describe("toCheckOutcome", () => {
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
    const noCurrency: ExtractionResult = { ok: true, price: "12.00", strategy: "selector" };
    const outcome = toCheckOutcome(okFetch, noCurrency, null);
    expect(outcome.status).toBe("extract_failed");
    expect(outcome.recordPricePoint).toBe(false);
    expect(outcome.extractorUsed).toBe("selector");
    expect(outcome.error).toContain("no currency");
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
