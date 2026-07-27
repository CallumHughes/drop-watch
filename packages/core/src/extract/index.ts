/**
 * The extraction chain: jsonld → microdata → opengraph → selector, first valid
 * result wins.
 *
 * "Track any product" is not one scraper, it's a fallback chain. Most ecommerce
 * platforms emit schema.org/Product JSON-LD, so a large share of URLs work with
 * no per-site configuration at all; the selector strategy exists for the rest.
 *
 * This module is pure — HTML in, result out. No network, no database. The
 * worker (scheduled checks) and apps/web (the add-product preview) run this
 * identical code so the preview can never drift from what gets recorded.
 */

import { load } from "cheerio";
import { extractJsonLd } from "./jsonld";
import { extractMicrodata } from "./microdata";
import { extractOpenGraph, extractPageMetadata } from "./opengraph";
import { extractBySelector } from "./selector";
import type {
  ExtractionResult,
  ExtractorStrategy,
  PriceCandidate,
  Strategy,
  StrategyContext,
} from "./types";

/**
 * The result contract. Helpers that callers rarely need (`parsePrice`,
 * `parseAvailability`) stay on their own modules and are reachable as
 * `@price-tracker/core/extract/price` and `.../extract/availability`, which
 * keeps this entrypoint from becoming a barrel over the whole package.
 */
export type {
  Availability,
  Extracted,
  ExtractionResult,
  ExtractorStrategy,
  PriceCandidate,
  StrategyContext,
} from "./types";

/** Fallback order. Fixed by the plan; callers may narrow it, not reorder it. */
export const STRATEGY_ORDER: readonly ExtractorStrategy[] = [
  "jsonld",
  "microdata",
  "opengraph",
  "selector",
];

const STRATEGIES: Record<ExtractorStrategy, Strategy> = {
  jsonld: extractJsonLd,
  microdata: extractMicrodata,
  opengraph: extractOpenGraph,
  selector: extractBySelector,
};

export interface ExtractOptions {
  /** BCP 47 hint for ambiguous price separators, e.g. "de-DE". */
  locale?: string;
  /** CSS selector for the `selector` strategy. Without it that strategy no-ops. */
  selector?: string;
  /** Narrows the chain — e.g. `["selector"]` for a product configured that way. */
  strategies?: readonly ExtractorStrategy[];
  /** Page URL, used to resolve a relative image URL to an absolute one. */
  url?: string;
}

function absoluteUrl(imageUrl: string, base: string | undefined): string {
  if (!base) {
    return imageUrl;
  }
  try {
    return new URL(imageUrl, base).toString();
  } catch {
    return imageUrl;
  }
}

/**
 * The winning strategy owns price, currency and stock. Title and image are
 * merged in from page metadata when it did not supply them — a selector match
 * on a price span knows nothing about the product name, but og:title does.
 */
function backfill(
  candidate: PriceCandidate,
  context: StrategyContext,
  url: string | undefined
): PriceCandidate {
  const metadata = extractPageMetadata(context.$);
  const merged: PriceCandidate = { ...candidate };
  if (merged.title === undefined && metadata.title !== undefined) {
    merged.title = metadata.title;
  }
  if (merged.imageUrl === undefined && metadata.imageUrl !== undefined) {
    merged.imageUrl = metadata.imageUrl;
  }
  if (merged.imageUrl !== undefined) {
    merged.imageUrl = absoluteUrl(merged.imageUrl, url);
  }
  return merged;
}

/**
 * Runs the fallback chain over a fetched HTML document.
 *
 * The result is discriminated on `ok` and names the strategy that won, so the
 * UI can show it and `checkRuns.extractorUsed` can record it.
 */
export function extract(html: string, options: ExtractOptions = {}): ExtractionResult {
  if (html.trim().length === 0) {
    return { error: "empty document", ok: false };
  }

  const order = options.strategies ?? STRATEGY_ORDER;
  const context: StrategyContext = { $: load(html) };
  if (options.locale !== undefined) {
    context.locale = options.locale;
  }
  if (options.selector !== undefined) {
    context.selector = options.selector;
  }

  for (const strategy of order) {
    const candidate = STRATEGIES[strategy](context);
    if (candidate) {
      return { ok: true, strategy, ...backfill(candidate, context, options.url) };
    }
  }

  return { error: `no price found (tried: ${order.join(", ")})`, ok: false };
}
