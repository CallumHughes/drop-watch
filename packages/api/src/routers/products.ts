/**
 * Everything the dashboard and the product detail page read, plus the two
 * things they write: tracking settings and "check now".
 *
 * Two shapes matter here. `summary` is what a product card needs — latest
 * price, a short sparkline, distance from target, and whether recent checks
 * have been failing — assembled for every product in three queries rather than
 * three per product. `history` and `checkRuns` are the detail page's deeper
 * reads, paged by an explicit limit.
 *
 * Prices stay decimal strings from `numeric(12,2)` all the way to the UI, and
 * the derived numbers (target distance, percentage change) are computed in
 * integer minor units — see `../decimal`.
 */

import { ORPCError } from "@orpc/server";
import { ALERT_RULES } from "@price-tracker/core/rules";
import { db } from "@price-tracker/db";
import { sendCheckNow } from "@price-tracker/db/queue";
import type { CheckRun, Product } from "@price-tracker/db/schema/products";
import { checkRuns, pricePoints, products } from "@price-tracker/db/schema/products";
import { asc, desc, eq, lte, sql } from "drizzle-orm";
import { z } from "zod";

import { percentChange, subtract } from "../decimal";
import { protectedProcedure } from "../index";
import { getSenderBoss } from "../queue";

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

const MIN_INTERVAL_MINUTES = 5;
/** A week. Anything longer is a bookmark, not a tracker. */
const MAX_INTERVAL_MINUTES = 10_080;
const MAX_JITTER_PERCENT = 100;
const MIN_DROP_PERCENT = 1;
const MAX_DROP_PERCENT = 99;

/** Matches what `numeric(12,2)` accepts, so a bad target never reaches Postgres. */
const PRICE_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

/** One observation. `price` is a decimal string; `inStock` is null when unknown. */
export interface PriceSample {
  inStock: boolean | null;
  observedAt: Date;
  price: string;
}

/** A product card's worth of derived state. */
export interface ProductSummary {
  /** Signed percentage from the previous point to the latest, one decimal place. */
  changePercent: string | null;
  /** Length of the current run of non-`ok` checks. Zero means healthy. */
  consecutiveFailures: number;
  /** Oldest first, so a sparkline can be drawn straight from it. */
  history: PriceSample[];
  lastCheck: CheckRun | null;
  latest: PriceSample | null;
  previous: PriceSample | null;
  product: Product;
  /** `latest - targetPrice`. Negative means the target has been met. */
  targetDelta: string | null;
}

const productIdInput = z.object({ id: z.uuid() });

async function loadProduct(id: string): Promise<Product> {
  const [product] = await db.select().from(products).where(eq(products.id, id)).limit(1);
  if (!product) {
    throw new ORPCError("NOT_FOUND", { message: "Product not found" });
  }
  return product;
}

/**
 * The most recent `limit` price points for every product at once.
 *
 * A window function rather than a query per product: the dashboard is a list,
 * and `price_points(product_id, observed_at DESC)` serves the partition
 * directly.
 */
async function recentSamples(limit: number): Promise<Map<string, PriceSample[]>> {
  const ranked = db.$with("ranked_price_points").as(
    db
      .select({
        inStock: pricePoints.inStock,
        observedAt: pricePoints.observedAt,
        price: pricePoints.price,
        productId: pricePoints.productId,
        rank: sql<number>`row_number() over (partition by ${pricePoints.productId} order by ${pricePoints.observedAt} desc)`.as(
          "rank"
        ),
      })
      .from(pricePoints)
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
    samples.push({ inStock: row.inStock, observedAt: row.observedAt, price: row.price });
    byProduct.set(row.productId, samples);
  }
  return byProduct;
}

/** The most recent `limit` check runs per product, newest first. */
async function recentRuns(limit: number): Promise<Map<string, CheckRun[]>> {
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

/**
 * How many checks in a row have failed, newest first.
 *
 * A 304 is recorded as `ok` with no price point, so a page that simply has not
 * changed never trips the badge.
 */
function countLeadingFailures(runs: CheckRun[]): number {
  let failures = 0;
  for (const run of runs) {
    if (run.status === "ok") {
      break;
    }
    failures += 1;
  }
  return failures;
}

function summarise(product: Product, samples: PriceSample[], runs: CheckRun[]): ProductSummary {
  const latest = samples.at(-1) ?? null;
  const previous = samples.at(-2) ?? null;
  return {
    changePercent: latest && previous ? percentChange(previous.price, latest.price) : null,
    consecutiveFailures: countLeadingFailures(runs),
    history: samples,
    lastCheck: runs[0] ?? null,
    latest,
    previous,
    product,
    targetDelta: latest && product.targetPrice ? subtract(latest.price, product.targetPrice) : null,
  };
}

/** The most recent `limit` price points for one product, oldest first. */
async function loadSamples(productId: string, limit: number): Promise<PriceSample[]> {
  const rows = await db
    .select({
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

const updateInput = z.object({
  active: z.boolean().optional(),
  dropPercent: z.number().int().min(MIN_DROP_PERCENT).max(MAX_DROP_PERCENT).nullable().optional(),
  id: z.uuid(),
  intervalMinutes: z.number().int().min(MIN_INTERVAL_MINUTES).max(MAX_INTERVAL_MINUTES).optional(),
  jitterPercent: z.number().int().min(0).max(MAX_JITTER_PERCENT).optional(),
  rules: z.array(z.enum(ALERT_RULES)).optional(),
  targetPrice: z.string().regex(PRICE_PATTERN).nullable().optional(),
});

type UpdateInput = z.infer<typeof updateInput>;

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
        input,
      }): Promise<{ jobId: string | null; status: "already_checking" | "queued" }> => {
        const product = await loadProduct(input.id);
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
    .handler(async ({ input }): Promise<CheckRun[]> => {
      await loadProduct(input.id);
      return await db
        .select()
        .from(checkRuns)
        .where(eq(checkRuns.productId, input.id))
        .orderBy(desc(checkRuns.startedAt))
        .limit(input.limit);
    }),

  detail: protectedProcedure
    .input(productIdInput)
    .handler(({ input }): Promise<ProductSummary> => loadProduct(input.id).then(summariseOne)),

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
    .handler(async ({ input }): Promise<PriceSample[]> => {
      await loadProduct(input.id);
      return await loadSamples(input.id, input.limit);
    }),

  /** The dashboard: one summary per tracked product. */
  list: protectedProcedure.handler(async (): Promise<ProductSummary[]> => {
    const [rows, samples, runs] = await Promise.all([
      db.select().from(products).orderBy(asc(products.title), asc(products.url)),
      recentSamples(SPARKLINE_POINTS),
      recentRuns(FAILURE_WINDOW),
    ]);
    return rows.map((product) =>
      summarise(product, samples.get(product.id) ?? [], runs.get(product.id) ?? [])
    );
  }),

  /** Tracking settings: interval, jitter, alert rules, target, active. */
  update: protectedProcedure
    .input(updateInput)
    .handler(async ({ input }): Promise<ProductSummary> => {
      const product = await loadProduct(input.id);
      const patch = buildPatch(input);
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
