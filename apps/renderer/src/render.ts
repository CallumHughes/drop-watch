/**
 * The one file in this package allowed to import Playwright.
 *
 * Scope, matching `packages/core/src/fetch/index.ts`: sites with active bot
 * protection are unsupported and we do not escalate against them. This exists
 * for pages that build their own DOM in JavaScript, not for pages that don't
 * want us — no `playwright-extra`, no stealth plugins, no fingerprint
 * spoofing, no UA games beyond Chromium's default, no CAPTCHA anything.
 */

import type { RenderRequest, RenderResponse } from "@drop-watch/core/render/contract";
import {
  DEFAULT_RENDER_MAX_BYTES,
  DEFAULT_RENDER_TIMEOUT_MS,
} from "@drop-watch/core/render/contract";
import type { Browser, BrowserContext, Page, Response as PlaywrightResponse } from "playwright";
import { chromium } from "playwright";
import { classifyError, exceedsByteCap, shouldBlockResource } from "./classify";

/**
 * Best-effort settle after `goto` resolves, to catch SPA hydration that keeps
 * firing requests after the `domcontentloaded`/`load` event. Playwright
 * discourages `networkidle` as a `goto` *condition* because it hangs forever
 * on any page with polling or analytics beacons; used here afterwards, on its
 * own small budget, with the timeout swallowed, it costs ~3s on pages that
 * never idle and buys real content on the ones that do.
 */
const NETWORK_IDLE_MS = 3000;

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
 * Renders one page and returns a contract-shaped result. Never throws —
 * every Playwright failure is caught and mapped by {@link classifyError}.
 */
export async function renderPage(request: RenderRequest): Promise<RenderResponse> {
  const startedAt = Date.now();
  const budgetMs = request.timeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS;
  const maxBytes = request.maxBytes ?? DEFAULT_RENDER_MAX_BYTES;
  const elapsed = () => Date.now() - startedAt;

  let context: BrowserContext | null = null;
  try {
    const activeBrowser = await ensureBrowser();
    context = await activeBrowser.newContext({
      ...(request.locale ? { locale: request.locale } : {}),
      ...(request.userAgent ? { userAgent: request.userAgent } : {}),
    });
    await context.route("**/*", (route) =>
      shouldBlockResource(route.request().resourceType()) ? route.abort() : route.continue()
    );
    const page = await context.newPage();

    const { html, response } = await withDeadline(navigate(page, request, budgetMs), budgetMs);

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
    return classifyError(error, elapsed());
  } finally {
    await context?.close();
  }
}
