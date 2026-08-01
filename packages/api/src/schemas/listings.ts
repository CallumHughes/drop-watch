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

import { z } from "zod";

import {
  MAX_INTERVAL_MINUTES,
  MAX_JITTER_PERCENT,
  MAX_SELECTOR_LENGTH,
  MAX_URL_LENGTH,
  MIN_INTERVAL_MINUTES,
} from "./products";

/** BCP 47 hint, same bound as `productCreateInput.locale`. */
const MAX_LOCALE_LENGTH = 35;

/** Adds a store to an existing product. */
export const listingCreateInput = z
  .object({
    currency: z.string().length(3).nullable().optional(),
    /** Pinning to `selector` makes a rotted selector fail loudly. */
    extractor: z.enum(["auto", "selector"]).default("auto"),
    intervalMinutes: z
      .number()
      .int()
      .min(MIN_INTERVAL_MINUTES)
      .max(MAX_INTERVAL_MINUTES)
      .optional(),
    jitterPercent: z.number().int().min(0).max(MAX_JITTER_PERCENT).optional(),
    locale: z.string().max(MAX_LOCALE_LENGTH).nullable().optional(),
    productId: z.uuid(),
    selector: z.string().max(MAX_SELECTOR_LENGTH).nullable().optional(),
    url: z.url().max(MAX_URL_LENGTH),
  })
  .refine(
    (input) => input.extractor !== "selector" || Boolean(input.selector?.trim()),
    "A selector-mode listing needs a selector"
  );

export type ListingCreateInput = z.infer<typeof listingCreateInput>;

/**
 * What `listings.update` accepts: schedule and extraction settings, all
 * optional.
 *
 * The selector refine is deliberately narrower than `listingCreateInput`'s.
 * An update can set `extractor: "selector"` without also sending `selector`
 * — the listing may already have one from an earlier edit, and the merged
 * result (existing selector + this patch) is only knowable once the router
 * has loaded the row. So the schema only rejects the case it *can* see
 * without that context: `extractor: "selector"` paired with a `selector` key
 * that was explicitly supplied but empty or `null` in the same call — sending
 * a selector-mode switch and a selector-clearing edit together is
 * self-contradictory regardless of what the row currently holds. Anything
 * else (extractor supplied, selector omitted) is the router's job, against
 * the merged state.
 */
export const listingUpdateInput = z
  .object({
    active: z.boolean().optional(),
    currency: z.string().length(3).nullable().optional(),
    extractor: z.enum(["auto", "selector"]).optional(),
    id: z.uuid(),
    intervalMinutes: z
      .number()
      .int()
      .min(MIN_INTERVAL_MINUTES)
      .max(MAX_INTERVAL_MINUTES)
      .optional(),
    jitterPercent: z.number().int().min(0).max(MAX_JITTER_PERCENT).optional(),
    locale: z.string().max(MAX_LOCALE_LENGTH).nullable().optional(),
    selector: z.string().max(MAX_SELECTOR_LENGTH).nullable().optional(),
  })
  .refine(
    (input) =>
      !(input.extractor === "selector" && input.selector !== undefined && !input.selector?.trim()),
    "A selector-mode listing needs a selector"
  );

export type ListingUpdateInput = z.infer<typeof listingUpdateInput>;
