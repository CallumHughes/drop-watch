/**
 * The migration chain and `drizzle-kit push` must produce the same schema.
 *
 * Production applies `src/migrations` (the compose `migrate` service); the
 * e2e suite applies `drizzle-kit push`. Nothing else guards against those two
 * paths drifting — a schema edit without a generated migration would pass e2e
 * and break the next deploy. So: two throwaway databases, one per path, and a
 * normalised pg_dump diff over the result.
 *
 * Self-contained on purpose: no import touches the `db` singleton, drizzle-kit
 * runs as a child process per database, and pg_dump runs inside the compose
 * postgres container (the host has no matching client binaries).
 */

import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  adminConnectionString,
  INTEGRATION_DATABASE_URL,
  PARITY_MIGRATE_DB,
  PARITY_PUSH_DB,
  withDatabase,
} from "../test/constants";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PKG_DIR = path.join(REPO_ROOT, "packages/db");

const PARITY_TIMEOUT_MS = 120_000;

const TRAILING_COMMA = /,$/;

async function withAdmin(run: (client: Client) => Promise<void>): Promise<void> {
  const client = new Client({
    connectionString: adminConnectionString(INTEGRATION_DATABASE_URL),
  });
  await client.connect();
  try {
    await run(client);
  } finally {
    await client.end();
  }
}

async function recreateParityDatabases(): Promise<void> {
  await withAdmin(async (client) => {
    for (const name of [PARITY_MIGRATE_DB, PARITY_PUSH_DB]) {
      // biome-ignore lint/performance/noAwaitInLoops: sequential DDL.
      await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await client.query(`CREATE DATABASE "${name}"`);
    }
  });
}

async function dropParityDatabases(): Promise<void> {
  await withAdmin(async (client) => {
    for (const name of [PARITY_MIGRATE_DB, PARITY_PUSH_DB]) {
      // biome-ignore lint/performance/noAwaitInLoops: sequential DDL.
      await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    }
  });
}

function applySchema(command: "db:migrate" | "db:push", dbName: string): void {
  // Explicit env wins over the dotenv load in drizzle.config.ts.
  execSync(`pnpm ${command}`, {
    cwd: PKG_DIR,
    env: { ...process.env, DATABASE_URL: withDatabase(INTEGRATION_DATABASE_URL, dbName) },
    stdio: ["ignore", "ignore", "inherit"],
  });
}

function dumpSchema(dbName: string): string {
  // --exclude-schema=drizzle drops the __drizzle_migrations bookkeeping that
  // only the migrated database has; a harmless no-op on the pushed one.
  return execSync(
    `docker compose exec -T postgres pg_dump --schema-only --no-owner --no-privileges --exclude-schema=drizzle -U postgres "${dbName}"`,
    { cwd: REPO_ROOT, encoding: "utf8" }
  );
}

function isNoise(line: string): boolean {
  return (
    line.startsWith("--") ||
    line.startsWith("SET ") ||
    line.startsWith("SELECT pg_catalog.set_config") ||
    // pg_dump 18 wraps dumps in \restrict/\unrestrict with a random per-dump token.
    line.startsWith("\\restrict") ||
    line.startsWith("\\unrestrict") ||
    line.trim() === ""
  );
}

/**
 * Column order inside a table is not part of parity: a column added by a later
 * migration lands last in attnum order, while push creates the whole table in
 * definition order. Sort the body lines into a canonical (non-SQL) form.
 */
function canonicalizeCreateTable(statement: string): string {
  if (!statement.startsWith("CREATE TABLE")) {
    return statement;
  }
  const lines = statement.split("\n");
  const body = lines
    .slice(1, -1)
    .map((line) => line.trim().replace(TRAILING_COMMA, ""))
    .sort();
  return [lines[0], ...body, lines.at(-1)].join("\n");
}

/**
 * Object creation order differs between the two toolpaths, so compare the
 * statements as a sorted set rather than as a sequence.
 */
function normalize(dump: string): string {
  const statements = dump
    .split("\n")
    .filter((line) => !isNoise(line))
    .join("\n")
    .split(";\n")
    .map((statement) => canonicalizeCreateTable(statement.trim()))
    .filter(Boolean)
    .sort();
  return statements.join(";\n\n");
}

describe("migrations vs push parity", () => {
  beforeAll(async () => {
    await recreateParityDatabases();
  }, PARITY_TIMEOUT_MS);

  afterAll(async () => {
    await dropParityDatabases();
  });

  it(
    "the migration chain and drizzle-kit push produce identical schemas",
    () => {
      applySchema("db:migrate", PARITY_MIGRATE_DB);
      applySchema("db:push", PARITY_PUSH_DB);

      const migrated = normalize(dumpSchema(PARITY_MIGRATE_DB));
      const pushed = normalize(dumpSchema(PARITY_PUSH_DB));
      expect(pushed).toBe(migrated);
    },
    PARITY_TIMEOUT_MS
  );
});
