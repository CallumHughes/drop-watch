/**
 * HTML for the fake retailer pages the fixture server serves.
 *
 * Five variants cover the automatic preview's transport decisions: `jsonld`
 * is confident in the HTTP response, `js` only gains JSON-LD after rendering,
 * and `rendered-selected-sku` starts ambiguous before the rendered DOM marks
 * one variant as selected. `browser-no-match` starts with the same usable
 * ambiguity but removes it when rendered, while `selector` exercises the
 * hand-picked fallback.
 */

export interface FixtureProductState {
  /** schema.org availability, e.g. "InStock" or "OutOfStock". */
  availability: "InStock" | "OutOfStock";
  currency: string;
  /** Decimal string, e.g. "100.00" — prices are never floats on this wire. */
  price: string;
  template: "browser-no-match" | "js" | "jsonld" | "rendered-selected-sku" | "selector";
  title: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  EUR: "€",
  GBP: "£",
  USD: "$",
};

function displayPrice(state: FixtureProductState): string {
  const symbol = CURRENCY_SYMBOLS[state.currency] ?? `${state.currency} `;
  return `${symbol}${state.price}`;
}

function productJsonLd(state: FixtureProductState, url: string) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: state.title,
    offers: {
      "@type": "Offer",
      availability: `https://schema.org/${state.availability}`,
      price: state.price,
      priceCurrency: state.currency,
      url,
    },
  };
}

function jsonLdPage(state: FixtureProductState, url: string): string {
  const data = productJsonLd(state, url);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(state.title)}</title>
  <script type="application/ld+json">${JSON.stringify(data)}</script>
</head>
<body>
  <main>
    <h1>${escapeHtml(state.title)}</h1>
    <p>${displayPrice(state)}</p>
  </main>
</body>
</html>
`;
}

const ALTERNATE_VARIANT_PRICE = "75.00";
const ALTERNATE_VARIANT_SKU = "blue";
const DEFAULT_VARIANT_SKU = "red";

function variantJsonLd(state: FixtureProductState, price: string, sku: string) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: `${state.title} ${sku}`,
    offers: {
      "@type": "Offer",
      availability: `https://schema.org/${state.availability}`,
      price,
      priceCurrency: state.currency,
      sku,
    },
    sku,
  };
}

/**
 * Raw HTML deliberately contains two usable prices with no URL evidence, so
 * HTTP extraction is ambiguous. Rendering either selects the blue SKU or
 * removes both candidates, exercising browser confirmation and HTTP salvage.
 */
function ambiguousVariantPage(
  state: FixtureProductState,
  renderedBehavior: "remove" | "select"
): string {
  const data = [
    variantJsonLd(state, state.price, DEFAULT_VARIANT_SKU),
    variantJsonLd(state, ALTERNATE_VARIANT_PRICE, ALTERNATE_VARIANT_SKU),
  ];
  const browserMutation =
    renderedBehavior === "select"
      ? `const selected = document.createElement("span");
    selected.dataset.sku = "${ALTERNATE_VARIANT_SKU}";
    selected.dataset.skuSelected = "true";
    document.body.append(selected);`
      : `for (const candidate of document.querySelectorAll('script[type="application/ld+json"]')) {
      candidate.remove();
    }`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(state.title)}</title>
  <script type="application/ld+json">${JSON.stringify(data)}</script>
</head>
<body>
  <main>
    <h1>${escapeHtml(state.title)}</h1>
  </main>
  <script>
    ${browserMutation}
  </script>
</body>
</html>
`;
}

/**
 * The source response contains no price text or JSON-LD script. The encoded
 * payload is only decoded after the short timer, so a plain HTTP preview has
 * nothing automatic to extract while a browser preview must wait for the DOM
 * to settle before it can succeed.
 */
function javascriptPage(state: FixtureProductState, url: string): string {
  const payload = Buffer.from(JSON.stringify(productJsonLd(state, url))).toString("base64");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(state.title)}</title>
</head>
<body>
  <main>
    <h1>${escapeHtml(state.title)}</h1>
  </main>
  <script>
    window.setTimeout(() => {
      const data = JSON.parse(atob("${payload}"));
      const structuredData = document.createElement("script");
      structuredData.type = "application/ld+json";
      structuredData.textContent = JSON.stringify(data);
      document.head.append(structuredData);
    }, 125);
  </script>
</body>
</html>
`;
}

function selectorPage(state: FixtureProductState): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(state.title)}</title>
</head>
<body>
  <main>
    <h1>${escapeHtml(state.title)}</h1>
    <div class="stock">${state.availability === "InStock" ? "In stock" : "Out of stock"}</div>
    <p class="price">${displayPrice(state)}</p>
  </main>
</body>
</html>
`;
}

export function renderProductPage(state: FixtureProductState, url: string): string {
  if (state.template === "jsonld") {
    return jsonLdPage(state, url);
  }
  if (state.template === "browser-no-match") {
    return ambiguousVariantPage(state, "remove");
  }
  if (state.template === "rendered-selected-sku") {
    return ambiguousVariantPage(state, "select");
  }
  return state.template === "js" ? javascriptPage(state, url) : selectorPage(state);
}
