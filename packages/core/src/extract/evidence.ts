/**
 * Whether a result is *ambiguous*, which is not the same question as whether
 * it is confident.
 *
 * `confidence` is low in two very different situations: the extractor saw
 * several prices and could not tell which one the page is selling, and the
 * extractor saw exactly one price but nothing corroborating that it belongs
 * to this URL. Only the first is a reason to refuse to record a price. A sole
 * JSON-LD offer on `/p?ProductID=99`, or a single `product:price:amount` meta
 * tag, is unambiguous however little evidence backs it.
 *
 * So persistence gates on this, while the preview's browser escalation keeps
 * gating on `confidence` — "is this safe to record?" and "would rendering
 * tell us more?" are different questions and want different answers.
 *
 * Type-only imports, so this stays reachable from the browser bundle.
 */

import type { ExtractionConfidence, ExtractionEvidence } from "./types";

/**
 * Evidence that the chosen price may be the wrong one even though only one
 * candidate survived: a contradiction between the page's own signals, or a
 * price that was never a single figure to begin with.
 */
const CONFLICTING_EVIDENCE_TYPES: ReadonlySet<ExtractionEvidence["type"]> = new Set([
  "jsonld:aggregate-offer",
  "jsonld:conflict",
  "jsonld:multiple-candidates",
  "jsonld:non-product",
  "microdata:ambiguous",
]);

/** More than one price was in play, or the page contradicted itself. */
export function ambiguousEvidence(evidence: ExtractionEvidence): boolean {
  if ("candidateCount" in evidence && evidence.candidateCount > 1) {
    return true;
  }
  return CONFLICTING_EVIDENCE_TYPES.has(evidence.type);
}

/** The confidence and evidence pair every extraction carries, flattened or not. */
export interface ConfidenceSignals {
  confidence: ExtractionConfidence;
  evidence: ExtractionEvidence;
}

/**
 * The gate itself. A high-confidence result is always recordable — it got
 * there by positively identifying its candidate, which is why a selected-SKU
 * match among three candidates passes. A low-confidence one is refused only
 * when the evidence says more than one price was on the table.
 */
export function isAmbiguousExtraction(signals: ConfidenceSignals): boolean {
  return signals.confidence === "low" && ambiguousEvidence(signals.evidence);
}
