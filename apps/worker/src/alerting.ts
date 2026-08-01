/**
 * The alerting half of a check: decide, send, remember.
 *
 * `core/rules` decides (purely, against observations and dedupe state),
 * `core/notify` sends, and this module is the orchestration between them —
 * loading `alert_state`, writing it back, and keeping the whole thing off the
 * critical path of the check itself.
 *
 * That last part is the rule worth stating twice: **alerting must never fail a
 * check**. By the time anything here runs the price point and the
 * `check_runs` row are already committed, and every exit from this module is a
 * log line. Home Assistant being down costs you a notification, never a
 * measurement and never a pg-boss retry.
 *
 * `alert_state` is only written after a *successful* send, so a webhook that
 * was unreachable is retried on the next check instead of being silently
 * marked as delivered.
 *
 * An alert now goes out on more than one channel, so "a successful send" means
 * **any channel landed** — `deliverAlert`'s `delivered`. Deduping per channel
 * would be the wrong trade: `alert_state` is keyed by `(product, rule)`, and
 * splitting it per channel to re-send an email nobody received would also
 * re-send the notification that did arrive. One channel landing is enough to
 * consider the person told.
 *
 * Watch-broken dedupe does not live in `alert_state` — it is one alarm per
 * listing, so it lives on `listings.brokenReportedAt`: set when the alarm is
 * sent, cleared on the first ok check.
 *
 * `target` is the one rule not about the listing this check ran against — it
 * is about the product's cheapest *active* listing right now, so this module
 * loads that separately (`cheapestCurrentSample`) and hands it to `core/rules`
 * alongside the checked listing's own `latest`/`previous`.
 */

import { percentChange, toMinorUnits } from "@drop-watch/core/decimal";
import type { NotificationPayload } from "@drop-watch/core/notify";
import type { AlertChannel } from "@drop-watch/core/notify/channels";
import { deliverAlert } from "@drop-watch/core/notify/channels";
import { alertChannels } from "@drop-watch/core/notify/targets";
import type {
  AlertMemory,
  AlertRule,
  AlertStateKey,
  Observation,
  RuleTrigger,
} from "@drop-watch/core/rules";
import {
  cooldownMs,
  countLeadingFailures,
  evaluateAlerts,
  shouldReportBroken,
  WATCH_BROKEN,
} from "@drop-watch/core/rules";
import { db } from "@drop-watch/db";
import type { Listing, Product } from "@drop-watch/db/schema/products";
import { alertState, checkRuns, listings, pricePoints } from "@drop-watch/db/schema/products";
import type { Settings } from "@drop-watch/db/schema/settings";
import { alertTargets, loadSettings } from "@drop-watch/db/settings";
import { emailChannel, emailEnabled } from "@drop-watch/email";
import { and, desc, eq } from "drizzle-orm";
import { createLogger } from "evlog";

import type { CheckOutcome } from "./outcome";

/** Two points is all the rules need: the new observation and the one before. */
const OBSERVATION_WINDOW = 2;

/** One observation plus the currency it is denominated in. */
interface Sample extends Observation {
  currency: string;
}

/** A sample plus which listing it came from — what the `target` rule needs to name a store. */
type ListingSample = Sample & { listingId: string; url: string };

/** Everything the worker knows once a check has been committed. */
export interface AlertContext {
  listing: Listing;
  outcome: CheckOutcome;
  /** True when this check wrote a price point — the price rules need one. */
  pricePointWritten: boolean;
  product: Product;
}

/** The newest `limit` observations for a listing, newest first. */
async function recentSamples(listingId: string, limit: number): Promise<Sample[]> {
  return await db
    .select({
      currency: pricePoints.currency,
      inStock: pricePoints.inStock,
      price: pricePoints.price,
    })
    .from(pricePoints)
    .where(eq(pricePoints.listingId, listingId))
    .orderBy(desc(pricePoints.observedAt), desc(pricePoints.id))
    .limit(limit);
}

/**
 * The latest price point of every active listing of a product, in the
 * product's currency. `DISTINCT ON (listing_id)` ordered by `observed_at
 * DESC, id DESC` is "latest per listing" in one query rather than N.
 *
 * When `product.currency` is null the product has never had a successful
 * extraction, so at most one listing can have data — nothing to filter.
 */
async function latestSampleByListing(product: Product): Promise<ListingSample[]> {
  const conditions = [eq(listings.productId, product.id), eq(listings.active, true)];
  if (product.currency) {
    conditions.push(eq(pricePoints.currency, product.currency));
  }
  return await db
    .selectDistinctOn([pricePoints.listingId], {
      currency: pricePoints.currency,
      inStock: pricePoints.inStock,
      listingId: pricePoints.listingId,
      price: pricePoints.price,
      url: listings.url,
    })
    .from(pricePoints)
    .innerJoin(listings, eq(pricePoints.listingId, listings.id))
    .where(and(...conditions))
    .orderBy(pricePoints.listingId, desc(pricePoints.observedAt), desc(pricePoints.id));
}

