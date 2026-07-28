/**
 * The alerting half of a check: decide, send, remember.
 *
 * `core/rules` decides (purely, against observations and dedupe state),
 * `core/notify` sends, and this module is the orchestration between them —
 * loading `alert_state`, writing it back, and keeping the whole thing off the
 * critical path of the check itself.
 *
 * That last part is the rule worth stating twice: **alerting must never fail a
 * check** (PLAN.md §7). By the time anything here runs the price point and the
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
 */

import { percentChange } from "@price-tracker/core/decimal";
import type { NotificationPayload } from "@price-tracker/core/notify";
import type { AlertChannel } from "@price-tracker/core/notify/channels";
import { deliverAlert } from "@price-tracker/core/notify/channels";
import { alertChannels } from "@price-tracker/core/notify/targets";
import type {
  AlertMemory,
  AlertStateKey,
  Observation,
  RuleTrigger,
} from "@price-tracker/core/rules";
import {
  cooldownMs,
  countLeadingFailures,
  evaluateAlerts,
  shouldReportBroken,
  TRACKER_BROKEN,
} from "@price-tracker/core/rules";
import { db } from "@price-tracker/db";
import type { Product } from "@price-tracker/db/schema/products";
import { alertState, checkRuns, pricePoints } from "@price-tracker/db/schema/products";
import type { Settings } from "@price-tracker/db/schema/settings";
import { alertTargets, loadSettings } from "@price-tracker/db/settings";
import { emailChannel, emailEnabled } from "@price-tracker/email";
import { and, desc, eq } from "drizzle-orm";
import { createLogger } from "evlog";

import type { CheckOutcome } from "./outcome";

/** Two points is all the rules need: the new observation and the one before. */
const OBSERVATION_WINDOW = 2;

/** One observation plus the currency it is denominated in. */
interface Sample extends Observation {
  currency: string;
}

/** Everything the worker knows once a check has been committed. */
export interface AlertContext {
  outcome: CheckOutcome;
  /** True when this check wrote a price point — the price rules need one. */
  pricePointWritten: boolean;
  product: Product;
}

/** The newest `limit` observations for a product, newest first. */
async function recentSamples(productId: string, limit: number): Promise<Sample[]> {
  return await db
    .select({
      currency: pricePoints.currency,
      inStock: pricePoints.inStock,
      price: pricePoints.price,
    })
    .from(pricePoints)
    .where(eq(pricePoints.productId, productId))
    .orderBy(desc(pricePoints.observedAt), desc(pricePoints.id))
    .limit(limit);
}

/** The dedupe state for a product, keyed by rule. */
async function loadMemory(productId: string): Promise<Map<AlertStateKey, AlertMemory>> {
  const rows = await db.select().from(alertState).where(eq(alertState.productId, productId));
  return new Map(
    rows.map((row) => [
      row.rule,
      { lastAlertedAt: row.lastAlertedAt, lastAlertedPrice: row.lastAlertedPrice },
    ])
  );
}

function rememberAlert(productId: string, rule: AlertStateKey, price: string | null, now: Date) {
  return db
    .insert(alertState)
    .values({ lastAlertedAt: now, lastAlertedPrice: price, productId, rule })
    .onConflictDoUpdate({
      set: { lastAlertedAt: now, lastAlertedPrice: price },
      target: [alertState.productId, alertState.rule],
    });
}

function forgetAlert(productId: string, rule: AlertStateKey) {
  return db
    .delete(alertState)
    .where(and(eq(alertState.productId, productId), eq(alertState.rule, rule)));
}

function priceAlertPayload(
  product: Product,
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
    pctChange: previous ? percentChange(previous.price, latest.price) : null,
    previousPrice: previous?.price ?? null,
    price: latest.price,
    productId: product.id,
    rule: trigger.rule,
    title: product.title,
    url: product.url,
  };
}

function brokenPayload(
  product: Product,
  consecutiveFailures: number,
  outcome: CheckOutcome
): NotificationPayload {
  return {
    consecutiveFailures,
    currency: product.currency,
    error: outcome.error ?? outcome.status,
    imageUrl: product.imageUrl,
    inStock: null,
    pctChange: null,
    previousPrice: null,
    price: null,
    productId: product.id,
    rule: TRACKER_BROKEN,
    title: product.title,
    url: product.url,
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
    // is not allowed to undo it (PLAN.md §7).
    log.warn("alert delivery failed");
  }
  log.emit();
  return delivered;
}

/** Price rules: target, drop_percent, restock — evaluated, sent, remembered. */
async function runPriceAlerts(
  product: Product,
  channels: readonly AlertChannel[],
  settings: Settings,
  now: Date
): Promise<void> {
  const [latest, previous = null] = await recentSamples(product.id, OBSERVATION_WINDOW);
  if (!latest) {
    return;
  }

  const triggers = evaluateAlerts({
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
      priceAlertPayload(product, trigger, latest, previous),
      trigger.reason
    );
    if (sent) {
      await rememberAlert(product.id, trigger.rule, latest.price, now);
    }
  }
}

/**
 * The "this tracker is broken" alarm.
 *
 * One notification when the failure streak reaches the threshold, then silence
 * until a check succeeds — recovery is the `tracker_broken` row being deleted,
 * which happens on every successful check whether or not one was ever sent.
 */
async function runFailureAlert(
  product: Product,
  channels: readonly AlertChannel[],
  settings: Settings,
  context: AlertContext,
  now: Date
): Promise<void> {
  if (context.outcome.status === "ok") {
    await forgetAlert(product.id, TRACKER_BROKEN);
    return;
  }

  const runs = await db
    .select({ status: checkRuns.status })
    .from(checkRuns)
    .where(eq(checkRuns.productId, product.id))
    .orderBy(desc(checkRuns.startedAt), desc(checkRuns.id))
    .limit(settings.failureThreshold);

  const failures = countLeadingFailures(runs);
  const memory = await loadMemory(product.id);
  if (!shouldReportBroken(failures, memory.has(TRACKER_BROKEN), settings.failureThreshold)) {
    return;
  }

  const sent = await deliver(
    channels,
    brokenPayload(product, failures, context.outcome),
    `${failures} consecutive failed checks`
  );
  if (sent) {
    await rememberAlert(product.id, TRACKER_BROKEN, null, now);
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
    const targets = await alertTargets({ emailConfigured: emailEnabled(), settings });
    const channels = alertChannels(targets, emailChannel);
    if (channels.length === 0) {
      // Not an error — alerting is off, or no destination has ever been
      // configured. Recovery state is still cleared so a later configuration
      // does not inherit a stale "broken" flag.
      if (context.outcome.status === "ok") {
        await forgetAlert(context.product.id, TRACKER_BROKEN);
      }
      return;
    }

    const now = new Date();
    if (context.pricePointWritten) {
      await runPriceAlerts(context.product, channels, settings, now);
    }
    await runFailureAlert(context.product, channels, settings, context, now);
  } catch (error) {
    const log = createLogger({
      action: "alerting_failed",
      error: error instanceof Error ? error.message : String(error),
      productId: context.product.id,
    });
    log.error("alerting failed, check is unaffected");
    log.emit();
  }
}
