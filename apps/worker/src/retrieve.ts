/**
 * The pure half of "how should this listing be retrieved".
 *
 * Deliberately free of database, environment and network imports — both
 * imports below are type-only and erased at runtime — so the decision can be
 * tested without a `DATABASE_URL`. `check-listing.ts` owns the half that
 * actually fetches, and that half cannot be imported without a database.
 */

import type { RendererFault } from "@drop-watch/core/render";
import type { Listing } from "@drop-watch/db/schema/products";

/** Extracted so the test can assert on it without duplicating the string. */
export const RENDER_UNCONFIGURED_ERROR =
  "browser rendering is not configured (RENDER_URL is unset)";

/**
 * Decides how a listing's page should be retrieved. Pure and directly
 * testable, unlike `retrievePage` itself, which needs a live sidecar.
 */
export function renderTarget(
  listing: Pick<Listing, "render">,
  renderUrl: string | undefined
): "http" | "browser" | "unconfigured" {
  if (listing.render !== "browser") {
    return "http";
  }
  return renderUrl ? "browser" : "unconfigured";
}

/**
 * Synthesised result for a browser-mode listing with no sidecar configured.
 * Flows through `toCheckOutcome` into a real `check_runs` row — visible in the
 * log and able to trip the watch-broken alarm — rather than crashing the worker.
 */
export function unconfiguredRenderResult(): RendererFault {
  return { durationMs: 0, error: RENDER_UNCONFIGURED_ERROR, status: "renderer_error" };
}
