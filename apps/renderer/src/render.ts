/**
 * The one file in this package allowed to import Playwright.
 *
 * Scope, matching `packages/core/src/fetch/index.ts`: this exists for pages
 * that build their own DOM in JavaScript. It presents as an ordinary Chrome and
 * does not advertise automation — Chromium's own `HeadlessChrome` user agent is
 * refused outright by Imperva on the first request, before any page JavaScript
 * runs, and the `--enable-automation` tells stop a challenge script issuing its
 * cookie even once the user agent passes. Beyond that there is no escalation:
 * no `playwright-extra`, no stealth plugins, no canvas or WebGL spoofing, no
 * identity rotation, no proxy pools, no CAPTCHA anything. Sites that still
 * refuse us stay unsupported, and `@drop-watch/core/extract/challenge` names
 * them rather than letting a challenge page pass for a product page.
 */

import { checkUrlScheme } from "@drop-watch/core/net/guard";
import type { UserAgentBrand } from "@drop-watch/core/net/identity";
import {
  DEFAULT_LOCALE,
  DEFAULT_USER_AGENT,
  headedBrands,
  headedUserAgent,
  timezoneForLocale,
} from "@drop-watch/core/net/identity";
import type { RenderRequest, RenderResponse } from "@drop-watch/core/render/contract";
import {
  DEFAULT_RENDER_MAX_BYTES,
  DEFAULT_RENDER_TIMEOUT_MS,
  MAX_RENDER_TIMEOUT_MS,
} from "@drop-watch/core/render/contract";
import { log } from "evlog";
import type {
  Browser,
  BrowserContext,
  BrowserServer,
  Page,
  Response as PlaywrightResponse,
} from "playwright";
import { chromium } from "playwright";
import {
  type BrowserGeneration,
  BrowserGenerationManager,
  withDeadline,
} from "./browser-generation";
import {
  classifyError,
  exceedsByteCap,
  isInertScheme,
  shouldBlockResource,
  stalledFor,
} from "./classify";
import { type GuardedSocksProxy, startGuardedSocksProxy } from "./guarded-socks-proxy";

/**
 * Best-effort settle after `goto` resolves, to catch SPA hydration that keeps
 * firing requests after the `domcontentloaded`/`load` event. Playwright
 * discourages `networkidle` as a `goto` *condition* because it hangs forever
 * on any page with polling or analytics beacons; used here afterwards, on its
 * own small budget, with the timeout swallowed, it costs ~3s on pages that
 * never idle and buys real content on the ones that do.
 */
const NETWORK_IDLE_MS = 3000;

/** Budget for tearing a context down; a healthy close is tens of milliseconds. */
const CONTEXT_CLOSE_TIMEOUT_MS = 2000;
const BROWSER_LAUNCH_TIMEOUT_MS = 15_000;
const BROWSER_SERVER_LAUNCH_TIMEOUT_MS = 10_000;
const BROWSER_CLOSE_TIMEOUT_MS = 2000;
const BROWSER_KILL_TIMEOUT_MS = 2000;
const BROWSER_CONNECT_TIMEOUT_MS = 3000;
// Leave a second of slack inside the 15s launch budget after server + connect.
const IDENTITY_PROBE_TIMEOUT_MS = 1000;
const CONTEXT_SETUP_TIMEOUT_MS = 5000;

/**
 * What this browser should claim to be, read from the browser itself.
 *
 * `metadata` is `null` when the probe could not read the client hints, in which
 * case only the user agent is overridden — a partial identity is still a large
 * improvement on announcing `HeadlessChrome`.
 */
interface BrowserIdentity {
  metadata: UserAgentMetadata | null;
  userAgent: string;
}

/** The subset of CDP's `Emulation.setUserAgentOverride` metadata we send. */
interface UserAgentMetadata {
  architecture: string;
  bitness: string;
  brands: UserAgentBrand[];
  fullVersion: string;
  fullVersionList: UserAgentBrand[];
  mobile: boolean;
  model: string;
  platform: string;
  platformVersion: string;
  wow64: boolean;
}

interface ManagedBrowser {
  browser: Browser;
  identity: BrowserIdentity;
  server: BrowserServer;
}

