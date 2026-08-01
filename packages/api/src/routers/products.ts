/**
 * Everything the dashboard and the product detail page read, plus the two
 * things they write: tracking settings and "check now".
 *
 * Every read and write is scoped to the signed-in owner — products are private
 * per account, and an id that belongs to someone else answers NOT_FOUND, never
 * FORBIDDEN, so "not yours" is indistinguishable from "doesn't exist".
 *
 * A product's scrape-shaped detail — url, extractor, schedule, cache
 * validators — lives on its `listings`, not on the product itself. This PR
 * keeps the external surface unchanged (every product still has exactly one
 * listing, created alongside it), so every query here resolves through that
 * listing rather than exposing it as its own procedure yet.
 *
 * Two shapes matter here. `summary` is what a product card needs — latest
 * price, a short sparkline, distance from target, and whether recent checks
 * have been failing — assembled for every product in a handful of queries
 * rather than several per product. `history` and `checkRuns` are the detail
 * page's deeper reads, paged by an explicit limit.
 *
 * Prices stay decimal strings from `numeric(12,2)` all the way to the UI, and
 * the derived numbers (target distance, percentage change) are computed in
 * integer minor units — see `../decimal`. The derivation itself lives in
 * `../summary`; this module only queries.
 */

import { db } from "@drop-watch/db";
import { sendCheckNow } from "@drop-watch/db/queue";
import type {
  CheckRun,
  Listing,
  NewListing,
  NewProduct,
  Product,
} from "@drop-watch/db/schema/products";
import { checkRuns, listings, pricePoints, products } from "@drop-watch/db/schema/products";
import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import { z } from "zod";

import { protectedProcedure } from "../index";
import { getSenderBoss } from "../queue";
import { productCreateInput, productUpdateInput } from "../schemas/products";
import { type PriceSample, type ProductSummary, pulledInNextCheckAt, summarise } from "../summary";

/** Points behind each dashboard sparkline. Enough shape, one small query. */
const SPARKLINE_POINTS = 24;

/**
 * Check runs pulled per product for the failure badge. Only the leading
 * non-`ok` streak is used, so this is a ceiling on "how broken", not a window
 * that can hide a failure.
 */
const FAILURE_WINDOW = 20;

/** Detail-page defaults. Both are capped so a crafted input cannot pull the table. */
const DEFAULT_HISTORY_POINTS = 200;
const MAX_HISTORY_POINTS = 2000;
const DEFAULT_CHECK_RUNS = 50;
const MAX_CHECK_RUNS = 500;

/**
 * Re-exported so `apps/web` can name these shapes without taking a dependency
 * on `@drop-watch/db` — the UI reads the API, not the database.
 */
export type { CheckRun, Listing, Product } from "@drop-watch/db/schema/products";
export type { CheckStatus, ListingSummary, PriceSample, ProductSummary } from "../summary";

const productIdInput = z.object({ id: z.uuid() });

/**
 * A product *belonging to the requester*, or NOT_FOUND. Deliberately the same
 * NOT_FOUND whether the id does not exist or exists under another account — a
 * FORBIDDEN would confirm the id is real and leak what other users track.
 */
async function loadProduct(id: string, ownerId: string): Promise<Product> {
  const [product] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, id), eq(products.userId, ownerId)))
    .limit(1);
  if (!product) {
    throw new ORPCError("NOT_FOUND", { message: "Product not found" });
  }
  return product;
}

/** A product's own listings, oldest first — `listings[0]` is the original one. */
async function loadListings(productId: string): Promise<Listing[]> {
  return await db
    .select()
    .from(listings)
    .where(eq(listings.productId, productId))
    .orderBy(asc(listings.createdAt));
}

