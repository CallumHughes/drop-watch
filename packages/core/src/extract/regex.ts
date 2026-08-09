/**
 * Configured regular expression, matched against the raw response body rather
 * than the DOM.
 *
 * That is the whole reason this strategy exists: a CSS selector can address the
 * element holding a price but not a value that never becomes text —
 * `data-price="1234"`, or a `"priceAmount":1234` buried in an inline script. In
 * browser render mode the body is the serialized post-JavaScript DOM, so the
 * same pattern keeps working.
 *
 * The value is the named group `price` if the pattern has one, else capture
 * group 1, else the whole match. Optional `currency` and `availability` groups
 * are read when present.
 *
 * A pattern that does not compile is a user-input error, not a crash: null.
 */

import { parseAvailability } from "./availability";
import { checkRegexExpression } from "./expression-guard";
import { parsePrice } from "./price";
import type { PriceCandidate, StrategyContext } from "./types";

/**
 * How much of the body one pattern may scan. The third layer of the ReDoS
 * mitigation described in `./expression-guard` — a bounded input turns a
 * merely-slow pattern into a merely-slow-once pattern. A price this deep into
 * a document is past the point where a regex is the right tool.
 */
const MAX_INPUT_CHARS = 500_000;

/**
 * Flags are fixed rather than user-supplied. Case-insensitive because markup
 * casing is not something anyone should have to think about, and global so the
 * picker can count and sample every match. Deliberately no `s`: making `.` span
 * newlines turns an ordinary `.*` into a whole-document scan, and `[\s\S]` says
 * the same thing where it is actually wanted.
 */
const FLAGS = "gi";

export function extractByRegex({
  expression,
  html,
  locale,
}: StrategyContext): PriceCandidate | null {
  if (!expression || expression.trim().length === 0) {
    return null;
  }
  if (!checkRegexExpression(expression).ok) {
    return null;
  }

  let pattern: RegExp;
  try {
    pattern = new RegExp(expression.trim(), FLAGS);
  } catch {
    return null;
  }

  const matches = [...html.slice(0, MAX_INPUT_CHARS).matchAll(pattern)];
  if (matches.length === 0) {
    return null;
  }

  for (const match of matches) {
    const candidate = candidateFrom(match, matches.length, locale);
    if (candidate) {
      return candidate;
    }
  }
  return null;
}

function candidateFrom(
  match: RegExpExecArray,
  matchCount: number,
  locale: string | undefined
): PriceCandidate | null {
  const groups = match.groups ?? {};
  const raw = groups.price ?? match[1] ?? match[0];
  if (!raw?.trim()) {
    return null;
  }

  const parsed = parsePrice(raw.trim(), {
    ...(groups.currency ? { currency: groups.currency } : {}),
    ...(locale ? { locale } : {}),
  });
  if (!parsed) {
    return null;
  }

  const candidate: PriceCandidate = {
    confidence: "high",
    evidence: { matchCount, type: "regex:configured" },
    price: parsed.amount,
  };
  if (parsed.currency) {
    candidate.currency = parsed.currency;
  }
  const availability = parseAvailability(groups.availability);
  if (availability) {
    candidate.availability = availability.availability;
    if (availability.inStock !== undefined) {
      candidate.inStock = availability.inStock;
    }
  }
  return candidate;
}

/** The matches the picker shows, so the value column is the captured value. */
export function regexMatches(html: string, expression: string): RegExpExecArray[] {
  let pattern: RegExp;
  try {
    pattern = new RegExp(expression.trim(), FLAGS);
  } catch {
    return [];
  }
  return [...html.slice(0, MAX_INPUT_CHARS).matchAll(pattern)];
}

/** The value a match contributes: named `price` group, group 1, or the match. */
export function regexValue(match: RegExpExecArray): string {
  return (match.groups?.price ?? match[1] ?? match[0]).trim();
}