/**
 * The cheapest of a set of samples by minor units of price. Pure, and
 * exported for unit testing: this is the one piece of `cheapestCurrentSample`
 * worth testing without a Postgres connection, since the query itself is not
 * something a unit test can usefully exercise.
 */
export function cheapestByMinorUnits<T extends { price: string }>(rows: readonly T[]): T | null {
  return rows.reduce<T | null>(
    (min, row) => (min === null || toMinorUnits(row.price) < toMinorUnits(min.price) ? row : min),
    null
  );
}

/**
 * The cheapest current listing of a product — the `target` rule's subject.
 * `null` when no active listing has ever recorded a price in the product's
 * currency.
 */
async function cheapestCurrentSample(product: Product): Promise<ListingSample | null> {
  return cheapestByMinorUnits(await latestSampleByListing(product));
}

/** The dedupe state for a product's price rules, keyed by rule. */
async function loadMemory(productId: string): Promise<Map<AlertStateKey, AlertMemory>> {
  const rows = await db.select().from(alertState).where(eq(alertState.productId, productId));
  return new Map(
    rows.map((row) => [
      row.rule,
      { lastAlertedAt: row.lastAlertedAt, lastAlertedPrice: row.lastAlertedPrice },
    ])
  );
}

function rememberAlert(productId: string, rule: AlertRule, price: string | null, now: Date) {
  return db
    .insert(alertState)
    .values({ lastAlertedAt: now, lastAlertedPrice: price, productId, rule })
    .onConflictDoUpdate({
      set: { lastAlertedAt: now, lastAlertedPrice: price },
      target: [alertState.productId, alertState.rule],
    });
}

/** Clears the broken-watch flag, but only when it is actually set. */
function clearBrokenReported(listingId: string) {
  return db.update(listings).set({ brokenReportedAt: null }).where(eq(listings.id, listingId));
}

function markBrokenReported(listingId: string, now: Date) {
  return db.update(listings).set({ brokenReportedAt: now }).where(eq(listings.id, listingId));
}

/**
 * `target` fires on the cheapest current listing, which may not be the one
 * this check ran against — the payload names that listing, not the checked
 * one. `previousPrice`/`pctChange` only make sense when the cheapest listing
 * is the checked listing; otherwise there is no cross-store "previous" to
 * report, so both stay `null` rather than comparing prices from two stores.
 */
function targetAlertPayload(
  product: Product,
  listing: Listing,
  cheapest: ListingSample,
  previous: Sample | null
): NotificationPayload {
  const checkedListingIsCheapest = cheapest.listingId === listing.id;
  const comparablePrevious = checkedListingIsCheapest ? previous : null;
  return {
    consecutiveFailures: null,
    currency: cheapest.currency,
    error: null,
    imageUrl: product.imageUrl,
    inStock: cheapest.inStock,
    listingId: cheapest.listingId,
    pctChange: comparablePrevious ? percentChange(comparablePrevious.price, cheapest.price) : null,
    previousPrice: comparablePrevious ? comparablePrevious.price : null,
    price: cheapest.price,
    productId: product.id,
    rule: "target",
    title: product.title,
    url: cheapest.url,
  };
}

/** `drop_percent`/`restock` fire on the listing that was actually checked. */
function checkedListingAlertPayload(
  product: Product,
  listing: Listing,
  trigger: RuleTrigger,
  latest: Sample,
  previous: Sample | null
): NotificationPayload {
  return {
    consecutiveFailures: null,
    currency: latest.currency,
    error: null,
    imageUrl: product.imageUrl,
    inStock: latest.inStock,
    listingId: listing.id,
    pctChange: previous ? percentChange(previous.price, latest.price) : null,
    previousPrice: previous ? previous.price : null,
    price: latest.price,
    productId: product.id,
    rule: trigger.rule,
    title: product.title,
    url: listing.url,
  };
}

function priceAlertPayload(
  product: Product,
  listing: Listing,
  trigger: RuleTrigger,
  latest: Sample,
  previous: Sample | null,
  cheapest: ListingSample | null
): NotificationPayload {
  // `trigger.rule === "target"` implies `cheapest` is non-null — the rules
  // module never fires `target` without one — but the type does not know
  // that, so the fallback keeps this total rather than asserting.
  if (trigger.rule === "target" && cheapest) {
    return targetAlertPayload(product, listing, cheapest, previous);
  }
  return checkedListingAlertPayload(product, listing, trigger, latest, previous);
}

function brokenPayload(
  product: Product,
  listing: Listing,
  consecutiveFailures: number,
  outcome: CheckOutcome
): NotificationPayload {
  return {
    consecutiveFailures,
    currency: listing.currency,
    error: outcome.error ?? outcome.status,
    imageUrl: product.imageUrl,
    inStock: null,
    listingId: listing.id,
    pctChange: null,
    previousPrice: null,
    price: null,
    productId: product.id,
    rule: WATCH_BROKEN,
    title: product.title,
    url: listing.url,
  };
}

