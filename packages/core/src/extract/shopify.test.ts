import { describe, expect, it } from "vitest";

import { extract } from "./index";

const URL = "https://shop.example.com/products/widget";
const OG =
  '<meta property="og:title" content="Widget"><meta property="product:price:amount" content="3.40"><meta property="product:price:currency" content="GBP">';

function shopifyPage(embedded: unknown): string {
  return `<html><head>${OG}</head><body><script>var _BIS = _BIS || {};
_BIS.product = ${JSON.stringify(embedded)};</script></body></html>`;
}

const product = {
  available: true,
  handle: "widget",
  variants: [
    { available: false, id: 1 },
    { available: true, id: 2 },
  ],
};

describe("extract — Shopify stock backfill", () => {
  it("fills stock the winning strategy left out", () => {
    const result = extract(shopifyPage({ ...product, available: false }), { url: URL });
    expect(result).toMatchObject({
      availability: "OutOfStock",
      inStock: false,
      price: "3.40",
      strategy: "opengraph",
    });
  });

  it("reads the variant the URL selects", () => {
    expect(extract(shopifyPage(product), { url: `${URL}?variant=1` })).toMatchObject({
      inStock: false,
    });
    expect(extract(shopifyPage(product), { url: `${URL}?variant=2` })).toMatchObject({
      inStock: true,
    });
  });

  it("says nothing when the selected variant is missing", () => {
    const result = extract(shopifyPage(product), { url: `${URL}?variant=3` });
    expect(result).not.toHaveProperty("inStock");
  });

  it("falls back to the variants when the product has no flag", () => {
    const { available: _, ...withoutFlag } = product;
    expect(extract(shopifyPage(withoutFlag), { url: URL })).toMatchObject({ inStock: true });
  });

  it("finds the product behind a pile of theme config blobs", () => {
    const blobs = Array.from({ length: 15 }, (_, i) => `theme.s${i} = {"i":${i}};`).join("\n");
    const html = shopifyPage({ ...product, available: false }).replace(
      "<body>",
      `<body><script>${blobs}</script>`
    );
    expect(extract(html, { url: URL })).toMatchObject({ inStock: false });
  });

  it("ignores a product whose handle is not the tracked one", () => {
    const result = extract(shopifyPage({ ...product, handle: "other" }), { url: URL });
    expect(result).not.toHaveProperty("inStock");
  });

  it("ignores pages outside /products/", () => {
    const result = extract(shopifyPage(product), { url: "https://shop.example.com/widget" });
    expect(result).not.toHaveProperty("inStock");
  });

  it("ignores copies that disagree", () => {
    const html = shopifyPage(product).replace(
      "</body>",
      `<script type="application/json">${JSON.stringify({ ...product, available: false })}</script></body>`
    );
    expect(extract(html, { url: URL })).not.toHaveProperty("inStock");
  });

  it("never overrides stock the winning strategy reported", () => {
    const html = shopifyPage({ ...product, available: false }).replace(
      "</head>",
      '<meta property="product:availability" content="instock"></head>'
    );
    expect(extract(html, { url: URL })).toMatchObject({ availability: "instock", inStock: true });
  });
});