/** Every listing an owner has, across all their products, grouped by product. */
async function loadOwnerListings(ownerId: string): Promise<Map<string, Listing[]>> {
  const rows = await db
    .select()
    .from(listings)
    .where(eq(listings.userId, ownerId))
    .orderBy(asc(listings.createdAt));
  const byProduct = new Map<string, Listing[]>();
  for (const listing of rows) {
    const group = byProduct.get(listing.productId) ?? [];
    group.push(listing);
    byProduct.set(listing.productId, group);
  }
  return byProduct;
}

/**
 * The most recent `limit` price points for every product *of one owner* at
 * once.
 *
 * A window function rather than a query per product: the dashboard is a list,
 * and `price_points(listing_id, observed_at DESC)` serves the partition
 * directly. The join to `listings` both filters by owner and recovers the
 * product each point belongs to — the ranking is per listing, but the
 * returned map stays keyed by product, which is what the dashboard consumes.
 */
async function recentSamples(limit: number, ownerId: string): Promise<Map<string, PriceSample[]>> {
  const ranked = db.$with("ranked_price_points").as(
    db
      .select({
        availability: pricePoints.availability,
        currency: pricePoints.currency,
        inStock: pricePoints.inStock,
        listingId: pricePoints.listingId,
        observedAt: pricePoints.observedAt,
        price: pricePoints.price,
        productId: listings.productId,
        rank: sql<number>`row_number() over (partition by ${pricePoints.listingId} order by ${pricePoints.observedAt} desc)`.as(
          "rank"
        ),
      })
      .from(pricePoints)
      .innerJoin(listings, eq(pricePoints.listingId, listings.id))
      .where(eq(listings.userId, ownerId))
  );

  const rows = await db
    .with(ranked)
    .select()
    .from(ranked)
    .where(lte(ranked.rank, limit))
    .orderBy(asc(ranked.observedAt));

  const byProduct = new Map<string, PriceSample[]>();
  for (const row of rows) {
    const samples = byProduct.get(row.productId) ?? [];
    samples.push({
      availability: row.availability,
      currency: row.currency,
      inStock: row.inStock,
      listingId: row.listingId,
      observedAt: row.observedAt,
      price: row.price,
    });
    byProduct.set(row.productId, samples);
  }
  return byProduct;
}

/**
 * The most recent `limit` check runs per product of one owner, newest first.
 * Owner-filtered and product-grouped for the same reason as {@link recentSamples}.
 */
async function recentRuns(limit: number, ownerId: string): Promise<Map<string, CheckRun[]>> {
  const ranked = db.$with("ranked_check_runs").as(
    db
      .select({
        durationMs: checkRuns.durationMs,
        error: checkRuns.error,
        extractorUsed: checkRuns.extractorUsed,
        httpStatus: checkRuns.httpStatus,
        id: checkRuns.id,
        listingId: checkRuns.listingId,
        productId: listings.productId,
        rank: sql<number>`row_number() over (partition by ${checkRuns.listingId} order by ${checkRuns.startedAt} desc)`.as(
          "rank"
        ),
        startedAt: checkRuns.startedAt,
        status: checkRuns.status,
      })
      .from(checkRuns)
      .innerJoin(listings, eq(checkRuns.listingId, listings.id))
      .where(eq(listings.userId, ownerId))
  );

  const rows = await db
    .with(ranked)
    .select()
    .from(ranked)
    .where(lte(ranked.rank, limit))
    .orderBy(desc(ranked.startedAt));

  const byProduct = new Map<string, CheckRun[]>();
  for (const { rank: _rank, productId, ...run } of rows) {
    const runs = byProduct.get(productId) ?? [];
    runs.push(run);
    byProduct.set(productId, runs);
  }
  return byProduct;
}

/** The most recent `limit` price points for one product, oldest first. */
async function loadSamples(productId: string, limit: number): Promise<PriceSample[]> {
  const rows = await db
    .select({
      availability: pricePoints.availability,
      currency: pricePoints.currency,
      inStock: pricePoints.inStock,
      listingId: pricePoints.listingId,
      observedAt: pricePoints.observedAt,
      price: pricePoints.price,
    })
    .from(pricePoints)
    .innerJoin(listings, eq(pricePoints.listingId, listings.id))
    .where(eq(listings.productId, productId))
    .orderBy(desc(pricePoints.observedAt))
    .limit(limit);
  return rows.reverse();
}

