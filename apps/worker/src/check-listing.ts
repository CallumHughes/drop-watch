/**
 * One check of one listing: fetch → extract → record → reschedule.
 *
 * The whole point of the design here is the transaction in `persist`. The price
 * point, the check-run audit row, and the `nextCheckAt` advance are written
 * together or not at all, so a worker killed mid-check leaves the listing
 * exactly as it was — still due, no half-written attempt — and the dispatcher
 * picks it up again. Delivery is at-least-once, as it is with any queue: a
 * crash can cost a repeated check, never a corrupt or missing one.
 *
 * Alerting runs *after* that transaction commits, deliberately outside it and
 * deliberately unable to fail the check — see `./alerting`.
 */

import type { ExtractionResult, ExtractorStrategy } from "@drop-watch/core/extract";
import { extract, STRATEGY_ORDER } from "@drop-watch/core/extract";
import type { FetchPageResult } from "@drop-watch/core/fetch";
import { fetchPage, withDomainQueue } from "@drop-watch/core/fetch";
import type { RetrieveResult } from "@drop-watch/core/render";
import { renderPage } from "@drop-watch/core/render";
import { db } from "@drop-watch/db";
import type { Listing, NewCheckRun, NewPricePoint, Product } from "@drop-watch/db/schema/products";
import { checkRuns, listings, pricePoints, products } from "@drop-watch/db/schema/products";
import { env } from "@drop-watch/env/worker";
import { eq } from "drizzle-orm";
import { createLogger } from "evlog";
import { runAlerting } from "./alerting";
import { type CheckOutcome, toCheckOutcome } from "./outcome";
import { renderTarget, unconfiguredRenderResult } from "./retrieve";
import { nextCheckAt } from "./schedule";

/** Where a check came from. Recorded on the log line, not in the database. */
export type CheckSource = "scheduled" | "manual";

/**
 * Listings whose check is running right now, in this process.
 *
 * pg-boss's `exclusive` queue policy already stops one queue from running two
 * jobs for a listing, but `check-listing` and `check-listing-now` are separate
 * queues — a "check now" pressed a second after the dispatcher fired would
 * otherwise double-fetch the same page. Cheap belt to pg-boss's braces.
 */
const inFlight = new Set<string>();

function strategiesFor(listing: Listing): readonly ExtractorStrategy[] {
  // A listing pinned to `selector` should fail loudly when its selector rots,
  // not quietly start reporting whatever JSON-LD the page happens to carry.
  return listing.extractor === "selector" ? ["selector"] : STRATEGY_ORDER;
}

/** `undefined` rather than `null`, because that is what the fetch layer takes. */
function conditionalRequest(listing: Listing): { etag?: string; lastModified?: string } {
  const options: { etag?: string; lastModified?: string } = {};
  if (listing.etag) {
    options.etag = listing.etag;
  }
  if (listing.lastModified) {
    options.lastModified = listing.lastModified;
  }
  return options;
}

/**
 * Retrieves a listing's page over plain HTTP or through the renderer sidecar,
 * depending on `listing.render`. Never throws — both paths already return a
 * `FetchPageResult` variant for every failure mode.
 */
function retrievePage(listing: Listing): Promise<RetrieveResult> {
  const renderUrl = env.RENDER_URL;
  const target = renderTarget(listing, renderUrl);

  if (target === "http") {
    return fetchPage(listing.url, conditionalRequest(listing));
  }

  if (target === "unconfigured" || renderUrl === undefined) {
    return Promise.resolve(unconfiguredRenderResult());
  }

  // `renderPage` talks to the sidecar on localhost, not to the store, so
  // without this wrap a browser check would skip the per-domain politeness
  // queue entirely — `fetchPage` applies it for us on the http path.
  //
  // Deliberately no `conditionalRequest(listing)`: a browser render sends no
  // cache validators, and `buildWrite` only overwrites the ones it actually
  // received, so the stored etag/lastModified survive untouched.
  return withDomainQueue(listing.url, () =>
    renderPage(renderUrl, listing.url, {
      ...(listing.locale ? { locale: listing.locale } : {}),
    })
  );
}

interface CheckWrite {
  /** Columns to backfill onto `listings` alongside the reschedule. */
  listingUpdate: Partial<Listing>;
  pricePoint: NewPricePoint | null;
  /** Columns to backfill onto `products`; empty when there is nothing to write. */
  productUpdate: Partial<Product>;
}

