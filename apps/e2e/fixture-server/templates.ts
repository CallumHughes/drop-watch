/**
 * HTML for the fake retailer pages the fixture server serves.
 *
 * Two variants, matching the two halves of the app's extraction chain:
 * `jsonld` exercises the automatic path (schema.org/Product structured data),
 * `selector` has no structured data at all so only a hand-picked CSS selector
 * (`.price`) can find the price.
 */

export interface FixtureProductState {
  /** schema.org availability, e.g. "InStock" or "OutOfStock". */
  availability: "InStock" | "OutOfStock";
  currency: string;
  /** Decimal string, e.g. "100.00" — prices are never floats on this wire. */
  price: string;
  template: "jsonld" | "selector";
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

function jsonLdPage(state: FixtureProductState, url: string): string {
  const data = {
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
  return state.template === "jsonld" ? jsonLdPage(state, url) : selectorPage(state);
}
