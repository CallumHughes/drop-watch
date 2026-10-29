import { describe, expect, it } from "vitest";
import { ambiguousEvidence, isAmbiguousExtraction } from "./evidence";
import { extract } from "./index";
import type { ExtractionEvidence } from "./types";

function page(body: string): string {
  return `<!doctype html><html><head>${body}</head><body></body></html>`;
}

function ldScript(value: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
}

const product = {
  "@context": "https://schema.org",
  "@type": "Product",
  name: "Widget",
  offers: { "@type": "Offer", price: "24.99", priceCurrency: "GBP" },
};

describe("ambiguousEvidence", () => {
  it("flags more than one candidate", () => {
    expect(ambiguousEvidence({ candidateCount: 2, type: "jsonld:multiple-candidates" })).toBe(true);
    expect(ambiguousEvidence({ candidateCount: 3, type: "microdata:ambiguous" })).toBe(true);
  });

  it("flags a contradiction or a range even with one candidate", () => {
    const conflicting: ExtractionEvidence[] = [
      { candidateCount: 1, type: "jsonld:conflict" },
      { candidateCount: 1, type: "jsonld:aggregate-offer" },
      { candidateCount: 1, type: "jsonld:non-product" },
    ];
    for (const evidence of conflicting) {
      expect(ambiguousEvidence(evidence)).toBe(true);
    }
  });

  it("clears a sole candidate that merely lacks corroboration", () => {
    const unproven: ExtractionEvidence[] = [
      { candidateCount: 1, type: "jsonld:queried-url" },
      { candidateCount: 1, type: "jsonld:pathname" },
      { candidateCount: 1, type: "jsonld:document-order" },
      { candidateCount: 1, type: "microdata:queried-url" },
      { candidateCount: 1, type: "microdata:document-price" },
      { type: "opengraph:page-metadata" },
    ];
    for (const evidence of unproven) {
      expect(ambiguousEvidence(evidence)).toBe(false);
    }
  });
});

describe("isAmbiguousExtraction", () => {
  it("never refuses a high-confidence result, however many candidates it chose between", () => {
    expect(
      isAmbiguousExtraction({
        confidence: "high",
        evidence: { candidateCount: 3, type: "jsonld:selected-sku" },
      })
    ).toBe(false);
  });

  it("refuses a low-confidence result only when prices competed", () => {
    expect(
      isAmbiguousExtraction({
        confidence: "low",
        evidence: { candidateCount: 2, type: "jsonld:multiple-candidates" },
      })
    ).toBe(true);
    expect(
      isAmbiguousExtraction({
        confidence: "low",
        evidence: { candidateCount: 1, type: "jsonld:queried-url" },
      })
    ).toBe(false);
  });
});

/**
 * The regression the gate was widened for: these pages are unambiguous and a
 * check must keep recording them, even though the extractor rates them low.
 */
describe("real pages the gate must not refuse", () => {
  it("accepts a sole offer on a URL carrying a query parameter", () => {
    const result = extract(page(ldScript(product)), {
      url: "https://shop.example.com/p?ProductID=99",
    });
    if (!result.ok) {
      throw new Error("expected an extraction");
    }
    expect(result).toMatchObject({
      confidence: "low",
      evidence: { candidateCount: 1, type: "jsonld:queried-url" },
    });
    expect(isAmbiguousExtraction(result)).toBe(false);
  });

  it("accepts a lone OpenGraph price tag", () => {
    const result = extract(
      page(
        '<meta property="product:price:amount" content="24.99" /><meta property="product:price:currency" content="GBP" />'
      ),
      { url: "https://shop.example.com/widget" }
    );
    if (!result.ok) {
      throw new Error("expected an extraction");
    }
    expect(result).toMatchObject({ confidence: "low", strategy: "opengraph" });
    expect(isAmbiguousExtraction(result)).toBe(false);
  });

  it("still refuses two competing size offers", () => {
    const result = extract(
      page(
        ldScript([
          { ...product, name: "Small", offers: { price: "99.00", priceCurrency: "GBP" } },
          { ...product, name: "Large", offers: { price: "499.00", priceCurrency: "GBP" } },
        ])
      ),
      { url: "https://shop.example.com/rug" }
    );
    if (!result.ok) {
      throw new Error("expected an extraction");
    }
    expect(isAmbiguousExtraction(result)).toBe(true);
  });
});