function buildWrite(
  listing: Listing,
  product: Product,
  fetched: Extract<FetchPageResult, { status: "ok" | "not_modified" }>,
  extraction: ExtractionResult | null,
  currency: string | null,
  outcome: CheckOutcome
): CheckWrite {
  const listingUpdate: Partial<Listing> = {
    // Only overwrite validators we actually received; a 304 without an ETag
    // must not wipe the one that produced it.
    ...(fetched.etag ? { etag: fetched.etag } : {}),
    ...(fetched.lastModified ? { lastModified: fetched.lastModified } : {}),
  };

  if (!(outcome.recordPricePoint && extraction?.ok && currency)) {
    return { listingUpdate, pricePoint: null, productUpdate: {} };
  }

  // Backfill only what is not already set — the user's own title, image or
  // currency edits outrank whatever a page says this week.
  if (!listing.currency) {
    listingUpdate.currency = currency;
  }

  const productUpdate: Partial<Product> = {};
  if (!product.title && extraction.title) {
    productUpdate.title = extraction.title;
  }
  if (!product.imageUrl && extraction.imageUrl) {
    productUpdate.imageUrl = extraction.imageUrl;
  }
  // Product currency denominates targetPrice, so it gets the same backfill.
  if (!product.currency) {
    productUpdate.currency = currency;
  }

  const pricePoint: NewPricePoint = {
    currency,
    // Decimal string all the way from the parser into `numeric(12,2)`. Never
    // through Number.
    listingId: listing.id,
    price: extraction.price,
  };
  if (extraction.availability !== undefined) {
    pricePoint.availability = extraction.availability;
  }
  if (extraction.inStock !== undefined) {
    pricePoint.inStock = extraction.inStock;
  }

  return { listingUpdate, pricePoint, productUpdate };
}

/**
 * Runs a check and records it. Never throws for anything the target site did —
 * an unreachable host is a recorded `check_runs` row, not a failed job, so
 * pg-boss's retries stay reserved for genuine infrastructure faults (the
 * fetch layer already retries transport errors itself).
 */
export async function checkListing(listingId: string, source: CheckSource): Promise<void> {
  if (inFlight.has(listingId)) {
    createLogger({ action: "check_listing", listingId, source }).warn("check already in flight");
    return;
  }
  inFlight.add(listingId);
  try {
    await runCheck(listingId, source);
  } finally {
    inFlight.delete(listingId);
  }
}

function extractFrom(listing: Listing, fetched: RetrieveResult): ExtractionResult | null {
  if (fetched.status !== "ok") {
    return null;
  }
  return extract(fetched.body, {
    strategies: strategiesFor(listing),
    url: fetched.url,
    ...(listing.locale ? { locale: listing.locale } : {}),
    ...(listing.selector ? { selector: listing.selector } : {}),
  });
}

function buildCheckRun(
  listing: Listing,
  startedAt: Date,
  durationMs: number,
  outcome: CheckOutcome
): NewCheckRun {
  return {
    durationMs,
    listingId: listing.id,
    startedAt,
    status: outcome.status,
    ...(outcome.error === undefined ? {} : { error: outcome.error }),
    ...(outcome.extractorUsed === undefined ? {} : { extractorUsed: outcome.extractorUsed }),
    ...(outcome.httpStatus === undefined ? {} : { httpStatus: outcome.httpStatus }),
  };
}

/**
 * Everything a check produces, committed atomically. This is what makes a
 * killed worker safe: either the attempt is fully recorded and the listing is
 * rescheduled, or none of it happened and the listing is still due.
 */
function persist(
  listing: Listing,
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
      .update(listings)
      .set({ ...write.listingUpdate, nextCheckAt: scheduledFor })
      .where(eq(listings.id, listing.id));
    if (Object.keys(write.productUpdate).length > 0) {
      await tx.update(products).set(write.productUpdate).where(eq(products.id, listing.productId));
    }
  });
}

async function loadCheckable(
  listingId: string,
  log: ReturnType<typeof createLogger>
): Promise<{ listing: Listing; product: Product } | null> {
  const [row] = await db
    .select({ listing: listings, product: products })
    .from(listings)
    .innerJoin(products, eq(listings.productId, products.id))
    .where(eq(listings.id, listingId))
    .limit(1);
  if (!row) {
    log.warn("listing not found");
    log.emit();
    return null;
  }
  if (!row.product.active) {
    log.warn("product inactive, skipping");
    log.emit();
    return null;
  }
  if (!row.listing.active) {
    log.warn("listing inactive, skipping");
    log.emit();
    return null;
  }
  return row;
}

async function runCheck(listingId: string, source: CheckSource): Promise<void> {
  const log = createLogger({ action: "check_listing", listingId, source });
  const checkable = await loadCheckable(listingId, log);
  if (!checkable) {
    return;
  }
  const { listing, product } = checkable;

  log.set({ productId: product.id, url: listing.url });

  const startedAt = new Date();
  const fetched = await retrievePage(listing);
  const extraction = extractFrom(listing, fetched);
  const extractedCurrency = extraction?.ok ? extraction.currency : undefined;
  const currency = extractedCurrency ?? listing.currency ?? null;
  const outcome = toCheckOutcome(fetched, extraction, currency);

  const scheduledFor = nextCheckAt(new Date(), listing.intervalMinutes, listing.jitterPercent);
  const write =
    fetched.status === "ok" || fetched.status === "not_modified"
      ? buildWrite(listing, product, fetched, extraction, currency, outcome)
      : { listingUpdate: {}, pricePoint: null, productUpdate: {} };

  await persist(
    listing,
    buildCheckRun(listing, startedAt, fetched.durationMs, outcome),
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
    render: listing.render,
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
    listing,
    outcome,
    pricePointWritten: write.pricePoint !== null,
    product,
  });
}
