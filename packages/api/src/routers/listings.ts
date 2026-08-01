/**
 * Listing-level management: add a store to a product, tune one listing's
 * schedule and extraction, drop a listing, and check one listing right now.
 *
 * A listing never renders on its own — the product card and detail page are
 * what read this — so every mutation here returns the parent product's
 * refreshed {@link ProductSummary} rather than the bare listing, the same
 * contract `products.create`/`update` already use. That means the UI never
 * has to reassemble a summary from a partial update.
 *
 * Owner scoping mirrors `routers/products.ts` exactly: a listing (or product)
 * id that is not the caller's answers NOT_FOUND, never FORBIDDEN, so "not
 * yours" is indistinguishable from "doesn't exist".
 */

import { db } from "@drop-watch/db";
import { sendCheckNow } from "@drop-watch/db/queue";
import type { Listing, NewListing } from "@drop-watch/db/schema/products";
import { listings } from "@drop-watch/db/schema/products";
import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { protectedProcedure } from "../index";
import { getSenderBoss } from "../queue";
import { listingCreateInput, listingUpdateInput } from "../schemas/listings";
import { type ProductSummary, pulledInNextCheckAt } from "../summary";
import { loadProduct, summariseOne } from "./products";

/**
 * A listing *belonging to the requester*, or NOT_FOUND. Same rationale as
 * `products.ts`'s `loadProduct`: an id that belongs to someone else must be
 * indistinguishable from one that does not exist.
 */
async function loadListing(id: string, ownerId: string): Promise<Listing> {
  const [listing] = await db
    .select()
    .from(listings)
    .where(and(eq(listings.id, id), eq(listings.userId, ownerId)))
    .limit(1);
  if (!listing) {
    throw new ORPCError("NOT_FOUND", { message: "Listing not found" });
  }
  return listing;
}

type CreateInput = z.infer<typeof listingCreateInput>;

const LISTING_INSERT_KEYS = [
  "currency",
  "extractor",
  "intervalMinutes",
  "jitterPercent",
  "locale",
  "selector",
] as const;

/**
 * Only the supplied create-input keys, plus `nextCheckAt` pinned to now so
 * the minutely dispatcher picks the new listing up on its next tick — same
 * rationale as `products.ts`'s `buildListingInsert`.
 */
function buildListingInsert(input: CreateInput, ownerId: string, now: Date): NewListing {
  const values: NewListing = {
    nextCheckAt: now,
    productId: input.productId,
    url: input.url,
    userId: ownerId,
  };
  for (const key of LISTING_INSERT_KEYS) {
    const value = input[key];
    if (value !== undefined) {
      Object.assign(values, { [key]: value });
    }
  }
  return values;
}

type UpdateInput = z.infer<typeof listingUpdateInput>;

/** Only the keys actually supplied, routed onto the listing row. */
function buildListingPatch(input: UpdateInput): Partial<Listing> {
  const { active, currency, extractor, intervalMinutes, jitterPercent, locale, selector } = input;
  const patch: Partial<Listing> = {};
  if (active !== undefined) {
    patch.active = active;
  }
  if (currency !== undefined) {
    patch.currency = currency;
  }
  if (extractor !== undefined) {
    patch.extractor = extractor;
  }
  if (intervalMinutes !== undefined) {
    patch.intervalMinutes = intervalMinutes;
  }
  if (jitterPercent !== undefined) {
    patch.jitterPercent = jitterPercent;
  }
  if (locale !== undefined) {
    patch.locale = locale;
  }
  if (selector !== undefined) {
    patch.selector = selector;
  }
  return patch;
}

