/**
 * Recognising a bot-protection interstitial.
 *
 * Without this, a challenge page is indistinguishable from a product page whose
 * price we failed to find: Imperva answers 200 with ~6KB of "Pardon Our
 * Interruption", the extraction chain reports "no price found (tried: jsonld,
 * microdata, opengraph, selector)", and the next thing anyone does is go
 * hunting for a CSS selector on a page that has no product on it.
 *
 * Pure — markup and status in, a sentence or `null` out. Deliberately
 * conservative: these markers are specific to the vendors' own challenge
 * scripts, so a false positive would need a product page to ship one.
 */

/** Characters worth scanning; challenge pages are usually small. */
const SCAN_CHARS = 20_000;

const HTTP_FORBIDDEN = 403;

const LEADING_WWW = /^www\./;

interface ChallengeSignature {
  markers: readonly (RegExp | string)[];
  /** Named in the message, so the reader knows which vendor to look up. */
  vendor: string;
}

const SIGNATURES: readonly ChallengeSignature[] = [
  {
    // Deliberately not `_Incapsula_Resource`: that script is Imperva's sensor,
    // which a protected site also serves on the pages it delivers normally, so
    // matching it would name a block on a page that arrived intact.
    markers: [/<title\b[^>]*>\s*Pardon Our Interruption\s*<\/title>/i, "reeseSkipAutoLoad"],
    vendor: "Imperva",
  },
  // The broadest marker left, and a bare substring. It names the field Bot
  // Manager's challenge form posts back, which a delivered product page has no
  // reason to carry — but if one ever does, narrow this toward the challenge
  // path the way Cloudflare's was, rather than widening the scan.
  { markers: ["bm-verify"], vendor: "Akamai" },
  {
    markers: [
      "cf_chl_opt",
      /\/cdn-cgi\/challenge-platform\/h\/[^/\s"']+\/flow\//,
      /<title\b[^>]*>\s*Just a moment(?:\.{3}|…)?\s*<\/title>/i,
    ],
    vendor: "Cloudflare",
  },
  { markers: ["geo.captcha-delivery.com"], vendor: "DataDome" },
  { markers: ["px-captcha"], vendor: "PerimeterX" },
];

function matches(haystack: string, marker: RegExp | string): boolean {
  return typeof marker === "string" ? haystack.includes(marker) : marker.test(haystack);
}

/** Which vendor's challenge this markup carries, or `null`. */
export function challengeVendor(html: string): string | null {
  const scanned = html.slice(0, SCAN_CHARS);
  for (const signature of SIGNATURES) {
    if (signature.markers.some((marker) => matches(scanned, marker))) {
      return signature.vendor;
    }
  }
  return null;
}

export interface ChallengeOptions {
  /** The status that carried `html`, when there was a response. */
  httpStatus?: number | undefined;
  /**
   * Which transport was refused. Only the advice depends on it, and only
   * because "try a browser" is wrong to say to someone whose browser attempt is
   * the one that just failed. Omitted where the caller does not know, which
   * gets the advice that holds either way.
   */
  transport?: "browser" | "http" | undefined;
  /** Host named in the message; omitted when the URL is unparseable. */
  url?: string | undefined;
}

function hostOf(url: string | undefined): string {
  if (!url) {
    return "This site";
  }
  try {
    return new URL(url).hostname.replace(LEADING_WWW, "");
  } catch {
    return "This site";
  }
}

/**
 * What a hand-written expression would be matched against is the interstitial,
 * never the product — so saying so is useful in every case, while "try a
 * browser" is only useful to someone who has not already tried one.
 */
function advice(transport: ChallengeOptions["transport"]): string {
  if (transport === "http") {
    return "Browser mode may get through; a saved selector will not.";
  }
  return "A saved selector will not help: it would match the interstitial, not the product.";
}

/**
 * A sentence naming the block, or `null` when nothing suggests one. A 403 counts
 * on its own: the vendors answer it with an empty body, so there is no markup
 * left to match against, and a retailer serving a bare 403 to a plain product
 * URL is refusing us either way.
 */
export function challengeReason(html: string, options: ChallengeOptions = {}): string | null {
  const vendor = challengeVendor(html);
  const forbidden = options.httpStatus === HTTP_FORBIDDEN;
  if (!(vendor || forbidden)) {
    return null;
  }
  const attribution = vendor ? ` (${vendor} bot protection)` : "";
  return `${hostOf(options.url)} blocked this request${attribution}. ${advice(options.transport)}`;
}
