/**
 * Everything the dashboard and the product detail page read, plus what they
 * write at the product level: identity, alert configuration, and "check now".
 * Schedule and extraction settings are listing-level and live in
 * `./listings` instead — a product can have several listings, each on its own
 * schedule, so there is no longer a single interval to patch from here.
 *
 * Every read and write is scoped to the signed-in owner — products are private
 * per account, and an id that belongs to someone else answers NOT_FOUND, never
 * FORBIDDEN, so "not yours" is indistinguishable from "doesn't exist".
 *
 * Two shapes matter here. `detail` and `list` return a product-card summary
 * each — latest price, a short sparkline, distance from target, and whether
 * recent checks have been failing — assembled for every product in a handful
 * of queries rather than several per product. `history` and `checkRuns` are
 * the detail page's deeper reads, paged by an explicit limit. `history` is
 * windowed per listing (a chatty store must not evict a quiet one's line
 * from the chart); `checkRuns` stays a single merged, newest-first log capped
 * at `limit` overall — a chronological log reads correctly interleaved, a
 * chart does not.
 *
 * Prices stay decimal strings from `numeric(12,2)` all the way to the UI, and
 * the derived numbers (target distance, percentage change) are computed in
 * integer minor units — see `../decimal`. The derivation itself lives in
 * `../summary`; this module only queries.
 */

import { db } from "@drop-watch/db";
import { sendCheckNow } from "@drop-watch/db/queue";
import type { CheckRun, Listing, NewProduct, Product } from "@drop-watch/db/schema/products";
import { checkRuns, listings, pricePoints, products } from "@drop-watch/db/schema/products";
import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import { z } from "zod";

import { protectedProcedure } from "../index";
import { buildListingInsert } from "../listing-insert";
import { getSenderBoss } from "../queue";
import { productCreateInput, productUpdateInput } from "../schemas/products";
import { type PriceSample, type ProductSummary, summarise } from "../summary";

/** Points behind each dashboard sparkline, *per listing*. Enough shape, one small query. */
const SPARKLINE_POINTS = 24;

/**
 * Check runs pulled *per listing* for the failure badge. Only the leading
 * non-`ok` streak is used, so this is a ceiling on "how broken", not a window
 * that can hide a failure — and windowing per listing is what stops a chatty
 * store from pushing a quiet one's own streak out of view.
 */
const FAILURE_WINDOW = 20;

/**
 * Detail-page defaults for `history` (per listing — a product with several
 * listings can return up to `limit` points from each, so the true ceiling is
 * `limit * listing count`, not `limit` alone) and `checkRuns` (capped overall,
 * merged across listings). Both bounded so a crafted input cannot pull the
 * table; a caller only has as many listings as they created, so the
 * per-listing multiplier stays small in practice.
 */
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
 *
 * Exported for `./listings`, which owns a listing's own record but still
 * needs to confirm the *parent product* is the caller's before adding to it,
 * and needs the row back to build the returned `ProductSummary`.
 */
