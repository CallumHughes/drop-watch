/**
 * HTML for the fake retailer pages the fixture server serves.
 *
 * Six variants cover the automatic preview's transport decisions: `jsonld`
 * is confident in the HTTP response, `js` only gains JSON-LD after rendering,
 * and `rendered-selected-sku` starts ambiguous before the rendered DOM marks
 * one variant as selected. `browser-no-match` is ambiguous the same way, but
 * rendering deletes the candidates instead of resolving them, leaving the HTTP
 * fallback unsavable. `manual-browser-reload` begins as a confident HTTP
 * result, then changes its JSON-LD price in the browser DOM; `selector`
 * exercises the hand-picked fallback.
 *
 * `opengraph-only` carries its single price in OpenGraph meta tags alone —
 * unambiguous, but never high confidence, which is the pairing the recording
 * gate has to get right.
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

/**
 * What a template is allowed to know about the request.
 *
 * Only the bot-protection templates read it, and only to tell the two
 * transports apart the way a real CDN does: by what the caller says it is.
 */
export interface FixtureRequest {
  /** `Sec-CH-UA`. Sent by a real Chromium, never by the undici fetch path. */
  secChUa: string | undefined;
  userAgent: string | undefined;
}

/** A served response, so a template can refuse a request rather than answer it. */
export interface FixtureResponse {
  body: string;
  status: number;
}

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
    | "bot-protection"
    | "bot-protection-browser"
    | "bot-protection-interstitial"
    | "bot-protection-total"
    | "browser-no-match"
    | "js"
    | "json-blob"
    | "jsonld"
    | "attribute-only"
    | "ambiguous-sizes"
    | "opengraph-only"
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
 * Raw HTML deliberately contains two conflicting prices with no URL evidence,
 * so HTTP extraction is low-confidence. Rendering either selects the blue SKU
 * or removes both candidates: resolved, or still unsavable.
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
 * One price, carried only by OpenGraph meta tags. The extraction chain rates
 * every OpenGraph result low confidence because the tags corroborate nothing
 * — but there is only one price on the page, so it is unambiguous and a check
 * must still record it.
 */
function openGraphOnlyPage(state: FixtureProductState): string {
  const availability = state.availability === "InStock" ? "instock" : "oos";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(state.title)}</title>
  <meta property="og:title" content="${escapeHtml(state.title)}" />
  <meta property="product:price:amount" content="${escapeHtml(state.price)}" />
  <meta property="product:price:currency" content="${escapeHtml(state.currency)}" />
  <meta property="product:availability" content="${availability}" />
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

const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;

/** The marker Chromium's headless builds put in their UA and their brand list. */
const HEADLESS_MARKER = "HeadlessChrome";

/**
 * Trimmed from the body boots.com actually serves a plain fetch: the challenge
 * script and the `Pardon Our Interruption` title, with no product anywhere on
 * it. Served with a 200, which is what makes it indistinguishable from a real
 * page to anything that only looks at the status.
 */
function impervaInterstitial(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <noscript><title>Pardon Our Interruption</title></noscript>
  <script>window.reeseSkipAutoLoad = true;</script>
  <script src="/_Incapsula_Resource?SWJIYLWA=719d34d31c8e3a6e6fffd425f7e032f3"></script>
</head>
<body>
  <div class="container">
    <h1>Pardon Our Interruption</h1>
    <p>As you were browsing something about your browser made us think you were a bot.</p>
  </div>
</body>
</html>
`;
}

/** Whether the caller is announcing a headless build, in either place it shows. */
function looksHeadless(request: FixtureRequest): boolean {
  return (
    (request.userAgent?.includes(HEADLESS_MARKER) ?? false) ||
    (request.secChUa?.includes(HEADLESS_MARKER) ?? false)
  );
}

/**
 * Models the shops this app could not read at all: refuse anything announcing
 * a headless build, on the first request, before any page JavaScript runs —
 * which is exactly what Imperva does — and otherwise behave like a normal
 * JavaScript-composed storefront, so the price exists only in the rendered DOM.
 *
 * Checking `Sec-CH-UA` as well as the user agent is the point. Overriding only
 * the user agent leaves Chromium advertising `HeadlessChrome` in that header,
 * so a test that read the user agent alone would pass while the real Boots
 * still refused us.
 */
function botProtectionPage(
  state: FixtureProductState,
  url: string,
  request: FixtureRequest
): FixtureResponse {
  if (looksHeadless(request)) {
    return { body: "", status: HTTP_FORBIDDEN };
  }
  return { body: javascriptPage(state, url), status: HTTP_OK };
}

/**
 * A shop that refuses every real browser but serves the plain-HTTP path. The
 * HTTP body carries no price, so the preview exists, shows nothing automatic,
 * and offers a browser reload that cannot possibly work — which is the state
 * the UI has to recognise instead of charging another render for it.
 */
function browserForbiddenPage(
  state: FixtureProductState,
  url: string,
  request: FixtureRequest
): FixtureResponse {
  // `Sec-CH-UA` is sent by a real Chromium and never by the undici path, which
  // makes it the one header that tells the two transports apart.
  if (request.secChUa !== undefined) {
    return { body: "", status: HTTP_FORBIDDEN };
  }
  return { body: javascriptPage(state, url), status: HTTP_OK };
}

export function renderProductPage(
  state: FixtureProductState,
  url: string,
  request: FixtureRequest
): FixtureResponse {
  if (state.template === "bot-protection") {
    return botProtectionPage(state, url, request);
  }
  if (state.template === "bot-protection-browser") {
    return browserForbiddenPage(state, url, request);
  }
  if (state.template === "bot-protection-interstitial") {
    return { body: impervaInterstitial(), status: HTTP_OK };
  }
  if (state.template === "bot-protection-total") {
    return { body: "", status: HTTP_FORBIDDEN };
  }
  return { body: htmlFor(state, url), status: HTTP_OK };
}

function htmlFor(state: FixtureProductState, url: string): string {
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
  if (state.template === "opengraph-only") {
    return openGraphOnlyPage(state);
  }
  if (state.template === "json-blob") {
    return jsonBlobPage(state);
  }
  return state.template === "js" ? javascriptPage(state, url) : selectorPage(state);
}
