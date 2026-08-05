/**
 * How fast the product page polls while it is waiting for a check it asked
 * for.
 *
 * "Check now" only enqueues a job: the mutation resolves in milliseconds and
 * the worker finishes a moment later, but the page's live queries are on a
 * {@link LIVE_REFETCH_MS} interval, so a result that existed after one second
 * could take fifteen to appear. Rather than shorten that interval for every
 * page all the time — most of which are watching nothing happen — the page
 * polls quickly for the short window when it knows an answer is coming.
 */

import type { ListingSummary } from "@drop-watch/api/routers/products";

import { LIVE_REFETCH_MS } from "./format";

/** Poll interval while a requested check is outstanding. */
export const CHECK_REFETCH_MS = 1000;

/**
 * How long to keep polling quickly before giving up and going back to the
 * normal interval. Long enough for a slow retailer plus the fetch layer's
 * retries, short enough that a check which never lands — a listing
 * deactivated mid-flight, a worker that died — cannot leave the page polling
 * at 1Hz forever.
 */
export const CHECK_WAIT_CAP_MS = 45_000;

/**
 * A check this page asked for and has not seen the result of.
 *
 * Two clocks, deliberately. `queuedAt` is the server's, compared only against
 * server-stamped check-run times, so a browser whose clock is off cannot make
 * a stale check look like a fresh one. `expiresAt` is the browser's own
 * monotonic-enough wall clock, measuring a duration from the moment the
 * response arrived — a cap computed across the two clocks would be skewed by
 * their difference and could expire before it began.
 */
export interface PendingCheck {
  expiresAt: number;
  queuedAt: Date;
}

/** Whether any active listing has yet to report a check from this request. */
function awaitingResult(listings: readonly ListingSummary[], queuedAt: Date): boolean {
  return listings.some((summary) => {
    if (!summary.listing.active) {
      return false;
    }
    const startedAt = summary.lastCheck?.startedAt;
    return !startedAt || new Date(startedAt).getTime() < queuedAt.getTime();
  });
}

/**
 * The interval the detail page's live queries should be on right now.
 *
 * Recomputed on every render, which while polling quickly means once a
 * second — so the moment the last listing reports back, or the cap runs out,
 * the next interval is the normal one again.
 */
export function checkRefetchInterval(
  listings: readonly ListingSummary[] | undefined,
  pending: PendingCheck | null,
  now: number
): number {
  if (!(pending && listings) || now >= pending.expiresAt) {
    return LIVE_REFETCH_MS;
  }
  return awaitingResult(listings, pending.queuedAt) ? CHECK_REFETCH_MS : LIVE_REFETCH_MS;
}