export const listingsRouter = {
  /**
   * Adds a store to an existing product. `(userId, url)` is unique, same as
   * `products.create`'s first listing — adding something *you* already track
   * is a mistake worth naming, not a duplicate row.
   */
  add: protectedProcedure
    .input(listingCreateInput)
    .handler(async ({ context, input }): Promise<ProductSummary> => {
      const ownerId = context.session.user.id;
      const product = await loadProduct(input.productId, ownerId);
      const now = new Date();
      const [inserted] = await db
        .insert(listings)
        .values(buildListingInsert(input, ownerId, now))
        .onConflictDoNothing({ target: [listings.userId, listings.url] })
        .returning();
      if (!inserted) {
        throw new ORPCError("CONFLICT", { message: "That URL is already being tracked." });
      }
      return await summariseOne(product);
    }),

  /**
   * Enqueues an immediate check for one listing, same contract as
   * `products.checkNow` but scoped to a single store rather than every
   * listing on the product.
   */
  checkNow: protectedProcedure
    .input(z.object({ listingId: z.uuid() }))
    .handler(
      async ({
        context,
        input,
      }): Promise<{ jobId: string | null; status: "already_checking" | "queued" }> => {
        const listing = await loadListing(input.listingId, context.session.user.id);
        const boss = await getSenderBoss();
        const jobId = await sendCheckNow(boss, listing.id);
        return jobId ? { jobId, status: "queued" } : { jobId: null, status: "already_checking" };
      }
    ),

  /**
   * Drops a listing — cascades remove its price points, check runs, and
   * `brokenReportedAt` with it. Refused on a product's last listing: deleting
   * it would leave an inert product with nothing watching it and no listing
   * left to re-add through, which is worse than just not allowing it. The UI
   * offers product deletion for that case instead.
   */
  remove: protectedProcedure
    .input(z.object({ id: z.uuid() }))
    .handler(async ({ context, input }): Promise<ProductSummary> => {
      const ownerId = context.session.user.id;
      const listing = await loadListing(input.id, ownerId);
      const siblings = await db
        .select({ id: listings.id })
        .from(listings)
        .where(eq(listings.productId, listing.productId));
      if (siblings.length <= 1) {
        throw new ORPCError("CONFLICT", {
          message:
            "This is the only listing on this product. Delete the product instead of its last listing.",
        });
      }
      await db.delete(listings).where(eq(listings.id, listing.id));
      const product = await loadProduct(listing.productId, ownerId);
      return await summariseOne(product);
    }),

  /**
   * Tunes one listing's schedule and extraction. `extractor`/`selector`
   * validity is checked here against the *merged* state (this patch over the
   * existing row) rather than in the schema, because a caller switching to
   * `selector` mode without also sending a `selector` is valid when the
   * listing already has one — see `listingUpdateInput`'s doc.
   */
  update: protectedProcedure
    .input(listingUpdateInput)
    .handler(async ({ context, input }): Promise<ProductSummary> => {
      const listing = await loadListing(input.id, context.session.user.id);

      const nextExtractor = input.extractor ?? listing.extractor;
      const nextSelector = input.selector === undefined ? listing.selector : input.selector;
      if (nextExtractor === "selector" && !nextSelector?.trim()) {
        throw new ORPCError("BAD_REQUEST", { message: "A selector-mode listing needs a selector" });
      }

      const patch = buildListingPatch(input);
      const now = new Date();
      // Computed against the pre-update row: it is *this* edit's interval
      // that might pull the schedule in, compared to the schedule as it
      // stood before the patch below touches it.
      const pulledIn = pulledInNextCheckAt(listing, input.intervalMinutes, now);

      // One transaction: a crash between the interval patch and the pull-in
      // must not leave a shortened interval whose next check is still hours out.
      await db.transaction(async (tx) => {
        if (Object.keys(patch).length > 0) {
          await tx.update(listings).set(patch).where(eq(listings.id, listing.id));
        }
        if (pulledIn !== undefined) {
          await tx
            .update(listings)
            .set({ nextCheckAt: pulledIn })
            .where(eq(listings.id, listing.id));
        }
      });

      const product = await loadProduct(listing.productId, context.session.user.id);
      return await summariseOne(product);
    }),
};
