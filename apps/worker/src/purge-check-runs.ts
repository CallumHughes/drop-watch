/**
 * Retention sweep for `check_runs`. Deletes rows older than {@link RETENTION_DAYS}
 * days, run daily by the worker's cron.
 */

import { db } from "@drop-watch/db";
import { checkRuns } from "@drop-watch/db/schema/products";
import { sql } from "drizzle-orm";
import { createLogger } from "evlog";

/** Matches the schema comment on `checkRuns`. */
export const RETENTION_DAYS = 30;

/** Bounded batches, so the first sweep of an old deployment is many short
 * transactions rather than one long lock the job expiry then misreads. */
const BATCH_SIZE = 5000;

export async function purgeCheckRuns(): Promise<void> {
  const log = createLogger({ action: "purge_check_runs" });
  const startedAt = Date.now();

  let deleted = 0;
  let batch: number;
  do {
    // `now()` is the database's clock — the cutoff of an irreversible delete
    // must not move with container clock skew.
    // biome-ignore lint/performance/noAwaitInLoops: batches are sequential on purpose.
    const result = await db.execute(sql`
      delete from ${checkRuns} where ${checkRuns.id} in (
        select ${checkRuns.id} from ${checkRuns}
        where ${checkRuns.startedAt} < now() - make_interval(days => ${RETENTION_DAYS})
        limit ${BATCH_SIZE}
      )`);
    batch = result.rowCount ?? 0;
    deleted += batch;
  } while (batch === BATCH_SIZE);

  log.set({ deleted, durationMs: Date.now() - startedAt });
  log.emit();
}
