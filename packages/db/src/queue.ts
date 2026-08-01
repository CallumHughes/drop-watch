/**
 * pg-boss wiring: queue names, queue configuration, and the two ways to get a
 * boss instance.
 *
 * This lives in `@drop-watch/db` rather than in `apps/worker` because
 * Postgres is the only interface between the web app and the worker — the "check now" button in `apps/web` enqueues onto the same queue the
 * worker consumes, and neither side can import from the other's app.
 *
 * Ownership is deliberately lopsided: the **worker** owns the `pgboss` schema
 * (it migrates, supervises, and runs the cron). Every other process is only a
 * sender and must not do any of those things — a second cron worker would
 * double-fire the minutely dispatcher.
 */

import { env } from "@drop-watch/env/db";
import { PgBoss, type Queue, type SendOptions } from "pg-boss";

/** Re-exported so callers can type a boss without depending on pg-boss directly. */
export type { PgBoss } from "pg-boss";

/** Minutely dispatcher. Finds listings whose `nextCheckAt` has passed. */
export const ENQUEUE_DUE_CHECKS_QUEUE = "enqueue-due-checks";

/** Scheduled checks, enqueued by the dispatcher. */
export const CHECK_LISTING_QUEUE = "check-listing";

/** Ad-hoc checks from the UI's "check now" button. Same handler, own queue. */
export const CHECK_LISTING_NOW_QUEUE = "check-listing-now";

/** Daily retention sweep. Deletes `check_runs` rows older than 30 days. */
export const PURGE_CHECK_RUNS_QUEUE = "purge-check-runs";

/** Payload for both `check-listing` and `check-listing-now`. */
export interface CheckListingJob {
  listingId: string;
}

/**
 * A check attempt is capped by the fetch layer at ~20s per try and up to three
 * tries with backoff, so anything still active after two minutes is a crashed
 * worker rather than a slow site. pg-boss reclaims those for retry.
 */
const CHECK_EXPIRE_SECONDS = 120;

/** The dispatcher only reads an index and sends jobs; it is never slow. */
const DISPATCH_EXPIRE_SECONDS = 60;

/** Three attempts, backing off, before a job is given up on. */
const CHECK_RETRY_LIMIT = 3;

/** A bulk delete can take a while; longer than a check but still bounded. */
const PURGE_EXPIRE_SECONDS = 300;

/**
 * Queue definitions, applied by {@link ensureQueues} at worker boot.
 *
 * `exclusive` on the check queues is what makes the dispatcher safe to run
 * every minute: at most one job per listing may be queued *or* active, so a
 * listing that stays due (because the worker is down, or a check is still
 * running) accumulates exactly one job rather than one per tick. It is also the
 * "never two checks in flight for one listing" guarantee.
 *
 * `short` on the dispatcher does the same for the cron itself.
 */
export const QUEUE_DEFINITIONS: readonly Queue[] = [
  {
    expireInSeconds: DISPATCH_EXPIRE_SECONDS,
    name: ENQUEUE_DUE_CHECKS_QUEUE,
    policy: "short",
    retryLimit: CHECK_RETRY_LIMIT,
  },
  {
    expireInSeconds: CHECK_EXPIRE_SECONDS,
    name: CHECK_LISTING_QUEUE,
    policy: "exclusive",
    retryBackoff: true,
    retryLimit: CHECK_RETRY_LIMIT,
  },
  {
    expireInSeconds: CHECK_EXPIRE_SECONDS,
    name: CHECK_LISTING_NOW_QUEUE,
    policy: "exclusive",
    retryBackoff: true,
    retryLimit: CHECK_RETRY_LIMIT,
  },
  {
    expireInSeconds: PURGE_EXPIRE_SECONDS,
    name: PURGE_CHECK_RUNS_QUEUE,
    policy: "short",
    retryLimit: CHECK_RETRY_LIMIT,
  },
];

/** Cron expression for the dispatcher. Every minute. */
export const ENQUEUE_DUE_CHECKS_CRON = "* * * * *";

/** Cron expression for the retention sweep. Daily, off-peak. */
export const PURGE_CHECK_RUNS_CRON = "0 3 * * *";

/**
 * The worker's boss: migrates the `pgboss` schema, runs maintenance, and runs
 * the cron. Exactly one process in the deployment may use this.
 */
export function createWorkerBoss(): PgBoss {
  return new PgBoss({
    application_name: "drop-watch-worker",
    connectionString: env.DATABASE_URL,
    migrate: true,
    schedule: true,
    supervise: true,
  });
}

/** Small pool — a sender opens a connection to enqueue and little else. */
const SENDER_POOL_SIZE = 2;

/**
 * A send-only boss for `apps/web`. Does not migrate (the worker owns the
 * schema), does not supervise, and does not run the cron. Still needs
 * `start()` before `send()`.
 */
export function createSenderBoss(): PgBoss {
  return new PgBoss({
    application_name: "drop-watch-sender",
    connectionString: env.DATABASE_URL,
    max: SENDER_POOL_SIZE,
    migrate: false,
    schedule: false,
    supervise: false,
  });
}

/** Idempotent; safe to call on every boot. */
export async function ensureQueues(boss: PgBoss): Promise<void> {
  for (const { name, ...options } of QUEUE_DEFINITIONS) {
    // biome-ignore lint/performance/noAwaitInLoops: three DDL statements at boot, and pg-boss has no batch form.
    await boss.createQueue(name, options);
  }
}

/**
 * Send options for a check job. The `singletonKey` is what the `exclusive`
 * policy keys on, so "check now" pressed twice enqueues once.
 */
export function checkListingSendOptions(listingId: string): SendOptions {
  return { singletonKey: listingId };
}

/**
 * Enqueue an immediate check — this is the "check now" button's entire
 * contract with the worker. Resolves to the job id, or `null` when a check for
 * this listing is already queued or running.
 */
export function sendCheckNow(boss: PgBoss, listingId: string): Promise<string | null> {
  const job: CheckListingJob = { listingId };
  return boss.send(CHECK_LISTING_NOW_QUEUE, job, checkListingSendOptions(listingId));
}
