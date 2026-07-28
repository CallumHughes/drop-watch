/**
 * Global setup: a fresh integration database with the real migrations applied.
 *
 * Same drop/create pattern as `apps/e2e/global/setup.ts`, but the schema is
 * applied with `drizzle-kit migrate` rather than `push` — the migration chain
 * is what production runs, and the parity suite separately proves push agrees
 * with it. The migrate script is invoked directly in this package (never
 * through turbo, whose `db:migrate` task is persistent).
 */

import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "pg";

import { adminConnectionString, databaseName, INTEGRATION_DATABASE_URL } from "./constants";

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

async function recreateDatabase(): Promise<void> {
  const name = databaseName(INTEGRATION_DATABASE_URL);
  await withAdmin(async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await client.query(`CREATE DATABASE "${name}"`);
  });
}

async function dropDatabase(): Promise<void> {
  const name = databaseName(INTEGRATION_DATABASE_URL);
  await withAdmin(async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  });
}

function applyMigrations(): void {
  // Explicit env wins over every dotenv file the tooling loads on its own.
  execSync("pnpm db:migrate", {
    cwd: PKG_DIR,
    env: { ...process.env, DATABASE_URL: INTEGRATION_DATABASE_URL },
    stdio: ["ignore", "ignore", "inherit"],
  });
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  await recreateDatabase();
  applyMigrations();
  return dropDatabase;
}
