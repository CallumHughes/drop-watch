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
/** The renderer sidecar's e2e port, separate from the production default. */
export const RENDER_PORT = 4200;

export const BASE_URL = `http://localhost:${WEB_PORT}`;
export const FIXTURE_URL = `http://localhost:${FIXTURE_PORT}`;

/**
 * How many hostnames the fixture server is addressed by. Must be at least the
 * `workers` count below, and costs nothing to overshoot — the server binds one
 * socket and every name reaches it.
 */
const FIXTURE_HOST_COUNT = 8;

/**
 * The fixture server answers on one hostname per worker, and every worker
 * scrapes only its own.
 *
 * The fetch layer serialises requests per hostname (`hostnameKey` in
 * `packages/core/src/fetch/index.ts`) — deliberate politeness towards a real
 * retailer, but with every fixture product on `localhost` it made one
 * concurrency-1 queue the ceiling on the whole suite's parallelism, in the web
 * process and the worker process alike. Distinct names give each worker a
 * queue of its own and leave the per-domain limit itself untouched.
 *
 * `*.localhost` rather than `127.0.0.2`-style aliases: the whole subdomain is
 * reserved for loopback by RFC 6761 and resolves out of the box on macOS and
 * on the CI runner, whereas macOS answers nothing on 127.0.0.0/8 beyond
 * 127.0.0.1 without a `sudo ifconfig lo0 alias` per address. The fixture
 * server verifies all of them at startup, so a host that does not resolve
 * fails the run immediately instead of surfacing as a scrape error later.
 */
export const FIXTURE_HOSTS: readonly string[] = Array.from(
  { length: FIXTURE_HOST_COUNT },
  (_, index) => `fixture-${index}.localhost`
);

/** The fixture origin a given Playwright worker scrapes. */
export function fixtureOrigin(parallelIndex: number): string {
  const host = FIXTURE_HOSTS[parallelIndex % FIXTURE_HOSTS.length];
  return `http://${host}:${FIXTURE_PORT}`;
}

export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgresql://postgres:password@localhost:5432/drop-watch-e2e";

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
  // The fixture server *is* the retailer here, and it lives on loopback, which
  // the SSRF guard blocks by default. This is the same exemption a self-hosted
  // instance scraping something on its own network would set. Every name the
  // server answers on has to be listed: `localhost` for the webhook and mail
  // sinks, the per-worker hosts for the product pages.
  ALLOWED_PRIVATE_HOSTS: ["localhost", ...FIXTURE_HOSTS].join(","),
  APP_URL: BASE_URL,
  // `next start` runs in production mode, where Better Auth rate-limits
  // sign-in to 3 requests per 10s per address — and every worker here shares
  // 127.0.0.1.
  AUTH_RATE_LIMIT_ENABLED: "false",
  BETTER_AUTH_SECRET: "e2e-only-secret-e2e-only-secret-e2e-only",
  BETTER_AUTH_URL: BASE_URL,
  CORS_ORIGIN: BASE_URL,
  DATABASE_URL: E2E_DATABASE_URL,
  HA_URL: "",
  HA_WEBHOOK_ID: "",
  NEXT_DIST_DIR: ".next-e2e",
  // The third Playwright web server starts the renderer here. `web` reads it
  // for capabilities and its API route uses it for browser previews; browser-
  // mode worker checks connect to it too.
  RENDER_URL: `http://localhost:${RENDER_PORT}`,
  RESEND_API_KEY: "re-e2e-fixture-key",
  RESEND_BASE_URL: FIXTURE_URL,
};
