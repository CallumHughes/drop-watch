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
import { checkExpression, parseSelectorExpression } from "./expression-guard";
import { describeJsonValue } from "./json-documents";
import { extractJsonLd } from "./jsonld";
import { extractByJsonPath, jsonPathMatches } from "./jsonpath";
import { extractMicrodata } from "./microdata";
import { extractOpenGraph, extractPageMetadata } from "./opengraph";
import { extractBySelector } from "./selector";
import type {
  CheerioSelection,
  ExpressionMode,
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
  ExpressionMode,
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

/**
 * Fallback order. Fixed by the plan; callers may narrow it, not reorder it.
 *
 * `jsonpath` is deliberately absent. It needs an expression the
 * user wrote, so in a chain that runs without one they could only ever no-op —
 * they are reachable by pinning a listing to them, not by falling back.
 */
export const STRATEGY_ORDER: readonly ExtractorStrategy[] = [
  "jsonld",
  "microdata",
  "opengraph",
  "selector",
];

const STRATEGIES: Record<ExtractorStrategy, Strategy> = {
  jsonld: extractJsonLd,
  jsonpath: extractByJsonPath,
  microdata: extractMicrodata,
  opengraph: extractOpenGraph,
  selector: extractBySelector,
};

export interface ExtractOptions {
  /**
   * The configured extraction expression — CSS or JSONPath, read by whichever
   * strategy the caller pinned. Every expression
   * strategy no-ops without it.
   */
  expression?: string;
  /** BCP 47 hint for ambiguous price separators, e.g. "de-DE". */
  locale?: string;
  /** Narrows the chain — e.g. `["selector"]` for a listing configured that way. */
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
  const context: StrategyContext = { $: load(html), html };
  if (options.locale !== undefined) {
    context.locale = options.locale;
  }
  if (options.expression !== undefined) {
    context.expression = options.expression;
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

/** One thing a candidate expression matched, as the picker displays it. */
export interface ExpressionMatch {
  /**
   * What produced the value — the element's markup or the JSON document the
   * path resolved in. Truncated to
   * {@link MAX_SAMPLE_CHARS}.
   */
  context: string;
  /** The value itself: element text, an explicit attribute, or a resolved JSON value. */
  value: string;
}

/**
 * What a candidate expression does to a page: how much it matches, what those
 * matches look like, and whether a price falls out of them.
 */
export interface ExpressionTest {
  /**
   * The string is not valid in its mode — bad CSS or an unparseable path.
   * Distinct from "matched nothing" because it is
   * what every half-typed expression looks like, not a wrong one.
   */
  invalidExpression: boolean;
  /** Why it is invalid; empty when it is not. */
  invalidReason: string;
  matchCount: number;
  /** The pinned strategy's verdict, identical to what a check would record. */
  result: ExtractionResult;
  /** The first few matches in document order. */
  samples: ExpressionMatch[];
}

export interface TestExpressionOptions {
  expression: string;
  locale?: string;
  mode: ExpressionMode;
  url?: string;
}

const COLLAPSE_WHITESPACE = /\s+/g;

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

function failed(error: string, invalidReason = ""): ExpressionTest {
  return {
    invalidExpression: invalidReason !== "",
    invalidReason,
    matchCount: 0,
    result: { error, ok: false },
    samples: [],
  };
}

/**
 * Runs one pinned strategy alone and reports what it saw.
 *
 * This is what the add-product picker calls on every edit, against HTML fetched
 * once and held in memory — the document is parsed here but never
 * re-downloaded. It returns the same {@link ExtractionResult} a scheduled check
 * would record, so what the picker shows is what will be tracked.
 */
export function testExpression(html: string, options: TestExpressionOptions): ExpressionTest {
  if (html.trim().length === 0) {
    return failed("empty document");
  }
  const expression = options.expression.trim();
  if (expression.length === 0) {
    return failed("no expression");
  }

  // Syntax and safety first, so the picker rejects exactly what a save would.
  const check = checkExpression(options.mode, expression);
  if (!check.ok) {
    return failed(check.error, check.error);
  }

  const context = buildContext(html, { ...options, expression });
  if (options.mode === "jsonpath") {
    return jsonPathTest(context, expression, options.url);
  }
  return selectorTest(context, expression, options.url);
}

function toTest(
  context: StrategyContext,
  strategy: ExpressionMode,
  matchCount: number,
  samples: ExpressionMatch[],
  emptyError: string,
  url: string | undefined
): ExpressionTest {
  const candidate = STRATEGIES[strategy](context);
  const result: ExtractionResult = candidate
    ? { ok: true, strategy, ...backfill(candidate, context, url) }
    : { error: matchCount === 0 ? emptyError : unreadableError(strategy), ok: false };
  return { invalidExpression: false, invalidReason: "", matchCount, result, samples };
}

function unreadableError(strategy: ExpressionMode): string {
  if (strategy === "jsonpath") {
    return "resolved, but no price could be read from the value";
  }
  return "matched, but no price could be read from the selected value";
}

function selectorTest(
  context: StrategyContext,
  selector: string,
  url: string | undefined
): ExpressionTest {
  const parsedExpression = parseSelectorExpression(selector);
  if ("error" in parsedExpression) {
    return failed(parsedExpression.error, parsedExpression.error);
  }

  let matched: CheerioSelection;
  try {
    matched = context.$(parsedExpression.selector);
  } catch {
    const reason = `not a valid CSS selector: ${selector}`;
    return failed(reason, reason);
  }

  const samples = matched
    .toArray()
    .slice(0, MAX_SAMPLES)
    .map((element) => ({
      context: truncate(context.$.html(context.$(element)), MAX_SAMPLE_CHARS),
      value: truncate(
        (parsedExpression.attribute
          ? context.$(element).attr(parsedExpression.attribute)
          : context.$(element).text()
        )
          ?.replace(COLLAPSE_WHITESPACE, " ")
          .trim() ?? "",
        MAX_SAMPLE_CHARS
      ),
    }));

  return toTest(context, "selector", matched.length, samples, "matched nothing on this page", url);
}

function jsonPathTest(
  context: StrategyContext,
  expression: string,
  url: string | undefined
): ExpressionTest {
  const matches = jsonPathMatches(context, expression);
  const samples = matches.slice(0, MAX_SAMPLES).map((match) => ({
    context: truncate(match.source, MAX_SAMPLE_CHARS),
    value: truncate(describeJsonValue(match.value), MAX_SAMPLE_CHARS),
  }));

  return toTest(
    context,
    "jsonpath",
    matches.length,
    samples,
    "resolved nothing in any JSON on this page",
    url
  );
}
