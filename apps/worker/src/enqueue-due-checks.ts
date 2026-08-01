/**
 * The minutely dispatcher.
 *
 * It does one indexed read (`listings(active, next_check_at)`, joined to
 * `products` for the pause flag) and turns every due listing into a
 * `check-listing` job. It does no fetching itself — a slow site must never
 * hold up the tick that would have enqueued the other nineteen listings.
 *
 * Enqueueing is idempotent: the queue's `exclusive` policy plus a per-listing
 * `singletonKey` means a listing that stays due (worker restarting, check
 * still running) ends up with exactly one job, not one per minute.
 */

import { db } from "@drop-watch/db";
import {
  CHECK_LISTING_QUEUE,
  type CheckListingJob,
  checkListingSendOptions,
  type PgBoss,
} from "@drop-watch/db/queue";
import { listings, products } from "@drop-watch/db/schema/products";
import { and, eq, lte } from "drizzle-orm";
import { createLogger } from "evlog";

export async function enqueueDueChecks(boss: PgBoss): Promise<void> {
  const log = createLogger({ action: "enqueue_due_checks" });
  const startedAt = Date.now();

  const due = await db
    .select({ id: listings.id })
    .from(listings)
    .innerJoin(products, eq(listings.productId, products.id))
    .where(
      and(
        eq(products.active, true),
        eq(listings.active, true),
        lte(listings.nextCheckAt, new Date())
      )
    );

  let enqueued = 0;
  for (const listing of due) {
    const job: CheckListingJob = { listingId: listing.id };
    // biome-ignore lint/performance/noAwaitInLoops: pg-boss has no batch send that honours per-job singleton keys.
    const jobId = await boss.send(CHECK_LISTING_QUEUE, job, checkListingSendOptions(listing.id));
    if (jobId) {
      enqueued += 1;
    }
  }

  log.set({
    // due - enqueued is the count already queued or running, which is the
    // signal that checks are taking longer than their interval.
    deduped: due.length - enqueued,
    due: due.length,
    durationMs: Date.now() - startedAt,
    enqueued,
  });
  log.emit();
}
