/**
 * Variant identity from a URL, shared by the strategies that use the final
 * fetched URL as evidence.
 *
 * Only the parts a shop uses to name a variant count. A hash never does, and
 * campaign parameters describe where the link was pasted from rather than which
 * product it points at — treating `?utm_source=email` as an unresolved variant
 * query would demote a perfectly unambiguous page and buy a browser render for
 * nothing.
 */

/** Prefix-matched: every `utm_*` parameter is campaign attribution. */
const TRACKING_PREFIX = "utm_";
/** Click identifiers from ad networks, marketplaces and mail senders. */
const TRACKING_PARAMS = new Set([
  "dclid",
  "fbclid",
  "gbraid",
  "gclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "msclkid",
  "srsltid",
  "ttclid",
  "twclid",
  "wbraid",
  "yclid",
]);

export interface UrlIdentity {
  /** Origin, path and remaining sorted query — the whole variant identity. */
  full: string;
  /** Whether a query that could still name an unresolved variant remains. */
  hasQuery: boolean;
  originPathname: string;
}

function isTrackingParam(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith(TRACKING_PREFIX) || TRACKING_PARAMS.has(lower);
}

export function urlIdentity(value: unknown): UrlIdentity | undefined {
  if (typeof value !== "string") {
    return;
  }
  try {
    const url = new URL(value);
    url.hash = "";
    for (const name of [...url.searchParams.keys()]) {
      if (isTrackingParam(name)) {
        url.searchParams.delete(name);
      }
    }
    url.searchParams.sort();
    const originPathname = `${url.origin}${url.pathname}`;
    return {
      full: `${originPathname}${url.search}`,
      hasQuery: url.search.length > 0,
      originPathname,
    };
  } catch {
    // Only absolute, well-formed URLs have an origin to compare.
  }
}
