/**
 * The web side's single pg-boss connection.
 *
 * Postgres is the only interface between `apps/web` and `apps/worker`
 * (PLAN.md §1), so "check now" is a `send()` onto the queue the worker already
 * consumes. Two rules govern what happens here:
 *
 * 1. **Sender only.** `createSenderBoss()` does not migrate, supervise, or
 *    schedule. Calling `createWorkerBoss()` from the web process would start a
 *    second minutely cron and double-fire the dispatcher.
 * 2. **One instance per process.** Same hazard as the database pool: a fresh
 *    boss per request, or per hot reload, exhausts Postgres connections. The
 *    started instance is stashed on `globalThis` for exactly that reason.
 */

import { createSenderBoss, type PgBoss } from "@drop-watch/db/queue";
import { log } from "evlog";

const globalForBoss = globalThis as { __priceTrackerSenderBoss?: Promise<PgBoss> };

async function startSenderBoss(): Promise<PgBoss> {
  const boss = createSenderBoss();
  // pg-boss reports background failures on this event instead of throwing into
  // whatever call is in flight; unhandled, EventEmitter takes the process down.
  boss.on("error", (error) => {
    log.error({ action: "sender_boss_error", error: error.message });
  });
  await boss.start();
  return boss;
}

/**
 * The started sender, booted on first use. A failed start is not cached, so a
 * database that was briefly unreachable does not poison every later send.
 */
export function getSenderBoss(): Promise<PgBoss> {
  const existing = globalForBoss.__priceTrackerSenderBoss;
  if (existing) {
    return existing;
  }
  const starting = startSenderBoss().catch((error: unknown) => {
    globalForBoss.__priceTrackerSenderBoss = undefined;
    throw error;
  });
  globalForBoss.__priceTrackerSenderBoss = starting;
  return starting;
}
