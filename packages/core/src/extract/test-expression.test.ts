import { describe, expect, it } from "vitest";

import { testExpression } from "./index";

/**
 * A page with no structured data at all — the case the picker exists for. Two
 * `.price` elements, so match counts are meaningful; the price also appears in
 * a `data-price` attribute and an inline JSON blob, which are the two places a
 * CSS selector cannot reach.
 */
const PAGE = `<!doctype html><html lang="en"><head>
  <title>A Light in the Attic | Books to Scrape</title>
  <meta property="og:image" content="/media/cover.jpg">
</head><body>
  <article class="product_page" data-price="51.77">
    <h1>A Light in the Attic</h1>
    <p class="price_color">£51.77</p>
    <p class="instock availability">In stock (22 available)</p>
    <p class="note">Prices shown include VAT.</p>
  </article>
  <aside><p class="price_color">£13.99</p></aside>
  <script type="application/json" id="__STATE__">
    {"product":{"name":"A Light in the Attic","price":51.77,"currency":"GBP"}}
  </script>
</body></html>`;

const URL = "https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html";

describe("testExpression — selector", () => {
  it("reads a price from the matched element and names the winning strategy", () => {
    const test = testExpression(PAGE, {
      expression: "p.price_color",
      mode: "selector",
      url: URL,
    });

    expect(test.invalidExpression).toBe(false);
    expect(test.matchCount).toBe(2);
    expect(test.result).toEqual({
      confidence: "high",
      currency: "GBP",
      evidence: { matchCount: 2, type: "selector:configured" },
      // Backfilled from page metadata, resolved against the page URL — a price
      // span knows nothing about the product, but the document does.
      imageUrl: "https://books.toscrape.com/media/cover.jpg",
      ok: true,
      price: "51.77",
      strategy: "selector",
      title: "A Light in the Attic | Books to Scrape",
    });
  });

  it("reports the matched elements so the picker can show what was hit", () => {
    const test = testExpression(PAGE, { expression: ".product_page h1", mode: "selector" });

    expect(test.matchCount).toBe(1);
    expect(test.samples).toEqual([
      { context: "<h1>A Light in the Attic</h1>", value: "A Light in the Attic" },
    ]);
  });

  it("separates a selector that matched nothing from one that is not valid CSS", () => {
    const missing = testExpression(PAGE, { expression: ".does-not-exist", mode: "selector" });
    expect(missing.invalidExpression).toBe(false);
    expect(missing.matchCount).toBe(0);
    expect(missing.result).toEqual({ error: "matched nothing on this page", ok: false });

    const halfTyped = testExpression(PAGE, { expression: "p.price_color:has(", mode: "selector" });
    expect(halfTyped.invalidExpression).toBe(true);
    expect(halfTyped.matchCount).toBe(0);
  });

  it("says so when the match holds no readable price", () => {
    const test = testExpression(PAGE, { expression: "p.note", mode: "selector" });

    expect(test.matchCount).toBe(1);
    expect(test.result).toEqual({
      error: "matched, but no price could be read from the matched text",
      ok: false,
    });
  });

  it("skips a match with no price and takes the next one that has one", () => {
    const test = testExpression(PAGE, { expression: "p", mode: "selector" });

    // `p.instock` and `p.note` come first in document order for `p`; the first
    // element that actually parses as a price is what a check would record.
    expect(test.matchCount).toBe(4);
    expect(test.result).toMatchObject({ ok: true, price: "51.77" });
  });

  it("treats an empty expression as nothing to test rather than an error", () => {
    expect(testExpression(PAGE, { expression: "   ", mode: "selector" })).toEqual({
      invalidExpression: false,
      invalidReason: "",
      matchCount: 0,
      result: { error: "no expression", ok: false },
      samples: [],
    });
  });

  it("honours a locale hint for ambiguous separators", () => {
    const html = '<html lang="de"><body><span id="p">1.234,56 €</span></body></html>';
    expect(
      testExpression(html, { expression: "#p", locale: "de-DE", mode: "selector" }).result
    ).toMatchObject({ currency: "EUR", price: "1234.56" });
  });
});

