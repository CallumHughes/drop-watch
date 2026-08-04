/**
 * The one file in this package allowed to import Playwright.
 *
 * Scope, matching `packages/core/src/fetch/index.ts`: sites with active bot
 * protection are unsupported and we do not escalate against them. This exists
 * for pages that build their own DOM in JavaScript, not for pages that don't
 * want us — no `playwright-extra`, no stealth plugins, no fingerprint
 * spoofing, no UA games beyond Chromium's default, no CAPTCHA anything.
 */

import { checkUrlScheme } from "@drop-watch/core/net/guard";
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
const CONTEXT_SETUP_TIMEOUT_MS = 5000;

interface ManagedBrowser {
  browser: Browser;
  server: BrowserServer;
}

async function launchBrowser(): Promise<ManagedBrowser> {
  let server: BrowserServer | null = null;
  try {
    server = await chromium.launchServer({
      args: [
        "--disable-quic",
        "--dns-prefetch-disable",
        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
      ],
      timeout: BROWSER_SERVER_LAUNCH_TIMEOUT_MS,
    });
    const browser = await chromium.connect(server.wsEndpoint(), {
      timeout: BROWSER_CONNECT_TIMEOUT_MS,
    });
    return { browser, server };
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
    const contextPromise = acquired.handle.browser.newContext({
      proxy: { bypass: "<-loopback>", server: proxy.server },
      serviceWorkers: "block",
      ...(request.locale ? { locale: request.locale } : {}),
      ...(request.userAgent ? { userAgent: request.userAgent } : {}),
    });
    try {
      context = await withDeadline(
        contextPromise,
        CONTEXT_SETUP_TIMEOUT_MS,
        "browser context setup"
      );
    } catch (error) {
      // A timed-out protocol call can still resolve later. Close that late
      // context explicitly while retiring its browser generation below.
      contextPromise.then((lateContext) => lateContext.close()).catch(() => undefined);
      browserManager.retire(generation);
      throw error;
    }

    let page: Page;
    try {
      await withDeadline(
        installAddressGuard(context, guard),
        CONTEXT_SETUP_TIMEOUT_MS,
        "browser route setup"
      );
      page = await withDeadline(context.newPage(), CONTEXT_SETUP_TIMEOUT_MS, "page setup");
    } catch (error) {
      browserManager.retire(generation);
      throw error;
    }

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
