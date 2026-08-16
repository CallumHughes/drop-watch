/**
 * Configured JSONPath, evaluated against every JSON document on the page.
 *
 * The gap this fills: single-page storefronts render the price from an embedded
 * state blob, so the number exists in the response but never as text a CSS
 * selector can reach. `$.props.pageProps.product.price` reaches it, and
 * `$..price` usually finds it without knowing the shape at all.
 *
 * Documents are tried in the order `./json-documents` lists them, and the first
 * resolved value that parses as a price wins.
 */

import { isRecord } from "./json";
import { collectJsonDocuments } from "./json-documents";
import { evaluateJsonPath, parseJsonPath } from "./json-path";
import { type ParsedPrice, parsePrice } from "./price";
import type { PriceCandidate, StrategyContext } from "./types";

export function extractByJsonPath({
  $,
  expression,
  html,
  locale,
}: StrategyContext): PriceCandidate | null {
  if (!expression || expression.trim().length === 0) {
    return null;
  }
  const path = parseJsonPath(expression);
  if ("error" in path) {
    return null;
  }

  const resolved: unknown[] = [];
  for (const document of collectJsonDocuments({ $, html })) {
    resolved.push(...evaluateJsonPath(path, document.value));
  }
  if (resolved.length === 0) {
    return null;
  }

  for (const value of resolved) {
    const parsed = priceFrom(value, locale);
    if (parsed) {
      const candidate: PriceCandidate = {
        confidence: "high",
        evidence: { matchCount: resolved.length, type: "jsonpath:configured" },
        price: parsed.amount,
      };
      if (parsed.currency) {
        candidate.currency = parsed.currency;
      }
      return candidate;
    }
  }
  return null;
}

/**
 * A resolved value read as a price. Objects are handled because a path landing
 * on a schema.org offer — `{ price, priceCurrency }` — is the common case, and
 * it is the only shape that can carry its own currency.
 *
 * Availability is deliberately not read here: there is no convention for where
 * it sits relative to an arbitrary path, and guessing wrong would silently
 * mark things in stock.
 */
function priceFrom(value: unknown, locale: string | undefined): ParsedPrice | null {
  if (typeof value === "number" || typeof value === "string") {
    return parsePrice(value, { ...(locale ? { locale } : {}) });
  }
  if (!isRecord(value)) {
    return null;
  }

  const raw = value.price ?? value.amount ?? value.value;
  if (typeof raw !== "number" && typeof raw !== "string") {
    return null;
  }
  const currency = value.priceCurrency ?? value.currency;
  return parsePrice(raw, {
    ...(typeof currency === "string" ? { currency } : {}),
    ...(locale ? { locale } : {}),
  });
}

/** Every value the path resolves to, for the picker's match list. */
export function jsonPathMatches(
  context: Pick<StrategyContext, "$" | "html">,
  expression: string
): { source: string; value: unknown }[] {
  const path = parseJsonPath(expression);
  if ("error" in path) {
    return [];
  }
  const matches: { source: string; value: unknown }[] = [];
  for (const document of collectJsonDocuments(context)) {
    for (const value of evaluateJsonPath(path, document.value)) {
      matches.push({ source: document.source, value });
    }
  }
  return matches;
}