/**
 * `navigator.userAgentData` is not in this project's DOM lib. Declared here
 * rather than widened globally: only the probe below touches it, and only
 * inside the page.
 */
interface NavigatorUAData {
  brands: UserAgentBrand[];
  getHighEntropyValues: (hints: string[]) => Promise<{
    architecture?: string;
    bitness?: string;
    fullVersionList?: UserAgentBrand[];
    model?: string;
    platformVersion?: string;
  }>;
  platform: string;
}

interface ProbedIdentity {
  architecture: string;
  bitness: string;
  brands: UserAgentBrand[];
  fullVersionList: UserAgentBrand[];
  model: string;
  platform: string;
  platformVersion: string;
  userAgent: string;
}

/**
 * A page on a potentially-trustworthy origin, served from memory.
 *
 * `navigator.userAgentData` is undefined on `about:blank` — an opaque origin is
 * not a secure context — so the brand list cannot be read there. Fulfilling the
 * route locally gives the page a `http://localhost` origin without opening a
 * socket, which is why this needs no address-guard exemption.
 */
const IDENTITY_PROBE_URL = "http://localhost/__identity-probe";

/**
 * Reads what this Chromium says about itself and removes the headless marker,
 * rather than sending hardcoded values: the versions then still match the
 * browser making the request, so the identity cannot contradict the TLS and
 * JavaScript fingerprints that accompany it. Chromium's own GREASE brand is
 * kept for the same reason — inventing one would drift from whatever the
 * pinned Playwright build actually uses.
 *
 * Costs one in-memory page per browser launch, not per render.
 */
async function detectIdentity(browser: Browser): Promise<BrowserIdentity> {
  const context = await browser.newContext();
  try {
    await context.route("**/*", (route) =>
      route.fulfill({ body: "<html></html>", contentType: "text/html" })
    );
    const page = await context.newPage();
    await page.goto(IDENTITY_PROBE_URL, { waitUntil: "domcontentloaded" });
    const probed = await page.evaluate(async (): Promise<ProbedIdentity | null> => {
      const data = (navigator as Navigator & { userAgentData?: NavigatorUAData }).userAgentData;
      if (!data) {
        return null;
      }
      const high = await data.getHighEntropyValues([
        "architecture",
        "bitness",
        "fullVersionList",
        "model",
        "platformVersion",
      ]);
      return {
        architecture: high.architecture ?? "",
        bitness: high.bitness ?? "",
        brands: data.brands.map(({ brand, version }) => ({ brand, version })),
        fullVersionList: (high.fullVersionList ?? []).map(({ brand, version }) => ({
          brand,
          version,
        })),
        model: high.model ?? "",
        platform: data.platform,
        platformVersion: high.platformVersion ?? "",
        userAgent: navigator.userAgent,
      };
    });

    if (!probed) {
      const reported = await page.evaluate(() => navigator.userAgent);
      return { metadata: null, userAgent: headedUserAgent(reported) ?? reported };
    }

    const fullVersionList = headedBrands(probed.fullVersionList);
    return {
      metadata: {
        architecture: probed.architecture,
        bitness: probed.bitness,
        brands: headedBrands(probed.brands),
        fullVersion: browser.version(),
        fullVersionList,
        mobile: false,
        model: probed.model,
        platform: probed.platform,
        platformVersion: probed.platformVersion,
        wow64: false,
      },
      userAgent: headedUserAgent(probed.userAgent) ?? probed.userAgent,
    };
  } finally {
    await context.close().catch(() => undefined);
  }
}