/** The most recent `limit` check runs for one product, newest first. */
async function loadRuns(productId: string, limit: number): Promise<CheckRun[]> {
  return await db
    .select({
      durationMs: checkRuns.durationMs,
      error: checkRuns.error,
      extractorUsed: checkRuns.extractorUsed,
      httpStatus: checkRuns.httpStatus,
      id: checkRuns.id,
      listingId: checkRuns.listingId,
      startedAt: checkRuns.startedAt,
      status: checkRuns.status,
    })
    .from(checkRuns)
    .innerJoin(listings, eq(checkRuns.listingId, listings.id))
    .where(eq(listings.productId, productId))
    .orderBy(desc(checkRuns.startedAt))
    .limit(limit);
}

/** Min/max/avg over one product's whole price history. Prices stay decimal strings. */
export interface PriceStats {
  avg: string;
  count: number;
  max: string;
  min: string;
}

/**
 * One aggregate query; null when the product has no price points yet.
 * Filtered to the product's current currency — a retailer that geo-flips
 * GBP→USD must not fold both into one average.
 */
async function loadStats(product: Product): Promise<PriceStats | null> {
  const [row] = await db
    .select({
      avg: sql<string | null>`avg(${pricePoints.price})::numeric(12,2)`,
      count: sql<number>`count(*)::int`,
      max: sql<string | null>`max(${pricePoints.price})`,
      min: sql<string | null>`min(${pricePoints.price})`,
    })
    .from(pricePoints)
    .innerJoin(listings, eq(pricePoints.listingId, listings.id))
    .where(
      and(
        eq(listings.productId, product.id),
        product.currency ? eq(pricePoints.currency, product.currency) : undefined
      )
    );
  if (!row || row.count === 0 || row.avg === null || row.max === null || row.min === null) {
    return null;
  }
  return { avg: row.avg, count: row.count, max: row.max, min: row.min };
}

/** The single-product path. Plain indexed reads — no window function needed. */
async function summariseOne(product: Product): Promise<ProductSummary> {
  const [productListings, samples, runs] = await Promise.all([
    loadListings(product.id),
    loadSamples(product.id, SPARKLINE_POINTS),
    loadRuns(product.id, FAILURE_WINDOW),
  ]);
  return summarise(product, productListings, samples, runs);
}

type UpdateInput = z.infer<typeof productUpdateInput>;

/** Only the keys actually supplied, routed onto the product row. */
function buildProductPatch(input: UpdateInput): Partial<Product> {
  const { active, dropPercent, rules, targetPrice } = input;
  const patch: Partial<Product> = {};
  if (active !== undefined) {
    patch.active = active;
  }
  if (dropPercent !== undefined) {
    patch.dropPercent = dropPercent;
  }
  if (rules !== undefined) {
    patch.rules = rules;
  }
  if (targetPrice !== undefined) {
    patch.targetPrice = targetPrice;
  }
  return patch;
}

/** Only the keys actually supplied, routed onto every one of the product's listings. */
function buildListingPatch(input: UpdateInput): Partial<Listing> {
  const { intervalMinutes, jitterPercent } = input;
  const patch: Partial<Listing> = {};
  if (intervalMinutes !== undefined) {
    patch.intervalMinutes = intervalMinutes;
  }
  if (jitterPercent !== undefined) {
    patch.jitterPercent = jitterPercent;
  }
  return patch;
}

/**
 * Applies a shortened interval's pull-in to each of the product's listings
 * individually — {@link pulledInNextCheckAt} decides per listing, against that
 * listing's own `nextCheckAt`, whether the new interval moves its next check
 * sooner. A listing whose next check is already sooner than the new interval
 * implies is left alone.
 */
