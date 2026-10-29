import type {
  ExpressionMode,
  ExpressionPreview,
  PreviewExtraction,
} from "@drop-watch/api/routers/preview";
import type { RenderMode } from "@drop-watch/api/schemas/products";
import type { ListingExtractor } from "@drop-watch/core/extract/strategies";

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

/**
 * Spells out every change applying would make. An automatic result quietly
 * clearing a working expression is the case this exists for.
 */
export function repairSummary(
  next: ListingExtractionSettings,
  current: ListingExtractionSettings
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
  return `Applying will ${listPhrase(changes)}.`;
}