describe("testExpression — regex", () => {
  it("reads the value out of an attribute a selector cannot reach", () => {
    const test = testExpression(PAGE, {
      expression: 'data-price="([\\d.]+)"',
      mode: "regex",
      url: URL,
    });

    expect(test.invalidExpression).toBe(false);
    expect(test.matchCount).toBe(1);
    expect(test.result).toMatchObject({
      confidence: "high",
      evidence: { matchCount: 1, type: "regex:configured" },
      ok: true,
      price: "51.77",
      strategy: "regex",
    });
  });

  it("shows the capture as the value and the whole match as its context", () => {
    const test = testExpression(PAGE, { expression: 'data-price="([\\d.]+)"', mode: "regex" });

    expect(test.samples).toEqual([{ context: 'data-price="51.77"', value: "51.77" }]);
  });

  it("prefers a named price group over group 1", () => {
    const test = testExpression(PAGE, {
      expression: 'data-(?<label>price)="(?<price>[\\d.]+)"',
      mode: "regex",
    });

    expect(test.result).toMatchObject({ ok: true, price: "51.77" });
    expect(test.samples[0]?.value).toBe("51.77");
  });

  it("reads an optional currency group", () => {
    const test = testExpression(PAGE, {
      expression: '"price":(?<price>[\\d.]+),"currency":"(?<currency>[A-Z]{3})"',
      mode: "regex",
    });

    expect(test.result).toMatchObject({ currency: "GBP", ok: true, price: "51.77" });
  });

  it("reports a pattern that will not compile as invalid, not as no-match", () => {
    const test = testExpression(PAGE, { expression: "([0-9]+", mode: "regex" });

    expect(test.invalidExpression).toBe(true);
    expect(test.invalidReason).toContain("not a valid regular expression");
    expect(test.matchCount).toBe(0);
  });

  it("refuses a pattern that nests unbounded quantifiers", () => {
    const test = testExpression(PAGE, { expression: "(a+)+$", mode: "regex" });

    expect(test.invalidExpression).toBe(true);
    expect(test.invalidReason).toContain("more than one way");
  });

  it("counts high-cardinality matches without losing a later price", () => {
    const repeated = `${"x".repeat(10_000)}data-price="42.50"`;
    const test = testExpression(repeated, {
      expression: 'x|data-price="([\\d.]+)"',
      mode: "regex",
    });

    expect(test.matchCount).toBe(10_001);
    expect(test.samples).toHaveLength(5);
    expect(test.result).toMatchObject({ ok: true, price: "42.50" });
  });

  it("separates matching nothing from matching without a price", () => {
    expect(testExpression(PAGE, { expression: "nothing-here", mode: "regex" }).result).toEqual({
      error: "matched nothing on this page",
      ok: false,
    });
    expect(testExpression(PAGE, { expression: "(Light)", mode: "regex" }).result).toEqual({
      error: "matched, but no price could be read from the matched text",
      ok: false,
    });
  });
});

describe("testExpression — jsonpath", () => {
  it("resolves a price out of an embedded JSON blob", () => {
    const test = testExpression(PAGE, {
      expression: "$.product.price",
      mode: "jsonpath",
      url: URL,
    });

    expect(test.invalidExpression).toBe(false);
    expect(test.matchCount).toBe(1);
    expect(test.result).toMatchObject({
      confidence: "high",
      evidence: { matchCount: 1, type: "jsonpath:configured" },
      ok: true,
      price: "51.77",
      strategy: "jsonpath",
    });
  });

  it("finds the price by recursive descent without knowing the shape", () => {
    const test = testExpression(PAGE, { expression: "$..price", mode: "jsonpath" });

    expect(test.result).toMatchObject({ ok: true, price: "51.77" });
  });

  it("names the document each value came from", () => {
    const test = testExpression(PAGE, { expression: "$..price", mode: "jsonpath" });

    expect(test.samples).toEqual([{ context: '<script id="__STATE__">', value: "51.77" }]);
  });

  it("reports an unparseable path as invalid, not as no-match", () => {
    const test = testExpression(PAGE, { expression: "product.price", mode: "jsonpath" });

    expect(test.invalidExpression).toBe(true);
    expect(test.invalidReason).toContain("must start with `$`");
  });

  it("says so when the path resolves nothing", () => {
    expect(testExpression(PAGE, { expression: "$.nope", mode: "jsonpath" }).result).toEqual({
      error: "resolved nothing in any JSON on this page",
      ok: false,
    });
  });

  it("says so when the path resolves something that is not a price", () => {
    expect(testExpression(PAGE, { expression: "$.product.name", mode: "jsonpath" }).result).toEqual(
      { error: "resolved, but no price could be read from the value", ok: false }
    );
  });
});
