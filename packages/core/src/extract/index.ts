// Extraction chain: jsonld → microdata → opengraph → selector.
// Implementations land in Epic 2; the result shape is the contract shared by the
// worker (scheduled checks) and apps/web (the add-product preview).

export type ExtractorStrategy = "jsonld" | "microdata" | "opengraph" | "selector";

export interface Extracted {
  currency?: string;
  imageUrl?: string;
  inStock?: boolean;
  /** Decimal string, e.g. "1234.56". Never a float. */
  price: string;
  strategy: ExtractorStrategy;
  title?: string;
}

export type ExtractionResult = ({ ok: true } & Extracted) | { ok: false; error: string };
