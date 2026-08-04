/**
 * Turns a fetch result plus an extraction result into the row that goes into
 * `check_runs`.
 *
 * Kept pure and separate from the orchestration in `check-listing.ts` because
 * this mapping is the part that is easy to get subtly wrong (a 304 is a
 * success; a dead hostname is not an HTTP error) and the part Epic 7's
 * consecutive-failure alarm depends on. The table it implements is documented
 * on the `check_run_status` enum in `@drop-watch/db/schema/products`.
 */

import type { ExtractionResult } from "@drop-watch/core/extract";
import type { RetrieveResult } from "@drop-watch/core/render";
import type { checkRunStatus, ExtractorUsed } from "@drop-watch/db/schema/products";

export type CheckRunStatus = (typeof checkRunStatus.enumValues)[number];

export interface CheckOutcome {
  error?: string;
  extractorUsed?: ExtractorUsed;
  httpStatus?: number;
  /** True only when there is a price *and* a currency worth recording. */
  recordPricePoint: boolean;
  status: CheckRunStatus;
}

/**
 * @param currency - the currency to store, already resolved from the page and
 *   the product's configured fallback. `null` when neither supplied one, which
 *   is an extraction failure rather than a reason to invent a currency: a bare
 *   number with no unit is not a price.
 */
export function toCheckOutcome(
  fetched: RetrieveResult,
  extraction: ExtractionResult | null,
  currency: string | null
): CheckOutcome {
  switch (fetched.status) {
    // A 304 means the page has not changed since our last successful fetch.
    // That is a healthy check with nothing new to record — no price point, and
    // deliberately not its own status, or Epic 7 would alarm on a fine product.
    case "not_modified":
      return { httpStatus: fetched.httpStatus, recordPricePoint: false, status: "ok" };
    case "http_error":
      return {
        error: fetched.error,
        httpStatus: fetched.httpStatus,
        recordPricePoint: false,
        status: "http_error",
      };
    case "network_error":
      return { error: fetched.error, recordPricePoint: false, status: "network_error" };
    // The sidecar's own fault, not the store's — see the enum's doc comment.
    case "renderer_error":
      return { error: fetched.error, recordPricePoint: false, status: "renderer_error" };
    case "timeout":
      return { error: fetched.error, recordPricePoint: false, status: "timeout" };
    default:
      break;
  }

  if (!extraction) {
    return {
      error: "no extraction attempted",
      httpStatus: fetched.httpStatus,
      recordPricePoint: false,
      status: "extract_failed",
    };
  }

  if (!extraction.ok) {
    return {
      error: extraction.error,
      httpStatus: fetched.httpStatus,
      recordPricePoint: false,
      status: "extract_failed",
    };
  }

  if (!currency) {
    return {
      error: `price ${extraction.price} found via ${extraction.strategy} but no currency (page gave none and the product has none configured)`,
      extractorUsed: extraction.strategy,
      httpStatus: fetched.httpStatus,
      recordPricePoint: false,
      status: "extract_failed",
    };
  }

  return {
    extractorUsed: extraction.strategy,
    httpStatus: fetched.httpStatus,
    recordPricePoint: true,
    status: "ok",
  };
}