async function launchBrowser(): Promise<ManagedBrowser> {
  let server: BrowserServer | null = null;
  try {
    server = await chromium.launchServer({
      args: [
        "--disable-quic",
        "--dns-prefetch-disable",
        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
        // Without this, `navigator.webdriver` is true and the automation
        // surface stays visible to page JavaScript, which is enough for a
        // challenge script to withhold its cookie and leave us on a near-empty
        // interstitial instead of the product page.
        "--disable-blink-features=AutomationControlled",
      ],
      // Playwright defaults this to false even for a non-root process. Pages
      // are hostile input, so keep Chromium's renderer processes behind their
      // own sandbox as well as the surrounding container boundary.
      chromiumSandbox: true,
      // Playwright adds `--enable-automation` by default. It changes nothing we
      // rely on and is read directly by bot-protection scripts.
      ignoreDefaultArgs: ["--enable-automation"],
      timeout: BROWSER_SERVER_LAUNCH_TIMEOUT_MS,
    });
    const browser = await chromium.connect(server.wsEndpoint(), {
      timeout: BROWSER_CONNECT_TIMEOUT_MS,
    });
    const identity = await withDeadline(
      detectIdentity(browser),
      IDENTITY_PROBE_TIMEOUT_MS,
      "browser identity detection"
    ).catch(() => ({ metadata: null, userAgent: DEFAULT_USER_AGENT }));
    return { browser, identity, server };
  } catch (error) {
    if (server) {
      await withDeadline(
        server.kill(),
        BROWSER_KILL_TIMEOUT_MS,
        "failed browser launch cleanup"
      ).catch(() => undefined);
    }
    throw error;
  }
}

/**
 * One long-lived browser process, a fresh `BrowserContext` per request rather
 * than a page pool. A context costs tens of milliseconds against a
 * multi-second page load — not worth pooling for — and buys two things
 * pooling would give up: no cookie or storage bleed between two retailers
 * (this tracker holds no sessions and must never accidentally acquire one),
 * and a page a caller forgets to close is structurally unable to pin memory,
 * because the whole context it lives in is closed in `finally`.
 */
const browserManager = new BrowserGenerationManager<ManagedBrowser>({
  close: ({ server }) => server.close(),
  closeTimeoutMs: BROWSER_CLOSE_TIMEOUT_MS,
  forceClose: ({ server }) => server.kill(),
  forceCloseTimeoutMs: BROWSER_KILL_TIMEOUT_MS,
  isUsable: ({ browser, server }) =>
    browser.isConnected() &&
    server.process().exitCode === null &&
    server.process().signalCode === null,
  launch: launchBrowser,
  launchTimeoutMs: BROWSER_LAUNCH_TIMEOUT_MS,
});

/** For `/healthz`: whether a browser process is currently up. */
export function browserStatus(): "connected" | "idle" {
  return browserManager.isConnected() ? "connected" : "idle";
}

/**
 * Start times of the renders currently running, held by object identity so a
 * render removes exactly its own entry. Lets `/healthz` answer whether renders
 * are still completing, which `isConnected()` cannot.
 */
const inFlightRenders = new Set<{ startedAt: number }>();

/**
 * Past this age a render is wedged rather than slow: it has outlived the
 * largest budget the contract allows, teardown, and half a minute of slack.
 */
const STALL_THRESHOLD_MS = MAX_RENDER_TIMEOUT_MS + CONTEXT_CLOSE_TIMEOUT_MS + 30_000;

/** Age of the oldest overdue render, or `null` when none is overdue. */
export function stalledRenderMs(now: number = Date.now()): number | null {
  const started = [...inFlightRenders].map((render) => render.startedAt);
  return stalledFor(started.length === 0 ? null : Math.min(...started), now, STALL_THRESHOLD_MS);
}

/** Closes the browser, if one was ever launched. Called on shutdown. */
export async function closeBrowser(deadlineAt?: number): Promise<void> {
  await browserManager.close(deadlineAt);
}

/**
 * What the address guard saw during one render. The first refusal is enough to
 * throw the render away; keeping its reason turns Chromium's opaque
 * `net::ERR_BLOCKED_BY_CLIENT` back into a sentence about an address.
 */
interface GuardState {
  refusal: string | null;
}

/**
 * Keeps the normal route focused on cheap browser-side policy. Address policy
 * is enforced by the per-render SOCKS proxy at the socket connection, where
 * Chromium cannot resolve a different address between the check and connect.
 */
