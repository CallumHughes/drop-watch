/**
 * Retention sweep for `check_runs`. Deletes rows older than {@link RETENTION_DAYS}
 * days, run daily by the worker's cron.
 */

import { db } from "@drop-watch/db";
import { checkRuns } from "@drop-watch/db/schema/products";
import { lt } from "drizzle-orm";
import { createLogger } from "evlog";

/** Matches the schema comment on `checkRuns`. */
export const RETENTION_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Rows with `startedAt` before this instant are eligible for deletion. */
export function retentionCutoff(now: Date): Date {
  return new Date(now.getTime() - RETENTION_DAYS * MS_PER_DAY);
}

export async function purgeCheckRuns(): Promise<void> {
  const log = createLogger({ action: "purge_check_runs" });
  const startedAt = Date.now();

  const result = await db
    .delete(checkRuns)
    .where(lt(checkRuns.startedAt, retentionCutoff(new Date())));

  log.set({ deleted: result.rowCount ?? 0, durationMs: Date.now() - startedAt });
  log.emit();
}
