import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closeDb } from "../test/helpers";
import { db } from "./index";
import {
  CHECK_LISTING_NOW_QUEUE,
  CHECK_LISTING_QUEUE,
  checkListingSendOptions,
  createSenderBoss,
  createWorkerBoss,
  ENQUEUE_DUE_CHECKS_QUEUE,
  ensureQueues,
  type PgBoss,
  PURGE_CHECK_RUNS_QUEUE,
  QUEUE_DEFINITIONS,
  sendCheckNow,
} from "./queue";

const STOP_GRACE_MS = 5000;

/** `stop()` can resolve before teardown finishes; wait for the event, bounded. */
async function stopBoss(boss: PgBoss): Promise<void> {
  await boss.stop({ close: true, graceful: false });
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, STOP_GRACE_MS);
    boss.once("stopped", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

// A deterministic starting point, whatever a previous run left behind.
beforeAll(async () => {
  await db.execute(sql`DROP SCHEMA IF EXISTS pgboss CASCADE`);
});

afterAll(async () => {
  await closeDb();
});

describe("before the worker has migrated the pgboss schema", () => {
  it("a sender boss refuses to start — the worker owns the schema", async () => {
    const sender = createSenderBoss();
    sender.on("error", () => {
      // Expected: the failed start may also surface as an error event.
    });
    try {
      await expect(sender.start()).rejects.toThrow();
    } finally {
      await sender.stop({ close: true, graceful: false }).catch(() => {
        // A boss that never started has nothing to stop.
      });
    }
  });
});

describe("with a worker boss", () => {
  let worker: PgBoss;

  beforeAll(async () => {
    worker = createWorkerBoss();
    worker.on("error", (error) => {
      console.error("worker boss error", error);
    });
    await worker.start();
    await ensureQueues(worker);
  });

  beforeEach(async () => {
    for (const { name } of QUEUE_DEFINITIONS) {
      // biome-ignore lint/performance/noAwaitInLoops: three cleanup statements.
      await worker.deleteAllJobs(name);
    }
  });

  afterAll(async () => {
    await stopBoss(worker);
  });

  it("ensureQueues is idempotent and applies the definitions", async () => {
    await ensureQueues(worker);

    // pg-boss keeps internal __pgboss__ queues of its own; ours are the rest.
    const queues = await worker.getQueues();
    const ownQueues = queues.filter((queue) => !queue.name.startsWith("__pgboss__"));
    expect(ownQueues.map((queue) => queue.name).sort()).toEqual(
      [
        CHECK_LISTING_NOW_QUEUE,
        CHECK_LISTING_QUEUE,
        ENQUEUE_DUE_CHECKS_QUEUE,
        PURGE_CHECK_RUNS_QUEUE,
      ].sort()
    );

    const checkQueue = await worker.getQueue(CHECK_LISTING_QUEUE);
    expect(checkQueue).toMatchObject({
      expireInSeconds: 120,
      policy: "exclusive",
      retryBackoff: true,
      retryLimit: 3,
    });

    const dispatchQueue = await worker.getQueue(ENQUEUE_DUE_CHECKS_QUEUE);
    expect(dispatchQueue).toMatchObject({ expireInSeconds: 60, policy: "short" });
  });

  it("sendCheckNow dedupes per listing while a job is queued", async () => {
    const first = await sendCheckNow(worker, "listing-1");
    expect(first).toEqual(expect.any(String));

    // Pressed twice: the exclusive policy keys on the singletonKey.
    await expect(sendCheckNow(worker, "listing-1")).resolves.toBeNull();

    // A different listing is unaffected.
    await expect(sendCheckNow(worker, "listing-2")).resolves.toEqual(expect.any(String));

    const jobs = await worker.findJobs(CHECK_LISTING_NOW_QUEUE);
    expect(jobs).toHaveLength(2);
    expect(jobs.map((job) => job.singletonKey).sort()).toEqual(["listing-1", "listing-2"]);
  });

  it("checkListingSendOptions keys the job on the listing id", () => {
    expect(checkListingSendOptions("listing-1")).toEqual({ singletonKey: "listing-1" });
  });

  it("a sender boss can enqueue once the schema exists", async () => {
    const sender = createSenderBoss();
    sender.on("error", (error) => {
      console.error("sender boss error", error);
    });
    try {
      await sender.start();
      const jobId = await sendCheckNow(sender, "listing-from-sender");
      expect(jobId).toEqual(expect.any(String));

      const jobs = await worker.findJobs(CHECK_LISTING_NOW_QUEUE);
      expect(jobs.map((job) => job.singletonKey)).toEqual(["listing-from-sender"]);
    } finally {
      await stopBoss(sender);
    }
  });
});
