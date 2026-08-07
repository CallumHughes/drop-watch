import { describe, expect, it } from "vitest";

import { testSelector } from "./index";

/**
 * A page with no structured data at all — the case the selector picker exists
 * for. Two `.price` elements, so match counts are meaningful.
 */
const PAGE = `<!doctype html><html lang="en"><head>
  <title>A Light in the Attic | Books to Scrape</title>
  <meta property="og:image" content="/media/cover.jpg">
</head><body>
  <article class="product_page">
    <h1>A Light in the Attic</h1>
    <p class="price_color">£51.77</p>
    <p class="instock availability">In stock (22 available)</p>
    <p class="note">Prices shown include VAT.</p>
  </article>
  <aside><p class="price_color">£13.99</p></aside>
</body></html>`;

describe("testSelector", () => {
  it("reads a price from the matched element and names the winning strategy", () => {
    const test = testSelector(PAGE, {
      selector: "p.price_color",
      url: "https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html",
    });

    expect(test.invalidSelector).toBe(false);
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
    const test = testSelector(PAGE, { selector: ".product_page h1" });

    expect(test.matchCount).toBe(1);
    expect(test.samples).toEqual([
      { html: "<h1>A Light in the Attic</h1>", text: "A Light in the Attic" },
    ]);
  });

  it("separates a selector that matched nothing from one that is not valid CSS", () => {
    const missing = testSelector(PAGE, { selector: ".does-not-exist" });
    expect(missing.invalidSelector).toBe(false);
    expect(missing.matchCount).toBe(0);
    expect(missing.result).toEqual({ error: "matched nothing on this page", ok: false });

    const halfTyped = testSelector(PAGE, { selector: "p.price_color:has(" });
    expect(halfTyped.invalidSelector).toBe(true);
    expect(halfTyped.matchCount).toBe(0);
  });

  it("says so when the match holds no readable price", () => {
    const test = testSelector(PAGE, { selector: "p.note" });

    expect(test.matchCount).toBe(1);
    expect(test.result).toEqual({
      error: "matched, but no price could be read from the matched text",
      ok: false,
    });
  });

  it("skips a match with no price and takes the next one that has one", () => {
    const test = testSelector(PAGE, { selector: "p" });

    // `p.instock` and `p.note` come first in document order for `p`; the first
    // element that actually parses as a price is what a check would record.
    expect(test.matchCount).toBe(4);
    expect(test.result).toMatchObject({ ok: true, price: "51.77" });
  });

  it("treats an empty selector as nothing to test rather than an error", () => {
    expect(testSelector(PAGE, { selector: "   " })).toEqual({
      invalidSelector: false,
      matchCount: 0,
      result: { error: "no selector", ok: false },
      samples: [],
    });
  });

  it("honours a locale hint for ambiguous separators", () => {
    const html = '<html lang="de"><body><span id="p">1.234,56 €</span></body></html>';
    expect(testSelector(html, { locale: "de-DE", selector: "#p" }).result).toMatchObject({
      currency: "EUR",
      price: "1234.56",
    });
  });
});
