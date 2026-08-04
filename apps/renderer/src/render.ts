/**
 * The one file in this package allowed to import Playwright.
 *
 * Scope, matching `packages/core/src/fetch/index.ts`: sites with active bot
 * protection are unsupported and we do not escalate against them. This exists
 * for pages that build their own DOM in JavaScript, not for pages that don't
 * want us — no `playwright-extra`, no stealth plugins, no fingerprint
 * spoofing, no UA games beyond Chromium's default, no CAPTCHA anything.
 */

import { checkPeerAddress, checkUrl, type UrlVerdict } from "@drop-watch/core/net/guard";
import type { RenderRequest, RenderResponse } from "@drop-watch/core/render/contract";
import {
  DEFAULT_RENDER_MAX_BYTES,
  DEFAULT_RENDER_TIMEOUT_MS,
  MAX_RENDER_TIMEOUT_MS,
} from "@drop-watch/core/render/contract";
import { log } from "evlog";
import type { Browser, BrowserContext, Page, Response as PlaywrightResponse } from "playwright";
import { chromium } from "playwright";
import {
  classifyError,
  exceedsByteCap,
  isInertScheme,
  shouldBlockResource,
  stalledFor,
} from "./classify";

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
const CONTEXT_CLOSE_TIMEOUT_MS = 5000;

/**
 * One long-lived browser process, a fresh `BrowserContext` per request rather
 * than a page pool. A context costs tens of milliseconds against a
 * multi-second page load — not worth pooling for — and buys two things
 * pooling would give up: no cookie or storage bleed between two retailers
 * (this tracker holds no sessions and must never accidentally acquire one),
 * and a page a caller forgets to close is structurally unable to pin memory,
 * because the whole context it lives in is closed in `finally`.
 */
let browser: Browser | null = null;
/**
 * Single in-flight launch promise so N concurrent requests arriving while
 * nothing has launched yet cannot each start their own `chromium.launch()`.
 * The check-then-set below has no `await` in between, so it is atomic with
 * respect to other calls on the same event loop.
 */
let launching: Promise<Browser> | null = null;

async function ensureBrowser(): Promise<Browser> {
  if (browser?.isConnected()) {
    return browser;
  }
  if (!launching) {
    launching = chromium.launch().then(
      (launched) => {
        browser = launched;
        launching = null;
        return launched;
      },
      (error: unknown) => {
        launching = null;
        throw error;
      }
    );
  }
  return await launching;
}

/** For `/healthz`: whether a browser process is currently up. */
export function browserStatus(): "connected" | "idle" {
  return browser?.isConnected() ? "connected" : "idle";
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
export async function closeBrowser(): Promise<void> {
  if (launching) {
    await launching.catch(() => undefined);
  }
  if (browser) {
    await browser.close().catch(() => undefined);
    browser = null;
  }
}

/** Rejects with a Playwright-shaped `TimeoutError` after `ms`, whichever finishes first wins the race. */
function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`render exceeded its ${ms}ms budget`);
      error.name = "TimeoutError";
      reject(error);
    }, ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/**
 * What the address guard saw during one render. The first refusal is enough to
 * throw the render away; keeping its reason turns Chromium's opaque
 * `net::ERR_BLOCKED_BY_CLIENT` back into a sentence about an address.
 */
interface GuardState {
  refusal: string | null;
  /** Peer-address verifications still in flight, awaited before the HTML is trusted. */
  settling: Promise<void>[];
}

/**
 * Blocks requests to non-public addresses, and verifies afterwards that the
 * responses that did arrive came from where the check said they would.
 *
 * Chromium resolves DNS in its own process, leaving a gap between our
 * resolution and the browser's; reading the peer address back closes it.
 * Subresources are covered as well as the document — a script fetching an
 * internal endpoint and writing the reply into JSON-LD is why browser mode
 * raises the stakes.
 */
async function installAddressGuard(context: BrowserContext, state: GuardState): Promise<void> {
  // One verdict per origin per render, so a page pulling forty assets off one
  // CDN does not resolve it forty times.
  const verdicts = new Map<string, Promise<UrlVerdict>>();
  const verdictFor = (url: string): Promise<UrlVerdict> => {
    const { origin } = new URL(url);
    const cached = verdicts.get(origin);
    if (cached) {
      return cached;
    }
    const verdict = checkUrl(url);
    verdicts.set(origin, verdict);
    return verdict;
  };

  context.on("response", (response) => {
    state.settling.push(verifyPeerAddress(response, state));
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
    const verdict = await verdictFor(url);
    if (verdict.ok) {
      await route.continue();
      return;
    }
    state.refusal ??= verdict.reason;
    await route.abort("blockedbyclient");
  });
}

/** Reads back the address a response came from. Not every response has one. */
async function verifyPeerAddress(response: PlaywrightResponse, state: GuardState): Promise<void> {
  try {
    const url = new URL(response.url());
    if (isInertScheme(response.url())) {
      return;
    }
    const peer = await response.serverAddr();
    if (!peer) {
      return;
    }
    const verdict = checkPeerAddress(peer.ipAddress, url.hostname);
    if (!verdict.ok) {
      state.refusal ??= verdict.reason;
    }
  } catch {
    // A response served from cache or a worker has no peer to read, which is
    // not a signal either way.
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
async function closeContext(context: BrowserContext | null): Promise<void> {
  if (!context) {
    return;
  }
  try {
    await withDeadline(context.close(), CONTEXT_CLOSE_TIMEOUT_MS);
  } catch {
    log.warn("renderer", "context close timed out; dropping the browser");
    await closeBrowser();
  }
}

/**
 * Renders one page and returns a contract-shaped result. Never throws —
 * every Playwright failure is caught and mapped by {@link classifyError}.
 */
export async function renderPage(request: RenderRequest): Promise<RenderResponse> {
  const startedAt = Date.now();
  const budgetMs = request.timeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS;
  const maxBytes = request.maxBytes ?? DEFAULT_RENDER_MAX_BYTES;
  const elapsed = () => Date.now() - startedAt;

  const guard: GuardState = { refusal: null, settling: [] };
  const inFlight = { startedAt };
  inFlightRenders.add(inFlight);
  let context: BrowserContext | null = null;
  try {
    const activeBrowser = await ensureBrowser();
    context = await activeBrowser.newContext({
      ...(request.locale ? { locale: request.locale } : {}),
      ...(request.userAgent ? { userAgent: request.userAgent } : {}),
    });
    await installAddressGuard(context, guard);
    const page = await context.newPage();

    const { html, response } = await withDeadline(navigate(page, request, budgetMs), budgetMs);

    // Let the peer-address checks land before `html` is trusted.
    await Promise.allSettled(guard.settling);
    if (guard.refusal) {
      return { durationMs: elapsed(), error: guard.refusal, status: "network_error" };
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
    // A blocked main document surfaces as `net::ERR_BLOCKED_BY_CLIENT`, which
    // says nothing useful.
    if (guard.refusal) {
      return { durationMs: elapsed(), error: guard.refusal, status: "network_error" };
    }
    return classifyError(error, elapsed());
  } finally {
    await closeContext(context);
    inFlightRenders.delete(inFlight);
  }
}