/**
 * Sends one notification on every configured channel and logs what each did.
 * Resolves to whether *any* of them landed, which is what `alert_state` is
 * gated on.
 */
async function deliver(
  channels: readonly AlertChannel[],
  payload: NotificationPayload,
  reason: string
): Promise<boolean> {
  const log = createLogger({
    action: "alert",
    price: payload.price,
    productId: payload.productId,
    reason,
    rule: payload.rule,
  });
  const { delivered, results } = await deliverAlert({ channels, payload });
  // Per channel rather than aggregated: "alert delivery failed" without saying
  // which destination failed is a line that sends you to the code to find out.
  log.set({ channels: results });
  if (delivered) {
    log.info("alert sent");
  } else {
    // Logged, never thrown: the check is already committed and a notification
    // is not allowed to undo it.
    log.warn("alert delivery failed");
  }
  log.emit();
  return delivered;
}

/** Price rules: target, drop_percent, restock — evaluated, sent, remembered. */
async function runPriceAlerts(
  product: Product,
  listing: Listing,
  channels: readonly AlertChannel[],
  settings: Settings,
  now: Date
): Promise<void> {
  const [latest, previous = null] = await recentSamples(listing.id, OBSERVATION_WINDOW);
  if (!latest) {
    return;
  }

  const cheapest = await cheapestCurrentSample(product);

  const triggers = evaluateAlerts({
    cheapest,
    config: {
      dropPercent: product.dropPercent,
      rules: product.rules,
      targetPrice: product.targetPrice,
    },
    cooldownMs: cooldownMs(settings.cooldownMinutes),
    latest,
    memory: await loadMemory(product.id),
    now,
    previous,
  });

  for (const trigger of triggers) {
    // biome-ignore lint/performance/noAwaitInLoops: a product rarely fires two rules at once, and the ones that do should arrive in rule order rather than racing.
    const sent = await deliver(
      channels,
      priceAlertPayload(product, listing, trigger, latest, previous, cheapest),
      trigger.reason
    );
    if (sent) {
      // The dedupe price is the trigger's own subject — the cheapest
      // listing's for `target`, the checked listing's for the rest — not
      // uniformly `latest.price`.
      await rememberAlert(product.id, trigger.rule, trigger.subject.price, now);
    }
  }
}

/**
 * The "this watch is broken" alarm.
 *
 * One notification when the failure streak reaches the threshold, then silence
 * until a check succeeds — recovery is `listings.brokenReportedAt` being
 * cleared, which happens on every successful check whether or not one was
 * ever sent.
 */
async function runFailureAlert(
  product: Product,
  listing: Listing,
  channels: readonly AlertChannel[],
  settings: Settings,
  context: AlertContext,
  now: Date
): Promise<void> {
  if (context.outcome.status === "ok") {
    if (listing.brokenReportedAt !== null) {
      await clearBrokenReported(listing.id);
    }
    return;
  }

  const runs = await db
    .select({ status: checkRuns.status })
    .from(checkRuns)
    .where(eq(checkRuns.listingId, listing.id))
    .orderBy(desc(checkRuns.startedAt), desc(checkRuns.id))
    .limit(settings.failureThreshold);

  const failures = countLeadingFailures(runs);
  if (!shouldReportBroken(failures, listing.brokenReportedAt !== null, settings.failureThreshold)) {
    return;
  }

  const sent = await deliver(
    channels,
    brokenPayload(product, listing, failures, context.outcome),
    `${failures} consecutive failed checks`
  );
  if (sent) {
    await markBrokenReported(listing.id, now);
  }
}

/**
 * Runs alerting for a committed check. Swallows everything: a bug in here is a
 * log line, not a lost check or a pg-boss retry of a fetch that already
 * succeeded.
 */
export async function runAlerting(context: AlertContext): Promise<void> {
  try {
    const settings = await loadSettings();
    const targets = await alertTargets({
      emailConfigured: emailEnabled(),
      ownerId: context.product.userId,
      settings,
    });
    const channels = alertChannels(targets, emailChannel);
    if (channels.length === 0) {
      // Not an error — alerting is off, or no destination has ever been
      // configured. Recovery state is still cleared so a later configuration
      // does not inherit a stale "broken" flag.
      if (context.outcome.status === "ok" && context.listing.brokenReportedAt !== null) {
        await clearBrokenReported(context.listing.id);
      }
      return;
    }

    const now = new Date();
    if (context.pricePointWritten) {
      await runPriceAlerts(context.product, context.listing, channels, settings, now);
    }
    await runFailureAlert(context.product, context.listing, channels, settings, context, now);
  } catch (error) {
    const log = createLogger({
      action: "alerting_failed",
      error: error instanceof Error ? error.message : String(error),
      listingId: context.listing.id,
      productId: context.product.id,
    });
    log.error("alerting failed, check is unaffected");
    log.emit();
  }
}
