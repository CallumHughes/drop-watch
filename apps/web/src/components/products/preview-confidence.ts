import type {
  ExpressionMode,
  PagePreview,
  PreviewExtraction,
} from "@drop-watch/api/routers/preview";

const AMBIGUOUS_EVIDENCE = /ambiguous|conflict|multiple/i;

function hasAmbiguousEvidence(evidence: PreviewExtraction["evidence"]): boolean {
  const hasMultipleCandidates = "candidateCount" in evidence && evidence.candidateCount > 1;
  return hasMultipleCandidates || Boolean(AMBIGUOUS_EVIDENCE.test(evidence.type));
}

/**
 * Automatic extraction may be saved only when the API explicitly vouches for
 * high confidence. Evidence is displayed as diagnosis, but confidence is the
 * authoritative safety decision because a selected candidate may be one of
 * several legitimate candidates.
 */
export function automaticPreviewNeedsRepair(preview: PagePreview): boolean {
  if (!preview.extraction) {
    return true;
  }
  return preview.extraction.confidence !== "high";
}

/** Explain why an automatic result needs a user-verified expression. */
export function automaticPreviewRepairMessage(preview: PagePreview): string {
  if (
    preview.extraction &&
    (preview.extraction.confidence === "low" || hasAmbiguousEvidence(preview.extraction.evidence))
  ) {
    return "The automatic price is low-confidence or ambiguous, so it cannot be saved as-is. Choose a CSS selector or JSONPath and wait for a successful test.";
  }
  return "This automatic result cannot be saved until its confidence is verified. Choose a CSS selector or JSONPath and wait for a successful test.";
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
