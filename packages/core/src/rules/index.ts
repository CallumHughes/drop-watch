/**
 * Alert rule evaluation.
 *
 * Pure by design (PLAN.md §10): no database, no network, no clock of its own.
 * The worker loads the observations and the dedupe state, this decides what
 * should fire, and the worker sends and records. That split is what makes the
 * part which is genuinely easy to get wrong — the dedupe — testable without a
 * Postgres connection.
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
 * per PLAN.md §6, keyed by `(productId, rule)` with a 12h default cooldown.
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

/** 12 hours, per PLAN.md §6. Overridable from the settings table. */
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

/** A rule whose condition held, and why — the reason is logged with the send. */
export interface RuleTrigger {
  reason: string;
  rule: AlertRule;
}

/** Everything the evaluation needs, gathered by the caller. */
export interface EvaluationInput {
  config: AlertConfig;
  /** Cooldown in milliseconds. Defaults to {@link DEFAULT_COOLDOWN_MINUTES}. */
  cooldownMs?: number;
  /** The observation just recorded. */
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

/** Price at or below the configured target. */
function targetMet(config: AlertConfig, latest: Observation): RuleTrigger | null {
  if (!config.targetPrice) {
    return null;
  }
  if (toMinorUnits(latest.price) > toMinorUnits(config.targetPrice)) {
    return null;
  }
  return {
    reason: `price ${latest.price} is at or below target ${config.targetPrice}`,
    rule: "target",
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
  return { reason: "back in stock", rule: "restock" };
}

/**
 * Which enabled rules' conditions hold for this observation, in
 * {@link ALERT_RULES} order. Says nothing about whether they should be sent —
 * that is {@link shouldFire}.
 */
export function conditionsMet(
  config: AlertConfig,
  latest: Observation,
  previous: Observation | null
): RuleTrigger[] {
  const enabled = new Set(config.rules);
  const candidates = [
    targetMet(config, latest),
    dropMet(config, latest, previous),
    restockMet(latest, previous),
  ];
  return candidates.filter(
    (trigger): trigger is RuleTrigger => trigger !== null && enabled.has(trigger.rule)
  );
}

/**
 * The dedupe gate from PLAN.md §6. A cheaper price is always news; the same
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

/** The rules that should actually notify: condition held *and* not deduped. */
export function evaluateAlerts(input: EvaluationInput): RuleTrigger[] {
  const cooldown = input.cooldownMs ?? cooldownMs();
  return conditionsMet(input.config, input.latest, input.previous).filter((trigger) =>
    shouldFire(input.latest.price, input.memory.get(trigger.rule), input.now, cooldown)
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
