import { checkExpression } from "@drop-watch/core/extract/expression-guard";
import { LISTING_EXTRACTORS } from "@drop-watch/core/extract/strategies";
import { ALERT_RULES } from "@drop-watch/core/rules";
import { z } from "zod";

export const MIN_INTERVAL_MINUTES = 5;
/** A week. Anything longer is a bookmark, not a tracker. */
export const MAX_INTERVAL_MINUTES = 10_080;
export const MAX_JITTER_PERCENT = 100;
export const MIN_DROP_PERCENT = 1;
export const MAX_DROP_PERCENT = 99;

/**
 * Declared here, not in `./listings`, to avoid an import cycle: `./listings`
 * already imports bounds from this file, so it imports this one too rather
 * than the reverse. Spelled out rather than imported from `@drop-watch/db` for
 * the same reason as every other bound in this file — these schemas are
 * reachable from the browser bundle, and the db package is not.
 */
export const RENDER_MODES = ["http", "browser"] as const;
export type RenderMode = (typeof RENDER_MODES)[number];

/**
 * Matches what `numeric(12,2)` accepts, so a bad target never reaches
 * Postgres. The unanchored source is exported on its own because the HTML
 * `pattern` attribute anchors implicitly and rejects a value with `^`/`$` in
 * some engines — the add-product form uses the source, zod uses the regex.
 */
export const PRICE_PATTERN_SOURCE = String.raw`\d{1,10}(\.\d{1,2})?`;
export const PRICE_PATTERN = new RegExp(`^${PRICE_PATTERN_SOURCE}$`);

/** Bounds on the free-text columns the add-product flow writes. */
export const MAX_URL_LENGTH = 2048;
export const MAX_TITLE_LENGTH = 500;
export const MAX_EXPRESSION_LENGTH = 500;

/**
 * The refines every extraction-carrying schema shares.
 *
 * `expression` holds a CSS selector (optionally ending in `::attr(name)`) or
 * a JSONPath, and `extractor` says which — so "is this valid?" is one question
 * with two answers, asked here rather than restated on each schema. `checkExpression`
 * is the same function the add-product picker calls, so a pattern the picker
 * accepted can never fail on save.
 */
export interface ExtractionInput {
  expression?: string | null | undefined;
  extractor?: string | undefined;
}

export function hasExpressionWhenPinned(input: ExtractionInput): boolean {
  return input.extractor === undefined || input.extractor === "auto"
    ? true
    : Boolean(input.expression?.trim());
}

export function expressionIsValid(input: ExtractionInput): boolean {
  if (!(input.extractor && input.expression?.trim())) {
    return true;
  }
  return checkExpression(input.extractor, input.expression).ok;
}

export const PINNED_NEEDS_EXPRESSION = "A pinned extractor needs an expression";
export const EXPRESSION_IS_INVALID = "The expression is not valid for the chosen extractor";

/**
 * What `products.update` accepts: identity and alert configuration, all
 * optional. Schedule and extraction (`intervalMinutes`, `jitterPercent`,
 * `extractor`, `selector`, ...) are listing-level now and go through
 * `listings.update` instead — a product can have several listings, each on
 * its own schedule, so there is no longer one interval to patch here.
 *
 * `title` has no `null` case: clearing it back to "derive from the URL"
 * is not a thing the settings form does, so `undefined` (not supplied) is
 * the only way to leave it alone and an empty edit is simply not sent.
 */
export const productUpdateInput = z.object({
  active: z.boolean().optional(),
  dropPercent: z.number().int().min(MIN_DROP_PERCENT).max(MAX_DROP_PERCENT).nullable().optional(),
  id: z.uuid(),
  rules: z.array(z.enum(ALERT_RULES)).optional(),
  targetPrice: z.string().regex(PRICE_PATTERN).nullable().optional(),
  title: z.string().max(MAX_TITLE_LENGTH).optional(),
});

export type ProductUpdateInput = z.infer<typeof productUpdateInput>;

/**
 * What the add-product flow saves. Everything past `url` is optional because
 * the preview supplies what it found and the user overrides the rest; only the
 * supplied keys are written.
 */
export const productCreateInput = z
  .object({
    currency: z.string().length(3).nullable().optional(),
    dropPercent: z.number().int().min(MIN_DROP_PERCENT).max(MAX_DROP_PERCENT).nullable().optional(),
    /** CSS (optionally `::attr(name)`) or JSONPath — `extractor` says which. */
    expression: z.string().max(MAX_EXPRESSION_LENGTH).nullable().optional(),
    /** Pinning to a strategy makes a rotted expression fail loudly. */
    extractor: z.enum(LISTING_EXTRACTORS).default("auto"),
    imageUrl: z.url().max(MAX_URL_LENGTH).nullable().optional(),
    intervalMinutes: z
      .number()
      .int()
      .min(MIN_INTERVAL_MINUTES)
      .max(MAX_INTERVAL_MINUTES)
      .optional(),
    jitterPercent: z.number().int().min(0).max(MAX_JITTER_PERCENT).optional(),
    /** BCP 47 hint for pages whose separators are ambiguous. */
    locale: z.string().max(35).nullable().optional(),
    /**
     * Honoured on the first listing, though the add-product form does not yet
     * send it. No path checks that a renderer exists first: the settings
     * editor's "already in browser mode, renderer since removed" escape hatch
     * needs the server to accept that state, so the capability check is
     * advisory throughout.
     */
    render: z.enum(RENDER_MODES).default("http"),
    rules: z.array(z.enum(ALERT_RULES)).optional(),
    targetPrice: z.string().regex(PRICE_PATTERN).nullable().optional(),
    title: z.string().max(MAX_TITLE_LENGTH).nullable().optional(),
    url: z.url().max(MAX_URL_LENGTH),
  })
  .refine(hasExpressionWhenPinned, PINNED_NEEDS_EXPRESSION)
  .refine(expressionIsValid, EXPRESSION_IS_INVALID);

export type ProductCreateInput = z.infer<typeof productCreateInput>;
