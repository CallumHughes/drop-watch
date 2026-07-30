/**
 * The minutely dispatcher.
 *
 * It does one indexed read (`products(active, next_check_at)`) and turns every
 * due product into a `check-product` job. It does no fetching itself — a slow
 * site must never hold up the tick that would have enqueued the other
 * nineteen products.
 *
 * Enqueueing is idempotent: the queue's `exclusive` policy plus a per-product
 * `singletonKey` means a product that stays due (worker restarting, check
 * still running) ends up with exactly one job, not one per minute.
 */

import { db } from "@drop-watch/db";
import {
  CHECK_PRODUCT_QUEUE,
  type CheckProductJob,
  checkProductSendOptions,
  type PgBoss,
} from "@drop-watch/db/queue";
import { products } from "@drop-watch/db/schema/products";
import { and, eq, lte } from "drizzle-orm";
import { createLogger } from "evlog";

export async function enqueueDueChecks(boss: PgBoss): Promise<void> {
  const log = createLogger({ action: "enqueue_due_checks" });
  const startedAt = Date.now();

  const due = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.active, true), lte(products.nextCheckAt, new Date())));

  let enqueued = 0;
  for (const product of due) {
    const job: CheckProductJob = { productId: product.id };
    // biome-ignore lint/performance/noAwaitInLoops: pg-boss has no batch send that honours per-job singleton keys.
    const jobId = await boss.send(CHECK_PRODUCT_QUEUE, job, checkProductSendOptions(product.id));
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
