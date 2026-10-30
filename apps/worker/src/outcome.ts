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

import type { ExtractionEvidence, ExtractionResult } from "@drop-watch/core/extract";
import { challengeReason } from "@drop-watch/core/extract/challenge";
import { isAmbiguousExtraction } from "@drop-watch/core/extract/evidence";
import type { RetrieveResult } from "@drop-watch/core/render";
import type { checkRunStatus, ExtractorUsed, renderMode } from "@drop-watch/db/schema/products";

export type CheckRunStatus = (typeof checkRunStatus.enumValues)[number];
type RenderMode = (typeof renderMode.enumValues)[number];

export interface CheckOutcome {
  error?: string;
  extractorUsed?: ExtractorUsed;
  httpStatus?: number;
  /** True only when there is a price *and* a currency worth recording. */
  recordPricePoint: boolean;
  status: CheckRunStatus;
}

function evidenceDescription(evidence: ExtractionEvidence): string {
  if ("candidateCount" in evidence) {
    const candidates = evidence.candidateCount === 1 ? "candidate" : "candidates";
    return `${evidence.type}, ${evidence.candidateCount} ${candidates}`;
  }
  if ("matchCount" in evidence) {
    const matches = evidence.matchCount === 1 ? "match" : "matches";
    return `${evidence.type}, ${evidence.matchCount} ${matches}`;
  }
  return evidence.type;
}

function ambiguousError(extraction: Extract<ExtractionResult, { ok: true }>): string {
  return `ambiguous low-confidence extraction via ${extraction.strategy} (${evidenceDescription(extraction.evidence)}); no price point was recorded. Configure a selector or JSONPath to identify the intended price`;
}

/**
 * @param currency - the currency to store, already resolved from the page and
 *   the product's configured fallback. `null` when neither supplied one, which
 *   is an extraction failure rather than a reason to invent a currency: a bare
 *   number with no unit is not a price.
 * @param listing - the transport and URL this check used, for naming the host
 *   and giving the right advice in a bot-protection message. Only that message
 *   reads it, so it is optional.
 */
export function toCheckOutcome(
  fetched: RetrieveResult,
  extraction: ExtractionResult | null,
  currency: string | null,
  listing: { render?: RenderMode; url?: string } = {}
): CheckOutcome {
  switch (fetched.status) {
    // A 304 means the page has not changed since our last successful fetch.
    // That is a healthy check with nothing new to record — no price point, and
    // deliberately not its own status, or Epic 7 would alarm on a fine product.
    case "not_modified":
      return { httpStatus: fetched.httpStatus, recordPricePoint: false, status: "ok" };
    // A 403 from a bot-protection vendor is still an `http_error`, but "HTTP
    // 403" alone says nothing about what to do next.
    case "http_error":
      return {
        error:
          challengeReason("", {
            httpStatus: fetched.httpStatus,
            transport: listing.render,
            url: listing.url,
          }) ?? fetched.error,
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
    // An interstitial answers 200 with no product on it, so the chain's "no
    // price found" is true and useless. Name the block instead.
    return {
      error:
        challengeReason(fetched.body, {
          httpStatus: fetched.httpStatus,
          transport: listing.render,
          url: fetched.url,
        }) ?? extraction.error,
      httpStatus: fetched.httpStatus,
      recordPricePoint: false,
      status: "extract_failed",
    };
  }

  // Ambiguity, not low confidence: a sole price on a URL with a query
  // parameter, or an OpenGraph tag, is low-confidence but unambiguous and
  // still worth recording. See `@drop-watch/core/extract/evidence`.
  if (isAmbiguousExtraction(extraction)) {
    return {
      error: ambiguousError(extraction),
      extractorUsed: extraction.strategy,
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
