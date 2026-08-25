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
const DIMENSION_SEPARATOR = /(\d)\s*[x×]\s*(\d)/gi;
const WHITESPACE = /\s+/g;

export interface UrlIdentity {
  /** Parameters repeated with conflicting values cannot identify a variant. */
  ambiguousParameters: ReadonlySet<string>;
  /** Absolute URL used as the base for resolving relative JSON-LD URLs. */
  baseUrl: string;
  /** Origin, path and remaining sorted query — the whole variant identity. */
  full: string;
  /** Whether a query that could still name an unresolved variant remains. */
  hasQuery: boolean;
  originPathname: string;
  /** Recognised query parameters, with URL decoding already applied. */
  parameters: ReadonlyMap<string, string>;
}

function isTrackingParam(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith(TRACKING_PREFIX) || TRACKING_PARAMS.has(lower);
}

/** Safe equivalence used only when deciding whether repeated query values conflict. */
export function normalizeQueryValue(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(WHITESPACE, " ");
}

/** Includes the safe dimension spelling equivalence used by size-like URLs. */
export function normalizeUrlParameterValue(value: string): string {
  return normalizeQueryValue(value).replace(DIMENSION_SEPARATOR, "$1x$2");
}

export function urlIdentity(value: unknown, base?: string): UrlIdentity | undefined {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().startsWith("#")) {
    return;
  }
  try {
    const url = new URL(value, base);
    url.hash = "";
    for (const name of [...url.searchParams.keys()]) {
      if (isTrackingParam(name)) {
        url.searchParams.delete(name);
      }
    }
    url.searchParams.sort();
    const originPathname = `${url.origin}${url.pathname}`;
    const parameters = new Map<string, string>();
    const ambiguousParameters = new Set<string>();
    for (const [rawName, rawValue] of url.searchParams.entries()) {
      const name = rawName.toLowerCase();
      if (ambiguousParameters.has(name)) {
        continue;
      }
      const previous = parameters.get(name);
      if (previous === undefined) {
        parameters.set(name, rawValue);
      } else if (normalizeUrlParameterValue(previous) !== normalizeUrlParameterValue(rawValue)) {
        parameters.delete(name);
        ambiguousParameters.add(name);
      }
    }
    return {
      ambiguousParameters,
      baseUrl: url.toString(),
      full: `${originPathname}${url.search}`,
      hasQuery: url.search.length > 0,
      originPathname,
      parameters,
    };
  } catch {
    // Only absolute, well-formed URLs have an origin to compare.
  }
}
