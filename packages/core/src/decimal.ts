/**
 * Arithmetic on the decimal strings that `numeric(12,2)` columns produce.
 *
 * Prices never become JS floats — not in the database, not on the wire, and not
 * on the way to a "£3.20 under target" badge. Everything here
 * works in integer minor units via `bigint`, so the values the UI renders are
 * exactly the values Postgres stores.
 *
 * Lives in `core` rather than beside the API's summary code because the alert
 * rules need the same arithmetic: "is this at or below target" and "is this a
 * 10% drop" are precisely the comparisons that must not go through a float.
 */

/** `numeric(12,2)`, optionally signed. Anything else is a bug, not user input. */
const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

/** Money is scale 2 throughout the schema. */
const SCALE = 2;

const MINOR_UNITS = 100n;

/** Percentages are shown to one decimal place; more is noise at these prices. */
const PERCENT_UNITS = 10n;

const HUNDRED = 100n;

/**
 * Parses a decimal string to minor units (pence, cents). Extra fractional
 * digits are truncated rather than rounded — the schema never produces them.
 */
export function toMinorUnits(value: string): bigint {
  if (!DECIMAL_PATTERN.test(value)) {
    throw new Error(`not a decimal string: ${value}`);
  }
  const negative = value.startsWith("-");
  const [whole = "0", fraction = ""] = (negative ? value.slice(1) : value).split(".");
  const scaled = fraction.padEnd(SCALE, "0").slice(0, SCALE);
  const magnitude = BigInt(whole) * MINOR_UNITS + BigInt(scaled);
  return negative ? -magnitude : magnitude;
}

/** Inverse of {@link toMinorUnits}: always two decimal places, sign preserved. */
export function fromMinorUnits(minor: bigint): string {
  const negative = minor < 0n;
  const magnitude = negative ? -minor : minor;
  const whole = magnitude / MINOR_UNITS;
  const fraction = (magnitude % MINOR_UNITS).toString().padStart(SCALE, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/** `a - b`, both decimal strings, result a decimal string. */
export function subtract(a: string, b: string): string {
  return fromMinorUnits(toMinorUnits(a) - toMinorUnits(b));
}

/**
 * Signed percentage change from `from` to `to`, one decimal place. `null` when
 * `from` is zero, because the change from nothing is not a percentage.
 */
export function percentChange(from: string, to: string): string | null {
  const start = toMinorUnits(from);
  if (start === 0n) {
    return null;
  }
  const delta = toMinorUnits(to) - start;
  // Scale before dividing so the single decimal place survives integer maths.
  const tenths = (delta * HUNDRED * PERCENT_UNITS) / (start < 0n ? -start : start);
  const negative = tenths < 0n;
  const magnitude = negative ? -tenths : tenths;
  return `${negative ? "-" : ""}${magnitude / PERCENT_UNITS}.${magnitude % PERCENT_UNITS}`;
}
