import type { Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";

/**
 * A cheerio selection, and the raw node it wraps. `domhandler` is part of
 * cheerio's public type surface, so it is a direct dependency rather than
 * something we reach into transitively.
 */
export type CheerioSelection = Cheerio<AnyNode>;
export type CheerioElement = AnyNode;

/** A normalised schema.org availability token plus the boolean rules compare. */
export interface Availability {
  /** The bare schema.org token, e.g. "InStock" — stored for restock alerts. */
  availability: string;
  /** undefined when the token is present but not one we recognise. */
  inStock?: boolean;
}

/** Which link in the fallback chain produced the price. */
export type ExtractorStrategy = "jsonld" | "microdata" | "opengraph" | "selector";

export interface Extracted {
  /** Bare schema.org availability token, e.g. "InStock". */
  availability?: string;
  currency?: string;
  imageUrl?: string;
  inStock?: boolean;
  /** Decimal string, e.g. "1234.56". Never a float. */
  price: string;
  strategy: ExtractorStrategy;
  title?: string;
}

/** What a single strategy returns — the chain stamps on the strategy name. */
export type PriceCandidate = Omit<Extracted, "strategy">;

export type ExtractionResult = ({ ok: true } & Extracted) | { ok: false; error: string };

export interface StrategyContext {
  /** The parsed document, loaded once and shared by every strategy. */
  $: CheerioAPI;
  /** BCP 47 hint for ambiguous price separators. */
  locale?: string;
  /** CSS selector for the `selector` strategy; that strategy is skipped without one. */
  selector?: string;
}

export type Strategy = (context: StrategyContext) => PriceCandidate | null;
