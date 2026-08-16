/**
 * The listings router's input schemas, in a module with no server imports —
 * same rationale as `./products`: the router pulls in the database, and a
 * client bundle must never do that.
 *
 * Bounds are imported from `./products` rather than redeclared: a listing's
 * interval, jitter, url and selector are the same columns products.create
 * used to write directly, and the browser and the server must keep rejecting
 * exactly the same values either way.
 */

import { LISTING_EXTRACTORS } from "@drop-watch/core/extract/strategies";
import { z } from "zod";

import {
  EXPRESSION_IS_INVALID,
  expressionIsValid,
  hasExpressionWhenPinned,
  MAX_EXPRESSION_LENGTH,
  MAX_INTERVAL_MINUTES,
  MAX_JITTER_PERCENT,
  MAX_URL_LENGTH,
  MIN_INTERVAL_MINUTES,
  PINNED_NEEDS_EXPRESSION,
  RENDER_MODES,
} from "./products";

/** BCP 47 hint, same bound as `productCreateInput.locale`. */
const MAX_LOCALE_LENGTH = 35;

/** Adds a store to an existing product. */
export const listingCreateInput = z
  .object({
    currency: z.string().length(3).nullable().optional(),
    /** CSS (optionally `::attr(name)`) or JSONPath — `extractor` says which. */
    expression: z.string().max(MAX_EXPRESSION_LENGTH).nullable().optional(),
    /** Pinning to a strategy makes a rotted expression fail loudly. */
    extractor: z.enum(LISTING_EXTRACTORS).default("auto"),
    intervalMinutes: z
      .number()
      .int()
      .min(MIN_INTERVAL_MINUTES)
      .max(MAX_INTERVAL_MINUTES)
      .optional(),
    jitterPercent: z.number().int().min(0).max(MAX_JITTER_PERCENT).optional(),
    locale: z.string().max(MAX_LOCALE_LENGTH).nullable().optional(),
    productId: z.uuid(),
    render: z.enum(RENDER_MODES).default("http"),
    url: z.url().max(MAX_URL_LENGTH),
  })
  .refine(hasExpressionWhenPinned, PINNED_NEEDS_EXPRESSION)
  .refine(expressionIsValid, EXPRESSION_IS_INVALID);

export type ListingCreateInput = z.infer<typeof listingCreateInput>;

/**
 * What `listings.update` accepts: schedule and extraction settings, all
 * optional.
 *
 * The expression refine is deliberately narrower than `listingCreateInput`'s.
 * An update can pin `extractor` without also sending `expression` — the
 * listing may already have one from an earlier edit, and the merged result
 * (existing expression + this patch) is only knowable once the router has
 * loaded the row. So the schema only rejects the case it *can* see without
 * that context: a pinned `extractor` paired with an `expression` key that was
 * explicitly supplied but empty or `null` in the same call — sending a
 * mode switch and an expression-clearing edit together is self-contradictory
 * regardless of what the row currently holds. Anything else (extractor
 * supplied, expression omitted) is the router's job, against the merged state.
 *
 * Syntax is checked here either way: an expression that was actually supplied
 * can be validated without knowing the row.
 */
export const listingUpdateInput = z
  .object({
    active: z.boolean().optional(),
    currency: z.string().length(3).nullable().optional(),
    expression: z.string().max(MAX_EXPRESSION_LENGTH).nullable().optional(),
    extractor: z.enum(LISTING_EXTRACTORS).optional(),
    id: z.uuid(),
    intervalMinutes: z
      .number()
      .int()
      .min(MIN_INTERVAL_MINUTES)
      .max(MAX_INTERVAL_MINUTES)
      .optional(),
    jitterPercent: z.number().int().min(0).max(MAX_JITTER_PERCENT).optional(),
    locale: z.string().max(MAX_LOCALE_LENGTH).nullable().optional(),
    render: z.enum(RENDER_MODES).optional(),
  })
  .refine(
    (input) =>
      !(
        input.extractor !== undefined &&
        input.extractor !== "auto" &&
        input.expression !== undefined &&
        !input.expression?.trim()
      ),
    PINNED_NEEDS_EXPRESSION
  )
  .refine(expressionIsValid, EXPRESSION_IS_INVALID);

export type ListingUpdateInput = z.infer<typeof listingUpdateInput>;
