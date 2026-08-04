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
 */

import { percentChange, subtract } from "@drop-watch/core/decimal";
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
 * With exactly one listing per product (true for every product until listings
 * become independently manageable), the product-level fields below equal that
 * one listing's — which is what keeps this behaviour-identical to the
 * pre-split shape.
 */
export function summarise(
  product: Product,
  listingRows: Listing[],
  samples: PriceSample[],
  runs: CheckRun[]
): ProductSummary {
  const latest = samples.at(-1) ?? null;
  const previous = samples.at(-2) ?? null;
  const activeNextCheckTimes = listingRows
    .filter((listing) => listing.active)
    .map((listing) => listing.nextCheckAt.getTime());
  return {
    changePercent: latest && previous ? percentChange(previous.price, latest.price) : null,
    consecutiveFailures: countLeadingFailures(runs),
    history: samples,
    lastCheck: runs[0] ?? null,
    latest,
    listings: listingRows.map((listing) => summariseListing(listing, samples, runs)),
    nextCheckAt:
      activeNextCheckTimes.length > 0 ? new Date(Math.min(...activeNextCheckTimes)) : null,
    previous,
    product,
    targetDelta: latest && product.targetPrice ? subtract(latest.price, product.targetPrice) : null,
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