async function pullInNextCheckAt(
  productId: string,
  intervalMinutes: number,
  now: Date
): Promise<void> {
  const productListings = await loadListings(productId);
  const pulls = productListings
    .map((listing) => ({
      id: listing.id,
      nextCheckAt: pulledInNextCheckAt(listing, intervalMinutes, now),
    }))
    .filter((entry): entry is { id: string; nextCheckAt: Date } => entry.nextCheckAt !== undefined);
  await Promise.all(
    pulls.map((entry) =>
      db.update(listings).set({ nextCheckAt: entry.nextCheckAt }).where(eq(listings.id, entry.id))
    )
  );
}

type CreateInput = z.infer<typeof productCreateInput>;

const PRODUCT_INSERT_KEYS = [
  "currency",
  "dropPercent",
  "imageUrl",
  "rules",
  "targetPrice",
  "title",
] as const;
const LISTING_INSERT_KEYS = [
  "currency",
  "extractor",
  "intervalMinutes",
  "jitterPercent",
  "locale",
  "selector",
] as const;

/** Only the supplied create-input keys that belong on the product row. */
function buildProductInsert(input: CreateInput, ownerId: string): NewProduct {
  const values: NewProduct = { userId: ownerId };
  for (const key of PRODUCT_INSERT_KEYS) {
    const value = input[key];
    if (value !== undefined) {
      Object.assign(values, { [key]: value });
    }
  }
  return values;
}

/**
 * Only the supplied create-input keys that belong on the listing row, plus
 * `nextCheckAt` pinned to now so the minutely dispatcher picks the listing up
 * on its next tick rather than after a first full interval — adding something
 * and watching nothing happen for three hours reads as a bug.
 */
