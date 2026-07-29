/**
 * Everything the dashboard and the product detail page read, plus the two
 * things they write: tracking settings and "check now".
 *
 * Every read and write is scoped to the signed-in owner — products are private
 * per account, and an id that belongs to someone else answers NOT_FOUND, never
 * FORBIDDEN, so "not yours" is indistinguishable from "doesn't exist".
 *
 * Two shapes matter here. `summary` is what a product card needs — latest
 * price, a short sparkline, distance from target, and whether recent checks
 * have been failing — assembled for every product in three queries rather than
 * three per product. `history` and `checkRuns` are the detail page's deeper
 * reads, paged by an explicit limit.
 *
 * Prices stay decimal strings from `numeric(12,2)` all the way to the UI, and
 * the derived numbers (target distance, percentage change) are computed in
 * integer minor units — see `../decimal`. The derivation itself lives in
 * `../summary`; this module only queries.
 */

import { ORPCError } from "@orpc/server";
import { db } from "@price-tracker/db";
import { sendCheckNow } from "@price-tracker/db/queue";
import type { CheckRun, NewProduct, Product } from "@price-tracker/db/schema/products";
import { checkRuns, pricePoints, products } from "@price-tracker/db/schema/products";
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
 * on `@price-tracker/db` — the UI reads the API, not the database.
 */
export type { CheckRun, Product } from "@price-tracker/db/schema/products";
export type { CheckStatus, PriceSample, ProductSummary } from "../summary";

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

/**
 * The most recent `limit` price points for every product *of one owner* at
 * once.
 *
 * A window function rather than a query per product: the dashboard is a list,
 * and `price_points(product_id, observed_at DESC)` serves the partition
 * directly. The join to `products` exists purely to filter by owner — without
 * it, other accounts' sparkline data would be computed and shipped.
 */
async function recentSamples(limit: number, ownerId: string): Promise<Map<string, PriceSample[]>> {
  const ranked = db.$with("ranked_price_points").as(
    db
      .select({
        currency: pricePoints.currency,
        inStock: pricePoints.inStock,
        observedAt: pricePoints.observedAt,
        price: pricePoints.price,
        productId: pricePoints.productId,
        rank: sql<number>`row_number() over (partition by ${pricePoints.productId} order by ${pricePoints.observedAt} desc)`.as(
          "rank"
        ),
      })
      .from(pricePoints)
      .innerJoin(products, eq(pricePoints.productId, products.id))
      .where(eq(products.userId, ownerId))
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
      currency: row.currency,
      inStock: row.inStock,
      observedAt: row.observedAt,
      price: row.price,
    });
    byProduct.set(row.productId, samples);
  }
  return byProduct;
}

/**
 * The most recent `limit` check runs per product of one owner, newest first.
 * Owner-filtered for the same reason as {@link recentSamples}.
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
        productId: checkRuns.productId,
        rank: sql<number>`row_number() over (partition by ${checkRuns.productId} order by ${checkRuns.startedAt} desc)`.as(
          "rank"
        ),
        startedAt: checkRuns.startedAt,
        status: checkRuns.status,
      })
      .from(checkRuns)
      .innerJoin(products, eq(checkRuns.productId, products.id))
      .where(eq(products.userId, ownerId))
  );

  const rows = await db
    .with(ranked)
    .select()
    .from(ranked)
    .where(lte(ranked.rank, limit))
    .orderBy(desc(ranked.startedAt));

  const byProduct = new Map<string, CheckRun[]>();
  for (const { rank: _rank, ...run } of rows) {
    const runs = byProduct.get(run.productId) ?? [];
    runs.push(run);
    byProduct.set(run.productId, runs);
  }
  return byProduct;
}

/** The most recent `limit` price points for one product, oldest first. */
async function loadSamples(productId: string, limit: number): Promise<PriceSample[]> {
  const rows = await db
    .select({
      currency: pricePoints.currency,
      inStock: pricePoints.inStock,
      observedAt: pricePoints.observedAt,
      price: pricePoints.price,
    })
    .from(pricePoints)
    .where(eq(pricePoints.productId, productId))
    .orderBy(desc(pricePoints.observedAt))
    .limit(limit);
  return rows.reverse();
}

/** The single-product path. Plain indexed reads — no window function needed. */
async function summariseOne(product: Product): Promise<ProductSummary> {
  const [samples, runs] = await Promise.all([
    loadSamples(product.id, SPARKLINE_POINTS),
    db
      .select()
      .from(checkRuns)
      .where(eq(checkRuns.productId, product.id))
      .orderBy(desc(checkRuns.startedAt))
      .limit(FAILURE_WINDOW),
  ]);
  return summarise(product, samples, runs);
}

