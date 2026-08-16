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

const MAX_EXPRESSION_LENGTH = 500;

const ATTRIBUTE_NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;
const ATTRIBUTE_SUFFIX = /::attr\(([^()]*)\)$/;

/** Finds an attribute-reader marker outside quoted CSS attribute values. */
function selectorAttributeMarkers(expression: string): number[] {
  const markers: number[] = [];
  let quote: '"' | "'" | undefined;
  let escaped = false;

  for (let index = 0; index < expression.length; index += 1) {
    const character = expression[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (expression.startsWith("::attr", index)) {
      markers.push(index);
    }
  }
  return markers;
}

export interface ParsedSelectorExpression {
  attribute?: string;
  selector: string;
}

/**
 * Splits the optional terminal attribute reader from a CSS selector. The
 * suffix is intentionally distinct from CSS syntax so a normal selector keeps
 * its existing meaning: `[data-price]::attr(data-price)` reads that attribute.
 */
export function parseSelectorExpression(
  expression: string
): ParsedSelectorExpression | { error: string } {
  const source = expression.trim();
  const markers = selectorAttributeMarkers(source);
  if (markers.length === 0) {
    return { selector: source };
  }
  if (markers.length > 1) {
    return { error: "a selector may contain only one terminal ::attr(name) suffix" };
  }

  const suffix = source.match(ATTRIBUTE_SUFFIX);
  if (!suffix || suffix.index === undefined) {
    return { error: "attribute extraction must use a terminal ::attr(name) suffix" };
  }

  const selector = source.slice(0, suffix.index).trim();
  if (selector.length === 0) {
    return { error: "an attribute extraction expression needs a CSS selector before ::attr(name)" };
  }

  const [, attribute] = suffix;
  if (!(attribute && ATTRIBUTE_NAME.test(attribute))) {
    return { error: "::attr(name) needs a valid HTML attribute name" };
  }
  return { attribute, selector };
}

export function checkSelectorExpression(expression: string): ExpressionCheck {
  const parsed = parseSelectorExpression(expression);
  return "error" in parsed ? { error: parsed.error, ok: false } : { ok: true };
}

export function checkJsonPathExpression(expression: string): ExpressionCheck {
  const path = expression.trim();
  if (path.length === 0) {
    return { error: "no expression", ok: false };
  }
  if (path.length > MAX_EXPRESSION_LENGTH) {
    return { error: `expression is longer than ${MAX_EXPRESSION_LENGTH} characters`, ok: false };
  }
  const parsed = parseJsonPath(path);
  return "error" in parsed ? { error: parsed.error, ok: false } : { ok: true };
}

/** Dispatches to the check for whichever mode is reading the expression. */
export function checkExpression(mode: string, expression: string): ExpressionCheck {
  if (mode === "jsonpath") {
    return checkJsonPathExpression(expression);
  }
  if (mode === "selector") {
    return checkSelectorExpression(expression);
  }
  // An unknown mode is rejected by its caller; CSS syntax itself remains
  // cheerio's responsibility so this browser-safe module stays dependency-free.
  return { ok: true };
}
