/**
 * HTML for the fake retailer pages the fixture server serves.
 *
 * Six variants cover the automatic preview's transport decisions: `jsonld`
 * is confident in the HTTP response, `js` only gains JSON-LD after rendering,
 * and `rendered-selected-sku` starts ambiguous before the rendered DOM marks
 * one variant as selected. `browser-no-match` starts with the same usable
 * ambiguity but removes it when rendered. `manual-browser-reload` begins as a
 * confident HTTP result, then changes its JSON-LD price in the browser DOM;
 * `selector` exercises the hand-picked fallback.
 *
 * `attribute-only` and `json-blob` cover the two manual paths: a price that is
 * only ever an attribute value, and one that only exists inside an embedded
 * JSON payload. Neither carries structured data, so the automatic chain must
 * come up empty on both.
 *
 * `ambiguous-sizes` models a storefront whose selected, visible size has one
 * price while JSON-LD contains multiple size offers. Its document order is
 * mutable so a test can reproduce the false drops caused by treating the
 * first structured-data offer as the selected variant.
 */

export interface FixtureProductState {
  /** schema.org availability, e.g. "InStock" or "OutOfStock". */
  availability: "InStock" | "OutOfStock";
  /** Cheaper unselected variant used by the ambiguous-sizes template. */
  cheapPrice?: string;
  /** Put the cheap offer first in JSON-LD, independently of the visible variant. */
  cheapVariantFirst?: boolean;
  currency: string;
  /** Decimal string, e.g. "100.00" — prices are never floats on this wire. */
  price: string;
  template:
    | "browser-no-match"
    | "js"
    | "json-blob"
    | "jsonld"
    | "attribute-only"
    | "ambiguous-sizes"
    | "manual-browser-reload"
    | "rendered-selected-sku"
    | "selector";
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

/** The price exposed only after a user explicitly reloads this page in a browser. */
const MANUAL_BROWSER_RELOAD_PRICE = "75.00";
/** Leaves time for the E2E suite to observe the pending browser reload state. */
const MANUAL_BROWSER_RELOAD_DELAY_MS = 250;

/**
 * The source response has a confident JSON-LD price, but client JavaScript
 * corrects it shortly after load, before the renderer captures the DOM. This
 * lets the E2E suite prove that a manual browser reload supersedes a
 * successful HTTP preview without racing its pending UI state.
 */
function manualBrowserReloadPage(state: FixtureProductState, url: string): string {
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
  </main>
  <script>
    window.setTimeout(() => {
      const structuredData = document.querySelector('script[type="application/ld+json"]');
      if (structuredData?.textContent) {
        const product = JSON.parse(structuredData.textContent);
        product.offers.price = "${MANUAL_BROWSER_RELOAD_PRICE}";
        structuredData.textContent = JSON.stringify(product);
      }
    }, ${MANUAL_BROWSER_RELOAD_DELAY_MS});
  </script>
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

const DEFAULT_CHEAP_VARIANT_PRICE = "99.00";

/**
 * The large size is visibly selected and its price has a stable, one-match
 * selector. JSON-LD deliberately gives no selected-SKU or URL evidence, so
 * both orders remain low-confidence even though automatic extraction still
 * returns a candidate.
 */
function ambiguousSizesPage(state: FixtureProductState): string {
  const selectedVariant = variantJsonLd(state, state.price, "large");
  const cheapVariant = variantJsonLd(
    state,
    state.cheapPrice ?? DEFAULT_CHEAP_VARIANT_PRICE,
    "small"
  );
  const variants = state.cheapVariantFirst
    ? [cheapVariant, selectedVariant]
    : [selectedVariant, cheapVariant];

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(state.title)}</title>
  <script type="application/ld+json">${JSON.stringify(variants)}</script>
</head>
<body>
  <main>
    <h1>${escapeHtml(state.title)}</h1>
    <label for="size">Size</label>
    <select id="size">
      <option>Small</option>
      <option selected>Large</option>
    </select>
    <p data-testid="price-now">${displayPrice(state)}</p>
  </main>
</body>
</html>
`;
}

/**
 * The price exists only as an attribute value — never as text. The explicit
 * selector attribute syntax can read it, while the automatic chain cannot.
 */
function attributeOnlyPage(state: FixtureProductState): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(state.title)}</title>
</head>
<body>
  <main data-price="${state.currency} ${state.price}">
    <h1>${escapeHtml(state.title)}</h1>
    <div class="stock">${state.availability === "InStock" ? "In stock" : "Out of stock"}</div>
    <p class="price">See basket for price</p>
  </main>
</body>
</html>
`;
}

/**
 * The price exists only inside an embedded JSON payload, the way a
 * single-page storefront hydrates one.
 */
function jsonBlobPage(state: FixtureProductState): string {
  const payload = JSON.stringify({
    props: {
      pageProps: {
        product: {
          currency: state.currency,
          name: state.title,
          price: state.price,
        },
      },
    },
  });
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
  </main>
  <script id="__NEXT_DATA__" type="application/json">${payload}</script>
</body>
</html>
`;
}

export function renderProductPage(state: FixtureProductState, url: string): string {
  if (state.template === "jsonld") {
    return jsonLdPage(state, url);
  }
  if (state.template === "manual-browser-reload") {
    return manualBrowserReloadPage(state, url);
  }
  if (state.template === "browser-no-match") {
    return ambiguousVariantPage(state, "remove");
  }
  if (state.template === "rendered-selected-sku") {
    return ambiguousVariantPage(state, "select");
  }
  if (state.template === "attribute-only") {
    return attributeOnlyPage(state);
  }
  if (state.template === "ambiguous-sizes") {
    return ambiguousSizesPage(state);
  }
  if (state.template === "json-blob") {
    return jsonBlobPage(state);
  }
  return state.template === "js" ? javascriptPage(state, url) : selectorPage(state);
}
