/**
 * Connection strings for the integration suites.
 *
 * Same shape as `apps/e2e/constants.ts`: the compose Postgres on localhost,
 * with throwaway database names so a developer's dev database is never
 * touched. `INTEGRATION_DATABASE_URL` can point somewhere else (CI), and the
 * parity databases are always derived from it so all three land on the same
 * server.
 */

export const INTEGRATION_DATABASE_URL =
  process.env.INTEGRATION_DATABASE_URL ??
  "postgresql://postgres:password@localhost:5432/drop-watch-integration";

export const PARITY_MIGRATE_DB = "drop-watch-parity-migrate";
export const PARITY_PUSH_DB = "drop-watch-parity-push";

export function databaseName(connectionString: string): string {
  return decodeURIComponent(new URL(connectionString).pathname.slice(1));
}

/** The same server, but the `postgres` maintenance database — for DROP/CREATE DATABASE. */
export function adminConnectionString(connectionString: string): string {
  const url = new URL(connectionString);
  url.pathname = "/postgres";
  return url.toString();
}

/** The same server, but a different database. */
export function withDatabase(connectionString: string, name: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${name}`;
  return url.toString();
}
