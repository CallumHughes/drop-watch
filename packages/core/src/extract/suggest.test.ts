import { describe, expect, it } from "vitest";

import { suggestExpressions } from "./suggest";

function page(head: string, body = ""): string {
  return `<!doctype html><html><head><title>Fallback title</title>${head}</head><body>${body}</body></html>`;
}

function ldScript(json: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(json)}</script>`;
}

describe("suggestExpressions — markup", () => {
  it("picks the live price and never the struck-through one", () => {
    const html = page(
      "",
      '<div class="pricing"><del class="was-price">£49.99</del><span class="price">£24.99</span></div>'
    );

    const { candidates } = suggestExpressions(html, { expectedPrice: "24.99" });

    expect(candidates[0]).toEqual({
      currency: "GBP",
      expression: ".price",
      mode: "selector",
      reason: "Reads the price element's text.",
      sample: { context: '<span class="price">£24.99</span>', value: "£24.99" },
    });
  });

  it("says so when the number the user gave is the struck-through price", () => {
    const html = page(
      "",
      '<div class="pricing"><del class="was-price">£24.99</del><span class="price">£19.99</span></div>'
    );

    const { candidates } = suggestExpressions(html, { expectedPrice: "24.99" });

    // Both read 24.99 and neither is a good pin; what matters is that each
    // says why. The page labels one as a former price, so it ranks last.
    const reasons = new Map(
      candidates.map((candidate) => [candidate.expression, candidate.reason])
    );
    expect(reasons.get(".was-price")).toContain("struck-through");
    expect(reasons.get(".was-price")).toContain("was-price");
    expect(reasons.get(".pricing")).toContain("whichever comes first");
    expect(candidates.at(-1)?.expression).toBe(".was-price");
  });

  it("ranks a sentence quoting the price below the price itself", () => {
    const html = page(
      "",
      '<p class="delivery">Free delivery over £24.99</p><span class="price">£24.99</span>'
    );

    const { candidates } = suggestExpressions(html, { expectedPrice: "24.99" });

    expect(candidates.map((candidate) => candidate.expression)).toEqual([".price", ".delivery"]);
    expect(candidates[1]?.reason).toContain("sentence");
  });

  it("ranks another product's price below this product's", () => {
    const html = page(
      "",
      `<main><span class="price">£24.99</span></main>
       <aside class="related-products"><span class="item-price">£24.99</span></aside>`
    );

    const { candidates } = suggestExpressions(html, { expectedPrice: "24.99" });

    expect(candidates[0]?.expression).toBe(".price");
    expect(candidates.at(-1)?.reason).toContain("another product");
  });

  it("prefers the wrapper that carries the currency over the bare number", () => {
    const html = page("", '<span class="price">£<span class="amount">24.99</span></span>');

    const { candidates } = suggestExpressions(html, { expectedPrice: "24.99" });

    expect(candidates[0]?.expression).toBe(".price");
    expect(candidates[0]?.currency).toBe("GBP");
    const bare = candidates.find((candidate) => candidate.expression === ".amount");
    expect(bare?.currency).toBeUndefined();
    expect(bare?.reason).toContain("no currency");
  });

  it("reads an explicit data attribute and names it in the expression", () => {
    const html = page("", '<div class="box" data-product-price="24.99 GBP">In stock</div>');

    const { candidates } = suggestExpressions(html, { expectedPrice: "24.99" });

    expect(candidates[0]?.expression).toBe(".box::attr(data-product-price)");
    expect(candidates[0]?.currency).toBe("GBP");
  });

  it("leaves content attributes to the implicit precedence", () => {
    const html = page('<meta itemprop="price" content="24.99" />');

    const { candidates } = suggestExpressions(html, { expectedPrice: "24.99" });

    expect(candidates[0]?.expression).toBe('[itemprop="price"]');
  });

  it("never emits a generated class or a positional selector", () => {
    const html = page(
      "",
      `<main class="product-main"><h1>Widget 3000</h1>
       <span class="css-1x2y3z text-2xl">£24.99</span></main>`
    );

    const { candidates } = suggestExpressions(html, { expectedPrice: "24.99" });

    expect(candidates[0]?.expression).toBe(".product-main span");
    expect(candidates[0]?.reason).toContain("no stable class or id");
    for (const candidate of candidates) {
      expect(candidate.expression).not.toContain("css-1x2y3z");
      expect(candidate.expression).not.toContain("nth-child");
    }
  });
});

describe("suggestExpressions — JSON", () => {
  it("names one offer among several ambiguous variants", () => {
    const html = page(
      ldScript({
        "@context": "https://schema.org",
        "@type": "Product",
        name: "Widget",
        offers: [
          { "@type": "Offer", price: "19.99", priceCurrency: "GBP" },
          { "@type": "Offer", price: "24.99", priceCurrency: "GBP" },
        ],
      })
    );

    const { candidates } = suggestExpressions(html, { expectedPrice: "24.99" });

    expect(candidates[0]).toMatchObject({
      currency: "GBP",
      expression: "$.offers[1]",
      mode: "jsonpath",
    });
  });

  it("ranks a list position below stable markup, because it fails silently", () => {
    const html = page(
      ldScript({
        "@context": "https://schema.org",
        "@type": "Product",
        name: "Widget",
        offers: [
          { "@type": "Offer", price: "99.00", priceCurrency: "GBP" },
          { "@type": "Offer", price: "499.00", priceCurrency: "GBP" },
        ],
      }),
      '<span data-testid="price-now">£499.00</span>'
    );

    const { candidates } = suggestExpressions(html, { expectedPrice: "499.00" });

    expect(candidates[0]?.expression).toBe('[data-testid="price-now"]');
    const indexed = candidates.find((candidate) => candidate.expression === "$.offers[1]");
    expect(indexed?.reason).toContain("reordering that list");
  });

  it("reaches a price that only exists in an embedded payload", () => {
    const html = page(
      "",
      `<div id="root"></div><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
        props: { pageProps: { product: { price: 24.99, priceCurrency: "GBP" } } },
      })}</script>`
    );

    const { candidates } = suggestExpressions(html, { expectedPrice: "24.99" });

    expect(candidates[0]?.mode).toBe("jsonpath");
    expect(candidates[0]?.expression).toBe("$..product");
    expect(candidates.map((candidate) => candidate.expression)).toContain(
      "$.props.pageProps.product"
    );
  });

  it("prefers the shorthand when it resolves to exactly one value", () => {
    const html = page(
      "",
      `<script type="application/json">${JSON.stringify({ unitPrice: 24.99 })}</script>`
    );

    const { candidates } = suggestExpressions(html, { expectedPrice: "24.99" });

    expect(candidates[0]?.expression).toBe("$..unitPrice");
  });

  it("drops a shorthand that resolves to more than one value", () => {
    const html = page(
      "",
      `<script type="application/json">${JSON.stringify({
        items: [{ price: 24.99 }, { price: 24.99 }],
      })}</script>`
    );

    const { candidates } = suggestExpressions(html, { expectedPrice: "24.99" });

    expect(candidates.map((candidate) => candidate.expression)).not.toContain("$..price");
    expect(candidates.map((candidate) => candidate.expression)).toContain("$.items[0].price");
  });
});

describe("suggestExpressions — when the price is not there", () => {
  it("reports the prices the page does show", () => {
    const html = page("", '<span class="price">£19.99</span><span class="rrp-price">£29.99</span>');

    const { candidates, pricesOnPage } = suggestExpressions(html, { expectedPrice: "24.99" });

    expect(candidates).toEqual([]);
    expect(pricesOnPage).toEqual([
      { amount: "19.99", context: "£19.99", currency: "GBP" },
      { amount: "29.99", context: "£29.99", currency: "GBP" },
    ]);
  });

  it("returns nothing for an empty document or an unparseable price", () => {
    expect(suggestExpressions("", { expectedPrice: "24.99" })).toEqual({
      automatic: null,
      candidates: [],
      pricesOnPage: [],
    });
    expect(
      suggestExpressions(page("", "<span>£24.99</span>"), { expectedPrice: "not a price" })
    ).toEqual({ automatic: null, candidates: [], pricesOnPage: [] });
  });
});

describe("suggestExpressions — the automatic verdict", () => {
  const product = (price: string) => ({
    "@context": "https://schema.org",
    "@type": "Product",
    name: "Widget",
    offers: { "@type": "Offer", price, priceCurrency: "GBP" },
  });

  it("agrees when the chain reads the same price", () => {
    const { automatic } = suggestExpressions(page(ldScript(product("24.99"))), {
      expectedPrice: "24.99",
    });

    expect(automatic).toEqual({ agrees: true, ambiguous: false, currency: "GBP", price: "24.99" });
  });

  it("disagrees when the chain reads the was-price", () => {
    const { automatic } = suggestExpressions(page(ldScript(product("49.99"))), {
      expectedPrice: "24.99",
    });

    expect(automatic).toMatchObject({ agrees: false, price: "49.99" });
  });

  it("flags agreement that the worker's gate will still refuse", () => {
    const html = page(
      ldScript({
        "@context": "https://schema.org",
        "@type": "Product",
        name: "Widget",
        offers: [
          { "@type": "Offer", price: "24.99", priceCurrency: "GBP" },
          { "@type": "Offer", price: "34.99", priceCurrency: "GBP" },
        ],
      })
    );

    const { automatic } = suggestExpressions(html, { expectedPrice: "24.99" });

    expect(automatic).toMatchObject({ agrees: true, ambiguous: true });
  });

  it("is null when the chain reads nothing at all", () => {
    const { automatic } = suggestExpressions(page("", '<span class="price">£24.99</span>'), {
      expectedPrice: "24.99",
    });

    expect(automatic).toBeNull();
  });
});

describe("suggestExpressions — bounds", () => {
  it("stays bounded on a page quoting one price hundreds of times", () => {
    const rows = Array.from(
      { length: 500 },
      (_, index) => `<span class="row-${index} price">£24.99</span>`
    ).join("");

    const started = Date.now();
    const { candidates } = suggestExpressions(page("", rows), { expectedPrice: "24.99" });

    expect(candidates.length).toBeLessThanOrEqual(5);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
