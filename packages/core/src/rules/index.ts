/**
 * Alert rule evaluation.
 *
 * Pure by design: no database, no network, no clock of its own.
 * The worker loads the observations and the dedupe state, this decides what
 * should fire, and the worker sends and records. That split is what makes the
 * part which is genuinely easy to get wrong — the dedupe — testable without a
 * Postgres connection.
 *
 * A product can be watched at more than one store, and the three rules do not
 * share a subject:
 *
 * - `target` fires on the product's *cheapest current listing* — a shopper
 *   watching a target price does not care which store hits it, only that one
 *   does. `cheapest` is the caller's job to compute (latest observation per
 *   active listing, minimum price, same currency); this module never fires
 *   `target` without one.
 * - `drop_percent` and `restock` fire on the listing that was actually
 *   checked this run, against its own previous observation — a per-store
 *   price history, not a cross-store one.
 *
 * Dedupe stays keyed by `(productId, rule)` regardless: stores share one
 * cooldown per rule, so a target alert about store A does not let store B
 * re-notify a minute later at the same price.
 *
 * The dedupe is the whole game. A naive implementation notifies every three
 * hours forever about a product sitting a pound under target, and a watcher
 * that cries wolf gets muted and then deleted. So a rule fires only when
 *
 *     condition is true
 *     AND (never alerted
 *          OR price < lastAlertedPrice
 *          OR now - lastAlertedAt > cooldown)
 *
 * keyed by `(productId, rule)` with a 12h default cooldown, gated on the
 * trigger's subject price (the cheapest listing's for `target`, the checked
 * listing's for `drop_percent`/`restock`).
 */

import { toMinorUnits } from "../decimal";

export const ALERT_RULES = ["target", "drop_percent", "restock"] as const;

export type AlertRule = (typeof ALERT_RULES)[number];

/**
 * The synthetic rule the consecutive-failure alarm dedupes against. It is not
 * user-selectable — a watch that has stopped working is always worth saying
 * once — but it shares `alert_state` so "have we already said this" is one
 * mechanism rather than two.
 */
export const WATCH_BROKEN = "watch_broken";

/** Every key that can appear in `alert_state.rule`. */
export type AlertStateKey = AlertRule | typeof WATCH_BROKEN;

/** 12 hours. Overridable from the settings table. */
export const DEFAULT_COOLDOWN_MINUTES = 720;

/** Consecutive non-`ok` checks before a product is declared broken. */
export const DEFAULT_FAILURE_THRESHOLD = 5;

const MS_PER_MINUTE = 60_000;
const PERCENT = 100n;

/** One price observation, as the rules care about it. */
export interface Observation {
  /** `null` means the page never said, which is not the same as "no". */
  inStock: boolean | null;
  /** Decimal string from `numeric(12,2)`. Never a float. */
  price: string;
}

/** The alerting half of a product's configuration. */
export interface AlertConfig {
  dropPercent: number | null;
  rules: readonly AlertRule[];
  targetPrice: string | null;
}

/** One `alert_state` row, as the dedupe cares about it. */
export interface AlertMemory {
  lastAlertedAt: Date | null;
  lastAlertedPrice: string | null;
}

/**
 * A rule whose condition held, and why — the reason is logged with the send.
 *
 * `subject` is the observation the trigger is *about*: the cheapest listing's
 * for `target`, the checked listing's `latest` for `drop_percent`/`restock`.
 * The caller uses it both to build the right payload (which store, which
 * price) and to gate the dedupe on the right price.
 */
export interface RuleTrigger {
  reason: string;
  rule: AlertRule;
  subject: Observation;
}

/** Everything the evaluation needs, gathered by the caller. */
export interface EvaluationInput {
  /**
   * The cheapest current listing's latest observation, across the product's
   * active listings, in the product's currency. `null` when there is no such
   * observation (e.g. no listing has ever recorded a price) — `target` never
   * fires in that case, however low `latest` is.
   */
  cheapest: Observation | null;
  config: AlertConfig;
  /** Cooldown in milliseconds. Defaults to {@link DEFAULT_COOLDOWN_MINUTES}. */
  cooldownMs?: number;
  /** The observation just recorded, for the listing that was checked. */
  latest: Observation;
  /** Dedupe state, keyed by rule. Absent means never alerted. */
  memory: ReadonlyMap<AlertStateKey, AlertMemory>;
  now: Date;
  /** The observation before it, or `null` on a product's first price point. */
  previous: Observation | null;
}

export function cooldownMs(minutes: number = DEFAULT_COOLDOWN_MINUTES): number {
  return minutes * MS_PER_MINUTE;
}

/**
 * The cheapest current listing's price is at or below the configured target.
 * Evaluated against `cheapest`, not the checked listing — never fires without
 * one, since there is then nothing to be the subject of the alert.
 */
