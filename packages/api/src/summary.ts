/**
 * The pure half of the products router: what a price series and a run of check
 * attempts add up to on a product card — and on each of its listings — plus
 * what a changed interval implies for a listing's schedule.
 *
 * Kept apart from `routers/products.ts` because none of it touches the
 * database — the router does the querying, this does the arithmetic, and that
 * split is what makes the failure badge, the target distance and the schedule
 * clamp unit-testable without a Postgres connection.
 *
 * The failure streak itself comes from `core/rules` rather than being counted
 * again here: the dashboard's badge and the worker's "tracker broken" alarm
 * have to mean the same thing by "failing", and one implementation is how that
 * stays true.
 *
 * A product can have several listings, so every product-level field below is
 * derived, not copied from a single row:
 *
 * - `latest`/`previous`/`changePercent`/`history`/`cheapestListingId` all come
 *   from the cheapest *active* listing's current sample, in the product's own
 *   currency — `core/decimal`'s `cheapestByMinorUnits`, the same helper the
 *   worker uses to pick the `target` rule's subject, so the dashboard and the
 *   alert that fires never disagree about which listing "the" price is. A
 *   listing quoted in a different currency than the product (a retailer that
 *   has not re-extracted since a geo-flip) is excluded rather than compared on
 *   raw numbers. `previous`/`changePercent`/`history` are that one listing's
 *   own series — there is no cross-store "previous price".
 * - `consecutiveFailures` is the *worst* streak across active listings, not a
 *   sum or an average: one broken store is enough to say the tracker needs
 *   attention, and a healthy second store must not hide that.
 * - `lastCheck` is the most recent check run across every listing, active or
 *   not, so a paused listing's last attempt still explains "why did this stop
 *   moving".
 * - `nextCheckAt` is unchanged from before: the soonest scheduled check across
 *   active listings.
 */

import { cheapestByMinorUnits, percentChange, subtract } from "@drop-watch/core/decimal";
import { countLeadingFailures } from "@drop-watch/core/rules";
import type { CheckRun, Listing, Product } from "@drop-watch/db/schema/products";

/** One observation. `price` is a decimal string; `inStock` is null when unknown. */
export interface PriceSample {
  /** Bare schema.org token, e.g. "InStock". Null when the page said nothing usable. */
  availability: string | null;
  /** The currency the page quoted, which is what `price` is denominated in. */
  currency: string;
  inStock: boolean | null;
  /** Which listing this observation was recorded against. */
  listingId: string;
  observedAt: Date;
  price: string;
}

/** The `check_run_status` enum, as a union. */
export type CheckStatus = CheckRun["status"];

/** One listing's worth of derived state — a product card can hold several. */
export interface ListingSummary {
  /** Signed percentage from the previous point to the latest, one decimal place. */
  changePercent: string | null;
  /** Length of the current run of non-`ok` checks. Zero means healthy. */
  consecutiveFailures: number;
  /** Oldest first, so a sparkline can be drawn straight from it. */
  history: PriceSample[];
  lastCheck: CheckRun | null;
  latest: PriceSample | null;
  listing: Listing;
  previous: PriceSample | null;
}

/** A product card's worth of derived state. */
export interface ProductSummary {
  /** Signed percentage from the previous point to the latest, one decimal place. */
  changePercent: string | null;
  /**
   * The listing `latest` was drawn from — the id a card should highlight as
   * "the" store. `null` when no active listing has a current sample in the
   * product's own currency.
   */
  cheapestListingId: string | null;
  /** Length of the current run of non-`ok` checks. Zero means healthy. */
  consecutiveFailures: number;
  /** Oldest first, so a sparkline can be drawn straight from it. */
  history: PriceSample[];
  lastCheck: CheckRun | null;
  latest: PriceSample | null;
  /** Per-listing breakdown, oldest listing first. */
  listings: ListingSummary[];
  /** Earliest `nextCheckAt` across active listings; `null` when none are active. */
  nextCheckAt: Date | null;
  previous: PriceSample | null;
  product: Product;
  /** `latest - targetPrice`. Zero or negative means the target has been met. */
  targetDelta: string | null;
}

