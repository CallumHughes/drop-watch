import type {
  PriceSuggestion,
  SuggestedExpression,
  SuggestedPrice,
} from "@drop-watch/api/routers/preview";
import { toMinorUnits } from "@drop-watch/core/decimal";

import { formatPrice } from "@/lib/format";

import { automaticAlreadyReadsIt, expectedPriceIsUsable } from "./use-preview-flow";

/**
 * What the locator has to say right now.
 *
 * `automatic` outranks `located` on purpose: when the chain already reads the
 * typed price and the worker would accept it, pinning an expression only adds
 * something to rot.
 */
export type LocatorOutcome =
  | { kind: "idle" }
  | { kind: "unusable" }
  | { kind: "searching" }
  | { kind: "failed"; message: string }
  | { kind: "automatic"; price: string }
  | { candidate: SuggestedExpression; kind: "located" }
  | { kind: "elsewhere"; prices: SuggestedPrice[] }
  | { kind: "unreachable"; prices: SuggestedPrice[] }
  | { kind: "absent" };

/** Scale-2 comparison, so `24.9` and `24.90` are the same figure. */
function isSamePrice(amount: string, typed: string): boolean {
  try {
    return toMinorUnits(amount) === toMinorUnits(typed);
  } catch {
    return amount === typed;
  }
}

function failureMessage(error: unknown): string {
  const reason = error instanceof Error && error.message ? error.message : "the request failed.";
  return `Could not look for that price: ${reason}`;
}

export function locatorOutcome({
  error,
  expectedPrice,
  isLocating,
  suggestion,
}: {
  /** The suggestion query's error, if it has one and no result to show. */
  error?: unknown;
  expectedPrice: string;
  isLocating: boolean;
  suggestion: PriceSuggestion | undefined;
}): LocatorOutcome {
  const typed = expectedPrice.trim();
  if (typed.length === 0) {
    return { kind: "idle" };
  }
  if (!expectedPriceIsUsable(typed)) {
    return { kind: "unusable" };
  }
  if (isLocating) {
    return { kind: "searching" };
  }
  // A query that failed has no data and is not fetching, which is exactly what
  // a query that was never made looks like. Without this the reader watches
  // "looking for that price" forever and never learns the preview expired.
  if (!suggestion) {
    return error ? { kind: "failed", message: failureMessage(error) } : { kind: "searching" };
  }
  const { automatic } = suggestion;
  if (automatic && automaticAlreadyReadsIt(automatic)) {
    return { kind: "automatic", price: automatic.price };
  }
  const [candidate] = suggestion.candidates;
  if (candidate) {
    return { candidate, kind: "located" };
  }
  // On the page but not reachable is a different answer from not on the page,
  // and offering the reader back the figure they just typed is a closed loop:
  // picking it re-asks the same question and gets the same answer.
  const elsewhere = suggestion.pricesOnPage.filter((price) => !isSamePrice(price.amount, typed));
  if (elsewhere.length < suggestion.pricesOnPage.length) {
    return { kind: "unreachable", prices: elsewhere };
  }
  return elsewhere.length > 0 ? { kind: "elsewhere", prices: elsewhere } : { kind: "absent" };
}

/**
 * Said only when the chain reads a different number — the case a reader cannot
 * otherwise spot, and the usual reason a watch has been quietly wrong rather
 * than quietly broken.
 */
export function automaticDisagreementNote(
  suggestion: PriceSuggestion | undefined,
  expectedPrice: string
): string | null {
  const automatic = suggestion?.automatic;
  if (!automatic || automatic.agrees) {
    return null;
  }
  const found = formatPrice(automatic.price, automatic.currency);
  return `Read automatically, this page gives ${found}, not the ${expectedPrice.trim()} you entered.`;
}

/** The locator's own field label, naming the currency when one is known. */
export function expectedPriceLabel(currency: string | null): string {
  return `What price does this page show? (${currency ?? "currency unknown"})`;
}

/**
 * Said when the chosen expression reads no currency of its own and the listing
 * has none either — the worker refuses a bare number, so this is a save that
 * would fail on the next check.
 */
export function missingCurrencyWarning(
  outcome: LocatorOutcome,
  listingCurrency: string | null
): string | null {
  if (outcome.kind !== "located" || outcome.candidate.currency || listingCurrency) {
    return null;
  }
  return "This spot on the page gives a number but no currency, and this listing has none recorded yet. Checks will fail until the page or the listing supplies one.";
}

export const LOCATOR_HINT =
  "Type the price as it appears on the page, without the currency symbol. We’ll find where it comes from and track that spot.";
export const UNUSABLE_MESSAGE =
  "That is not a figure we can look for. Type the digits on their own, with at most two decimal places and no currency symbol or thousands separator.";
export const ABSENT_MESSAGE =
  "That price is not on the page we fetched. It may have changed since you looked, or belong to a different size or colour — check the page and try the figure it shows now.";
export const ELSEWHERE_MESSAGE = "We could not find that price, but the page does show these:";
export const UNREACHABLE_MESSAGE =
  "That price is on the page, but nothing around it is stable enough to track — it has no name of its own and neither do the elements holding it. Open Advanced below to point at it yourself.";
