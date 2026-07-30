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

The other workspaces need no file of their own: `packages/db` borrows
`apps/web/.env` as above, and `apps/e2e` defines its entire environment
explicitly in `apps/e2e/constants.ts` (a throwaway database, overridable with
`E2E_DATABASE_URL`).

Compose reads `apps/web/.env` first and then the root `.env`, so the root file
wins in a deployment; `docker-compose.yml` sets `DATABASE_URL`, `NODE_ENV` and
`TZ` itself.

Anything compose *interpolates* — `POSTGRES_PASSWORD`, `TZ`, `BETTER_AUTH_URL`,
`CORS_ORIGIN`, `NEXT_PUBLIC_EMAIL_ENABLED`, and the production `DATABASE_URL` —
has to be in the **root** `.env` or the shell. Compose does not interpolate from
`apps/web/.env`.

## Variables

| Variable | Required | Used by | Notes |
|---|---|---|---|
| `DATABASE_URL` | yes | everything | Set by compose in the local stack. In production, `postgresql://drop_watch:...@host.docker.internal:5432/drop_watch`. |
| `BETTER_AUTH_SECRET` | yes (web) | `web` | ≥32 chars. `openssl rand -base64 32`. Not set by any compose `environment` block — it must be in the root `.env` or `apps/web/.env`. |
| `BETTER_AUTH_URL` | yes (web) | `web` | The URL the browser uses, e.g. `http://server.local:3001`. Compose defaults it to `http://localhost:3001`. |
| `CORS_ORIGIN` | yes (web) | `web` | Normally identical to `BETTER_AUTH_URL`. |
| `HA_URL` | no | `web`, `worker` | **Seed value only** — see below. Base URL of Home Assistant, e.g. `http://homeassistant:8123`. |
| `HA_WEBHOOK_ID` | no | `web`, `worker` | **Seed value only.** The webhook id is itself the secret. |
| `RESEND_API_KEY` | no | `web`, `worker` | The mailer's on/off switch. Unset is a supported configuration: webhook-only alerting, no email auth flows. |
| `EMAIL_FROM` | no | `web`, `worker` | `From:` address. Defaults to `onboarding@resend.dev`, which needs no verified domain but which Resend only delivers to the address that owns your Resend account. |
| `APP_URL` | no | `web`, `worker` | Absolute base URL for links inside emails. The worker has no `BETTER_AUTH_URL` of its own; `web` falls back to that. |
| `NEXT_PUBLIC_EMAIL_ENABLED` | no | `web` **build** | Docker only, and a *build* argument rather than runtime config — see [Notifications](notifications.md#docker-next_public_email_enabled-is-a-build-argument). |
| `TZ` | no | all | Defaults to `Europe/London`. Affects scheduling and every rendered timestamp. |
| `POSTGRES_PASSWORD` | no | dev `postgres` | Dev container only. Defaults to `password`. |
| `NODE_ENV` | no | all | Set to `production` by compose. |
| `SEED_ADMIN_EMAIL` | seed only | `pnpm db:seed` | |
| `SEED_ADMIN_NAME` | seed only | `pnpm db:seed` | Defaults to `Admin`. |
| `SEED_ADMIN_PASSWORD` | seed only | `pnpm db:seed` | ≥8 chars. No default on purpose. |
| `SKIP_ENV_VALIDATION` | no | builds | Bypasses every schema. Set during the Docker build only. |

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

Per-product settings (check interval, jitter, target price, which rules are
armed, the extractor and selector, active/paused) live on the product and are
edited from its detail page.
