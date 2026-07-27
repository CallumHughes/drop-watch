/**
 * The pure half of the products router: what a price series and a run of check
 * attempts add up to on a product card, and what a changed interval implies for
 * the schedule.
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

import { percentChange, subtract } from "@price-tracker/core/decimal";
import { countLeadingFailures } from "@price-tracker/core/rules";
import type { CheckRun, Product } from "@price-tracker/db/schema/products";

/** One observation. `price` is a decimal string; `inStock` is null when unknown. */
export interface PriceSample {
  /** The currency the page quoted, which is what `price` is denominated in. */
  currency: string;
  inStock: boolean | null;
  observedAt: Date;
  price: string;
}

/** The `check_run_status` enum, as a union. */
export type CheckStatus = CheckRun["status"];

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
  previous: PriceSample | null;
  product: Product;
  /** `latest - targetPrice`. Zero or negative means the target has been met. */
  targetDelta: string | null;
}

/**
 * Assembles one card from the three things the router fetched for it. `samples`
 * must be oldest-first and `runs` newest-first — the orderings the queries
 * already produce.
 */
export function summarise(
  product: Product,
  samples: PriceSample[],
  runs: CheckRun[]
): ProductSummary {
  const latest = samples.at(-1) ?? null;
  const previous = samples.at(-2) ?? null;
  return {
    changePercent: latest && previous ? percentChange(previous.price, latest.price) : null,
    consecutiveFailures: countLeadingFailures(runs),
    history: samples,
    lastCheck: runs[0] ?? null,
    latest,
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
 * Without this, dropping a product from daily to five-minutely changes nothing
 * until the already-scheduled check finally lands up to a day later, which
 * reads as the setting having been ignored. It only ever moves the next check
 * earlier — lengthening an interval must not push back a check that is already
 * due, and the worker applies the new interval with jitter from then on.
 */
export function pulledInNextCheckAt(
  product: Pick<Product, "nextCheckAt">,
  intervalMinutes: number | undefined,
  now: Date
): Date | undefined {
  if (intervalMinutes === undefined) {
    return;
  }
  const soonest = new Date(now.getTime() + intervalMinutes * MS_PER_MINUTE);
  return soonest < product.nextCheckAt ? soonest : undefined;
}
