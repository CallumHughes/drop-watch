import { STRATEGY_ORDER } from "@drop-watch/core/extract";
import type { Listing } from "@drop-watch/db/schema/products";
import { describe, expect, it } from "vitest";

import { extractionOptions } from "./extraction";

function listing(overrides: Partial<Listing> = {}): Listing {
  return {
    active: true,
    brokenReportedAt: null,
    createdAt: new Date(),
    currency: null,
    etag: null,
    expression: null,
    extractor: "auto",
    id: "listing-1",
    intervalMinutes: 180,
    jitterPercent: 20,
    lastModified: null,
    locale: null,
    nextCheckAt: new Date(),
    productId: "product-1",
    render: "http",
    updatedAt: new Date(),
    url: "https://example.test/p",
    userId: "user-1",
    ...overrides,
  };
}

describe("extractionOptions", () => {
  it("runs the whole chain for an auto listing", () => {
    expect(extractionOptions(listing())).toEqual({ strategies: STRATEGY_ORDER });
  });

  it.each(["selector", "jsonpath"] as const)(
    "pins a %s listing to that strategy alone",
    (extractor) => {
      // Pinned means it fails loudly when the expression rots, rather than
      // quietly reporting whatever JSON-LD the page happens to carry.
      expect(extractionOptions(listing({ expression: ".price", extractor }))).toEqual({
        expression: ".price",
        strategies: [extractor],
      });
    }
  );

  it("does not forward an expression to the auto chain", () => {
    // With one generalised column, `auto` plus an expression would otherwise
    // hand that expression to the chain's trailing selector link.
    expect(extractionOptions(listing({ expression: "$.offers.price" }))).toEqual({
      strategies: STRATEGY_ORDER,
    });
  });

  it("falls back to the chain when a pinned listing has no expression", () => {
    expect(extractionOptions(listing({ extractor: "selector" }))).toEqual({
      strategies: STRATEGY_ORDER,
    });
  });

  it("falls back to the chain for an extractor value it does not recognise", () => {
    // `extractor` is a text column, not a pg enum. A hand-edited row must not
    // throw on a STRATEGIES lookup miss.
    const rogue = listing({ expression: ".price" });
    Object.assign(rogue, { extractor: "xpath" });

    expect(extractionOptions(rogue)).toEqual({ strategies: STRATEGY_ORDER });
  });
});
