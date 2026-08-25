import type { Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";

import type { ExtractorStrategy } from "./strategies";

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

/**
 * Which link in the fallback chain produced the price. Re-exported from
 * `./strategies` so importers of this module keep working — that leaf is the
 * single list, because the database and the zod schemas read it too.
 */
export type { ExpressionMode, ExtractorStrategy } from "./strategies";

/** Whether the extractor found enough evidence to auto-accept the result. */
export type ExtractionConfidence = "high" | "low";

export type ExtractionEvidence =
  | {
      candidateCount: number;
      matchedParams: string[];
      type: "jsonld:variant-params";
    }
  | {
      candidateCount: number;
      type:
        | "jsonld:selected-sku"
        | "jsonld:exact-url"
        | "jsonld:singleton"
        | "jsonld:aggregate-offer"
        | "jsonld:pathname"
        | "jsonld:queried-url"
        | "jsonld:conflict"
        | "jsonld:multiple-candidates"
        | "jsonld:non-product"
        | "jsonld:document-order";
    }
  | {
      candidateCount: number;
      type:
        | "microdata:single-product-price"
        | "microdata:ambiguous"
        | "microdata:document-price"
        | "microdata:queried-url";
    }
  | { type: "opengraph:page-metadata" }
  | {
      matchCount: number;
      type: "selector:configured" | "jsonpath:configured";
    };

export interface Extracted {
  /** Bare schema.org availability token, e.g. "InStock". */
  availability?: string;
  confidence: ExtractionConfidence;
  currency?: string;
  evidence: ExtractionEvidence;
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
  /**
   * The configured extraction expression — a CSS selector or JSONPath,
   * depending on which strategy is reading it. Every expression strategy is
   * skipped without one.
   */
  expression?: string;
  /** The raw body, used to discover embedded JSON documents. */
  html: string;
  /** BCP 47 hint for ambiguous price separators. */
  locale?: string;
  /** Final fetched page URL, used to identify the currently selected JSON-LD variant. */
  url?: string;
}

export type Strategy = (context: StrategyContext) => PriceCandidate | null;
