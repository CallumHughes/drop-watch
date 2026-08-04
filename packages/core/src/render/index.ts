/**
 * HTTP client for the renderer sidecar — the browser-render sibling of
 * `../fetch`. Same contract, different transport: a JSON POST to the sidecar
 * instead of a direct GET to the origin.
 *
 * Undici only, no Playwright import anywhere in this package: `packages/core`
 * is reachable from the Next.js bundle, and the sidecar is the only process
 * allowed to hold a browser.
 */

import { fetch as undiciFetch } from "undici";
import type { FetchPageResult } from "../fetch/index";
import type { RenderRequest, RenderResponse } from "./contract";
import { DEFAULT_RENDER_TIMEOUT_MS, RENDER_PATH, renderResponseSchema } from "./contract";

/** The sidecar answers with a plain 200 whenever the render ran at all. */
const HTTP_OK = 200;

/**
 * Extra time given to the client deadline beyond the budget handed to the
 * sidecar, so a sidecar that answers its own `timeout` variant properly wins
 * the race. Without this slack, the client and the sidecar would abort at
 * roughly the same instant and the caller would get a generic client-side
 * abort instead of the sidecar's more accurate `timeout` result.
 */
const RENDER_CLIENT_SLACK_MS = 2000;

export interface RenderPageOptions {
  locale?: string;
  maxBytes?: number;
  /** Caller cancellation, combined with the internal timeout. */
  signal?: AbortSignal;
  timeoutMs?: number;
  userAgent?: string;
  waitUntil?: "load" | "domcontentloaded";
}

function isTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const causeName = error.cause instanceof Error ? error.cause.name : "";
  const names = new Set(["AbortError", "BodyTimeoutError", "HeadersTimeoutError", "TimeoutError"]);
  return names.has(error.name) || names.has(causeName);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? `: ${error.cause.message}` : "";
    return `${error.message}${cause}`;
  }
  return String(error);
}

/**
 * Maps a wire `RenderResponse` onto `FetchPageResult`. Near-identity: the only
 * real work is `html` → `body`. Never emits `etag`/`lastModified` — a browser
 * render carries no cache validators, and `buildWrite` in the worker already
 * guards on their absence.
 */
export function toFetchResult(response: RenderResponse): FetchPageResult {
  switch (response.status) {
    case "http_error":
      return {
        durationMs: response.durationMs,
        error: response.error,
        httpStatus: response.httpStatus,
        status: "http_error",
      };
    case "network_error":
      return {
        durationMs: response.durationMs,
        error: response.error,
        status: "network_error",
      };
    case "ok":
      return {
        body: response.html,
        durationMs: response.durationMs,
        httpStatus: response.httpStatus,
        status: "ok",
        url: response.url,
      };
    case "timeout":
      return {
        durationMs: response.durationMs,
        error: response.error,
        status: "timeout",
      };
    default:
      return response satisfies never;
  }
}

/**
 * Renders a page through the sidecar at `baseUrl`. Never throws — every
 * failure mode, including a bad `baseUrl` or an unreachable sidecar, comes
 * back as a `FetchPageResult` variant, exactly like `fetchPage`, because
 * `apps/worker/src/check-listing.ts` relies on that contract.
 *
 * No retries. `fetchWithRetries` exists for transient transport failures on a
 * flaky origin; a broken sidecar is not that — a 5xx from it means the
 * renderer itself is unhealthy, not that the retailer hiccuped. A browser
 * render is also expensive enough that a blind retry would double the worst
 * case for no expected gain.
 */
export async function renderPage(
  baseUrl: string,
  url: string,
  options: RenderPageOptions = {}
): Promise<FetchPageResult> {
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;

  let endpoint: URL;
  try {
    endpoint = new URL(RENDER_PATH, baseUrl);
  } catch (error) {
    return {
      durationMs: elapsed(),
      error: `invalid renderer base URL: ${errorMessage(error)}`,
      status: "network_error",
    };
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS;
  const request: RenderRequest = {
    timeoutMs,
    url,
    ...(options.locale ? { locale: options.locale } : {}),
    ...(options.maxBytes ? { maxBytes: options.maxBytes } : {}),
    ...(options.userAgent ? { userAgent: options.userAgent } : {}),
    ...(options.waitUntil ? { waitUntil: options.waitUntil } : {}),
  };

  const signals: AbortSignal[] = [AbortSignal.timeout(timeoutMs + RENDER_CLIENT_SLACK_MS)];
  if (options.signal) {
    signals.push(options.signal);
  }

  try {
    const response = await undiciFetch(endpoint, {
      body: JSON.stringify(request),
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: AbortSignal.any(signals),
    });

    // Non-200 is always the sidecar's own fault (malformed request, at
    // capacity, shutting down) — never the store's — so it is reported the
    // same way regardless of which status it is.
    if (response.status !== HTTP_OK) {
      return {
        durationMs: elapsed(),
        error: `renderer responded ${response.status}`,
        status: "network_error",
      };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      return {
        durationMs: elapsed(),
        error: `renderer returned invalid JSON: ${errorMessage(error)}`,
        status: "network_error",
      };
    }

    const parsed = renderResponseSchema.safeParse(payload);
    if (!parsed.success) {
      return {
        durationMs: elapsed(),
        error: `renderer returned a malformed response: ${parsed.error.message}`,
        status: "network_error",
      };
    }

    return toFetchResult(parsed.data);
  } catch (error) {
    if (isTimeout(error)) {
      return {
        durationMs: elapsed(),
        error: `timed out after ${timeoutMs}ms`,
        status: "timeout",
      };
    }
    return {
      durationMs: elapsed(),
      error: `renderer unreachable: ${errorMessage(error)}`,
      status: "network_error",
    };
  }
}
