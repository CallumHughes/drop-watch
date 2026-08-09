import type { ExpressionMode } from "@drop-watch/api/routers/preview";
import type { RenderMode } from "@drop-watch/api/schemas/products";

/** How each pinned mode reads in prose. */
const MODE_LABELS: Record<ExpressionMode, string> = {
  jsonpath: "the JSONPath",
  regex: "the regular expression",
  selector: "the selector",
};

/**
 * Explains the exact extraction and rendering path that will be persisted for
 * a new listing. Kept pure because both create forms use the same language.
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
      ? `Will be tracked with ${MODE_LABELS[mode]} ${expression}`
      : "Will be tracked with the automatic extractor chain";
  const rendering = render === "browser" ? ", loaded in a headless browser" : "";
  return `${extraction}${rendering}.`;
}
