import { describe, expect, it } from "vitest";

import { extract } from "./index";

function page(head: string, body = ""): string {
  return `<!doctype html><html><head><title>Fallback title</title>${head}</head><body>${body}</body></html>`;
}

function ldScript(json: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(json)}</script>`;
}

describe("extract — JSON-LD", () => {
  it("reads a plain schema.org/Product", () => {
    const html = page(
      ldScript({
        "@context": "https://schema.org",
        "@type": "Product",
        image: "https://cdn.example.com/widget.jpg",
        name: "Widget",
        offers: {
          "@type": "Offer",
          availability: "https://schema.org/InStock",
          price: "24.99",
          priceCurrency: "GBP",
        },
      })
    );

    expect(extract(html)).toEqual({
      availability: "InStock",
      currency: "GBP",
      imageUrl: "https://cdn.example.com/widget.jpg",
      inStock: true,
      ok: true,
      price: "24.99",
      strategy: "jsonld",
      title: "Widget",
    });
  });

  it("finds the Product inside an @graph", () => {
    const html = page(
      ldScript({
        "@context": "https://schema.org",
        "@graph": [
          { "@type": "WebSite", name: "Example Shop" },
          { "@type": "BreadcrumbList", itemListElement: [] },
          {
            "@type": "Product",
            name: "Graph Widget",
            offers: {
              "@type": "Offer",
              availability: "http://schema.org/OutOfStock",
              price: 149.5,
              priceCurrency: "EUR",
            },
          },
        ],
      })
    );

    const result = extract(html);
    expect(result).toMatchObject({
      availability: "OutOfStock",
      currency: "EUR",
      inStock: false,
      ok: true,
      price: "149.5",
      strategy: "jsonld",
      title: "Graph Widget",
    });
  });

  it("scans past earlier script blocks that hold no product", () => {
    const html = page(
      ldScript({ "@type": "Organization", name: "Example Shop" }) +
        ldScript([{ "@type": "WebPage" }]) +
        ldScript({
          "@type": "Product",
          name: "Third Block Widget",
          offers: { price: "9.99", priceCurrency: "USD" },
        })
    );

    expect(extract(html)).toMatchObject({
      currency: "USD",
      ok: true,
      price: "9.99",
      strategy: "jsonld",
      title: "Third Block Widget",
    });
  });

  it("prefers a Product over a non-Product node that also has offers", () => {
    const html = page(
      ldScript([
        { "@type": "ItemList", name: "Related", offers: { price: "1.00", priceCurrency: "GBP" } },
        {
          "@type": "Product",
          name: "Real Product",
          offers: { price: "42.00", priceCurrency: "GBP" },
        },
      ])
    );

    expect(extract(html)).toMatchObject({ price: "42.00", title: "Real Product" });
  });

  it("handles an AggregateOffer via lowPrice", () => {
    const html = page(
      ldScript({
        "@type": "Product",
        name: "Ranged Widget",
        offers: {
          "@type": "AggregateOffer",
          highPrice: "80.00",
          lowPrice: "60.00",
          priceCurrency: "USD",
        },
      })
    );

    expect(extract(html)).toMatchObject({ currency: "USD", price: "60.00" });
  });

  it("reads a price out of priceSpecification", () => {
    const html = page(
      ldScript({
        "@type": "Product",
        name: "Spec Widget",
        offers: {
          "@type": "Offer",
          priceSpecification: {
            "@type": "UnitPriceSpecification",
            price: "31.00",
            priceCurrency: "CHF",
          },
        },
      })
    );

    expect(extract(html)).toMatchObject({ currency: "CHF", price: "31.00" });
  });

  it("takes an image from an ImageObject or an array", () => {
    const html = page(
      ldScript({
        "@type": "Product",
        image: [{ "@type": "ImageObject", url: "https://cdn.example.com/a.jpg" }],
        name: "Imaged Widget",
        offers: { price: "5.00", priceCurrency: "GBP" },
      })
    );

    expect(extract(html)).toMatchObject({ imageUrl: "https://cdn.example.com/a.jpg" });
  });

  it("survives malformed JSON in one block and uses the next", () => {
    const html = page(
      '<script type="application/ld+json">{ not json at all }</script>' +
        ldScript({
          "@type": "Product",
          name: "Survivor",
          offers: { price: "12.00", priceCurrency: "GBP" },
        })
    );

    expect(extract(html)).toMatchObject({ ok: true, price: "12.00", strategy: "jsonld" });
  });

  it("parses a locale-formatted JSON-LD price using priceCurrency", () => {
    const html = page(
      ldScript({
        "@type": "Product",
        name: "Euro Widget",
        offers: { price: "1.234,56", priceCurrency: "EUR" },
      })
    );

    expect(extract(html)).toMatchObject({ currency: "EUR", price: "1234.56" });
  });
});

describe("extract — microdata", () => {
  it("reads itemprop price, currency and availability", () => {
    const html = page(
      "",
      `<div itemscope itemtype="https://schema.org/Product">
         <span itemprop="name">Micro Widget</span>
         <img itemprop="image" src="/img/micro.png" alt="" />
         <div itemprop="offers" itemscope itemtype="https://schema.org/Offer">
           <meta itemprop="price" content="59.95" />
           <meta itemprop="priceCurrency" content="USD" />
           <link itemprop="availability" href="https://schema.org/InStock" />
         </div>
       </div>`
    );

    expect(extract(html, { url: "https://shop.example.com/p/1" })).toMatchObject({
      availability: "InStock",
      currency: "USD",
      imageUrl: "https://shop.example.com/img/micro.png",
      inStock: true,
      ok: true,
      price: "59.95",
      strategy: "microdata",
      title: "Micro Widget",
    });
  });

  it("falls back to element text when there is no content attribute", () => {
    const html = page(
      "",
      `<div itemscope itemtype="https://schema.org/Product">
         <span itemprop="price">£1,234.56</span>
       </div>`
    );

    expect(extract(html)).toMatchObject({
      currency: "GBP",
      price: "1234.56",
      strategy: "microdata",
    });
  });

  it("ignores an unpriced Product scope and uses the one that has a price", () => {
    const html = page(
      "",
      `<div itemscope itemtype="https://schema.org/Product">
         <span itemprop="name">No price here</span>
       </div>
       <div itemscope itemtype="https://schema.org/Product">
         <meta itemprop="price" content="7.50" />
         <meta itemprop="priceCurrency" content="GBP" />
       </div>`
    );

    expect(extract(html)).toMatchObject({ price: "7.50", strategy: "microdata" });
  });

  it("widens to the whole document when nothing is inside a Product scope", () => {
    const html = page("", '<span itemprop="price" content="3.20">£3.20</span>');
    expect(extract(html)).toMatchObject({ price: "3.20", strategy: "microdata" });
  });
});

describe("extract — OpenGraph", () => {
  it("reads product:price tags", () => {
    const html = page(
      `<meta property="og:title" content="OG Widget" />
       <meta property="og:image" content="https://cdn.example.com/og.jpg" />
       <meta property="product:price:amount" content="18.00" />
       <meta property="product:price:currency" content="SEK" />
       <meta property="product:availability" content="instock" />`
    );

    expect(extract(html)).toEqual({
      availability: "instock",
      currency: "SEK",
      imageUrl: "https://cdn.example.com/og.jpg",
      inStock: true,
      ok: true,
      price: "18.00",
      strategy: "opengraph",
      title: "OG Widget",
    });
  });

  it("accepts name= instead of property= and the og:price spelling", () => {
    const html = page(
      `<meta name="og:price:amount" content="4.25" />
       <meta name="og:price:currency" content="GBP" />
       <meta name="og:availability" content="out of stock" />`
    );

    expect(extract(html)).toMatchObject({
      availability: "out of stock",
      currency: "GBP",
      inStock: false,
      price: "4.25",
      strategy: "opengraph",
    });
  });
});

describe("extract — configured selector", () => {
  const html = page(
    '<meta property="og:title" content="Selector Widget" />',
    '<div class="row"><span class="price">  Now\n  £1,299.00  </span></div>'
  );

  it("extracts from the matched element and backfills the title", () => {
    expect(extract(html, { selector: ".price" })).toMatchObject({
      currency: "GBP",
      ok: true,
      price: "1299.00",
      strategy: "selector",
      title: "Selector Widget",
    });
  });

  it("is skipped when no selector is configured", () => {
    const result = extract(html);
    expect(result.ok).toBe(false);
  });

  it("returns a failure when the selector matches nothing", () => {
    expect(extract(html, { selector: ".nope" })).toEqual({
      error: "no price found (tried: jsonld, microdata, opengraph, selector)",
      ok: false,
    });
  });

  it("does not throw on an invalid selector", () => {
    expect(extract(html, { selector: "!!!" }).ok).toBe(false);
  });

  it("applies the locale hint to the matched text", () => {
    const german = page("", '<span class="price">1.234 €</span>');
    expect(extract(german, { locale: "en-GB", selector: ".price" })).toMatchObject({
      price: "1.234",
    });
    expect(extract(german, { locale: "de-DE", selector: ".price" })).toMatchObject({
      price: "1234",
    });
  });
});

describe("extract — chain order and options", () => {
  const html = page(
    ldScript({
      "@type": "Product",
      name: "JSON-LD wins",
      offers: { price: "10.00", priceCurrency: "GBP" },
    }) +
      `<meta property="product:price:amount" content="20.00" />
       <meta property="product:price:currency" content="GBP" />`,
    `<div itemscope itemtype="https://schema.org/Product">
       <meta itemprop="price" content="30.00" />
     </div>
     <span class="price">£40.00</span>`
  );

  it("prefers JSON-LD over every later strategy", () => {
    expect(extract(html, { selector: ".price" })).toMatchObject({
      price: "10.00",
      strategy: "jsonld",
    });
  });

  it("falls through in order when earlier strategies are excluded", () => {
    expect(
      extract(html, { selector: ".price", strategies: ["microdata", "opengraph"] })
    ).toMatchObject({ price: "30.00", strategy: "microdata" });
    expect(
      extract(html, { selector: ".price", strategies: ["opengraph", "selector"] })
    ).toMatchObject({ price: "20.00", strategy: "opengraph" });
    expect(extract(html, { selector: ".price", strategies: ["selector"] })).toMatchObject({
      price: "40.00",
      strategy: "selector",
    });
  });

  it("names the strategies it tried when it finds nothing", () => {
    expect(extract("<html><body>nothing here</body></html>")).toEqual({
      error: "no price found (tried: jsonld, microdata, opengraph, selector)",
      ok: false,
    });
  });

  it("reports an empty document", () => {
    expect(extract("   ")).toEqual({ error: "empty document", ok: false });
  });

  it("falls back to the <title> element when there is no og:title", () => {
    const bare = page(
      ldScript({ "@type": "Product", offers: { price: "1.00", priceCurrency: "GBP" } })
    );
    expect(extract(bare)).toMatchObject({ title: "Fallback title" });
  });

  it("resolves a relative image URL against the page URL", () => {
    const relative = page(
      ldScript({
        "@type": "Product",
        image: "/media/rel.jpg",
        name: "Relative",
        offers: { price: "1.00", priceCurrency: "GBP" },
      })
    );
    expect(extract(relative, { url: "https://shop.example.com/p/9" })).toMatchObject({
      imageUrl: "https://shop.example.com/media/rel.jpg",
    });
  });

  it("leaves an absolute image URL alone", () => {
    const absolute = page(
      ldScript({
        "@type": "Product",
        image: "https://cdn.example.com/abs.jpg",
        name: "Absolute",
        offers: { price: "1.00", priceCurrency: "GBP" },
      })
    );
    expect(extract(absolute, { url: "https://shop.example.com/p/9" })).toMatchObject({
      imageUrl: "https://cdn.example.com/abs.jpg",
    });
  });
});