function buildListingInsert(
  input: CreateInput,
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

export const productsRouter = {
  /**
   * Enqueues an immediate check per active listing, onto the queue the worker
   * already consumes. `already_checking` is a normal outcome, not an error:
   * pg-boss's exclusive policy means a listing with a check queued or running
   * takes no second job.
   */
  checkNow: protectedProcedure
    .input(productIdInput)
    .handler(
      async ({
        context,
        input,
      }): Promise<{ jobId: string | null; status: "already_checking" | "queued" }> => {
        const product = await loadProduct(input.id, context.session.user.id);
        const activeListings = await db
          .select()
          .from(listings)
          .where(and(eq(listings.productId, product.id), eq(listings.active, true)));
        const boss = await getSenderBoss();
        const jobIds = await Promise.all(
          activeListings.map((listing) => sendCheckNow(boss, listing.id))
        );
        const jobId = jobIds.find((id): id is string => id !== null) ?? null;
        return jobId ? { jobId, status: "queued" } : { jobId: null, status: "already_checking" };
      }
    ),
  /**
   * Every check attempt for one product's listing(s), newest first. This is
   * the answer to "why did this silently stop working".
   */
  checkRuns: protectedProcedure
    .input(
      productIdInput.extend({
        limit: z.number().int().min(1).max(MAX_CHECK_RUNS).default(DEFAULT_CHECK_RUNS),
      })
    )
    .handler(async ({ context, input }): Promise<CheckRun[]> => {
      await loadProduct(input.id, context.session.user.id);
      return await loadRuns(input.id, input.limit);
    }),

  /**
   * Confirm-and-save, the end of the add-product flow. Inserts the product and
   * its first (and, for now, only) listing together, so a duplicate-URL
   * conflict on the listing rolls the product insert back too.
   *
   * Returns the same {@link ProductSummary} the dashboard renders, so the new
   * card can be seeded into the list without a round trip. It has no history
   * yet — the worker writes the first price point when it picks the listing
   * up, which `nextCheckAt` makes happen within a minute.
   */
  create: protectedProcedure
    .input(productCreateInput)
    .handler(async ({ context, input }): Promise<ProductSummary> => {
      const ownerId = context.session.user.id;
      const now = new Date();
      const { listing, product } = await db.transaction(async (tx) => {
        const [insertedProduct] = await tx
          .insert(products)
          .values(buildProductInsert(input, ownerId))
          .returning();
        if (!insertedProduct) {
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: "Product insert returned no row",
          });
        }
        const [insertedListing] = await tx
          .insert(listings)
          .values(buildListingInsert(input, insertedProduct.id, ownerId, now))
          // `(userId, url)` is unique. Adding something *you* already track is a
          // mistake worth naming, not a duplicate row — another account tracking
          // the same URL is none of your business and conflicts with nothing.
          .onConflictDoNothing({ target: [listings.userId, listings.url] })
          .returning();
        if (!insertedListing) {
          throw new ORPCError("CONFLICT", { message: "That URL is already being tracked." });
        }
        return { listing: insertedListing, product: insertedProduct };
      });
      return summarise(product, [listing], [], []);
    }),

  detail: protectedProcedure
    .input(productIdInput)
    .handler(
      ({ context, input }): Promise<ProductSummary> =>
        loadProduct(input.id, context.session.user.id).then(summariseOne)
    ),

  /**
   * Price history oldest-first, so the chart can render it without reversing.
   * At-least-once delivery means two points can share very nearly the same
   * timestamp after a worker crash; that is expected, not a bug to filter.
   */
  history: protectedProcedure
    .input(
      productIdInput.extend({
        limit: z.number().int().min(1).max(MAX_HISTORY_POINTS).default(DEFAULT_HISTORY_POINTS),
      })
    )
    .handler(async ({ context, input }): Promise<PriceSample[]> => {
      await loadProduct(input.id, context.session.user.id);
      return await loadSamples(input.id, input.limit);
    }),

  /** The dashboard: one summary per product the requester tracks. */
  list: protectedProcedure.handler(async ({ context }): Promise<ProductSummary[]> => {
    const ownerId = context.session.user.id;
    const [rows, ownerListings, samples, runs] = await Promise.all([
      db
        .select()
        .from(products)
        .where(eq(products.userId, ownerId))
        .orderBy(asc(products.title), asc(products.createdAt)),
      loadOwnerListings(ownerId),
      recentSamples(SPARKLINE_POINTS, ownerId),
      recentRuns(FAILURE_WINDOW, ownerId),
    ]);
    return rows.map((product) =>
      summarise(
        product,
        ownerListings.get(product.id) ?? [],
        samples.get(product.id) ?? [],
        runs.get(product.id) ?? []
      )
    );
  }),

  /** Min/max/avg price and observation count over the whole recorded history. */
  stats: protectedProcedure
    .input(productIdInput)
    .handler(async ({ context, input }): Promise<PriceStats | null> => {
      const product = await loadProduct(input.id, context.session.user.id);
      return await loadStats(product);
    }),

  /**
   * Tracking settings: rules, target and drop-percent land on the product;
   * interval and jitter land on every one of its listings.
   */
  update: protectedProcedure
    .input(productUpdateInput)
    .handler(async ({ context, input }): Promise<ProductSummary> => {
      const product = await loadProduct(input.id, context.session.user.id);
      const now = new Date();

      const productPatch = buildProductPatch(input);
      const updated =
        Object.keys(productPatch).length > 0
          ? ((
              await db
                .update(products)
                .set(productPatch)
                .where(eq(products.id, product.id))
                .returning()
            )[0] ?? product)
          : product;

      const listingPatch = buildListingPatch(input);
      if (Object.keys(listingPatch).length > 0) {
        await db.update(listings).set(listingPatch).where(eq(listings.productId, product.id));
      }
      if (input.intervalMinutes !== undefined) {
        await pullInNextCheckAt(product.id, input.intervalMinutes, now);
      }

      return await summariseOne(updated);
    }),
};
