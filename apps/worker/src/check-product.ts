/**
 * One check of one product: fetch → extract → record → reschedule.
 *
 * The whole point of the design here is the transaction in `persist`. The price
 * point, the check-run audit row, and the `nextCheckAt` advance are written
 * together or not at all, so a worker killed mid-check leaves the product
 * exactly as it was — still due, no half-written attempt — and the dispatcher
 * picks it up again. Delivery is at-least-once, as it is with any queue: a
 * crash can cost a repeated check, never a corrupt or missing one.
 *
 * Alerting runs *after* that transaction commits, deliberately outside it and
 * deliberately unable to fail the check — see `./alerting`.
 */

import type { ExtractionResult, ExtractorStrategy } from "@price-tracker/core/extract";
import { extract, STRATEGY_ORDER } from "@price-tracker/core/extract";
import type { FetchPageResult } from "@price-tracker/core/fetch";
import { fetchPage } from "@price-tracker/core/fetch";
import { db } from "@price-tracker/db";
import type { NewCheckRun, NewPricePoint, Product } from "@price-tracker/db/schema/products";
import { checkRuns, pricePoints, products } from "@price-tracker/db/schema/products";
import { eq } from "drizzle-orm";
import { createLogger } from "evlog";
import { runAlerting } from "./alerting";
import { type CheckOutcome, toCheckOutcome } from "./outcome";
import { nextCheckAt } from "./schedule";

/** Where a check came from. Recorded on the log line, not in the database. */
export type CheckSource = "scheduled" | "manual";

/**
 * Products whose check is running right now, in this process.
 *
 * pg-boss's `exclusive` queue policy already stops one queue from running two
 * jobs for a product, but `check-product` and `check-product-now` are separate
 * queues — a "check now" pressed a second after the dispatcher fired would
 * otherwise double-fetch the same page. Cheap belt to pg-boss's braces.
 */
const inFlight = new Set<string>();

function strategiesFor(product: Product): readonly ExtractorStrategy[] {
  // A product pinned to `selector` should fail loudly when its selector rots,
  // not quietly start reporting whatever JSON-LD the page happens to carry.
  return product.extractor === "selector" ? ["selector"] : STRATEGY_ORDER;
}

/** `undefined` rather than `null`, because that is what the fetch layer takes. */
function conditionalRequest(product: Product): { etag?: string; lastModified?: string } {
  const options: { etag?: string; lastModified?: string } = {};
  if (product.etag) {
    options.etag = product.etag;
  }
  if (product.lastModified) {
    options.lastModified = product.lastModified;
  }
  return options;
}

interface CheckWrite {
  pricePoint: NewPricePoint | null;
  /** Columns to backfill onto `products` alongside the reschedule. */
  productUpdate: Partial<Product>;
}

function buildWrite(
  product: Product,
  fetched: Extract<FetchPageResult, { status: "ok" | "not_modified" }>,
  extraction: ExtractionResult | null,
  currency: string | null,
  outcome: CheckOutcome
): CheckWrite {
  const productUpdate: Partial<Product> = {
    // Only overwrite validators we actually received; a 304 without an ETag
    // must not wipe the one that produced it.
    ...(fetched.etag ? { etag: fetched.etag } : {}),
    ...(fetched.lastModified ? { lastModified: fetched.lastModified } : {}),
  };

  if (!(outcome.recordPricePoint && extraction?.ok && currency)) {
    return { pricePoint: null, productUpdate };
  }

  // Backfill only what the product does not already have — the user's own
  // title or image edits outrank whatever a page says this week.
  if (!product.title && extraction.title) {
    productUpdate.title = extraction.title;
  }
  if (!product.imageUrl && extraction.imageUrl) {
    productUpdate.imageUrl = extraction.imageUrl;
  }
  if (!product.currency) {
    productUpdate.currency = currency;
  }

  const pricePoint: NewPricePoint = {
    currency,
    // Decimal string all the way from the parser into `numeric(12,2)`. Never
    // through Number — see PLAN.md §3.
    price: extraction.price,
    productId: product.id,
  };
  if (extraction.availability !== undefined) {
    pricePoint.availability = extraction.availability;
  }
  if (extraction.inStock !== undefined) {
    pricePoint.inStock = extraction.inStock;
  }

  return { pricePoint, productUpdate };
}

