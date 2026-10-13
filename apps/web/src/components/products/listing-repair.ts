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
