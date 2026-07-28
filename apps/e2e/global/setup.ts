/**
 * Global setup: a fresh database and a live worker, once per run.
 *
 * Order matters. The database is dropped and recreated (so signup is open for
 * auth.setup.ts and every run starts from nothing), the schema is pushed, and
 * only then is the worker started — its pg-boss boot migrates the `pgboss`
 * schema into the same database. Readiness is polled from that schema: the
 * worker creates its queues last-but-one, so `check-product-now` existing
 * means jobs sent by "check now" will be picked up.
 *
 * The returned function is the teardown (Playwright runs it after the suite):
 * it stops the worker's whole process group, SIGTERM first for a graceful
 * pg-boss stop, SIGKILL if that takes longer than it should.
 */

import { type ChildProcess, execSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "pg";

import { appEnv, E2E_DATABASE_URL } from "../constants";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const WORKER_DIR = path.join(REPO_ROOT, "apps/worker");
const TSX_BIN = path.join(WORKER_DIR, "node_modules/.bin/tsx");

const READY_TIMEOUT_MS = 90_000;
const READY_POLL_MS = 500;
const KILL_GRACE_MS = 10_000;

function databaseName(connectionString: string): string {
  return decodeURIComponent(new URL(connectionString).pathname.slice(1));
}

function adminConnectionString(connectionString: string): string {
  const url = new URL(connectionString);
  url.pathname = "/postgres";
  return url.toString();
}

async function recreateDatabase(): Promise<void> {
  const name = databaseName(E2E_DATABASE_URL);
  const client = new Client({ connectionString: adminConnectionString(E2E_DATABASE_URL) });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await client.query(`CREATE DATABASE "${name}"`);
  } finally {
    await client.end();
  }
}

function pushSchema(): void {
  // Explicit env wins over every dotenv file the tooling loads on its own.
  execSync("pnpm --filter @price-tracker/db db:push", {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL },
    stdio: ["ignore", "ignore", "inherit"],
  });
}

function startWorker(): ChildProcess {
  return spawn(TSX_BIN, ["src/index.ts"], {
    cwd: WORKER_DIR,
    detached: true,
    env: { ...process.env, ...appEnv },
    stdio: ["ignore", "ignore", "inherit"],
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function queueExists(client: Client): Promise<boolean> {
  try {
    const result = await client.query(
      "SELECT 1 FROM pgboss.queue WHERE name = 'check-product-now'"
    );
    return result.rowCount !== null && result.rowCount > 0;
  } catch {
    // The pgboss schema does not exist until the worker has migrated it.
    return false;
  }
}

async function awaitWorkerReady(worker: ChildProcess): Promise<void> {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (worker.exitCode !== null) {
        throw new Error(`worker exited with code ${worker.exitCode} before becoming ready`);
      }
      // biome-ignore lint/performance/noAwaitInLoops: a readiness poll is sequential by nature.
      if (await queueExists(client)) {
        return;
      }
      await sleep(READY_POLL_MS);
    }
    throw new Error(`worker not ready after ${READY_TIMEOUT_MS}ms (pgboss queues never appeared)`);
  } finally {
    await client.end();
  }
}

function killGroup(worker: ChildProcess, signal: NodeJS.Signals): void {
  if (worker.pid === undefined) {
    return;
  }
  try {
    // Negative pid: the whole detached group, so tsx's node child dies too.
    process.kill(-worker.pid, signal);
  } catch {
    worker.kill(signal);
  }
}

function stopWorker(worker: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (worker.exitCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      killGroup(worker, "SIGKILL");
      resolve();
    }, KILL_GRACE_MS);
    worker.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    killGroup(worker, "SIGTERM");
  });
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  await recreateDatabase();
  pushSchema();
  const worker = startWorker();
  await awaitWorkerReady(worker);
  return () => stopWorker(worker);
}
