/**
 * Shared constants for the e2e suite: ports, URLs, credentials and the
 * environment handed to every spawned process.
 *
 * The web server runs on 3101 (not the dev server's 3001) and gets its own
 * Next dist dir, so the suite can run beside a live `pnpm dev` without the two
 * colliding. The database is a throwaway, recreated from scratch by global
 * setup on every run.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

export const WEB_PORT = 3101;
export const FIXTURE_PORT = 4100;

export const BASE_URL = `http://localhost:${WEB_PORT}`;
export const FIXTURE_URL = `http://localhost:${FIXTURE_PORT}`;

export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgresql://postgres:password@localhost:5432/price-tracker-e2e";

/** Created through the UI by auth.setup.ts — the instance's only account. */
export const ADMIN_EMAIL = "admin@e2e.local";
export const ADMIN_NAME = "E2E Admin";
export const ADMIN_PASSWORD = "e2e-admin-password";

/** Where auth.setup.ts saves the signed-in storage state. */
export const ADMIN_STORAGE_STATE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "tests/.auth/admin.json"
);

/**
 * The webhook id the alert sink listens on, configured once in auth.setup.ts.
 * Parallel specs only ever read payloads (filtered by their own product), so
 * one shared sink is safe.
 */
export const SINK_WEBHOOK_ID = "e2e-sink";

/**
 * Environment for the web server and the worker. Everything is explicit, and
 * the empty strings matter: every env schema uses `emptyStringAsUndefined`, so
 * they neutralise values a developer's `apps/web/.env` would otherwise leak in
 * — HA_URL/HA_WEBHOOK_ID would pre-seed the settings row.
 *
 * The suite runs the app in its email-enabled configuration: `RESEND_API_KEY`
 * is set (the value is arbitrary — the fake never checks it) and
 * `RESEND_BASE_URL` points the Resend SDK at the fixture server, which records
 * every send instead of delivering it. Setting the key is what flips the real
 * behaviour switches — signup requires verification, password reset exists,
 * the email alert channel is available — so auth.setup.ts must complete
 * verification from the captured mail before any other test can run.
 */
export const appEnv: Record<string, string> = {
  APP_URL: BASE_URL,
  BETTER_AUTH_SECRET: "e2e-only-secret-e2e-only-secret-e2e-only",
  BETTER_AUTH_URL: BASE_URL,
  CORS_ORIGIN: BASE_URL,
  DATABASE_URL: E2E_DATABASE_URL,
  HA_URL: "",
  HA_WEBHOOK_ID: "",
  NEXT_DIST_DIR: ".next-e2e",
  NEXT_PUBLIC_EMAIL_ENABLED: "true",
  RESEND_API_KEY: "re-e2e-fixture-key",
  RESEND_BASE_URL: FIXTURE_URL,
};
