/**
 * How create-input keys become a listing row, in one place because two routers
 * write listings: `products.create` inserts a product's first listing, and
 * `listings.add` inserts every one after that.
 *
 * Both used to carry their own copy of the key list. Nothing made the copies
 * agree, so a new listing setting added to the schemas would silently be
 * dropped on whichever path its author forgot — and the two paths look alike
 * enough that the gap would only show up as "the interval I typed on the
 * add-store form didn't stick".
 *
 * The list is now checked against the schema instead of trusted: it is spelled
 * as a `Record` over every settings key of `listingCreateInput`, so adding a
 * setting to the schema without adding it here is a type error rather than a
 * lost column.
 *
 * `buildListingPatch` (for `listings.update`) lives here too now, guarded the
 * same way, for three reasons:
 * - The insert and patch key sets legitimately differ (`active` is patch-only,
 *   `url`/`productId` are create-only), so one shared runtime list is not
 *   expressible — two `satisfies Record<K, true>` guards a reader sees
 *   together is the only way both can be "cannot diverge" simultaneously.
 * - `routers/listings.ts` imports `@drop-watch/db` at module scope, which made
 *   `buildListingPatch` untestable where it lived. This module has no server
 *   imports.
 * - It exists to stop a new listing setting being silently dropped on the path
 *   its author forgot — exactly the update path's bug.
 */

import type { Listing, NewListing } from "@drop-watch/db/schema/products";

import type { ListingCreateInput, ListingUpdateInput } from "./schemas/listings";

/**
 * The settings a create input carries. `productId` and `url` are excluded
 * because they are not settings — they identify the row and are passed
 * explicitly, from different places on each path.
 */
type ListingSettingKey = Exclude<keyof ListingCreateInput, "productId" | "url">;

const LISTING_INSERT_KEYS = Object.keys({
  currency: true,
  expression: true,
  extractor: true,
  intervalMinutes: true,
  jitterPercent: true,
  locale: true,
  render: true,
} satisfies Record<ListingSettingKey, true>) as ListingSettingKey[];

/**
 * What either router can hand over: `listingCreateInput` minus the parent id
 * it names, which `productCreateInput` satisfies too — the product create form
 * collects the same settings for the listing it opens with.
 */
export type ListingInsertInput = Omit<ListingCreateInput, "productId">;

/**
 * Only the supplied settings, plus `nextCheckAt` pinned to now so the minutely
 * dispatcher picks the listing up on its next tick rather than after a first
 * full interval — adding something and watching nothing happen for three hours
 * reads as a bug.
 */
export function buildListingInsert(
  input: ListingInsertInput,
  productId: string,
  ownerId: string,
  now: Date
): NewListing {
  const values: NewListing = { nextCheckAt: now, productId, url: input.url, userId: ownerId };
  for (const key of LISTING_INSERT_KEYS) {
    const value = input[key];
    if (value !== undefined) {
      Object.assign(values, { [key]: value });
    }
  }
  return values;
}

/** The keys `listings.update` may patch — every settings key except `id`. */
type ListingPatchKey = Exclude<keyof ListingUpdateInput, "id">;

const LISTING_PATCH_KEYS = Object.keys({
  active: true,
  currency: true,
  expression: true,
  extractor: true,
  intervalMinutes: true,
  jitterPercent: true,
  locale: true,
  render: true,
} satisfies Record<ListingPatchKey, true>) as ListingPatchKey[];

/** Only the keys actually supplied, routed onto the listing row. */
export function buildListingPatch(input: ListingUpdateInput): Partial<Listing> {
  const patch: Partial<Listing> = {};
  for (const key of LISTING_PATCH_KEYS) {
    const value = input[key];
    if (value !== undefined) {
      Object.assign(patch, { [key]: value });
    }
  }
  return patch;
}

/**
 * Settings whose values change what a check can retrieve or extract. A
 * conditional-request validator is only valid for the request/extraction
 * configuration that produced it, so changing one of these settings requires
 * a fresh request with no validators.
 */
type ExtractionSettingKey = "expression" | "extractor" | "locale" | "render";

const EXTRACTION_SETTING_KEYS: ExtractionSettingKey[] = [
  "extractor",
  "expression",
  "locale",
  "render",
];

/** True only when an extraction-affecting key was supplied with a new value. */
export function extractionSettingsChanged(
  listing: Pick<Listing, ExtractionSettingKey>,
  input: Pick<ListingUpdateInput, ExtractionSettingKey>
): boolean {
  return EXTRACTION_SETTING_KEYS.some(
    (key) => input[key] !== undefined && input[key] !== listing[key]
  );
}

/**
 * Composes an update patch, including the schedule change calculated by the
 * router. Extraction changes invalidate both conditional-request validators
 * and take precedence over an interval pull-in: the new configuration must
 * be tested immediately, not after the old interval or a newly calculated
 * future timestamp.
 */
export function buildListingUpdatePatch(
  listing: Pick<Listing, ExtractionSettingKey>,
  input: ListingUpdateInput,
  now: Date,
  pulledIn: Date | undefined
): Partial<Listing> {
  const patch = buildListingPatch(input);
  if (extractionSettingsChanged(listing, input)) {
    Object.assign(patch, { etag: null, lastModified: null, nextCheckAt: now });
  } else if (pulledIn !== undefined) {
    patch.nextCheckAt = pulledIn;
  }
  return patch;
}
