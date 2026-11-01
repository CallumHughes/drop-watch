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

  it("prefers the price element to the block that wraps it", () => {
    // The commonest markup there is. Both read £24.99 today; only the inner
    // one keeps reading it when a "Save £5" badge is added to the block.
    const html = page(
      "",
      '<section class="buybox"><div class="price-block"><span class="product-price">£24.99</span></div></section>'
    );

    const { candidates } = suggestExpressions(html, {
      expectedPrice: "24.99",
      listingCurrency: "GBP",
    });

    expect(candidates[0]?.expression).toBe(".product-price");
    expect(candidates[0]?.reason).toBe("Reads the price element's text.");
    expect(
      candidates.find((candidate) => candidate.expression === ".price-block")?.reason
    ).toContain("contains the price rather than being it");
  });

  it("still prefers a wrapper that reads its own currency to the bare number inside it", () => {
    // The demotion must never cost the currency: a bare number is recorded in
    // whatever the listing last stored, so a page that switches currency would
    // go on being reported in the old one.
    const html = page("", '<span class="price">£<span class="amount">24.99</span></span>');

    const { candidates } = suggestExpressions(html, {
      expectedPrice: "24.99",
      listingCurrency: "GBP",
    });

    expect(candidates[0]?.expression).toBe(".price");
    expect(candidates[0]?.currency).toBe("GBP");
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

  it("does not read Tailwind utilities as a was-price", () => {
    // `old` is a substring of `font-bold` and `before` of a Tailwind variant,
    // so the raw class attribute used to penalise the live price and tell the
    // reader its surroundings named it a former one.
    const html = page(
      "",
      `<main class="product-main"><del class="rrp">£49.99</del>
       <span class="text-2xl font-bold before:content-['']">£24.99</span></main>`
    );

    const { candidates } = suggestExpressions(html, { expectedPrice: "24.99" });

    expect(candidates[0]?.expression).toBe(".product-main span");
    expect(candidates[0]?.reason).not.toContain("was-price");
    expect(candidates[0]?.reason).not.toContain("another product");
  });

  it("does not borrow a price word from one class to condemn another", () => {
    // `w-full` is on half the price elements on the web. Read together with a
    // `product-price` class beside it, `full` + `price` said was-price.
    const html = page(
      "",
      `<main class="product-main"><del class="rrp">£49.99</del>
       <span class="w-full product-price">£24.99</span></main>`
    );

    const { candidates } = suggestExpressions(html, { expectedPrice: "24.99" });

    expect(candidates[0]?.expression).toBe(".product-price");
    expect(candidates[0]?.reason).toBe("Reads the price element's text.");
  });

  it("reads a carousel name spelled across two classes", () => {
    // `also bought` puts the phrase in two classes, and no class of a
    // recommendation block says "price", so the was-price rule's corroboration
    // could never fire here. Without it the carousel's wrapper outranked the
    // real price element on expression length alone.
    const html = page(
      "",
      `<main class="pdp"><span class="product-price">£24.99</span></main>
       <aside class="also bought"><span class="tile-price">£24.99</span></aside>`
    );

    const { candidates } = suggestExpressions(html, {
      expectedPrice: "24.99",
      listingCurrency: "GBP",
    });

    const order = candidates.map((candidate) => candidate.expression);
    expect(order.indexOf(".product-price")).toBeLessThan(order.indexOf(".also"));
    expect(candidates.find((candidate) => candidate.expression === ".also")?.reason).toContain(
      "another product"
    );
    expect(
      candidates.find((candidate) => candidate.expression === ".tile-price")?.reason
    ).toContain("another product");
  });

  it("does not read an ordinary name as a carousel for want of a companion", () => {
    // `other` is a companion away from naming a carousel, and `details` is not
    // that companion.
    const html = page(
      "",
      '<main class="pdp"><span class="other-details price">£24.99</span></main>'
    );

    const { candidates } = suggestExpressions(html, {
      expectedPrice: "24.99",
      listingCurrency: "GBP",
    });

    expect(candidates.find((candidate) => candidate.expression === ".price")?.reason).toBe(
      "Reads the price element's text."
    );
  });

  it("still reads a hyphenated was-price name as one", () => {
    const html = page(
      "",
      `<main class="product-main"><span class="list-none old-price">£24.99</span>
       <span class="w-full price-now">£19.99</span></main>`
    );

    const { candidates } = suggestExpressions(html, { expectedPrice: "24.99" });

    expect(candidates.find((candidate) => candidate.expression === ".old-price")?.reason).toContain(
      "was-price"
    );
  });

  it("describes an element read through its content attribute as an attribute", () => {
    const html = page(
      "",
      '<span class="product-price" content="24.99">£24.99 including VAT</span>'
    );

    const { candidates } = suggestExpressions(html, {
      expectedPrice: "24.99",
      listingCurrency: "GBP",
    });

    // The text draft and the implicit attribute draft are the same selector;
    // the attribute is what `extractBySelector` reads, so its tier and its
    // reason are the honest ones — the sentence caveat does not apply.
    expect(candidates[0]?.expression).toBe(".product-price");
    expect(candidates[0]?.reason).toBe("Reads an attribute on the price element.");
  });

  it("never makes a monetary attribute value part of the selector", () => {
    // `[data-price="£24.99"]` identifies the element today and matches nothing
    // the moment the price moves, so the watch would break on precisely the
    // change it exists to catch.
    const html = page("", '<span class="price" data-price="£24.99">£24.99</span>');

    const { candidates } = suggestExpressions(html, {
      expectedPrice: "24.99",
      listingCurrency: "GBP",
    });

    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(candidate.expression).not.toContain("24.99");
    }
    expect(candidates[0]?.expression).toBe(".price::attr(data-price)");
  });

  it("does the same for a price carrying a currency code", () => {
    const html = page("", '<span class="price" data-price="24.99 GBP">£24.99</span>');

    const { candidates } = suggestExpressions(html, {
      expectedPrice: "24.99",
      listingCurrency: "GBP",
    });

    for (const candidate of candidates) {
      expect(candidate.expression).not.toContain("24.99");
    }
  });

  it("does not take a form control's value for a price", () => {
    // `value` is itself a price word, so testing the attribute name first
    // answered for it and the element-level test never ran — an option value
    // that happens to equal the price passed as one.
    const html = page(
      "",
      `<select name="variant"><option value="499" selected>Large</option></select>
       <span class="product-price">£499</span>`
    );

    const { candidates } = suggestExpressions(html, {
      expectedPrice: "499.00",
      listingCurrency: "GBP",
    });

    expect(candidates[0]?.expression).toBe(".product-price");
    for (const candidate of candidates.slice(1)) {
      expect(candidate.reason).toContain("says it holds a price");
    }
  });

  it("does not take a generic data-value for a price", () => {
    const html = page(
      "",
      '<div class="tile" data-value="499">In stock</div><span class="product-price">£499</span>'
    );

    const { candidates } = suggestExpressions(html, {
      expectedPrice: "499.00",
      listingCurrency: "GBP",
    });

    expect(candidates[0]?.expression).toBe(".product-price");
    expect(
      candidates.find((candidate) => candidate.expression === ".tile::attr(data-value)")?.reason
    ).toContain("says it holds a price");
  });

  it("does not take an attribute for a price just because the number matches", () => {
    // A product id on a page selling something for £499 parses to 499 and goes
    // on reading 499 after the price moves.
    const html = page("", '<span class="price" data-product-id="499">£499</span>');

    const { candidates } = suggestExpressions(html, {
      expectedPrice: "499.00",
      listingCurrency: "GBP",
    });

    expect(candidates[0]?.expression).toBe(".price");
    expect(
      candidates.find((candidate) => candidate.expression === ".price::attr(data-product-id)")
        ?.reason
    ).toContain("says it holds a price");
  });

  it("suggests a price that only exists in a meta property", () => {
    const html = page('<meta property="product:price:amount" content="24.99" />');

    const { candidates } = suggestExpressions(html, {
      expectedPrice: "24.99",
      listingCurrency: "GBP",
    });

    expect(candidates[0]?.expression).toBe('[property="product:price:amount"]');
  });

  it("does not take a meta description quoting the price for the price", () => {
    // `[name="description"]` identifies one element and its content parses to
    // exactly the typed figure, so only the sentence tells it apart from a
    // price attribute.
    const html = page(
      '<meta name="description" content="Buy the Widget for just £24.99 today" />',
      '<span class="product-price">£24.99</span>'
    );

    const { candidates } = suggestExpressions(html, {
      expectedPrice: "24.99",
      listingCurrency: "GBP",
    });

    expect(candidates[0]?.expression).toBe(".product-price");
    expect(
      candidates.find((candidate) => candidate.expression === '[name="description"]')?.reason
    ).toContain("sentence");
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

  it("stays bounded when no selector on the page identifies anything", () => {
    // The expensive shape: every class is ambiguous, so narrowing exhausts
    // ancestors × prefixes × own selectors and finds nothing either way.
    // Each of those is a scan of the whole tree, and this runs in the API
    // handler on a keystroke, so the query budget is what bounds it.
    const filler = Array.from(
      { length: 8 },
      (_, index) => `<span class="pad-${index} note item">x</span>`
    ).join("");
    const block = `<div class="row alpha beta"><div class="cell gamma delta">${filler}<span class="figure epsilon zeta">£24.99</span></div></div>`;
    const html = page("", `<main class="product-main">${block.repeat(500)}</main>`);

    const started = Date.now();
    const { candidates } = suggestExpressions(html, { expectedPrice: "24.99" });

    expect(candidates).toEqual([]);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe("suggestExpressions — ranking against what the listing already knows", () => {
  const bareJsonAndMarkup = page(
    "",
    `<script type="application/json">${JSON.stringify({ price: 24.99 })}</script>
     <span class="product-price">£24.99</span>`
  );

  it("prefers currency-bearing markup when the listing has no currency", () => {
    // A bare number is an `extract_failed` on the next check, which no amount
    // of structural durability redeems.
    const { candidates } = suggestExpressions(bareJsonAndMarkup, { expectedPrice: "24.99" });

    expect(candidates[0]?.expression).toBe(".product-price");
    expect(candidates[0]?.currency).toBe("GBP");
  });

  it("prefers the durable path once the listing supplies the currency", () => {
    const { candidates } = suggestExpressions(bareJsonAndMarkup, {
      expectedPrice: "24.99",
      listingCurrency: "GBP",
    });

    expect(candidates[0]?.expression).toBe("$..price");
    expect(candidates[0]?.reason).toBe("Reads the page's structured data.");
  });

  it("reads a price field named anywhere along its path", () => {
    // `current` says nothing on its own; `priceInfo` says it plainly. Reading
    // only the leaf key called this some number that happened to match.
    const html = page(
      "",
      `<script type="application/json">${JSON.stringify({ priceInfo: { current: 24.99 } })}</script>
       <span class="product-price">£24.99</span>`
    );

    const { candidates } = suggestExpressions(html, {
      expectedPrice: "24.99",
      listingCurrency: "GBP",
    });

    // The concrete path carries the key that made this a price; `$..current`
    // throws it away, so it is the one that has to admit to naming nothing.
    expect(candidates[0]?.expression).toBe("$.priceInfo.current");
    expect(candidates[0]?.reason).toBe("Reads the page's structured data.");
    expect(candidates.find((candidate) => candidate.expression === "$..current")?.reason).toContain(
      "says it holds a price"
    );
  });

  it("does not let a broad ancestor key name every number beneath it", () => {
    // `initialValue` wraps a whole payload in app state. Letting `value` name
    // its descendants put the stock count back in the structured-data tier.
    const html = page(
      "",
      `<script type="application/json">${JSON.stringify({ initialValue: { product: { stock: 499 } } })}</script>
       <span class="product-price">£499</span>`
    );

    const { candidates } = suggestExpressions(html, {
      expectedPrice: "499.00",
      listingCurrency: "GBP",
    });

    expect(candidates[0]?.expression).toBe(".product-price");
    expect(candidates.find((candidate) => candidate.expression === "$..stock")?.reason).toContain(
      "says it holds a price"
    );
  });

  it("does not take an unnamed number for a price, however durable the path", () => {
    const html = page(
      "",
      `<script type="application/json">${JSON.stringify({ stock: 499 })}</script>
       <span class="product-price">£499.00</span>`
    );

    const { candidates } = suggestExpressions(html, {
      expectedPrice: "499.00",
      listingCurrency: "GBP",
    });

    expect(candidates[0]?.expression).toBe(".product-price");
    expect(candidates.find((candidate) => candidate.expression === "$..stock")?.reason).toContain(
      "says it holds a price"
    );
  });

  it("ranks a was-price JSON field below the live price in the markup", () => {
    const html = page(
      "",
      `<script type="application/json">${JSON.stringify({ originalPrice: 24.99 })}</script>
       <span class="product-price">£24.99</span>`
    );

    const { candidates } = suggestExpressions(html, {
      expectedPrice: "24.99",
      listingCurrency: "GBP",
    });

    expect(candidates[0]?.expression).toBe(".product-price");
    expect(
      candidates.find((candidate) => candidate.expression === "$..originalPrice")?.reason
    ).toContain("was-price");
  });
});

describe("suggestExpressions — the prices the page does show", () => {
  it("offers the product's own price even when incidental ones come first", () => {
    const incidental = Array.from(
      { length: 14 },
      (_, index) => `<span class="badge">£${index + 1}.00</span>`
    ).join("");
    const html = page("", `${incidental}<span class="product-price">£24.99</span>`);

    const { candidates, pricesOnPage } = suggestExpressions(html, { expectedPrice: "99.99" });

    expect(candidates).toEqual([]);
    // Truncating in document order dropped this one entirely.
    expect(pricesOnPage[0]).toEqual({ amount: "24.99", context: "£24.99", currency: "GBP" });
  });
});
