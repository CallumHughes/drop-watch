import type { ExpressionPreview, PreviewExtraction } from "@drop-watch/api/routers/preview";
import { describe, expect, it } from "vitest";

import { isSingleMatchExtraction, listingExtractionSettings } from "./listing-repair";

const extraction: PreviewExtraction = {
  availability: null,
  confidence: "high",
  currency: "GBP",
  evidence: { matchCount: 1, type: "selector:configured" },
  imageUrl: null,
  inStock: true,
  price: "12.00",
  strategy: "selector",
  title: "Thing",
};

const current = {
  expression: ".old-price",
  extractor: "selector" as const,
  render: "http" as const,
};

function expressionTest(matchCount: number): ExpressionPreview {
  return {
    extraction,
    extractionError: null,
    invalidExpression: false,
    invalidReason: "",
    matchCount,
    samples: [],
  };
}

describe("listingExtractionSettings", () => {
  it("requires exactly one expression match before applying", () => {
    expect(isSingleMatchExtraction(expressionTest(1))).toBe(true);
    expect(isSingleMatchExtraction(expressionTest(2))).toBe(false);
    expect(isSingleMatchExtraction(undefined)).toBe(false);
  });

  it("keeps existing settings when no repair preview was opened", () => {
    expect(
      listingExtractionSettings(
        {
          chosen: null,
          mode: null,
          preview: null,
          savingWithExpression: false,
          trimmedExpression: "",
        },
        current
      )
    ).toEqual(current);
  });

  it("blocks saving a preview until extraction succeeds", () => {
    expect(
      listingExtractionSettings(
        {
          chosen: null,
          mode: "selector",
          preview: { render: "browser" },
          savingWithExpression: false,
          trimmedExpression: "",
        },
        current
      )
    ).toBeNull();
  });

  it("persists the tested expression and preview render transport", () => {
    expect(
      listingExtractionSettings(
        {
          chosen: extraction,
          mode: "jsonpath",
          preview: { render: "browser" },
          savingWithExpression: true,
          trimmedExpression: "$..offers.price",
        },
        current
      )
    ).toEqual({
      expression: "$..offers.price",
      extractor: "jsonpath",
      render: "browser",
    });
  });

  it("persists automatic extraction when its preview is verified", () => {
    expect(
      listingExtractionSettings(
        {
          chosen: extraction,
          mode: null,
          preview: { render: "http" },
          savingWithExpression: false,
          trimmedExpression: "",
        },
        current
      )
    ).toEqual({ expression: null, extractor: "auto", render: "http" });
  });
});
