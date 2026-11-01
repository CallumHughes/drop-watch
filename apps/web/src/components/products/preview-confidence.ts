import type {
  ExpressionMode,
  PagePreview,
  PreviewExtraction,
} from "@drop-watch/api/routers/preview";
import { isAmbiguousExtraction } from "@drop-watch/core/extract/evidence";

/**
 * Automatic extraction may be saved unless the extractor saw more than one
 * price it could have picked. This has to agree with the worker's gate or the
 * preview would promise a price no check will ever record, so both read
 * `isAmbiguousExtraction` rather than keeping their own rule.
 *
 * Deliberately not `confidence !== "high"`: confidence is also low when a
 * single candidate simply has nothing corroborating it, which is unambiguous
 * and recordable.
 */
export function automaticPreviewNeedsRepair(preview: PagePreview): boolean {
  if (!preview.extraction) {
    return true;
  }
  return isAmbiguousExtraction(preview.extraction);
}

/** Explain why an automatic result needs a user-verified expression. */
export function automaticPreviewRepairMessage(preview: PagePreview): string {
  if (preview.extraction) {
    return "The automatic price is ambiguous — this page offers more than one price and nothing identifies which one is being sold. Tell us the price it shows and we will work out where it comes from.";
  }
  return "No price could be read from this page automatically. Tell us the price it shows and we will work out where it comes from.";
}

/**
 * Keeps the preview's automatic safety requirement separate from the current
 * manual result. A successful manual expression changes what can be saved,
 * not whether the original automatic result was safe to restore.
 */
export function previewSelection({
  manualExtraction,
  mode,
  preview,
}: {
  manualExtraction: PreviewExtraction | null;
  mode: ExpressionMode | null;
  preview: PagePreview | null;
}): { automaticRepairRequired: boolean; chosen: PreviewExtraction | null } {
  const automaticRepairRequired = preview !== null && automaticPreviewNeedsRepair(preview);
  let chosen = manualExtraction;
  if (mode === null) {
    chosen = preview?.extraction ?? null;
  }
  if (mode === null && automaticRepairRequired) {
    chosen = null;
  }
  return { automaticRepairRequired, chosen };
}
