# Configuration

Every variable is validated by a zod schema in `packages/env` — read those
rather than `process.env` directly.

## Which `.env` goes where

Each process loads its own file; there is no shared development `.env`:

| File | Copy from | Read by |
|---|---|---|
| `apps/web/.env` | [`apps/web/.env.example`](../apps/web/.env.example) | The Next.js app, and every `pnpm db:*` script (migrate, seed, studio, verify-user) — `drizzle.config.ts` and the seed script read this file explicitly. |
| `apps/worker/.env` | [`apps/worker/.env.example`](../apps/worker/.env.example) | The worker only. It resolves `.env` from its own directory, so nothing in `apps/web/.env` reaches it — at minimum it needs `DATABASE_URL`. |
| `.env` (repo root) | [`.env.example`](../.env.example) | **Docker deployments only** — the file compose interpolates and the containers read. Not used by `pnpm dev`. |

If you are running the published images rather than building from source, the
equivalent file is [`deploy/.env.example`](../deploy/.env.example), copied to
`.env` next to `deploy/docker-compose.yml`. It is meant to be downloaded on its
own rather than cloned alongside the rest of the repo, but the variables in it
are validated by the same schemas and documented by the same table below.

The other workspaces need no file of their own: `packages/db` borrows
`apps/web/.env` as above, and `apps/e2e` defines its entire environment
explicitly in `apps/e2e/constants.ts` (a throwaway database, overridable with
`E2E_DATABASE_URL`).

Compose reads `apps/web/.env` first and then the root `.env`, so the root file
wins in a deployment; `docker-compose.yml` sets `DATABASE_URL`, `NODE_ENV` and
`TZ` itself.

Anything compose *interpolates* — `POSTGRES_PASSWORD`, `TZ`, `BETTER_AUTH_URL`,
`CORS_ORIGIN`, and the production `DATABASE_URL` — has to be in the **root**
`.env` or the shell. Compose does not interpolate from `apps/web/.env`.

## Variables

