/**
 * Pure helpers for turning a Playwright failure, or a rendered page, into a
 * {@link RenderResponse}. No Playwright import here on purpose — this is the
 * one file in the package that unit tests can exercise without Chromium.
 */

import type { RenderResponse } from "@drop-watch/core/render/contract";

/** Resource types blocked before they reach the network. */
const BLOCKED_RESOURCE_TYPES = new Set(["font", "image", "media"]);

const TIMEOUT_ERROR_NAME = "TimeoutError";

/** `.name`, read structurally rather than via `instanceof Error` — Playwright's own `TimeoutError` qualifies, but so does any error-shaped value a mock or a future Playwright version might throw. */
function nameOf(value: unknown): string | undefined {
  if (typeof value === "object" && value !== null && "name" in value) {
    const { name } = value as { name?: unknown };
    return typeof name === "string" ? name : undefined;
  }
}

function causeOf(value: unknown): unknown {
  if (typeof value === "object" && value !== null && "cause" in value) {
    return (value as { cause?: unknown }).cause;
  }
}

function isTimeout(error: unknown): boolean {
  return nameOf(error) === TIMEOUT_ERROR_NAME || nameOf(causeOf(error)) === TIMEOUT_ERROR_NAME;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? `: ${error.cause.message}` : "";
    return `${error.message}${cause}`;
  }
  return String(error);
}

/**
 * Maps whatever `render()` threw onto the wire contract. Mirrors
 * `isTimeout`/`errorMessage` in `packages/core/src/fetch/index.ts` so the two
 * paths fail the same way for the same underlying cause.
 */
export function classifyError(error: unknown, durationMs: number): RenderResponse {
  if (isTimeout(error)) {
    return { durationMs, error: "timed out after render budget", status: "timeout" };
  }
  // A `net::ERR_*` message (DNS failure, connection reset, ...) and anything
  // else both land here: neither is a timeout, and the contract has no finer
  // bucket than "network_error" for the rest.
  return { durationMs, error: errorMessage(error), status: "network_error" };
}

/**
 * `image`, `media` and `font` do not participate in DOM construction. Keep
 * stylesheets: page JavaScript can wait for their load event or inspect the
 * CSSOM before composing the product data that this renderer exists to expose.
 */
export function shouldBlockResource(resourceType: string): boolean {
  return BLOCKED_RESOURCE_TYPES.has(resourceType);
}

/**
 * How long the oldest in-flight render has been running past `thresholdMs`, or
 * `null` when nothing is overdue. `isConnected()` stays true of a Chromium that
 * has stopped completing anything, so liveness is measured this way instead.
 */
export function stalledFor(
  oldestStartedAt: number | null,
  now: number,
  thresholdMs: number
): number | null {
  if (oldestStartedAt === null) {
    return null;
  }
  const age = now - oldestStartedAt;
  return age > thresholdMs ? age : null;
}

/**
 * Schemes that resolve inside the browser and never open a socket, so the
 * address guard has nothing to say about them. Everything else non-http(s) is
 * refused.
 */
const INERT_SCHEMES = new Set(["about:", "blob:", "data:"]);

export function isInertScheme(url: string): boolean {
  const separator = url.indexOf(":");
  return separator === -1 ? false : INERT_SCHEMES.has(url.slice(0, separator + 1).toLowerCase());
}

/**
 * Byte count when `html` exceeds `maxBytes`, else `null`. Counts UTF-8 bytes,
 * not UTF-16 code units, so a multibyte-heavy page is measured the way it
 * will actually be sent.
 *
 * Unlike the fetch layer's cap, this is not a streaming guard — by the time
 * `page.content()` returns, the whole DOM already sits in process memory.
 * This exists only to stop an oversized string crossing the wire to the
 * worker and landing in its logs.
 */
export function exceedsByteCap(html: string, maxBytes: number): number | null {
  const byteCount = Buffer.byteLength(html, "utf8");
  return byteCount > maxBytes ? byteCount : null;
}
