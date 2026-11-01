import type { ExpressionPreview, PreviewExtraction } from "@drop-watch/api/routers/preview";
import { describe, expect, it } from "vitest";

import {
  isSingleMatchExtraction,
  type ListingExtractionSettings,
  listingExtractionNote,
  listingExtractionSettings,
  repairActionLabel,
  repairSummary,
} from "./listing-repair";

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

describe("repairActionLabel", () => {
  it("names the outcome so an automatic repair is not mistaken for a pinned one", () => {
    expect(repairActionLabel(null)).toBe("Apply repair");
    expect(repairActionLabel({ expression: ".price", extractor: "selector", render: "http" })).toBe(
      "Apply tested CSS selector"
    );
    expect(
      repairActionLabel({ expression: "$..price", extractor: "jsonpath", render: "http" })
    ).toBe("Apply tested JSONPath");
    expect(repairActionLabel({ expression: null, extractor: "auto", render: "http" })).toBe(
      "Apply automatic extraction"
    );
  });
});

describe("repairSummary", () => {
  const pinned: ListingExtractionSettings = {
    expression: ".old-price",
    extractor: "selector",
    render: "browser",
  };

  it("warns that an automatic repair clears the saved expression", () => {
    expect(repairSummary({ expression: null, extractor: "auto", render: "browser" }, pinned)).toBe(
      "Applying will switch to automatic extraction and clear the saved CSS selector."
    );
  });

  it("names the transport change as well", () => {
    expect(repairSummary({ expression: null, extractor: "auto", render: "http" }, pinned)).toBe(
      "Applying will switch to automatic extraction, clear the saved CSS selector and check over plain HTTP."
    );
  });

  it("says nothing about clearing when the listing is already automatic", () => {
    expect(
      repairSummary(
        { expression: null, extractor: "auto", render: "http" },
        { expression: null, extractor: "auto", render: "http" }
      )
    ).toBe("Applying will switch to automatic extraction.");
  });

  it("describes a pinned repair without mentioning the replaced expression", () => {
    expect(
      repairSummary({ expression: ".new-price", extractor: "selector", render: "browser" }, pinned)
    ).toBe("Applying will pin the tested CSS selector.");
  });
});

describe("listingExtractionNote", () => {
  it.each([
    {
      expected: "Found automatically from the page's own product data.",
      settings: { expression: null, extractor: "auto", render: "http" },
    },
    {
      expected:
        "Found automatically from the page's own product data, loaded in a headless browser.",
      settings: { expression: null, extractor: "auto", render: "browser" },
    },
    {
      expected: "Read from a spot on the page you confirmed.",
      settings: { expression: ".price", extractor: "selector", render: "http" },
    },
    {
      expected: "Read from a spot on the page you confirmed, loaded in a headless browser.",
      settings: { expression: "$..price", extractor: "jsonpath", render: "browser" },
    },
  ] as const)("describes $settings.extractor over $settings.render", ({ expected, settings }) => {
    expect(listingExtractionNote(settings)).toBe(expected);
  });

  it("never names the expression", () => {
    expect(
      listingExtractionNote({
        expression: "[data-price]::attr(data-price)",
        extractor: "selector",
        render: "http",
      })
    ).not.toContain("data-price");
  });
});

describe("repairSummary — the tracked price", () => {
  const pinned: ListingExtractionSettings = {
    expression: ".price",
    extractor: "selector",
    render: "http",
  };
  const automatic: ListingExtractionSettings = {
    expression: null,
    extractor: "auto",
    render: "http",
  };

  it("warns that the next check will read as a price change", () => {
    expect(
      repairSummary(pinned, automatic, {
        currency: "GBP",
        next: "24.99",
        previous: "49.99",
        previousCurrency: "GBP",
      })
    ).toBe(
      "Applying will pin the tested CSS selector. It will record £24.99 where £49.99 is on record, so the next check will read as a price change and may alert."
    );
  });

  it("says nothing extra when the price is unchanged", () => {
    expect(
      repairSummary(pinned, automatic, {
        currency: "GBP",
        next: "24.990",
        previous: "24.99",
        previousCurrency: "GBP",
      })
    ).toBe("Applying will pin the tested CSS selector.");
  });

  it("names each price in the currency it was read in", () => {
    // Formatting the price on record with the repaired reading's currency
    // reported a figure in a currency it was never in.
    expect(
      repairSummary(pinned, automatic, {
        currency: "USD",
        next: "24.99",
        previous: "24.99",
        previousCurrency: "GBP",
      })
    ).toBe(
      "Applying will pin the tested CSS selector. It will record US$24.99 where £24.99 is on record — a different currency, so this listing's history no longer compares like for like."
    );
  });

  it("says nothing extra with no price on record, or no tracked price at all", () => {
    expect(
      repairSummary(pinned, automatic, {
        currency: "GBP",
        next: "24.99",
        previous: null,
        previousCurrency: "GBP",
      })
    ).toBe("Applying will pin the tested CSS selector.");
    expect(repairSummary(pinned, automatic)).toBe("Applying will pin the tested CSS selector.");
  });
});