type UpdateInput = z.infer<typeof productUpdateInput>;

/**
 * Only the keys actually supplied, so `targetPrice: null` clears the target
 * while omitting it leaves the target alone.
 */
function buildPatch(input: UpdateInput): Partial<Product> {
  const { id: _id, ...changes } = input;
  const patch: Partial<Product> = {};
  for (const [key, value] of Object.entries(changes)) {
    if (value !== undefined) {
      Object.assign(patch, { [key]: value });
    }
  }
  return patch;
}

type CreateInput = z.infer<typeof productCreateInput>;

/**
 * The insert, with `nextCheckAt` pinned to now so the minutely dispatcher picks
 * the product up on its next tick rather than after a first full interval —
 * adding something and watching nothing happen for three hours reads as a bug.
 */
function buildInsert(input: CreateInput, ownerId: string, now: Date): NewProduct {
  const { url, ...rest } = input;
  const values: NewProduct = { nextCheckAt: now, url, userId: ownerId };
  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined) {
      Object.assign(values, { [key]: value });
    }
  }
  return values;
}

export const productsRouter = {
  /**
   * Enqueues an immediate check onto the queue the worker already consumes.
   * `already_checking` is a normal outcome, not an error: pg-boss's exclusive
   * policy means a product with a check queued or running takes no second job.
   */
  checkNow: protectedProcedure
    .input(productIdInput)
    .handler(
      async ({
        context,
        input,
      }): Promise<{ jobId: string | null; status: "already_checking" | "queued" }> => {
        const product = await loadProduct(input.id, context.session.user.id);
        const boss = await getSenderBoss();
        const jobId = await sendCheckNow(boss, product.id);
        return jobId ? { jobId, status: "queued" } : { jobId: null, status: "already_checking" };
      }
    ),
  /**
   * Every check attempt for one product, newest first. This is the answer to
   * "why did this silently stop working".
   */
  checkRuns: protectedProcedure
    .input(
      productIdInput.extend({
        limit: z.number().int().min(1).max(MAX_CHECK_RUNS).default(DEFAULT_CHECK_RUNS),
      })
    )
    .handler(async ({ context, input }): Promise<CheckRun[]> => {
      await loadProduct(input.id, context.session.user.id);
      return await db
        .select()
        .from(checkRuns)
        .where(eq(checkRuns.productId, input.id))
        .orderBy(desc(checkRuns.startedAt))
        .limit(input.limit);
    }),

  /**
   * Confirm-and-save, the end of the add-product flow.
   *
   * Returns the same {@link ProductSummary} the dashboard renders, so the new
   * card can be seeded into the list without a round trip. It has no history
   * yet — the worker writes the first price point when it picks the product up,
   * which `nextCheckAt` makes happen within a minute.
   */
  create: protectedProcedure
    .input(productCreateInput)
    .handler(async ({ context, input }): Promise<ProductSummary> => {
      const [created] = await db
        .insert(products)
        .values(buildInsert(input, context.session.user.id, new Date()))
        // `(userId, url)` is unique. Adding something *you* already track is a
        // mistake worth naming, not a duplicate row — another account tracking
        // the same URL is none of your business and conflicts with nothing.
        .onConflictDoNothing({ target: [products.userId, products.url] })
        .returning();
      if (!created) {
        throw new ORPCError("CONFLICT", { message: "That URL is already being tracked." });
      }
      return summarise(created, [], []);
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
    const [rows, samples, runs] = await Promise.all([
      db
        .select()
        .from(products)
        .where(eq(products.userId, ownerId))
        .orderBy(asc(products.title), asc(products.url)),
      recentSamples(SPARKLINE_POINTS, ownerId),
      recentRuns(FAILURE_WINDOW, ownerId),
    ]);
    return rows.map((product) =>
      summarise(product, samples.get(product.id) ?? [], runs.get(product.id) ?? [])
    );
  }),

  /** Tracking settings: interval, jitter, alert rules, target, active. */
  update: protectedProcedure
    .input(productUpdateInput)
    .handler(async ({ context, input }): Promise<ProductSummary> => {
      const product = await loadProduct(input.id, context.session.user.id);
      const patch = buildPatch(input);
      const nextCheckAt = pulledInNextCheckAt(product, input.intervalMinutes, new Date());
      if (nextCheckAt) {
        patch.nextCheckAt = nextCheckAt;
      }
      if (Object.keys(patch).length === 0) {
        return await summariseOne(product);
      }
      const [updated] = await db
        .update(products)
        .set(patch)
        .where(eq(products.id, product.id))
        .returning();
      return await summariseOne(updated ?? product);
    }),
};