function targetMet(config: AlertConfig, cheapest: Observation | null): RuleTrigger | null {
  if (!(config.targetPrice && cheapest)) {
    return null;
  }
  if (toMinorUnits(cheapest.price) > toMinorUnits(config.targetPrice)) {
    return null;
  }
  return {
    reason: `price ${cheapest.price} is at or below target ${config.targetPrice}`,
    rule: "target",
    subject: cheapest,
  };
}

/**
 * At least `dropPercent` below the previous observation.
 *
 * Compared as `(previous - latest) * 100 >= dropPercent * previous` so the
 * whole test stays in integer minor units — dividing first would reintroduce
 * exactly the rounding this codebase refuses to do with money.
 */
function dropMet(
  config: AlertConfig,
  latest: Observation,
  previous: Observation | null
): RuleTrigger | null {
  if (config.dropPercent === null || !previous) {
    return null;
  }
  const before = toMinorUnits(previous.price);
  if (before <= 0n) {
    return null;
  }
  const fall = before - toMinorUnits(latest.price);
  if (fall * PERCENT < BigInt(config.dropPercent) * before) {
    return null;
  }
  return {
    reason: `price fell from ${previous.price} to ${latest.price}, at least ${config.dropPercent}%`,
    rule: "drop_percent",
    subject: latest,
  };
}

/**
 * Out of stock became in stock. Deliberately edge-triggered: a product that has
 * simply always been available never fires, and `null` (the page said nothing)
 * is not treated as "was out of stock".
 */
function restockMet(latest: Observation, previous: Observation | null): RuleTrigger | null {
  if (previous?.inStock !== false || latest.inStock !== true) {
    return null;
  }
  return { reason: "back in stock", rule: "restock", subject: latest };
}

/**
 * Which enabled rules' conditions hold for this observation, in
 * {@link ALERT_RULES} order. Says nothing about whether they should be sent —
 * that is {@link shouldFire}.
 */
export function conditionsMet(
  config: AlertConfig,
  latest: Observation,
  previous: Observation | null,
  cheapest: Observation | null
): RuleTrigger[] {
  const enabled = new Set(config.rules);
  const candidates = [
    targetMet(config, cheapest),
    dropMet(config, latest, previous),
    restockMet(latest, previous),
  ];
  return candidates.filter(
    (trigger): trigger is RuleTrigger => trigger !== null && enabled.has(trigger.rule)
  );
}

/**
 * The dedupe gate. A cheaper price is always news; the same
 * price again is only news once the cooldown has run out.
 */
export function shouldFire(
  price: string,
  memory: AlertMemory | undefined,
  now: Date,
  cooldown: number
): boolean {
  if (!memory?.lastAlertedAt) {
    return true;
  }
  if (memory.lastAlertedPrice && toMinorUnits(price) < toMinorUnits(memory.lastAlertedPrice)) {
    return true;
  }
  return now.getTime() - memory.lastAlertedAt.getTime() > cooldown;
}

/**
 * The rules that should actually notify: condition held *and* not deduped.
 *
 * The dedupe gate runs on each trigger's own `subject.price` rather than
 * uniformly on `input.latest.price` — a `target` trigger is about the
 * cheapest listing, so it is the cheapest listing's price that must be a new
 * low (or past cooldown) for it to fire again.
 */
export function evaluateAlerts(input: EvaluationInput): RuleTrigger[] {
  const cooldown = input.cooldownMs ?? cooldownMs();
  return conditionsMet(input.config, input.latest, input.previous, input.cheapest).filter(
    (trigger) =>
      shouldFire(trigger.subject.price, input.memory.get(trigger.rule), input.now, cooldown)
  );
}

/** A check attempt, as the failure alarm cares about it. */
interface RunStatus {
  status: string;
}

/**
 * How many checks in a row have failed, newest first.
 *
 * A 304 is recorded as `ok` with no price point, so a page that simply has not
 * changed never counts as a failure. Structurally typed rather than taking the
 * `CheckRun` row, because `core` must not import `@drop-watch/db` — the
 * dependency runs the other way.
 */
export function countLeadingFailures(runs: readonly RunStatus[]): number {
  let failures = 0;
  for (const run of runs) {
    if (run.status === "ok") {
      break;
    }
    failures += 1;
  }
  return failures;
}

/**
 * Whether to send the "this watch is broken" notification.
 *
 * Fires once when the streak reaches the threshold and stays silent afterwards
 * — `alreadyReported` is the presence of a `watch_broken` row, which the
 * worker deletes on the first successful check. Selectors rot silently, and
 * without this you simply stop getting deals and never notice.
 */
export function shouldReportBroken(
  consecutiveFailures: number,
  alreadyReported: boolean,
  threshold: number = DEFAULT_FAILURE_THRESHOLD
): boolean {
  return !alreadyReported && consecutiveFailures >= threshold;
}