/** One listing's card, built by filtering the product's samples/runs down to it. */
function summariseListing(
  listing: Listing,
  samples: PriceSample[],
  runs: CheckRun[]
): ListingSummary {
  const ownSamples = samples.filter((sample) => sample.listingId === listing.id);
  const ownRuns = runs.filter((run) => run.listingId === listing.id);
  const latest = ownSamples.at(-1) ?? null;
  const previous = ownSamples.at(-2) ?? null;
  return {
    changePercent: latest && previous ? percentChange(previous.price, latest.price) : null,
    consecutiveFailures: countLeadingFailures(ownRuns),
    history: ownSamples,
    lastCheck: ownRuns[0] ?? null,
    latest,
    listing,
    previous,
  };
}

/**
 * Assembles one card from the four things the router fetched for it. `samples`
 * must be oldest-first and `runs` newest-first — the orderings the queries
 * already produce. `listingRows` is the product's own listings, oldest first.
 *
 * The per-listing breakdown is built first; every product-level field other
 * than `nextCheckAt` and `lastCheck` is then derived from it rather than from
 * `samples`/`runs` directly — see the module doc for what each one means with
 * more than one listing.
 */
export function summarise(
  product: Product,
  listingRows: Listing[],
  samples: PriceSample[],
  runs: CheckRun[]
): ProductSummary {
  const listingSummaries = listingRows.map((listing) => summariseListing(listing, samples, runs));

  // The `target` rule's subject, mirrored here: cheapest current sample among
  // active listings, restricted to the product's own currency so a listing
  // that has geo-flipped currency and not yet re-extracted is not compared on
  // raw numbers against one that has.
  const currentSamples = listingSummaries
    .filter((summary) => summary.listing.active && summary.latest !== null)
    .map((summary) => summary.latest as PriceSample)
    .filter((sample) => !product.currency || sample.currency === product.currency);
  const cheapest = cheapestByMinorUnits(currentSamples);
  const cheapestListing = cheapest
    ? listingSummaries.find((summary) => summary.listing.id === cheapest.listingId)
    : undefined;

  const activeNextCheckTimes = listingRows
    .filter((listing) => listing.active)
    .map((listing) => listing.nextCheckAt.getTime());
  const activeFailureStreaks = listingSummaries
    .filter((summary) => summary.listing.active)
    .map((summary) => summary.consecutiveFailures);

  return {
    changePercent: cheapestListing?.changePercent ?? null,
    cheapestListingId: cheapest?.listingId ?? null,
    consecutiveFailures: activeFailureStreaks.length > 0 ? Math.max(...activeFailureStreaks) : 0,
    history: cheapestListing?.history ?? [],
    lastCheck: runs[0] ?? null,
    latest: cheapest,
    listings: listingSummaries,
    nextCheckAt:
      activeNextCheckTimes.length > 0 ? new Date(Math.min(...activeNextCheckTimes)) : null,
    previous: cheapestListing?.previous ?? null,
    product,
    targetDelta:
      cheapest && product.targetPrice ? subtract(cheapest.price, product.targetPrice) : null,
  };
}

const MS_PER_MINUTE = 60_000;

/**
 * The `nextCheckAt` a shortened interval implies, or `undefined` to leave the
 * existing schedule alone.
 *
 * Without this, dropping a listing from daily to five-minutely changes nothing
 * until the already-scheduled check finally lands up to a day later, which
 * reads as the setting having been ignored. It only ever moves the next check
 * earlier — lengthening an interval must not push back a check that is already
 * due, and the worker applies the new interval with jitter from then on.
 */
export function pulledInNextCheckAt(
  listing: Pick<Listing, "nextCheckAt">,
  intervalMinutes: number | undefined,
  now: Date
): Date | undefined {
  if (intervalMinutes === undefined) {
    return;
  }
  const soonest = new Date(now.getTime() + intervalMinutes * MS_PER_MINUTE);
  return soonest < listing.nextCheckAt ? soonest : undefined;
}
