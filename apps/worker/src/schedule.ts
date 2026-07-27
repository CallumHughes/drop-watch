/**
 * Reschedule arithmetic. Pure and injectable so the jitter is actually
 * testable rather than "looks random enough".
 */

const MS_PER_MINUTE = 60_000;
const PERCENT = 100;

/**
 * Never schedule closer than this, whatever the interval and jitter say. Stops
 * a misconfigured `intervalMinutes: 1` with heavy jitter from turning into a
 * tight loop against someone's shop.
 */
const MIN_INTERVAL_MINUTES = 1;

/**
 * Spread of one reschedule, in milliseconds.
 *
 * Jitter is not optional (PLAN.md §5): without it every product sharing an
 * interval fires on the same second forever, which is both a thundering herd
 * against target sites and a self-inflicted latency spike. The offset is
 * symmetric — `±jitterPercent` of the interval — so the long-run average stays
 * on the configured interval instead of drifting later every cycle.
 */
export function jitteredIntervalMs(
  intervalMinutes: number,
  jitterPercent: number,
  random: () => number = Math.random
): number {
  const baseMs = intervalMinutes * MS_PER_MINUTE;
  const spread = (Math.max(jitterPercent, 0) / PERCENT) * baseMs;
  // random() in [0,1) maps to a factor in [-1,1).
  const offset = (random() * 2 - 1) * spread;
  return Math.max(Math.round(baseMs + offset), MIN_INTERVAL_MINUTES * MS_PER_MINUTE);
}

/** The `nextCheckAt` to persist after a check attempt, successful or not. */
export function nextCheckAt(
  from: Date,
  intervalMinutes: number,
  jitterPercent: number,
  random: () => number = Math.random
): Date {
  return new Date(from.getTime() + jitteredIntervalMs(intervalMinutes, jitterPercent, random));
}
