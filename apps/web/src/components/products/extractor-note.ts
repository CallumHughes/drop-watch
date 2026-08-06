import type { RenderMode } from "@drop-watch/api/schemas/products";

/**
 * Explains the exact extraction and rendering path that will be persisted for
 * a new listing. Kept pure because both create forms use the same language.
 */
export function extractorNote({
  hasPrice,
  render,
  selector,
}: {
  hasPrice: boolean;
  render: RenderMode;
  selector: string | null;
}): string {
  if (!hasPrice) {
    return "Find a price above before saving.";
  }

  const extraction = selector
    ? `Will be tracked with the selector ${selector}`
    : "Will be tracked with the automatic extractor chain";
  const rendering = render === "browser" ? ", loaded in a headless browser" : "";
  return `${extraction}${rendering}.`;
}
