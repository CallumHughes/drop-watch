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
 */

import type { NewListing } from "@drop-watch/db/schema/products";

import type { ListingCreateInput } from "./schemas/listings";

/**
 * The settings a create input carries. `productId` and `url` are excluded
 * because they are not settings — they identify the row and are passed
 * explicitly, from different places on each path.
 */
type ListingSettingKey = Exclude<keyof ListingCreateInput, "productId" | "url">;

const LISTING_INSERT_KEYS = Object.keys({
  currency: true,
  extractor: true,
  intervalMinutes: true,
  jitterPercent: true,
  locale: true,
  selector: true,
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
