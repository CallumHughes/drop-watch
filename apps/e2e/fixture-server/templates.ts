/**
 * HTML for the fake retailer pages the fixture server serves.
 *
 * Four variants, matching the halves of the app's extraction chain:
 * `jsonld` exercises the automatic path (schema.org/Product structured data),
 * `selector` has no structured data at all so only a hand-picked CSS selector
 * (`.price`) can find the price, and `js` injects JSON-LD after the initial
 * document has loaded for the browser-first automatic preview. `browser-no-match`
 * does the inverse: HTTP sees JSON-LD that the rendered DOM removes.
 */

export interface FixtureProductState {
  /** schema.org availability, e.g. "InStock" or "OutOfStock". */
  availability: "InStock" | "OutOfStock";
  currency: string;
  /** Decimal string, e.g. "100.00" — prices are never floats on this wire. */
  price: string;
  template: "browser-no-match" | "js" | "jsonld" | "selector";
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

function jsonLdPage(state: FixtureProductState, url: string, removeWhenRendered = false): string {
  const data = productJsonLd(state, url);
  const removalScript = removeWhenRendered
    ? `<script>document.querySelector('script[type="application/ld+json"]')?.remove();</script>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(state.title)}</title>
  <script type="application/ld+json">${JSON.stringify(data)}</script>
  ${removalScript}
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
    return jsonLdPage(state, url, true);
  }
  return state.template === "js" ? javascriptPage(state, url) : selectorPage(state);
}
