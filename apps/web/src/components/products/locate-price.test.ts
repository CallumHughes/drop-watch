import type { PriceSuggestion, SuggestedExpression } from "@drop-watch/api/routers/preview";
import { describe, expect, it } from "vitest";

import {
  automaticDisagreementNote,
  expectedPriceLabel,
  locatorOutcome,
  missingCurrencyWarning,
} from "./locate-price";

const candidate: SuggestedExpression = {
  currency: "GBP",
  expression: ".price",
  mode: "selector",
  reason: "Reads the price element's text.",
  sample: { context: '<span class="price">£24.99</span>', value: "£24.99" },
};

function suggestion(overrides: Partial<PriceSuggestion> = {}): PriceSuggestion {
  return { automatic: null, candidates: [], pricesOnPage: [], ...overrides };
}

describe("locatorOutcome", () => {
  it("stays idle until something has been typed", () => {
    for (const expectedPrice of ["", "  "]) {
      expect(
        locatorOutcome({ expectedPrice, isLocating: false, suggestion: suggestion() })
      ).toEqual({ kind: "idle" });
    }
  });

  it("says so when what was typed is not a figure it can look for", () => {
    // The input used to carry a `pattern` for this, which blocked the enclosing
    // settings form's submit. Saying it here has no such reach.
    for (const expectedPrice of ["£24.99", "24.999", "1,299.00", "abc"]) {
      expect(
        locatorOutcome({ expectedPrice, isLocating: false, suggestion: suggestion() })
      ).toEqual({ kind: "unusable" });
    }
  });

  it("reports a failed lookup rather than searching forever", () => {
    expect(
      locatorOutcome({
        error: new Error("This preview has expired. Fetch the page again."),
        expectedPrice: "24.99",
        isLocating: false,
        suggestion: undefined,
      })
    ).toEqual({
      kind: "failed",
      message: "Could not look for that price: This preview has expired. Fetch the page again.",
    });
  });

  it("does not offer back the price that was just typed", () => {
    // Picking it would re-ask the same question and get the same answer.
    const outcome = locatorOutcome({
      expectedPrice: "24.99",
      isLocating: false,
      suggestion: suggestion({
        pricesOnPage: [
          { amount: "24.99", context: "£24.99", currency: "GBP" },
          { amount: "19.99", context: "£19.99", currency: "GBP" },
        ],
      }),
    });

    expect(outcome).toEqual({
      kind: "unreachable",
      prices: [{ amount: "19.99", context: "£19.99", currency: "GBP" }],
    });
  });

  it("compares the typed price by value, not by spelling", () => {
    expect(
      locatorOutcome({
        expectedPrice: "24.9",
        isLocating: false,
        suggestion: suggestion({
          pricesOnPage: [{ amount: "24.90", context: "£24.90", currency: "GBP" }],
        }),
      })
    ).toEqual({ kind: "unreachable", prices: [] });
  });

  it("searches while the request is outstanding or has not been made", () => {
    expect(
      locatorOutcome({ expectedPrice: "24.99", isLocating: true, suggestion: suggestion() })
    ).toEqual({ kind: "searching" });
    expect(
      locatorOutcome({ expectedPrice: "24.99", isLocating: false, suggestion: undefined })
    ).toEqual({ kind: "searching" });
  });

  it("reports the located candidate", () => {
    expect(
      locatorOutcome({
        expectedPrice: "24.99",
        isLocating: false,
        suggestion: suggestion({ candidates: [candidate] }),
      })
    ).toEqual({ candidate, kind: "located" });
  });

  it("prefers the automatic result over pinning anything", () => {
    expect(
      locatorOutcome({
        expectedPrice: "24.99",
        isLocating: false,
        suggestion: suggestion({
          automatic: { agrees: true, ambiguous: false, currency: "GBP", price: "24.99" },
          candidates: [candidate],
        }),
      })
    ).toEqual({ kind: "automatic", price: "24.99" });
  });

  it("still pins when the chain agrees but the gate would refuse", () => {
    expect(
      locatorOutcome({
        expectedPrice: "24.99",
        isLocating: false,
        suggestion: suggestion({
          automatic: { agrees: true, ambiguous: true, currency: "GBP", price: "24.99" },
          candidates: [candidate],
        }),
      })
    ).toEqual({ candidate, kind: "located" });
  });

  it("offers the page's own prices when the typed one is not on it", () => {
    const prices = [{ amount: "19.99", context: "£19.99", currency: "GBP" }];
    expect(
      locatorOutcome({
        expectedPrice: "24.99",
        isLocating: false,
        suggestion: suggestion({ pricesOnPage: prices }),
      })
    ).toEqual({ kind: "elsewhere", prices });
  });

  it("says the price is simply absent when the page shows none", () => {
    expect(
      locatorOutcome({ expectedPrice: "24.99", isLocating: false, suggestion: suggestion() })
    ).toEqual({ kind: "absent" });
  });
});

describe("automaticDisagreementNote", () => {
  it("names the number the chain reads instead", () => {
    expect(
      automaticDisagreementNote(
        suggestion({
          automatic: { agrees: false, ambiguous: false, currency: "GBP", price: "49.99" },
        }),
        " 24.99 "
      )
    ).toBe("Read automatically, this page gives £49.99, not the 24.99 you entered.");
  });

  it("says nothing when the chain agrees or read nothing", () => {
    expect(
      automaticDisagreementNote(
        suggestion({
          automatic: { agrees: true, ambiguous: false, currency: "GBP", price: "24.99" },
        }),
        "24.99"
      )
    ).toBeNull();
    expect(automaticDisagreementNote(suggestion(), "24.99")).toBeNull();
    expect(automaticDisagreementNote(undefined, "24.99")).toBeNull();
  });
});

describe("missingCurrencyWarning", () => {
  it("warns when neither the expression nor the listing has a currency", () => {
    const bare = { ...candidate, currency: null };
    expect(missingCurrencyWarning({ candidate: bare, kind: "located" }, null)).toContain(
      "no currency"
    );
  });

  it("stays quiet when either side supplies one", () => {
    const bare = { ...candidate, currency: null };
    expect(missingCurrencyWarning({ candidate: bare, kind: "located" }, "GBP")).toBeNull();
    expect(missingCurrencyWarning({ candidate, kind: "located" }, null)).toBeNull();
    expect(missingCurrencyWarning({ kind: "absent" }, null)).toBeNull();
  });
});

describe("expectedPriceLabel", () => {
  it("names the currency when one is known", () => {
    expect(expectedPriceLabel("GBP")).toBe("What price does this page show? (GBP)");
    expect(expectedPriceLabel(null)).toBe("What price does this page show? (currency unknown)");
  });
});
