/**
 * The products router's input schemas, in a module with no server imports.
 *
 * The router (`../routers/products`) validates with these; the web app's forms
 * import the same bounds for their native `min`/`max`/`pattern` attributes, so
 * the browser and the server reject exactly the same values. That sharing is
 * why this file exists: the router itself pulls in the database, which a
 * client bundle must never do.
 */

import { ALERT_RULES } from "@drop-watch/core/rules";
import { z } from "zod";

export const MIN_INTERVAL_MINUTES = 5;
/** A week. Anything longer is a bookmark, not a tracker. */
export const MAX_INTERVAL_MINUTES = 10_080;
export const MAX_JITTER_PERCENT = 100;
export const MIN_DROP_PERCENT = 1;
export const MAX_DROP_PERCENT = 99;

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
export const MAX_SELECTOR_LENGTH = 500;

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
    /** Pinning to `selector` makes a rotted selector fail loudly. */
    extractor: z.enum(["auto", "selector"]).default("auto"),
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
    rules: z.array(z.enum(ALERT_RULES)).optional(),
    selector: z.string().max(MAX_SELECTOR_LENGTH).nullable().optional(),
    targetPrice: z.string().regex(PRICE_PATTERN).nullable().optional(),
    title: z.string().max(MAX_TITLE_LENGTH).nullable().optional(),
    url: z.url().max(MAX_URL_LENGTH),
  })
  .refine(
    (input) => input.extractor !== "selector" || Boolean(input.selector?.trim()),
    "A selector-mode product needs a selector"
  );

export type ProductCreateInput = z.infer<typeof productCreateInput>;
