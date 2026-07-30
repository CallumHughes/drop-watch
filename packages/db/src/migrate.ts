/**
 * The one-shot migration job. Applies `src/migrations` through drizzle's
 * runtime migrator, against the same `__drizzle_migrations` journal
 * `drizzle-kit migrate` uses, so the two are interchangeable.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "@drop-watch/env/db";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const CONNECT_ATTEMPTS = 30;
const CONNECT_INTERVAL_MS = 2000;

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "migrations");

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * In production Postgres is on the host, outside compose's view, so there is no
 * `service_healthy` to depend on and the containers routinely start first.
 * Only the connection is retried: a migration that fails must fail the
 * deployment, not spin.
 */
async function waitForDatabase(client: ReturnType<typeof drizzle>["$client"]) {
  for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt += 1) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: retries are sequential by definition.
      await client.query("select 1");
      return;
    } catch (error) {
      if (attempt === CONNECT_ATTEMPTS) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      process.stdout.write(
        `migrate: database not ready (attempt ${attempt}/${CONNECT_ATTEMPTS}: ${message}), retrying in ${CONNECT_INTERVAL_MS / 1000}s\n`
      );
      await sleep(CONNECT_INTERVAL_MS);
    }
  }
}

const db = drizzle(env.DATABASE_URL);

try {
  await waitForDatabase(db.$client);
  process.stdout.write("migrate: database reachable, applying migrations\n");
  await migrate(db, { migrationsFolder });
  process.stdout.write("migrate: migrations applied\n");
} finally {
  await db.$client.end();
}
