import type {
  PriceSuggestion,
  SuggestedExpression,
  SuggestedPrice,
} from "@drop-watch/api/routers/preview";

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
  | { kind: "searching" }
  | { kind: "automatic"; price: string }
  | { candidate: SuggestedExpression; kind: "located" }
  | { kind: "elsewhere"; prices: SuggestedPrice[] }
  | { kind: "absent" };

export function locatorOutcome({
  expectedPrice,
  isLocating,
  suggestion,
}: {
  expectedPrice: string;
  isLocating: boolean;
  suggestion: PriceSuggestion | undefined;
}): LocatorOutcome {
  if (!expectedPriceIsUsable(expectedPrice)) {
    return { kind: "idle" };
  }
  if (isLocating || !suggestion) {
    return { kind: "searching" };
  }
  const { automatic } = suggestion;
  if (automatic && automaticAlreadyReadsIt(automatic)) {
    return { kind: "automatic", price: automatic.price };
  }
  const [candidate] = suggestion.candidates;
  if (candidate) {
    return { candidate, kind: "located" };
  }
  return suggestion.pricesOnPage.length > 0
    ? { kind: "elsewhere", prices: suggestion.pricesOnPage }
    : { kind: "absent" };
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
export const ABSENT_MESSAGE =
  "That price is not on the page we fetched. It may have changed since you looked, or belong to a different size or colour — check the page and try the figure it shows now.";
export const ELSEWHERE_MESSAGE = "We could not find that price, but the page does show these:";
