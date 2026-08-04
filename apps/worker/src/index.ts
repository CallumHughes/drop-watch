/**
 * The worker process.
 *
 * Standalone Node, deliberately not booted from inside Next.js: a
 * crawl burst must not block the dashboard's event loop, and a hot reload must
 * never leave two schedulers racing. Postgres — via pg-boss — is the only
 * interface between the two.
 *
 * Boot order matters. `start()` migrates and takes ownership of the `pgboss`
 * schema, queues must exist before anything works or sends on them, and the
 * cron is registered last so the dispatcher never fires into a worker that
 * cannot yet handle what it enqueues.
 */

import {
  CHECK_LISTING_NOW_QUEUE,
  CHECK_LISTING_QUEUE,
  type CheckListingJob,
  createWorkerBoss,
  ENQUEUE_DUE_CHECKS_CRON,
  ENQUEUE_DUE_CHECKS_QUEUE,
  ensureQueues,
  type PgBoss,
  PURGE_CHECK_RUNS_CRON,
  PURGE_CHECK_RUNS_QUEUE,
} from "@drop-watch/db/queue";
import { env } from "@drop-watch/env/worker";
import { initLogger, log } from "evlog";
import type { Job } from "pg-boss";
import { type CheckSource, checkListing } from "./check-listing";
import { enqueueDueChecks } from "./enqueue-due-checks";
import { purgeCheckRuns } from "./purge-check-runs";

/** Checks pulled per fetch. Each is processed in turn, not in parallel. */
const CHECK_BATCH_SIZE = 5;

/** How long `stop()` waits for in-flight checks before it stops waiting. */
const SHUTDOWN_TIMEOUT_MS = 30_000;

function checkHandler(source: CheckSource) {
  return async (jobs: Job<CheckListingJob>[]): Promise<void> => {
    for (const job of jobs) {
      // biome-ignore lint/performance/noAwaitInLoops: checks run in turn on purpose — parallel fetches would defeat the per-domain politeness queue in core.
      await checkListing(job.data.listingId, source);
    }
  };
}

async function registerWorkers(boss: PgBoss): Promise<void> {
  await boss.work(ENQUEUE_DUE_CHECKS_QUEUE, () => enqueueDueChecks(boss));
  await boss.work(CHECK_LISTING_QUEUE, { batchSize: CHECK_BATCH_SIZE }, checkHandler("scheduled"));
  await boss.work(CHECK_LISTING_NOW_QUEUE, { batchSize: CHECK_BATCH_SIZE }, checkHandler("manual"));
  await boss.work(PURGE_CHECK_RUNS_QUEUE, () => purgeCheckRuns());
}

function installShutdown(boss: PgBoss): void {
  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) {
      return;
    }
    stopping = true;
    log.info("worker", `${signal} received, stopping`);
    try {
      // Graceful: let the checks already in flight finish writing before the
      // connection goes away, so no attempt is recorded half-way.
      await boss.stop({ graceful: true, timeout: SHUTDOWN_TIMEOUT_MS });
    } catch (error) {
      log.error({ action: "worker_shutdown", error: String(error) });
    }
    process.exit(0);
  };

  const onSignal = (signal: NodeJS.Signals) => {
    shutdown(signal).catch(() => process.exit(1));
  };

  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
}

async function main(): Promise<void> {
  initLogger({ env: { environment: env.NODE_ENV, service: "drop-watch-worker" } });

  const boss = createWorkerBoss();
  // pg-boss surfaces background maintenance failures on this event rather than
  // throwing into whatever call happens to be in flight. Left unhandled,
  // EventEmitter's default behaviour would take the process down with it.
  boss.on("error", (error) => {
    log.error({ action: "pgboss_error", error: error.message });
  });
  boss.on("warning", (warning) => {
    log.warn({ action: "pgboss_warning", warning: warning.message });
  });

  await boss.start();
  await ensureQueues(boss);
  await registerWorkers(boss);
  await boss.schedule(ENQUEUE_DUE_CHECKS_QUEUE, ENQUEUE_DUE_CHECKS_CRON);
  await boss.schedule(PURGE_CHECK_RUNS_QUEUE, PURGE_CHECK_RUNS_CRON);

  installShutdown(boss);

  log.info({
    action: "worker_started",
    cron: ENQUEUE_DUE_CHECKS_CRON,
    environment: env.NODE_ENV,
    queues: [
      ENQUEUE_DUE_CHECKS_QUEUE,
      CHECK_LISTING_QUEUE,
      CHECK_LISTING_NOW_QUEUE,
      PURGE_CHECK_RUNS_QUEUE,
    ],
  });
}

main().catch((error: unknown) => {
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`worker failed to start: ${detail}\n`);
  process.exit(1);
});