/**
 * Runs a check and records it. Never throws for anything the target site did —
 * an unreachable host is a recorded `check_runs` row, not a failed job, so
 * pg-boss's retries stay reserved for genuine infrastructure faults (the
 * fetch layer already retries transport errors itself).
 */
export async function checkProduct(productId: string, source: CheckSource): Promise<void> {
  if (inFlight.has(productId)) {
    createLogger({ action: "check_product", productId, source }).warn("check already in flight");
    return;
  }
  inFlight.add(productId);
  try {
    await runCheck(productId, source);
  } finally {
    inFlight.delete(productId);
  }
}

function extractFrom(product: Product, fetched: FetchPageResult): ExtractionResult | null {
  if (fetched.status !== "ok") {
    return null;
  }
  return extract(fetched.body, {
    strategies: strategiesFor(product),
    url: fetched.url,
    ...(product.locale ? { locale: product.locale } : {}),
    ...(product.selector ? { selector: product.selector } : {}),
  });
}

function buildCheckRun(
  product: Product,
  startedAt: Date,
  durationMs: number,
  outcome: CheckOutcome
): NewCheckRun {
  return {
    durationMs,
    productId: product.id,
    startedAt,
    status: outcome.status,
    ...(outcome.error === undefined ? {} : { error: outcome.error }),
    ...(outcome.extractorUsed === undefined ? {} : { extractorUsed: outcome.extractorUsed }),
    ...(outcome.httpStatus === undefined ? {} : { httpStatus: outcome.httpStatus }),
  };
}

/**
 * Everything a check produces, committed atomically. This is what makes a
 * killed worker safe: either the attempt is fully recorded and the product is
 * rescheduled, or none of it happened and the product is still due.
 */
function persist(
  product: Product,
  checkRun: NewCheckRun,
  write: CheckWrite,
  scheduledFor: Date
): Promise<void> {
  return db.transaction(async (tx) => {
    if (write.pricePoint) {
      await tx.insert(pricePoints).values(write.pricePoint);
    }
    await tx.insert(checkRuns).values(checkRun);
    await tx
      .update(products)
      .set({ ...write.productUpdate, nextCheckAt: scheduledFor })
      .where(eq(products.id, product.id));
  });
}

async function loadCheckable(
  productId: string,
  log: ReturnType<typeof createLogger>
): Promise<Product | null> {
  const [product] = await db.select().from(products).where(eq(products.id, productId)).limit(1);
  if (!product) {
    log.warn("product not found");
    log.emit();
    return null;
  }
  if (!product.active) {
    log.warn("product inactive, skipping");
    log.emit();
    return null;
  }
  return product;
}

async function runCheck(productId: string, source: CheckSource): Promise<void> {
  const log = createLogger({ action: "check_product", productId, source });
  const product = await loadCheckable(productId, log);
  if (!product) {
    return;
  }

  log.set({ url: product.url });

  const startedAt = new Date();
  const fetched = await fetchPage(product.url, conditionalRequest(product));
  const extraction = extractFrom(product, fetched);
  const extractedCurrency = extraction?.ok ? extraction.currency : undefined;
  const currency = extractedCurrency ?? product.currency ?? null;
  const outcome = toCheckOutcome(fetched, extraction, currency);

  const scheduledFor = nextCheckAt(new Date(), product.intervalMinutes, product.jitterPercent);
  const write =
    fetched.status === "ok" || fetched.status === "not_modified"
      ? buildWrite(product, fetched, extraction, currency, outcome)
      : { pricePoint: null, productUpdate: {} };

  await persist(
    product,
    buildCheckRun(product, startedAt, fetched.durationMs, outcome),
    write,
    scheduledFor
  );

  log.set({
    currency: write.pricePoint?.currency ?? null,
    durationMs: fetched.durationMs,
    extractorUsed: outcome.extractorUsed ?? null,
    httpStatus: outcome.httpStatus ?? null,
    inStock: write.pricePoint?.inStock ?? null,
    nextCheckAt: scheduledFor.toISOString(),
    outcome: outcome.status,
    price: write.pricePoint?.price ?? null,
  });
  if (outcome.status === "ok") {
    log.info("check complete");
  } else {
    log.warn(outcome.error ?? "check failed");
  }
  log.emit();

  // After the commit and after the log line: the measurement is safe whatever
  // Home Assistant does next.
  await runAlerting({
    outcome,
    pricePointWritten: write.pricePoint !== null,
    product,
  });
}