| Variable | Required | Used by | Notes |
|---|---|---|---|
| `DATABASE_URL` | yes | everything | Set by compose in the local stack. In production, `postgresql://drop_watch:...@host.docker.internal:5432/drop_watch`. |
| `BETTER_AUTH_SECRET` | yes (web) | `web` | ≥32 chars. `openssl rand -base64 32`. Not set by any compose `environment` block — it must be in the root `.env` or `apps/web/.env`. |
| `BETTER_AUTH_URL` | yes (web) | `web` | The URL the browser uses, e.g. `http://server.local:3001`. Compose defaults it to `http://localhost:3001`. |
| `CORS_ORIGIN` | yes (web) | `web` | Normally identical to `BETTER_AUTH_URL`. |
| `HA_URL` | no | `web`, `worker` | **Seed value only** — see below. Base URL of Home Assistant, e.g. `http://homeassistant:8123`. |
| `HA_WEBHOOK_ID` | no | `web`, `worker` | **Seed value only.** The webhook id is itself the secret. |
| `RESEND_API_KEY` | no | `web`, `worker` | The mailer's on/off switch, read at runtime — set it and restart, no rebuild. Unset is a supported configuration: webhook-only alerting, no email auth flows. |
| `EMAIL_FROM` | no | `web`, `worker` | `From:` address. Defaults to `onboarding@resend.dev`, which needs no verified domain but which Resend only delivers to the address that owns your Resend account. |
| `APP_URL` | no | `web`, `worker` | Absolute base URL for links inside emails. The worker has no `BETTER_AUTH_URL` of its own; `web` falls back to that. |
| `AUTH_RATE_LIMIT_ENABLED` | no | `web` | Overrides Better Auth's default of on in production, off in development. Limits are per client address, so set `false` only where every request already shares one — a test run, say. |
| `RENDER_URL` | no | `web`, `worker` | Base URL of the renderer sidecar, e.g. `http://renderer:3002` (compose) or `http://localhost:3002` (local dev). `worker` calls it for browser-mode checks; `web` reports its availability and calls it for browser preview retries. Unset means browser-mode listings record a `renderer_error` check run rather than the worker crashing. See [Browser render mode](#browser-render-mode) below. |
| `COMPOSE_PROFILES` | no | compose only | Comma-separated. `browser` brings up the `renderer` service, in either compose file. `bundled-db` additionally brings up the bundled `postgres` service in `deploy/docker-compose.yml` (the published-image file) — it is on by default in `deploy/.env.example`; drop it and set `DATABASE_URL` to use a Postgres you already run. Root `.env` only — this is a compose-native variable, not read by any app. |
| `DROP_WATCH_IMAGE` | no | compose only | `deploy/docker-compose.yml` only. Image namespace to pull from. Defaults to `ghcr.io/callumhughes/drop-watch`; set it to run a fork's own published images. |
| `DROP_WATCH_VERSION` | no | compose only | `deploy/docker-compose.yml` only. Image tag. Defaults to `latest`, which moves with every push to `main`; pin to a commit's immutable short-SHA tag instead for a reproducible deploy. |
| `RENDER_CPUS` | no | compose only | Renderer CPU ceiling. Defaults to `2.0`. Prefer reducing render concurrency before raising it. |
| `RENDER_MEMORY_LIMIT` | no | compose only | Renderer memory ceiling. Defaults to `2g`. |
| `RENDER_PIDS_LIMIT` | no | compose only | Renderer process ceiling. Defaults to `512`. |
| `RENDER_TMPFS_LIMIT` | no | compose only | Size of the renderer's writable temporary filesystem. Defaults to `512m`; the rest of its filesystem is read-only. |
| `TZ` | no | all | Defaults to `Europe/London`. Affects scheduling and every rendered timestamp. |
| `POSTGRES_PASSWORD` | no | dev `postgres` | Dev container only. Defaults to `password`. |
| `NODE_ENV` | no | all | Set to `production` by compose. |
| `SEED_ADMIN_EMAIL` | seed only | `pnpm db:seed` | |
| `SEED_ADMIN_NAME` | seed only | `pnpm db:seed` | Defaults to `Admin`. |
| `SEED_ADMIN_PASSWORD` | seed only | `pnpm db:seed` | ≥8 chars. No default on purpose. |
| `SKIP_ENV_VALIDATION` | no | builds | Bypasses every schema. Set during the Docker build only. |

## Browser render mode

Some product pages compose their price into the DOM with JavaScript, so a
plain HTTP fetch never sees it. Browser render mode routes a listing's check
through the `renderer` sidecar (headless Chromium via Playwright) instead,
which returns the post-JavaScript HTML.

The add flow always starts with HTTP. If that preview finds no price and a
renderer is configured, it offers a browser retry. Saving a successful rendered
preview stores the new listing in browser mode, so its later checks use the same
path.

It is **not** for bot protection. Sites with active bot protection (Amazon in
particular) are treated as unsupported — DropWatch does not escalate against
them (`packages/core/src/fetch/index.ts:8-10`). A headless browser does not
change that stance.

It is opt-in, via the `browser` compose profile — see [`.env.example`](../.env.example)
and `RENDER_URL` above. Toggle it per listing from the store's settings editor
on the product's detail page ("Load the page in a headless browser"). When
`RENDER_URL` is unset the toggle is disabled and names `RENDER_URL` as the
reason — unless the listing is already in browser mode, in which case it stays
enabled so the listing can be switched back. When `RENDER_URL` is unset, or the
sidecar is down or unreachable, the affected listing simply records a
`renderer_error` check run — never a crash. That status is deliberately not
`network_error`: a sidecar at capacity, shutting down or unconfigured is a fault
in your own deployment, and the check log should point you at your container
rather than at the retailer.

## `HA_URL` / `HA_WEBHOOK_ID` are seed values, not runtime config

This one bites. The Home Assistant configuration lives in a singleton `settings`
row so the settings page can write it. That row is created **once**, on the first
`loadSettings()` call, from these two variables — after which the row wins and
changing the environment has no effect at all. To change the webhook later, use
the settings page (or `UPDATE settings SET ha_url = ..., ha_webhook_id = ...`).

Either `web` or `worker` may be the first process to touch the row, so set them
on **both** services or on neither. Setting neither is fine: alerting is simply
unconfigured until someone fills in the settings page.

## Settings that live in the database, not the environment

These are edited on the settings page and take effect without a restart —
Postgres is the interface between the web app and the worker:

- **Home Assistant URL and webhook id** (admin only).
- **Alerts enabled** — the master switch. Off silences every channel without
  losing either channel's configuration.
- **Alert cooldown** — 60 to 10,080 minutes, 12 hours by default.
- **Failure threshold** — consecutive failed checks before `watch_broken` fires.
  2 to 50, 5 by default.
- **Email alerts** — per user, on their own account.

Per-product settings (title, target price, which rules are armed, active/paused)
live on the product. Per-listing settings (check interval, jitter, the extractor
and selector, active/paused for that store alone) live on each store you add to
it. Both are edited from the product's detail page.