async function installAddressGuard(context: BrowserContext, state: GuardState): Promise<void> {
  let primaryPage: Page | null = null;
  context.on("page", (createdPage) => {
    if (!primaryPage) {
      primaryPage = createdPage;
      return;
    }
    // Playwright disables Chromium's popup blocker for automation. Rendering
    // needs exactly one page; extra pages only multiply processes and network
    // work under attacker control.
    createdPage.close().catch(() => undefined);
  });
  context.on("download", (download) => {
    // `acceptDownloads: false` denies persistence; cancelling the event as
    // well stops an attachment response from consuming the render budget.
    download.cancel().catch(() => undefined);
  });

  await context.routeWebSocket("**/*", async (webSocket) => {
    await webSocket.close({ code: 1008, reason: "WebSockets disabled" });
  });

  await context.route("**/*", async (route) => {
    const request = route.request();
    if (shouldBlockResource(request.resourceType())) {
      await route.abort();
      return;
    }
    const url = request.url();
    if (isInertScheme(url)) {
      await route.continue();
      return;
    }
    const verdict = checkUrlScheme(url);
    if (verdict.ok) {
      await route.continue();
      return;
    }
    state.refusal ??= verdict.reason;
    await route.abort("blockedbyclient");
  });
}

/**
 * Rewrites the client-hint headers, which a context `userAgent` does not touch.
 *
 * Chromium derives `Sec-CH-UA` from its own brand list, so overriding only the
 * user agent leaves a headless build announcing `"HeadlessChrome"` in a header
 * bot protection reads. CDP is the only way to replace it, and the metadata is
 * this browser's own with one entry renamed — see `detectIdentity`.
 */
async function applyClientHints(
  context: BrowserContext,
  page: Page,
  identity: BrowserIdentity
): Promise<void> {
  if (!identity.metadata) {
    return;
  }
  // Deliberately not detached: the override lives on the session, and
  // detaching reverts it, so the header would go back to announcing
  // `HeadlessChrome`. The session is torn down with its context in `finally`.
  const session = await context.newCDPSession(page);
  // No `acceptLanguage` here: the context's `locale` already sets it, and
  // passing both appends a second q-value to the header.
  await session.send("Emulation.setUserAgentOverride", {
    userAgent: identity.userAgent,
    userAgentMetadata: identity.metadata,
  });
}

interface PreparedPage {
  context: BrowserContext;
  page: Page;
}

/**
 * A context and a page ready to navigate: address guard installed, identity
 * applied, nothing fetched yet.
 *
 * Separate from `renderPage` because every failure here is evidence about the
 * browser rather than about the page, so each one retires the generation and
 * escapes — which is what lets the sidecar answer 5xx and the worker record
 * `renderer_error` instead of blaming the retailer.
 */
async function preparePage(
  acquired: { generation: BrowserGeneration<ManagedBrowser>; handle: ManagedBrowser },
  request: RenderRequest,
  proxy: GuardedSocksProxy,
  guard: GuardState
): Promise<PreparedPage> {
  // The identity defaults are deliberate, not cosmetic: Chromium's own
  // `HeadlessChrome` UA is refused on the first request by Imperva, and a
  // browser whose timezone disagrees with its language is a cheap tell. A
  // caller's own `locale`/`userAgent` still wins.
  const contextPromise = acquired.handle.browser.newContext({
    acceptDownloads: false,
    locale: request.locale ?? DEFAULT_LOCALE,
    proxy: { bypass: "<-loopback>", server: proxy.server },
    serviceWorkers: "block",
    timezoneId: timezoneForLocale(request.locale),
    userAgent: request.userAgent ?? acquired.handle.identity.userAgent,
  });

  let context: BrowserContext;
  try {
    context = await withDeadline(contextPromise, CONTEXT_SETUP_TIMEOUT_MS, "browser context setup");
  } catch (error) {
    // A timed-out protocol call can still resolve later. Close that late
    // context explicitly while retiring its browser generation below.
    contextPromise.then((lateContext) => lateContext.close()).catch(() => undefined);
    browserManager.retire(acquired.generation);
    throw error;
  }

  try {
    await withDeadline(
      installAddressGuard(context, guard),
      CONTEXT_SETUP_TIMEOUT_MS,
      "browser route setup"
    );
    const page = await withDeadline(context.newPage(), CONTEXT_SETUP_TIMEOUT_MS, "page setup");
    // Before the first navigation, because the header this fixes is sent with
    // it. Skipped when the caller supplied its own user agent: our brand list
    // describes this Chromium, and pairing it with someone else's user agent
    // would be the contradiction it exists to avoid.
    if (!request.userAgent && acquired.handle.identity.metadata) {
      await withDeadline(
        applyClientHints(context, page, acquired.handle.identity),
        CONTEXT_SETUP_TIMEOUT_MS,
        "client hint override"
      );
    }
    return { context, page };
  } catch (error) {
    browserManager.retire(acquired.generation);
    throw error;
  }
}

