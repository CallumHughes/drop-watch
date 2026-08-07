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
  CheerioSelection,
  ExtractionResult,
  ExtractorStrategy,
  PriceCandidate,
  Strategy,
  StrategyContext,
} from "./types";

/**
 * The result contract. Helpers that callers rarely need (`parsePrice`,
 * `parseAvailability`) stay on their own modules and are reachable as
 * `@drop-watch/core/extract/price` and `.../extract/availability`, which
 * keeps this entrypoint from becoming a barrel over the whole package.
 */
export type {
  Availability,
  Extracted,
  ExtractionConfidence,
  ExtractionEvidence,
  ExtractionResult,
  ExtractorStrategy,
  PriceCandidate,
  StrategyContext,
} from "./types";

/** Matched elements reported back to the selector picker. Enough to recognise
 * the right one, few enough that a selector matching a whole page stays cheap. */
const MAX_SAMPLES = 5;
/** One matched element's markup, truncated. A `<div>` can be the whole page. */
const MAX_SAMPLE_CHARS = 300;

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
function buildContext(html: string, options: ExtractOptions): StrategyContext {
  const context: StrategyContext = { $: load(html) };
  if (options.locale !== undefined) {
    context.locale = options.locale;
  }
  if (options.selector !== undefined) {
    context.selector = options.selector;
  }
  if (options.url !== undefined) {
    context.url = options.url;
  }
  return context;
}

export function extract(html: string, options: ExtractOptions = {}): ExtractionResult {
  if (html.trim().length === 0) {
    return { error: "empty document", ok: false };
  }

  const order = options.strategies ?? STRATEGY_ORDER;
  const context = buildContext(html, options);

  for (const strategy of order) {
    const candidate = STRATEGIES[strategy](context);
    if (candidate) {
      return { ok: true, strategy, ...backfill(candidate, context, options.url) };
    }
  }

  return { error: `no price found (tried: ${order.join(", ")})`, ok: false };
}

/** One element a candidate selector matched, as the picker displays it. */
export interface SelectorMatch {
  /** The element's own markup, truncated to {@link MAX_SAMPLE_CHARS}. */
  html: string;
  /** Its text with whitespace collapsed — usually the price itself. */
  text: string;
}

/**
 * What a candidate selector does to a page: how much it matches, what those
 * matches look like, and whether a price falls out of them.
 */
export interface SelectorTest {
  /**
   * The string is not valid CSS. Distinct from "matched nothing" because it is
   * what a half-typed selector looks like, not a wrong one.
   */
  invalidSelector: boolean;
  matchCount: number;
  /** The `selector` strategy's verdict, identical to what a check would record. */
  result: ExtractionResult;
  /** The first few matches in document order. */
  samples: SelectorMatch[];
}

export interface TestSelectorOptions {
  locale?: string;
  selector: string;
  url?: string;
}

const COLLAPSE_WHITESPACE = /\s+/g;

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

function failed(error: string, invalidSelector = false): SelectorTest {
  return { invalidSelector, matchCount: 0, result: { error, ok: false }, samples: [] };
}

/**
 * Runs the `selector` strategy alone and reports what it saw.
 *
 * This is what the add-product selector picker calls on every edit, against
 * HTML fetched once and held in memory — the document is parsed
 * here but never re-downloaded. It returns the same {@link ExtractionResult}
 * a scheduled check would record, so what the picker shows is what will be
 * tracked.
 */
export function testSelector(html: string, options: TestSelectorOptions): SelectorTest {
  if (html.trim().length === 0) {
    return failed("empty document");
  }
  if (options.selector.trim().length === 0) {
    return failed("no selector");
  }

  const context = buildContext(html, options);
  let matched: CheerioSelection;
  try {
    matched = context.$(options.selector);
  } catch {
    return failed(`not a valid CSS selector: ${options.selector}`, true);
  }

  const samples = matched
    .toArray()
    .slice(0, MAX_SAMPLES)
    .map((element) => ({
      html: truncate(context.$.html(context.$(element)), MAX_SAMPLE_CHARS),
      text: truncate(
        context.$(element).text().replace(COLLAPSE_WHITESPACE, " ").trim(),
        MAX_SAMPLE_CHARS
      ),
    }));

  const candidate = extractBySelector(context);
  const result: ExtractionResult = candidate
    ? { ok: true, strategy: "selector", ...backfill(candidate, context, options.url) }
    : {
        error:
          matched.length === 0
            ? "matched nothing on this page"
            : "matched, but no price could be read from the matched text",
        ok: false,
      };

  return { invalidSelector: false, matchCount: matched.length, result, samples };
}
