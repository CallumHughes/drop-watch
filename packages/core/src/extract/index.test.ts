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
      confidence: "low",
      currency: "GBP",
      evidence: { candidateCount: 1, type: "jsonld:document-order" },
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

    expect(extract(html)).toMatchObject({
      confidence: "low",
      currency: "USD",
      evidence: { candidateCount: 1, type: "jsonld:aggregate-offer" },
      price: "60.00",
    });
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

  it("uses an unambiguous selected SKU to choose a later ProductGroup variant", () => {
    const html = page(
      ldScript([
        {
          "@type": "Product",
          image: "https://images.example.com/cover.jpg",
          name: "Earlier accessory",
          offers: { price: "99.00", priceCurrency: "GBP", sku: "accessory-1" },
        },
        {
          "@type": "ProductGroup",
          hasVariant: [
            {
              "@type": "Product",
              image: "https://images.example.com/114250751.jpg",
              name: "Laptop, 8 GB",
              offers: { price: "399.00", priceCurrency: "GBP", sku: "114250751" },
            },
            {
              "@type": "Product",
              image: "https://images.example.com/114250752.jpg",
              name: "Laptop, 16 GB",
              offers: {
                availability: "https://schema.org/InStock",
                price: "499.00",
                priceCurrency: "GBP",
                sku: 114_250_752,
              },
            },
          ],
        },
      ]),
      '<button data-sku="114250752" data-sku-selected="true">16 GB</button>'
    );

    expect(extract(html)).toMatchObject({
      confidence: "high",
      currency: "GBP",
      evidence: { candidateCount: 3, type: "jsonld:selected-sku" },
      imageUrl: "https://images.example.com/114250752.jpg",
      inStock: true,
      price: "499.00",
      strategy: "jsonld",
      title: "Laptop, 16 GB",
    });
  });

  it("deduplicates a selected concrete Offer nested in an AggregateOffer", () => {
    const html = page(
      ldScript({
        "@type": "Product",
        name: "Nested variant",
        offers: {
          "@type": "AggregateOffer",
          lowPrice: "499.00",
          offers: {
            "@type": "Offer",
            price: "499.00",
            priceCurrency: "GBP",
            sku: "selected-blue",
          },
          priceCurrency: "GBP",
        },
      }),
      '<button data-sku="selected-blue" data-sku-selected="true">Blue</button>'
    );

    expect(extract(html)).toMatchObject({
      confidence: "high",
      evidence: { candidateCount: 2, type: "jsonld:selected-sku" },
      price: "499.00",
      title: "Nested variant",
    });
  });

  it("uses the owning Product SKU when its Offer has no SKU", () => {
    const html = page(
      ldScript([
        {
          "@type": "Product",
          name: "Red",
          offers: { price: "99.00", priceCurrency: "GBP" },
          sku: "red",
        },
        {
          "@type": "Product",
          name: "Blue",
          offers: { price: "499.00", priceCurrency: "GBP" },
          sku: "blue",
        },
      ]),
      '<button data-sku="blue" data-sku-selected="true">Blue</button>'
    );

    expect(extract(html)).toMatchObject({
      confidence: "high",
      evidence: { candidateCount: 2, type: "jsonld:selected-sku" },
      price: "499.00",
      title: "Blue",
    });
  });

  it("uses an exact variant query URL before an earlier pathname match", () => {
    const html = page(
      ldScript([
        {
          "@type": "Product",
          name: "Blue",
          offers: {
            price: "499.00",
            priceCurrency: "GBP",
            url: "https://shop.example.com/widget?variant=blue",
          },
        },
        {
          "@type": "Product",
          name: "Red",
          offers: {
            price: "99.00",
            priceCurrency: "GBP",
            url: "https://shop.example.com/widget?variant=red#details",
          },
        },
      ])
    );

    expect(extract(html, { url: "https://shop.example.com/widget?variant=red" })).toMatchObject({
      confidence: "high",
      evidence: { candidateCount: 2, type: "jsonld:exact-url" },
      price: "99.00",
      title: "Red",
    });
  });

  it("uses a unique ProductGroup size match for a Ruggable-shaped query", () => {
    const sizes = [
      "61x91",
      "61x183",
      "91x152",
      "91x244",
      "122x183",
      "122x275",
      "152x213",
      "152x244",
      "183x274",
      "244x305",
      "185 × 275",
    ];
    const html = page(
      ldScript({
        "@type": "ProductGroup",
        hasVariant: sizes.map((size, index) => ({
          "@type": "Product",
          name: `Morris & Co. Pimpernel Jade Tufted Rug ${size}`,
          offers: {
            price: index === sizes.length - 1 ? "449.25" : String(100 + index),
            priceCurrency: "GBP",
          },
          size,
        })),
        name: "Morris & Co. Pimpernel Jade Tufted Rug",
        variesBy: ["https://schema.org/size"],
      })
    );

    expect(
      extract(html, {
        url: "https://ruggable.co.uk/products/pimpernel?size=185x275&system=rug-cvr&utm_source=email",
      })
    ).toMatchObject({
      confidence: "high",
      currency: "GBP",
      evidence: {
        candidateCount: 11,
        matchedParams: ["size"],
        type: "jsonld:variant-params",
      },
      price: "449.25",
      title: "Morris & Co. Pimpernel Jade Tufted Rug 185 × 275",
    });
  });

  it("does not treat an empty JSON-LD URL as the current page URL", () => {
    const html = page(
      ldScript([
        {
          "@type": "Product",
          name: "Small variant",
          offers: { price: "10.00", priceCurrency: "GBP", url: "" },
          size: "small",
        },
        {
          "@type": "Product",
          name: "Large variant",
          offers: { price: "20.00", priceCurrency: "GBP" },
          size: "large",
        },
      ])
    );

    expect(extract(html, { url: "https://shop.example.com/widget?size=large" })).toMatchObject({
      confidence: "high",
      evidence: {
        candidateCount: 2,
        matchedParams: ["size"],
        type: "jsonld:variant-params",
      },
      price: "20.00",
      title: "Large variant",
    });
  });

  it("does not treat a fragment-only JSON-LD URL as the current page URL", () => {
    const html = page(
      ldScript([
        {
          "@type": "Product",
          name: "Small variant",
          offers: { price: "10.00", priceCurrency: "GBP", url: "#reviews" },
          size: "small",
        },
        {
          "@type": "Product",
          name: "Large variant",
          offers: { price: "20.00", priceCurrency: "GBP" },
          size: "large",
        },
      ])
    );

    expect(extract(html, { url: "https://shop.example.com/widget?size=large" })).toMatchObject({
      confidence: "high",
      evidence: {
        candidateCount: 2,
        matchedParams: ["size"],
        type: "jsonld:variant-params",
      },
      price: "20.00",
      title: "Large variant",
    });
  });

  it("treats conflicting color aliases as one ambiguous semantic property", () => {
    const html = page(
      ldScript([
        {
          "@type": "Product",
          color: ["Blue", "Navy"],
          name: "Array variant",
          offers: { price: "10.00", priceCurrency: "GBP" },
        },
        {
          "@type": "Product",
          color: "Red",
          name: "Red variant",
          offers: { price: "20.00", priceCurrency: "GBP" },
        },
      ])
    );

    expect(
      extract(html, { url: "https://shop.example.com/widget?color=blue&colour=navy" })
    ).toMatchObject({
      confidence: "low",
      evidence: { candidateCount: 2, type: "jsonld:multiple-candidates" },
      price: "10.00",
      title: "Array variant",
    });
  });

  it("collapses equivalent color aliases before semantic matching", () => {
    const html = page(
      ldScript([
        {
          "@type": "Product",
          color: "Red",
          name: "Red variant",
          offers: { price: "10.00", priceCurrency: "GBP" },
        },
        {
          "@type": "Product",
          color: ["Blue", { name: " blue " }],
          name: "Blue variant",
          offers: { price: "20.00", priceCurrency: "GBP" },
        },
      ])
    );

    expect(
      extract(html, { url: "https://shop.example.com/widget?color=BLUE&colour=%20blue%20" })
    ).toMatchObject({
      confidence: "high",
      evidence: {
        candidateCount: 2,
        matchedParams: ["color"],
        type: "jsonld:variant-params",
      },
      price: "20.00",
      title: "Blue variant",
    });
  });

  it("matches the approved generic query-property mappings with canonical evidence", () => {
    const mappingCases = [
      { parameter: "size", property: "size", query: "185 × 275", value: "185x275" },
      { parameter: "color", property: "color", query: "navy", value: "Navy" },
      { parameter: "colour", property: "color", query: "navy", value: "Navy" },
      { parameter: "material", property: "material", query: "wool", value: "Wool" },
      { parameter: "pattern", property: "pattern", query: "striped", value: "Striped" },
      { parameter: "sku", property: "sku", query: "sku-target", value: "sku-target" },
      { parameter: "mpn", property: "mpn", query: "mpn-target", value: "mpn-target" },
      { parameter: "model", property: "model", query: "model-target", value: "model-target" },
    ] as const;

    for (const mapping of mappingCases) {
      const html = page(
        ldScript([
          {
            "@type": "Product",
            name: "Other variant",
            offers: { price: "10.00", priceCurrency: "GBP" },
            [mapping.property]: `other-${mapping.value}`,
          },
          {
            "@type": "Product",
            name: "Mapped variant",
            offers: { price: "20.00", priceCurrency: "GBP" },
            [mapping.property]: mapping.value,
          },
        ])
      );

      expect(
        extract(html, {
          url: `https://shop.example.com/widget?${mapping.parameter}=${encodeURIComponent(mapping.query)}`,
        })
      ).toMatchObject({
        confidence: "high",
        evidence: {
          candidateCount: 2,
          matchedParams: [mapping.property],
          type: "jsonld:variant-params",
        },
        price: "20.00",
        title: "Mapped variant",
      });
    }
  });

  it("reads single-valued arrays and explicit value/name objects", () => {
    const html = page(
      ldScript({
        "@type": "Product",
        color: [{ name: "Blue" }, { value: " blue " }],
        material: { value: "Wool" },
        name: "Structured variant",
        offers: { price: "20.00", priceCurrency: "GBP" },
      })
    );

    expect(
      extract(html, { url: "https://shop.example.com/widget?color=blue&material=wool" })
    ).toMatchObject({
      confidence: "high",
      evidence: {
        candidateCount: 1,
        matchedParams: ["color", "material"],
        type: "jsonld:variant-params",
      },
      price: "20.00",
      title: "Structured variant",
    });
  });

  it("treats name and value on one structured property as aliases", () => {
    const html = page(
      ldScript([
        {
          "@type": "Product",
          name: "Small rug",
          offers: { price: "10.00", priceCurrency: "GBP" },
          size: { "@type": "SizeSpecification", name: "Small", value: "S" },
        },
        {
          "@type": "Product",
          name: "Large rug",
          offers: { price: "20.00", priceCurrency: "GBP" },
          size: { "@type": "SizeSpecification", name: "Large", value: "L" },
        },
      ])
    );

    expect(extract(html, { url: "https://shop.example.com/rug?size=L" })).toMatchObject({
      confidence: "high",
      evidence: {
        candidateCount: 2,
        matchedParams: ["size"],
        type: "jsonld:variant-params",
      },
      price: "20.00",
      title: "Large rug",
    });
  });

  it("treats split name and value objects as aliases for one variant", () => {
    const html = page(
      ldScript([
        {
          "@type": "Product",
          name: "Small rug",
          offers: { price: "10.00", priceCurrency: "GBP" },
          size: [{ name: "Small" }, { value: "S" }],
        },
        {
          "@type": "Product",
          name: "Large rug",
          offers: { price: "20.00", priceCurrency: "GBP" },
          size: [{ name: "Large" }, { value: "L" }],
        },
      ])
    );

    expect(extract(html, { url: "https://shop.example.com/rug?size=L" })).toMatchObject({
      confidence: "high",
      evidence: {
        candidateCount: 2,
        matchedParams: ["size"],
        type: "jsonld:variant-params",
      },
      price: "20.00",
      title: "Large rug",
    });
  });

  it("does not treat a multi-valued property as selected variant evidence", () => {
    const html = page(
      ldScript({
        "@type": "Product",
        name: "Generic rug offer",
        offers: { price: "89.25", priceCurrency: "GBP" },
        size: ["60x90", "185x275"],
      })
    );

    expect(extract(html, { url: "https://shop.example.com/rug?size=185x275" })).toMatchObject({
      confidence: "low",
      evidence: { candidateCount: 1, type: "jsonld:queried-url" },
      price: "89.25",
      title: "Generic rug offer",
    });
  });

  it("does not treat a nested multi-valued property as selected variant evidence", () => {
    const html = page(
      ldScript({
        "@type": "Product",
        name: "Generic rug offer",
        offers: { price: "89.25", priceCurrency: "GBP" },
        size: {
          "@type": "SizeSpecification",
          name: ["60x90", "185x275"],
        },
      })
    );

    expect(extract(html, { url: "https://shop.example.com/rug?size=185x275" })).toMatchObject({
      confidence: "low",
      evidence: { candidateCount: 1, type: "jsonld:queried-url" },
      price: "89.25",
      title: "Generic rug offer",
    });
  });

  it("does not stringify arbitrary variant objects", () => {
    const html = page(
      ldScript([
        {
          "@type": "Product",
          color: { label: "Blue" },
          name: "Unstructured variant",
          offers: { price: "10.00", priceCurrency: "GBP" },
        },
        {
          "@type": "Product",
          color: "Blue",
          name: "Structured variant",
          offers: { price: "20.00", priceCurrency: "GBP" },
        },
      ])
    );

    expect(extract(html, { url: "https://shop.example.com/widget?color=blue" })).toMatchObject({
      confidence: "low",
      evidence: {
        candidateCount: 2,
        matchedParams: ["color"],
        type: "jsonld:variant-params",
      },
      price: "20.00",
      title: "Structured variant",
    });
  });

  it("uses ProductGroup variesBy context through @id references in @graph", () => {
    const html = page(
      ldScript({
        "@context": "https://schema.org",
        "@graph": [
          {
            "@id": "#group",
            "@type": "ProductGroup",
            hasVariant: [{ "@id": "#small" }, { "@id": "#large" }],
            variesBy: ["https://schema.org/size"],
          },
          {
            "@id": "#small",
            "@type": "Product",
            name: "Small rug",
            offers: { price: "10.00", priceCurrency: "GBP" },
            size: "small",
          },
          {
            "@id": "#large",
            "@type": "Product",
            name: "Large rug",
            offers: { price: "20.00", priceCurrency: "GBP" },
            size: "large",
          },
        ],
      })
    );

    expect(
      extract(html, { url: "https://shop.example.com/rug?size=large&system=rug-cvr" })
    ).toMatchObject({
      confidence: "high",
      evidence: {
        candidateCount: 2,
        matchedParams: ["size"],
        type: "jsonld:variant-params",
      },
      price: "20.00",
      title: "Large rug",
    });
  });

  it("collapses semantically equivalent repeated query values", () => {
    const html = page(
      ldScript({
        "@type": "Product",
        name: "Large rug",
        offers: { price: "20.00", priceCurrency: "GBP" },
        size: "185x275",
      })
    );

    expect(
      extract(html, {
        url: "https://shop.example.com/rug?size=185%20%C3%97%20275&size=185x275",
      })
    ).toMatchObject({
      confidence: "high",
      evidence: {
        candidateCount: 1,
        matchedParams: ["size"],
        type: "jsonld:variant-params",
      },
      price: "20.00",
    });
  });

  it("keeps a partial multi-dimension ProductGroup match low confidence", () => {
    const html = page(
      ldScript({
        "@type": "ProductGroup",
        hasVariant: [
          {
            "@type": "Product",
            color: "red",
            name: "Large red",
            offers: { price: "20.00", priceCurrency: "GBP" },
            size: "large",
          },
          {
            "@type": "Product",
            color: "blue",
            name: "Small blue",
            offers: { price: "10.00", priceCurrency: "GBP" },
            size: "small",
          },
        ],
        variesBy: ["size", "color"],
      })
    );

    expect(extract(html, { url: "https://shop.example.com/rug?size=large" })).toMatchObject({
      confidence: "low",
      evidence: {
        candidateCount: 2,
        matchedParams: ["size"],
        type: "jsonld:variant-params",
      },
      price: "20.00",
      title: "Large red",
    });
  });

  it("keeps semantic confidence low when a same-group contender omits the property", () => {
    const html = page(
      ldScript({
        "@type": "ProductGroup",
        hasVariant: [
          {
            "@type": "Product",
            name: "Large rug",
            offers: { price: "20.00", priceCurrency: "GBP" },
            size: "large",
          },
          {
            "@type": "Product",
            name: "Unspecified rug",
            offers: { price: "10.00", priceCurrency: "GBP" },
          },
        ],
        variesBy: ["size"],
      })
    );

    expect(extract(html, { url: "https://shop.example.com/rug?size=large" })).toMatchObject({
      confidence: "low",
      evidence: {
        candidateCount: 2,
        matchedParams: ["size"],
        type: "jsonld:variant-params",
      },
      price: "20.00",
      title: "Large rug",
    });
  });

  it("keeps an unknown parameter neutral but low confidence without variesBy context", () => {
    const html = page(
      ldScript([
        {
          "@type": "Product",
          name: "Small blue widget",
          offers: { price: "10.00", priceCurrency: "GBP" },
          size: "small",
        },
        {
          "@type": "Product",
          name: "Large blue widget",
          offers: { price: "20.00", priceCurrency: "GBP" },
          size: "large",
        },
      ])
    );

    expect(
      extract(html, { url: "https://shop.example.com/widget?size=large&system=rug-cvr" })
    ).toMatchObject({
      confidence: "low",
      evidence: {
        candidateCount: 2,
        matchedParams: ["size"],
        type: "jsonld:variant-params",
      },
      price: "20.00",
      title: "Large blue widget",
    });
  });

  it("keeps a conflicting repeated unknown parameter as a confidence limiter", () => {
    const html = page(
      ldScript([
        {
          "@type": "Product",
          name: "Small widget",
          offers: { price: "10.00", priceCurrency: "GBP" },
          size: "S",
        },
        {
          "@type": "Product",
          name: "Large widget",
          offers: { price: "20.00", priceCurrency: "GBP" },
          size: "L",
        },
      ])
    );

    expect(
      extract(html, {
        url: "https://shop.example.com/widget?size=L&variant=1&variant=2",
      })
    ).toMatchObject({
      confidence: "low",
      evidence: {
        candidateCount: 2,
        matchedParams: ["size"],
        type: "jsonld:variant-params",
      },
      price: "20.00",
      title: "Large widget",
    });
  });

  it("leaves conflicting repeated semantic values ambiguous", () => {
    const html = page(
      ldScript([
        {
          "@type": "Product",
          name: "Small widget",
          offers: { price: "10.00", priceCurrency: "GBP" },
          size: "small",
        },
        {
          "@type": "Product",
          name: "Large widget",
          offers: { price: "20.00", priceCurrency: "GBP" },
          size: "large",
        },
      ])
    );

    expect(
      extract(html, { url: "https://shop.example.com/widget?size=small&size=large" })
    ).toMatchObject({
      confidence: "low",
      evidence: { candidateCount: 2, type: "jsonld:multiple-candidates" },
      price: "10.00",
      title: "Small widget",
    });
  });

  it("reports a semantic conflict with a stronger selected SKU", () => {
    const html = page(
      ldScript([
        {
          "@type": "Product",
          name: "Red widget",
          offers: { price: "10.00", priceCurrency: "GBP", sku: "red" },
          size: "small",
        },
        {
          "@type": "Product",
          name: "Blue widget",
          offers: { price: "20.00", priceCurrency: "GBP", sku: "blue" },
          size: "large",
        },
      ]),
      '<button data-sku="blue" data-sku-selected="true">Blue</button>'
    );

    expect(extract(html, { url: "https://shop.example.com/widget?size=small" })).toMatchObject({
      confidence: "low",
      evidence: { candidateCount: 2, type: "jsonld:conflict" },
      price: "20.00",
      title: "Blue widget",
    });
  });

  it("does not let a sibling parameter match demote an exact URL winner", () => {
    const html = page(
      ldScript([
        {
          "@type": "Product",
          name: "Exact URL variant",
          offers: {
            price: "10.00",
            priceCurrency: "GBP",
            url: "https://shop.example.com/widget?color=red",
          },
        },
        {
          "@type": "Product",
          color: "Red",
          name: "Semantic sibling",
          offers: {
            price: "20.00",
            priceCurrency: "GBP",
            url: "https://shop.example.com/widget?color=red&x=1",
          },
        },
      ])
    );

    expect(extract(html, { url: "https://shop.example.com/widget?color=red" })).toMatchObject({
      confidence: "high",
      evidence: { candidateCount: 2, type: "jsonld:exact-url" },
      price: "10.00",
      title: "Exact URL variant",
    });
  });

  it("prefers a semantic variant over an exact URL that contradicts the query", () => {
    const requestedUrl = "https://shop.example.com/rug?size=185x275&system=rug-cvr";
    const html = page(
      ldScript({
        "@type": "ProductGroup",
        hasVariant: [
          {
            "@type": "Product",
            name: "Default rug",
            offers: { price: "89.25", priceCurrency: "GBP", url: requestedUrl },
            size: "60x90",
          },
          {
            "@type": "Product",
            name: "Requested rug",
            offers: { price: "449.25", priceCurrency: "GBP" },
            size: "185x275",
          },
        ],
        variesBy: ["size"],
      })
    );

    expect(extract(html, { url: requestedUrl })).toMatchObject({
      confidence: "high",
      evidence: {
        candidateCount: 2,
        matchedParams: ["size"],
        type: "jsonld:variant-params",
      },
      price: "449.25",
      title: "Requested rug",
    });
  });

  it("keeps an exact product winner when its display name differs from the query slug", () => {
    const requestedUrl = "https://shop.example.com/tee?color=navy-blue";
    const html = page(
      ldScript([
        {
          "@type": "Product",
          color: "Navy Blue",
          name: "The Tee",
          offers: { price: "45.00", priceCurrency: "GBP", url: requestedUrl },
        },
        {
          "@type": "Product",
          color: "navy-blue",
          name: "Matching Socks",
          offers: {
            price: "6.00",
            priceCurrency: "GBP",
            url: "https://shop.example.com/socks",
          },
        },
      ])
    );

    expect(extract(html, { url: requestedUrl })).toMatchObject({
      confidence: "high",
      evidence: { candidateCount: 2, type: "jsonld:exact-url" },
      price: "45.00",
      title: "The Tee",
    });
  });

  it("keeps an exact singleton high confidence when its display name differs from a code", () => {
    const requestedUrl = "https://shop.example.com/tee?color=blk";
    const html = page(
      ldScript({
        "@type": "Product",
        color: "Black",
        name: "The Tee",
        offers: { price: "45.00", priceCurrency: "GBP", url: requestedUrl },
      })
    );

    expect(extract(html, { url: requestedUrl })).toMatchObject({
      confidence: "high",
      evidence: { candidateCount: 1, type: "jsonld:exact-url" },
      price: "45.00",
      title: "The Tee",
    });
  });

  it("uses a matching Offer URL path before earlier Products", () => {
    const html = page(
      ldScript([
        {
          "@type": "Product",
          name: "Red widget",
          offers: {
            price: "99.00",
            priceCurrency: "GBP",
            url: "https://shop.example.com/widget/red",
          },
        },
        {
          "@type": "Product",
          name: "Blue widget",
          offers: {
            price: "499.00",
            priceCurrency: "GBP",
            url: "https://shop.example.com/widget/blue?variant=blue#details",
          },
        },
      ])
    );

    expect(extract(html, { url: "https://shop.example.com/widget/blue?source=ad" })).toMatchObject({
      confidence: "low",
      evidence: { candidateCount: 2, type: "jsonld:pathname" },
      price: "499.00",
      title: "Blue widget",
    });
  });

  it("uses a matching Product URL path when its Offer has no URL", () => {
    const html = page(
      ldScript([
        {
          "@type": "Product",
          name: "Earlier widget",
          offers: { price: "99.00", priceCurrency: "GBP" },
          url: "https://shop.example.com/widget/earlier",
        },
        {
          "@type": "Product",
          name: "Current widget",
          offers: { price: "499.00", priceCurrency: "GBP" },
          url: "https://shop.example.com/widget/current?colour=blue",
        },
      ])
    );

    expect(extract(html, { url: "https://shop.example.com/widget/current#reviews" })).toMatchObject(
      {
        confidence: "low",
        evidence: { candidateCount: 2, type: "jsonld:pathname" },
        price: "499.00",
        title: "Current widget",
      }
    );
  });

  it("ignores conflicting selected-SKU hints and keeps legacy document order", () => {
    const html = page(
      ldScript([
        {
          "@type": "Product",
          name: "First variant",
          offers: { price: "99.00", priceCurrency: "GBP", sku: "red" },
        },
        {
          "@type": "Product",
          name: "Second variant",
          offers: { price: "499.00", priceCurrency: "GBP", sku: "blue" },
        },
      ]),
      '<button data-sku="red" data-sku-selected="true"></button><button data-sku="blue" data-sku-selected="true"></button>'
    );

    expect(extract(html)).toMatchObject({
      confidence: "low",
      evidence: { candidateCount: 2, type: "jsonld:conflict" },
      price: "99.00",
      title: "First variant",
    });
  });

  it("resolves relative JSON-LD URLs against the final page URL", () => {
    const html = page(
      ldScript([
        {
          "@type": "Product",
          name: "First variant",
          offers: { price: "99.00", priceCurrency: "GBP", url: "/widget/current" },
        },
        {
          "@type": "Product",
          name: "Second variant",
          offers: { price: "499.00", priceCurrency: "GBP", url: "not a valid URL" },
        },
      ])
    );

    expect(extract(html, { url: "https://shop.example.com/widget/current" })).toMatchObject({
      confidence: "high",
      evidence: { candidateCount: 2, type: "jsonld:exact-url" },
      price: "99.00",
      title: "First variant",
    });
  });

  it("keeps a singleton high confidence when a relative URL only matches its pathname", () => {
    const html = page(
      ldScript({
        "@type": "Product",
        name: "Singleton widget",
        offers: {
          price: "10.00",
          priceCurrency: "GBP",
          url: "/widget?ref=home",
        },
      })
    );

    expect(extract(html, { url: "https://shop.example.com/widget" })).toMatchObject({
      confidence: "high",
      evidence: { candidateCount: 1, type: "jsonld:singleton" },
      price: "10.00",
      title: "Singleton widget",
    });
  });

  it("keeps product-first, document-order behaviour when no selection hint exists", () => {
    const html = page(
      ldScript([
        { "@type": "ItemList", offers: { price: "1.00", priceCurrency: "GBP" } },
        {
          "@type": "Product",
          name: "First product",
          offers: { price: "99.00", priceCurrency: "GBP" },
        },
        {
          "@type": "Product",
          name: "Later product",
          offers: { price: "499.00", priceCurrency: "GBP" },
        },
      ])
    );

    expect(extract(html)).toMatchObject({
      confidence: "low",
      evidence: { candidateCount: 3, type: "jsonld:multiple-candidates" },
      price: "99.00",
      title: "First product",
    });
  });

  it("marks one concrete Product Offer on an unqueried final URL high confidence", () => {
    const html = page(
      ldScript({
        "@type": "Product",
        name: "Only product",
        offers: { price: "25.00", priceCurrency: "GBP" },
      })
    );

    expect(extract(html, { url: "https://shop.example.com/only-product" })).toMatchObject({
      confidence: "high",
      evidence: { candidateCount: 1, type: "jsonld:singleton" },
      price: "25.00",
    });
  });

  it("marks a singleton with an unresolved final URL query low confidence", () => {
    const html = page(
      ldScript({
        "@type": "Product",
        name: "Queried product",
        offers: { price: "25.00", priceCurrency: "GBP" },
      })
    );

    expect(
      extract(html, { url: "https://shop.example.com/product?variant=unknown" })
    ).toMatchObject({
      confidence: "low",
      evidence: { candidateCount: 1, type: "jsonld:queried-url" },
      price: "25.00",
    });
  });

  it("keeps a singleton confident when the query is only campaign tracking", () => {
    const html = page(
      ldScript({
        "@type": "Product",
        name: "Shared product",
        offers: { price: "25.00", priceCurrency: "GBP" },
      })
    );

    expect(
      extract(html, {
        url: "https://shop.example.com/product?utm_source=email&utm_medium=cpc&gclid=abc123",
      })
    ).toMatchObject({
      confidence: "high",
      evidence: { candidateCount: 1, type: "jsonld:singleton" },
      price: "25.00",
    });
  });

  it("matches a variant URL exactly despite pasted tracking parameters", () => {
    const html = page(
      ldScript([
        {
          "@type": "Product",
          name: "Blue",
          offers: {
            price: "499.00",
            priceCurrency: "GBP",
            url: "https://shop.example.com/widget?variant=blue",
          },
        },
        {
          "@type": "Product",
          name: "Red",
          offers: {
            price: "99.00",
            priceCurrency: "GBP",
            url: "https://shop.example.com/widget?variant=red",
          },
        },
      ])
    );

    expect(
      extract(html, { url: "https://shop.example.com/widget?variant=red&utm_campaign=spring" })
    ).toMatchObject({
      confidence: "high",
      evidence: { candidateCount: 2, type: "jsonld:exact-url" },
      price: "99.00",
      title: "Red",
    });
  });

  it("ignores selection markup that does not use the data-sku pair", () => {
    const html = page(
      ldScript([
        {
          "@type": "Product",
          name: "First variant",
          offers: { price: "99.00", priceCurrency: "GBP", sku: "red" },
        },
        {
          "@type": "Product",
          name: "Second variant",
          offers: { price: "499.00", priceCurrency: "GBP", sku: "blue" },
        },
      ]),
      `<button aria-checked="true" data-sku="blue">Blue</button>
       <button data-sku-selected="true">Blue</button>
       <button class="selected" data-sku="blue">Blue</button>`
    );

    expect(extract(html)).toMatchObject({
      confidence: "low",
      evidence: { candidateCount: 2, type: "jsonld:multiple-candidates" },
      price: "99.00",
      title: "First variant",
    });
  });

  it("marks selected SKU and exact URL disagreement low confidence", () => {
    const html = page(
      ldScript([
        {
          "@type": "Product",
          name: "Blue",
          offers: {
            price: "499.00",
            priceCurrency: "GBP",
            sku: "blue",
            url: "https://shop.example.com/widget?variant=blue",
          },
        },
        {
          "@type": "Product",
          name: "Red",
          offers: {
            price: "99.00",
            priceCurrency: "GBP",
            sku: "red",
            url: "https://shop.example.com/widget?variant=red",
          },
        },
      ]),
      '<button data-sku="blue" data-sku-selected="true">Blue</button>'
    );

    expect(extract(html, { url: "https://shop.example.com/widget?variant=red" })).toMatchObject({
      confidence: "low",
      evidence: { candidateCount: 2, type: "jsonld:conflict" },
      price: "499.00",
      title: "Blue",
    });
  });

  it("marks an Offer owned by a non-Product node low confidence", () => {
    const html = page(
      ldScript({
        "@type": "ItemList",
        name: "Related listing",
        offers: { price: "1.00", priceCurrency: "GBP" },
      })
    );

    expect(extract(html, { url: "https://shop.example.com/list" })).toMatchObject({
      confidence: "low",
      evidence: { candidateCount: 1, type: "jsonld:non-product" },
      price: "1.00",
    });
  });

  it("keeps a standalone AggregateOffer nested-offer fallback", () => {
    const html = page(
      ldScript({
        "@type": "AggregateOffer",
        name: "Standalone range",
        offers: { "@type": "Offer", price: "12.00", priceCurrency: "GBP" },
      })
    );

    expect(extract(html, { url: "https://shop.example.com/list" })).toMatchObject({
      confidence: "low",
      evidence: { candidateCount: 1, type: "jsonld:non-product" },
      price: "12.00",
      title: "Standalone range",
    });
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
      confidence: "high",
      currency: "USD",
      evidence: { candidateCount: 1, type: "microdata:single-product-price" },
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
    expect(extract(html)).toMatchObject({
      confidence: "low",
      evidence: { candidateCount: 1, type: "microdata:document-price" },
      price: "3.20",
      strategy: "microdata",
    });
  });

  it("marks multiple priced top-level Products ambiguous", () => {
    const html = page(
      "",
      `<div itemscope itemtype="https://schema.org/Product">
         <meta itemprop="price" content="10.00" />
       </div>
       <div itemscope itemtype="https://schema.org/Product">
         <meta itemprop="price" content="20.00" />
       </div>`
    );

    expect(extract(html, { url: "https://shop.example.com/products" })).toMatchObject({
      confidence: "low",
      evidence: { candidateCount: 2, type: "microdata:ambiguous" },
      price: "10.00",
    });
  });

  it("marks multiple prices inside one top-level Product ambiguous", () => {
    const html = page(
      "",
      `<div itemscope itemtype="https://schema.org/Product">
         <meta itemprop="price" content="10.00" />
         <meta itemprop="price" content="20.00" />
       </div>`
    );

    expect(extract(html, { url: "https://shop.example.com/product" })).toMatchObject({
      confidence: "low",
      evidence: { candidateCount: 2, type: "microdata:ambiguous" },
      price: "10.00",
    });
  });

  it("marks a singleton microdata Product on a queried URL low confidence", () => {
    const html = page(
      "",
      `<div itemscope itemtype="https://schema.org/Product">
         <meta itemprop="price" content="10.00" />
       </div>`
    );

    expect(
      extract(html, { url: "https://shop.example.com/product?variant=unknown" })
    ).toMatchObject({
      confidence: "low",
      evidence: { candidateCount: 1, type: "microdata:queried-url" },
      price: "10.00",
    });
  });

  it("keeps a single microdata Product confident under campaign tracking", () => {
    const html = page(
      "",
      `<div itemscope itemtype="https://schema.org/Product">
         <meta itemprop="price" content="10.00" />
       </div>`
    );

    expect(
      extract(html, { url: "https://shop.example.com/product?utm_source=newsletter" })
    ).toMatchObject({
      confidence: "high",
      evidence: { candidateCount: 1, type: "microdata:single-product-price" },
      price: "10.00",
    });
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
      confidence: "low",
      currency: "SEK",
      evidence: { type: "opengraph:page-metadata" },
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
    expect(extract(html, { expression: ".price" })).toMatchObject({
      confidence: "high",
      currency: "GBP",
      evidence: { matchCount: 1, type: "selector:configured" },
      ok: true,
      price: "1299.00",
      strategy: "selector",
      title: "Selector Widget",
    });
  });

  it("reads a currency-bearing attribute with a terminal ::attr(name) suffix", () => {
    const attributeHtml = page("", '<div data-price="GBP 42.50">ignore this text</div>');

    expect(
      extract(attributeHtml, {
        expression: "  [data-price]::attr(data-price)  ",
        strategies: ["selector"],
      })
    ).toMatchObject({ currency: "GBP", ok: true, price: "42.50", strategy: "selector" });
  });

  it("preserves content, value, and text fallbacks for ordinary selectors", () => {
    const fallbackHtml = page(
      "",
      '<meta class="from-content" content="GBP 10.00" />\n       <input class="from-value" value="GBP 20.00" />\n       <span class="from-text">GBP 30.00</span>'
    );

    expect(
      extract(fallbackHtml, { expression: "  .from-content  ", strategies: ["selector"] })
    ).toMatchObject({ currency: "GBP", ok: true, price: "10.00" });
    expect(
      extract(fallbackHtml, { expression: ".from-value", strategies: ["selector"] })
    ).toMatchObject({ currency: "GBP", ok: true, price: "20.00" });
    expect(
      extract(fallbackHtml, { expression: ".from-text", strategies: ["selector"] })
    ).toMatchObject({
      currency: "GBP",
      ok: true,
      price: "30.00",
    });
  });

  it("is skipped when no expression is configured", () => {
    const result = extract(html);
    expect(result.ok).toBe(false);
  });

  it("returns a failure when the selector matches nothing", () => {
    expect(extract(html, { expression: ".nope" })).toEqual({
      error: "no price found (tried: jsonld, microdata, opengraph, selector)",
      ok: false,
    });
  });

  it("does not throw on an invalid selector", () => {
    expect(extract(html, { expression: "!!!" }).ok).toBe(false);
  });

  it("applies the locale hint to the matched text", () => {
    const german = page("", '<span class="price">1.234 €</span>');
    expect(extract(german, { expression: ".price", locale: "en-GB" })).toMatchObject({
      price: "1.234",
    });
    expect(extract(german, { expression: ".price", locale: "de-DE" })).toMatchObject({
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
    expect(extract(html, { expression: ".price" })).toMatchObject({
      price: "10.00",
      strategy: "jsonld",
    });
  });

  it("falls through in order when earlier strategies are excluded", () => {
    expect(
      extract(html, { expression: ".price", strategies: ["microdata", "opengraph"] })
    ).toMatchObject({ price: "30.00", strategy: "microdata" });
    expect(
      extract(html, { expression: ".price", strategies: ["opengraph", "selector"] })
    ).toMatchObject({ price: "20.00", strategy: "opengraph" });
    expect(extract(html, { expression: ".price", strategies: ["selector"] })).toMatchObject({
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
