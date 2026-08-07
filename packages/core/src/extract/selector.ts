/**
 * Configured CSS selector — the last resort, and the one the add-product
 * selector picker drives. Takes the first matching element, pulls its
 * machine-readable value if it has one, and regex-extracts a price from the
 * text otherwise.
 *
 * An invalid selector is a user-input error, not a crash: it returns null.
 */

import { parsePrice } from "./price";
import type { CheerioSelection, PriceCandidate, StrategyContext } from "./types";

/** Collapses the whitespace cheerio's text() preserves from the source HTML. */
const WHITESPACE = /\s+/g;

export function extractBySelector({ $, locale, selector }: StrategyContext): PriceCandidate | null {
  if (!selector || selector.trim().length === 0) {
    return null;
  }

  let matched: CheerioSelection;
  try {
    matched = $(selector);
  } catch {
    return null;
  }
  if (matched.length === 0) {
    return null;
  }

  for (const element of matched.toArray()) {
    const node = $(element);
    const raw = node.attr("content") ?? node.attr("value") ?? node.text();
    const text = raw?.replace(WHITESPACE, " ").trim();
    if (!text) {
      continue;
    }
    const parsed = parsePrice(text, { locale });
    if (!parsed) {
      continue;
    }
    return parsed.currency
      ? {
          confidence: "high",
          currency: parsed.currency,
          evidence: { matchCount: matched.length, type: "selector:configured" },
          price: parsed.amount,
        }
      : {
          confidence: "high",
          evidence: { matchCount: matched.length, type: "selector:configured" },
          price: parsed.amount,
        };
  }
  return null;
}