interface Navigated {
  html: string;
  response: PlaywrightResponse | null;
}

async function navigate(page: Page, request: RenderRequest, budgetMs: number): Promise<Navigated> {
  const response = await page.goto(request.url, {
    timeout: budgetMs,
    waitUntil: request.waitUntil ?? "domcontentloaded",
  });
  await page.waitForLoadState("networkidle", { timeout: NETWORK_IDLE_MS }).catch(() => undefined);
  const html = await page.content();
  return { html, response };
}

function httpError(durationMs: number, error: string, httpStatus: number): RenderResponse {
  return { durationMs, error, httpStatus, status: "http_error" };
}

/**
 * Closes the render's context, but not at any price: a Chromium that never
 * acknowledges `close()` would hold its concurrency slot for the life of the
 * process. A close that misses the deadline is evidence about the browser
 * rather than the page, so the browser is dropped and the next render launches
 * a clean one.
 */
async function closeContext(
  context: BrowserContext | null,
  generation: BrowserGeneration<ManagedBrowser> | null
): Promise<void> {
  if (!context) {
    return;
  }
  try {
    await withDeadline(context.close(), CONTEXT_CLOSE_TIMEOUT_MS, "context close");
  } catch {
    log.warn("renderer", "context close timed out; retiring the browser generation");
    if (generation) {
      browserManager.retire(generation);
    }
  }
}

/**
 * Renders one page and returns a contract-shaped target result. Renderer
 * setup failures deliberately escape so the sidecar can return 5xx and the
 * worker records `renderer_error`; navigation failures retain the contract's
 * target-facing error variants.
 */
export async function renderPage(request: RenderRequest): Promise<RenderResponse> {
  const startedAt = Date.now();
  const budgetMs = request.timeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS;
  const maxBytes = request.maxBytes ?? DEFAULT_RENDER_MAX_BYTES;
  const elapsed = () => Date.now() - startedAt;

  const guard: GuardState = { refusal: null };
  const inFlight = { startedAt };
  inFlightRenders.add(inFlight);
  let context: BrowserContext | null = null;
  let generation: BrowserGeneration<ManagedBrowser> | null = null;
  let proxy: GuardedSocksProxy | null = null;
  try {
    proxy = await startGuardedSocksProxy();
    const acquired = await browserManager.acquire();
    ({ generation } = acquired);
    const prepared = await preparePage(acquired, request, proxy, guard);
    ({ context } = prepared);
    const { page } = prepared;

    try {
      const { html, response } = await withDeadline(
        navigate(page, request, budgetMs),
        budgetMs,
        "render"
      );

      const refusal = guard.refusal ?? proxy.refusal();
      if (refusal) {
        return { durationMs: elapsed(), error: refusal, status: "network_error" };
      }

      if (!response) {
        return { durationMs: elapsed(), error: "no response", status: "network_error" };
      }
      if (!response.ok()) {
        return httpError(
          elapsed(),
          `HTTP ${response.status()} ${response.statusText()}`.trim(),
          response.status()
        );
      }
      const overBy = exceedsByteCap(html, maxBytes);
      if (overBy !== null) {
        return httpError(elapsed(), `response too large (${overBy} bytes)`, response.status());
      }

      return {
        durationMs: elapsed(),
        html,
        httpStatus: response.status(),
        status: "ok",
        url: page.url(),
      };
    } catch (error) {
      // A blocked main document surfaces as `net::ERR_BLOCKED_BY_CLIENT`,
      // which says nothing useful.
      const refusal = guard.refusal ?? proxy.refusal();
      if (refusal) {
        return { durationMs: elapsed(), error: refusal, status: "network_error" };
      }
      return classifyError(error, elapsed());
    }
  } finally {
    proxy?.abort();
    try {
      await closeContext(context, generation);
    } finally {
      if (!context && generation) {
        browserManager.retire(generation);
      }
      inFlightRenders.delete(inFlight);
    }
  }
}
