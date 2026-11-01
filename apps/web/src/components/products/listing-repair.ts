import type {
  ExpressionMode,
  ExpressionPreview,
  PreviewExtraction,
} from "@drop-watch/api/routers/preview";
import type { RenderMode } from "@drop-watch/api/schemas/products";
import { toMinorUnits } from "@drop-watch/core/decimal";
import type { ListingExtractor } from "@drop-watch/core/extract/strategies";

import { formatPrice } from "@/lib/format";

export interface ListingRepairState {
  chosen: PreviewExtraction | null;
  mode: ExpressionMode | null;
  preview: { render: RenderMode } | null;
  savingWithExpression: boolean;
  trimmedExpression: string;
}

export interface ListingExtractionSettings {
  expression: string | null;
  extractor: ListingExtractor;
  render: RenderMode;
}

/** A manual candidate is safe to apply only when exactly one match parsed. */
export function isSingleMatchExtraction(test: ExpressionPreview | undefined): boolean {
  return Boolean(test?.extraction && test.matchCount === 1);
}

/**
 * Selects the extraction settings to persist after editing a listing. Once a
 * repair preview exists it is authoritative, but only a successful expression
 * test (or an explicitly high-confidence automatic result) can produce a
 * non-null result.
 */
export function listingExtractionSettings(
  state: ListingRepairState,
  current: ListingExtractionSettings
): ListingExtractionSettings | null {
  if (!state.preview) {
    return current;
  }
  if (!state.chosen) {
    return null;
  }
  if (state.savingWithExpression && state.mode) {
    return {
      expression: state.trimmedExpression,
      extractor: state.mode,
      render: state.preview.render,
    };
  }
  return { expression: null, extractor: "auto", render: state.preview.render };
}

/**
 * How this listing's price is found, without naming the expression.
 *
 * The editor no longer offers to change the expression by hand — the repair
 * panel derives it from a price the reader confirms — so printing it here would
 * only invite editing it somewhere that cannot.
 */
export function listingExtractionNote(settings: ListingExtractionSettings): string {
  const extraction =
    settings.extractor === "auto"
      ? "Found automatically from the page's own product data"
      : "Read from a spot on the page you confirmed";
  const rendering = settings.render === "browser" ? ", loaded in a headless browser" : "";
  return `${extraction}${rendering}.`;
}

/** How each pinned mode reads in the settings editor and its repair panel. */
export const EXPRESSION_LABELS: Record<ExpressionMode, string> = {
  jsonpath: "JSONPath",
  selector: "CSS selector",
};

const RENDER_LABELS: Record<RenderMode, string> = {
  browser: "a headless browser",
  http: "plain HTTP",
};

function listPhrase(parts: readonly string[]): string {
  if (parts.length <= 1) {
    return parts[0] ?? "";
  }
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/**
 * Names the outcome rather than the panel: an automatic repair and a pinned
 * one are the same click, and only the label tells them apart.
 */
export function repairActionLabel(next: ListingExtractionSettings | null): string {
  if (!next) {
    return "Apply repair";
  }
  return next.extractor === "auto"
    ? "Apply automatic extraction"
    : `Apply tested ${EXPRESSION_LABELS[next.extractor]}`;
}

/** The price this listing records now, and the price the repair would record. */
export interface TrackedPriceChange {
  /** The currency the repaired reading carries. */
  currency: string | null;
  next: string;
  /** The last price recorded for this listing; `null` when there is none. */
  previous: string | null;
  /** The currency *that* price was recorded in, which need not be the same. */
  previousCurrency: string | null;
}

/**
 * Names the price the repair would start recording, when that differs from the
 * one on record.
 *
 * Worth saying out loud: `drop_percent` fires against this listing's own
 * previous observation, so moving the reading from a was-price to the real one
 * is an artificial fall and the next check can alert on it.
 */
function trackedPriceSentence(tracked: TrackedPriceChange | undefined): string | null {
  if (!tracked?.previous) {
    return null;
  }
  // Each price in the currency it was actually read in. Formatting the price
  // on record with the repaired reading's currency reported a figure in a
  // currency it was never in, in the one sentence meant to be exact about it.
  const switched = tracked.previousCurrency !== tracked.currency;
  let changed = false;
  try {
    changed = toMinorUnits(tracked.previous) !== toMinorUnits(tracked.next);
  } catch {
    return null;
  }
  if (!(changed || switched)) {
    return null;
  }
  const from = formatPrice(tracked.previous, tracked.previousCurrency);
  const to = formatPrice(tracked.next, tracked.currency);
  // Across a currency switch the two figures are not comparable amounts at
  // all, so the sentence says that rather than promising a rise or a fall.
  if (switched) {
    return ` It will record ${to} where ${from} is on record — a different currency, so this listing's history no longer compares like for like.`;
  }
  return ` It will record ${to} where ${from} is on record, so the next check will read as a price change and may alert.`;
}

/**
 * Spells out every change applying would make. An automatic result quietly
 * clearing a working expression is the case this exists for.
 */
export function repairSummary(
  next: ListingExtractionSettings,
  current: ListingExtractionSettings,
  tracked?: TrackedPriceChange
): string {
  const changes: string[] = [];
  if (next.extractor === "auto") {
    changes.push("switch to automatic extraction");
    if (current.extractor !== "auto") {
      changes.push(`clear the saved ${EXPRESSION_LABELS[current.extractor]}`);
    }
  } else {
    changes.push(`pin the tested ${EXPRESSION_LABELS[next.extractor]}`);
  }
  if (next.render !== current.render) {
    changes.push(`check over ${RENDER_LABELS[next.render]}`);
  }
  return `Applying will ${listPhrase(changes)}.${trackedPriceSentence(tracked) ?? ""}`;
}
