/**
 * Who we claim to be, for both transports.
 *
 * The plain-HTTP path and the browser path have to agree: a CDN that sees one
 * identity on the first request and a different one on the retry treats the
 * pair as more suspicious than either alone. Keeping the values here is what
 * stops them drifting apart — `packages/core/src/fetch/index.ts` sends them as
 * headers, `apps/renderer/src/render.ts` applies them to the browser context.
 *
 * Scope, unchanged: we present as an ordinary Chrome and do not advertise
 * automation. We do not solve CAPTCHAs, rotate identities, or route through
 * proxy pools, and sites that still refuse us stay unsupported.
 */

/**
 * Chrome on macOS. Sending a real UA is what keeps most CDNs from 403ing us —
 * the renderer's own Chromium otherwise announces `HeadlessChrome`, which
 * Imperva refuses on the first request, before any page JavaScript runs.
 *
 * Keep this roughly current. A UA several major versions behind the Chromium
 * actually making the request is itself a signal, so it is worth bumping
 * whenever the pinned Playwright version moves.
 */
export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";

export const DEFAULT_ACCEPT_LANGUAGE = "en-GB,en;q=0.9";

/** BCP 47. Also what a listing's own `locale` overrides, per request. */
export const DEFAULT_LOCALE = "en-GB";

/**
 * A browser whose timezone disagrees with its `Accept-Language` and claimed
 * platform is a cheap thing to notice, so the two defaults are set together.
 */
export const DEFAULT_TIMEZONE = "Europe/London";

/**
 * Choose a stable representative of the locale's region, not the host's zone.
 * A locale cannot identify a city in a region with multiple timezones.
 */
export function timezoneForLocale(locale: string = DEFAULT_LOCALE): string {
  try {
    // Node 24 supports Locale info; TypeScript's Intl lib does not yet declare it.
    const regional = new Intl.Locale(locale).maximize() as Intl.Locale & {
      getTimeZones: () => string[] | undefined;
    };
    return regional.getTimeZones()?.[0] ?? DEFAULT_TIMEZONE;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/** The token Chromium's headless builds put in their UA and their brand list. */
const HEADLESS_BRAND = "HeadlessChrome";

/**
 * What a headless build's `HeadlessChrome` entry becomes. Real Chrome brands
 * itself this way; our UA already claims `Chrome`, so the two agree.
 */
const HEADED_BRAND = "Google Chrome";

/**
 * Playwright's headless Chromium reports `HeadlessChrome/<version>`. Swapping
 * that one token for `Chrome` is preferred over sending
 * {@link DEFAULT_USER_AGENT} verbatim: the version then still matches the
 * browser actually making the request, so the UA cannot contradict the TLS and
 * JavaScript fingerprints that go with it.
 *
 * Returns `null` when there was nothing to replace, so a caller can tell
 * "already headed" from "patched" rather than guessing.
 */
export function headedUserAgent(userAgent: string): string | null {
  return userAgent.includes(HEADLESS_BRAND) ? userAgent.replace(HEADLESS_BRAND, "Chrome") : null;
}

/** One entry of a `Sec-CH-UA` brand list. */
export interface UserAgentBrand {
  brand: string;
  version: string;
}

/**
 * The same rename, for the client-hint brand list.
 *
 * Overriding the user agent does *not* change `Sec-CH-UA`, which Chromium
 * builds from its own brand list — so a headless build still announces
 * `"HeadlessChrome";v="156"` in a header that bot protection reads, however
 * plausible the UA string is. Renaming only that entry keeps Chromium's own
 * GREASE brand and its real versions, which is why this takes the live list
 * rather than inventing one.
 */
export function headedBrands(brands: readonly UserAgentBrand[]): UserAgentBrand[] {
  return brands.map(({ brand, version }) => ({
    brand: brand === HEADLESS_BRAND ? HEADED_BRAND : brand,
    version,
  }));
}
