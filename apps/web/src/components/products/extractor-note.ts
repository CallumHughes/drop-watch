import type { ExpressionMode } from "@drop-watch/api/routers/preview";
import type { RenderMode } from "@drop-watch/api/schemas/products";

/**
 * Explains the extraction and rendering path that will be persisted for a new
 * listing. Kept pure because both create forms use the same language.
 *
 * The expression is deliberately not named: it is derived from the price the
 * reader confirmed, not something they wrote, and printing it here would
 * invite editing it in a form that no longer offers to.
 */
export function extractorNote({
  expression,
  hasPrice,
  mode,
  render,
}: {
  expression: string | null;
  hasPrice: boolean;
  mode: ExpressionMode | null;
  render: RenderMode;
}): string {
  if (!hasPrice) {
    return "Find a price above before saving.";
  }

  const extraction =
    mode && expression
      ? "Will be tracked from the price you confirmed on the page"
      : "Will be tracked with the automatic extractor chain";
  const rendering = render === "browser" ? ", loaded in a headless browser" : "";
  return `${extraction}${rendering}.`;
}