export async function loadProduct(id: string, ownerId: string): Promise<Product> {
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

/**
 * The most recent `limit` price points for *each* of a product's listings,
 * oldest first overall. Windowed per listing — like {@link recentSamples} but
 * scoped to one product instead of one owner, and returned flat instead of
 * grouped, since a single product's rows need no further grouping. A chatty
 * store must not evict a quiet one's line from the chart or the sparkline, so
 * this is what both the `history` procedure and {@link summariseOne} use.
 */
async function loadSamples(productId: string, limit: number): Promise<PriceSample[]> {
  const ranked = db.$with("ranked_price_points").as(
    db
      .select({
        availability: pricePoints.availability,
        currency: pricePoints.currency,
        inStock: pricePoints.inStock,
        listingId: pricePoints.listingId,
        observedAt: pricePoints.observedAt,
        price: pricePoints.price,
        rank: sql<number>`row_number() over (partition by ${pricePoints.listingId} order by ${pricePoints.observedAt} desc)`.as(
          "rank"
        ),
      })
      .from(pricePoints)
      .innerJoin(listings, eq(pricePoints.listingId, listings.id))
      .where(eq(listings.productId, productId))
  );
  const rows = await db
    .with(ranked)
    .select()
    .from(ranked)
    .where(lte(ranked.rank, limit))
    .orderBy(asc(ranked.observedAt));
  return rows.map(({ rank: _rank, ...sample }) => sample);
}

/**
 * The most recent `limit` check runs for one product, newest first, capped
 * overall rather than per listing — this is the detail page's merged log,
 * where a chronological read matters more than guaranteeing every listing a
 * slice. Used by the `checkRuns` procedure only; {@link summariseOne}'s
 * failure-streak input is {@link loadFailureWindowRuns} instead.
 */
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

/**
 * The most recent `limit` check runs for *each* of a product's listings,
 * newest first overall. Windowed per listing, like {@link loadSamples} —
 * without this, a listing checked every five minutes would push a listing
 * checked daily out of the failure-streak window entirely, understating (or
 * hiding) its own streak. Feeds {@link summarise}'s `consecutiveFailures` and
 * `lastCheck`, not the `checkRuns` procedure.
 */
async function loadFailureWindowRuns(productId: string, limit: number): Promise<CheckRun[]> {
  const ranked = db.$with("ranked_check_runs").as(
    db
      .select({
        durationMs: checkRuns.durationMs,
        error: checkRuns.error,
        extractorUsed: checkRuns.extractorUsed,
        httpStatus: checkRuns.httpStatus,
        id: checkRuns.id,
        listingId: checkRuns.listingId,
        rank: sql<number>`row_number() over (partition by ${checkRuns.listingId} order by ${checkRuns.startedAt} desc)`.as(
          "rank"
        ),
        startedAt: checkRuns.startedAt,
        status: checkRuns.status,
      })
      .from(checkRuns)
      .innerJoin(listings, eq(checkRuns.listingId, listings.id))
      .where(eq(listings.productId, productId))
  );
  const rows = await db
    .with(ranked)
    .select()
    .from(ranked)
    .where(lte(ranked.rank, limit))
    .orderBy(desc(ranked.startedAt));
  return rows.map(({ rank: _rank, ...run }) => run);
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

/**
 * The single-product path, shared by `products.detail`/`update` and by
 * `./listings`' mutations, which all return the parent product's refreshed
 * summary.
 */
export async function summariseOne(product: Product): Promise<ProductSummary> {
  const [productListings, samples, runs] = await Promise.all([
    loadListings(product.id),
    loadSamples(product.id, SPARKLINE_POINTS),
    loadFailureWindowRuns(product.id, FAILURE_WINDOW),
  ]);
  return summarise(product, productListings, samples, runs);
}

type UpdateInput = z.infer<typeof productUpdateInput>;

/** Only the keys actually supplied, routed onto the product row. */
function buildProductPatch(input: UpdateInput): Partial<Product> {
  const { active, dropPercent, rules, targetPrice, title } = input;
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
  if (title !== undefined) {
    patch.title = title;
  }
  return patch;
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

  /**
   * Deletes a product and, by cascade, every one of its listings — and their
   * price points, check runs and alert state. Unlike `listings.remove`, this
   * needs no "last one" guard: deleting the product *is* how you strand
   * nothing, since nothing is left watching.
   */
  remove: protectedProcedure
    .input(productIdInput)
    .handler(async ({ context, input }): Promise<{ deleted: true }> => {
      const product = await loadProduct(input.id, context.session.user.id);
      await db.delete(products).where(eq(products.id, product.id));
      return { deleted: true };
    }),

  /** Min/max/avg price and observation count over the whole recorded history. */
  stats: protectedProcedure
    .input(productIdInput)
    .handler(async ({ context, input }): Promise<PriceStats | null> => {
      const product = await loadProduct(input.id, context.session.user.id);
      return await loadStats(product);
    }),

  /** Identity and alert configuration: title, rules, target and drop-percent. */
  update: protectedProcedure
    .input(productUpdateInput)
    .handler(async ({ context, input }): Promise<ProductSummary> => {
      const product = await loadProduct(input.id, context.session.user.id);
      const patch = buildProductPatch(input);
      const updated =
        Object.keys(patch).length > 0
          ? ((
              await db.update(products).set(patch).where(eq(products.id, product.id)).returning()
            )[0] ?? product)
          : product;
      return await summariseOne(updated);
    }),
};
