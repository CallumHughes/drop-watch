/**
 * Syntax and safety checks for a user-supplied extraction expression.
 *
 * One module so the add-product picker and the save path reject exactly the
 * same strings: a pattern the picker accepted must never fail validation on
 * submit, and a pattern the schema rejects must never look fine in the picker.
 *
 * Kept free of cheerio and of every other extract module, because the zod
 * schemas in `@drop-watch/api` import it and are reachable from the browser
 * bundle.
 */

import { parseJsonPath } from "./json-path";

export type ExpressionCheck = { ok: true } | { error: string; ok: false };

/**
 * A user's regex runs in the shared worker process, so a catastrophic
 * backtracker stalls every listing's checks rather than only its own. Node
 * cannot interrupt a running regex, so this is mitigation and not a guarantee:
 * a length cap, a nested-quantifier rejection, and (in `./regex`) a cap on how
 * much of the body is searched. `re2` is the escalation if this proves thin.
 */
const MAX_PATTERN_LENGTH = 500;

/** `(a+)+`, `(a*)*` — a repeated group that is itself unbounded. */
const UNBOUNDED_QUANTIFIER = /[*+]|\{\d+,\}/;
const QUANTIFIER_AFTER_GROUP = /^(?:[*+]|\{\d+(?:,\d*)?\})/;

/**
 * A repeated group whose body can match the same text more than one way is the
 * shape that backtracks exponentially. Two ways to get there: an inner
 * unbounded quantifier (`(a+)+`) or an alternation whose branches can overlap
 * (`(a|aa)+`).
 *
 * Telling an overlapping alternation from a disjoint one needs real analysis,
 * so every repeated alternation is refused. `(a|b)+` is a false positive and
 * `[ab]+` says the same thing — a price pattern almost never wants the former.
 */
function isAmbiguousBody(body: string): boolean {
  return UNBOUNDED_QUANTIFIER.test(body) || hasAlternation(body);
}

/** A `|` that is a real alternation, not one inside a class or escaped. */
function hasAlternation(body: string): boolean {
  let inClass = false;
  let index = 0;
  while (index < body.length) {
    const char = body.charAt(index);
    if (char === "\\") {
      index += 1;
    } else if (inClass) {
      inClass = char !== "]";
    } else if (char === "[") {
      inClass = true;
    } else if (char === "|") {
      return true;
    }
    index += 1;
  }
  return false;
}

/**
 * Walks the pattern, and for every group that is immediately quantified checks
 * whether its body is ambiguous. A heuristic, not a decision procedure — it
 * catches the shapes people actually paste.
 */
function hasNestedQuantifier(pattern: string): boolean {
  for (let index = 0; index < pattern.length; index += 1) {
    if (pattern[index] === "\\") {
      index += 1;
      continue;
    }
    if (pattern[index] !== "(") {
      continue;
    }

    const closing = matchingParen(pattern, index);
    if (closing === -1) {
      continue;
    }
    const body = pattern.slice(index + 1, closing);
    const after = pattern.slice(closing + 1);
    if (QUANTIFIER_AFTER_GROUP.test(after) && isAmbiguousBody(body)) {
      return true;
    }
  }
  return false;
}

/** Index of the `)` closing the group opened at `open`, or -1 when unbalanced. */
function matchingParen(pattern: string, open: number): number {
  let depth = 0;
  let inClass = false;
  for (let index = open; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (inClass) {
      if (char === "]") {
        inClass = false;
      }
      continue;
    }
    if (char === "[") {
      inClass = true;
    } else if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

export function checkRegexExpression(expression: string): ExpressionCheck {
  const pattern = expression.trim();
  if (pattern.length === 0) {
    return { error: "no expression", ok: false };
  }
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return { error: `expression is longer than ${MAX_PATTERN_LENGTH} characters`, ok: false };
  }
  try {
    // biome-ignore lint/correctness/noUnusedInstantiation: compiled purely to find out whether it compiles.
    new RegExp(pattern);
  } catch (error) {
    return { error: `not a valid regular expression: ${(error as Error).message}`, ok: false };
  }
  if (hasNestedQuantifier(pattern)) {
    return {
      error:
        "this pattern repeats a group that can match the same text more than one way, which can hang on some pages — drop the outer repetition, e.g. `[\\s\\S]*?` instead of `(.*)+`, or `[ab]+` instead of `(a|b)+`",
      ok: false,
    };
  }
  return { ok: true };
}

export function checkJsonPathExpression(expression: string): ExpressionCheck {
  const path = expression.trim();
  if (path.length === 0) {
    return { error: "no expression", ok: false };
  }
  if (path.length > MAX_PATTERN_LENGTH) {
    return { error: `expression is longer than ${MAX_PATTERN_LENGTH} characters`, ok: false };
  }
  const parsed = parseJsonPath(path);
  return "error" in parsed ? { error: parsed.error, ok: false } : { ok: true };
}

/** Dispatches to the check for whichever mode is reading the expression. */
export function checkExpression(mode: string, expression: string): ExpressionCheck {
  if (mode === "regex") {
    return checkRegexExpression(expression);
  }
  if (mode === "jsonpath") {
    return checkJsonPathExpression(expression);
  }
  // A CSS selector is only checkable by handing it to cheerio, which this
  // module deliberately cannot do. `testExpression` reports that verdict.
  return { ok: true };
}
