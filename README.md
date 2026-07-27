# price-tracker

A self-hosted price tracker for arbitrary online products. It checks product pages on
a schedule, records price history, and pushes alerts to a local Home Assistant
webhook.

See [`PLAN.md`](PLAN.md) for the design and [`EPICS.md`](EPICS.md) for the
implementation breakdown. Scaffolded with
[Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack).

## Stack

- **Next.js** (App Router) — dashboard, add-product flow, settings; port **3001**
- **oRPC** — end-to-end type-safe API with an OpenAPI surface
- **Drizzle + PostgreSQL** — schema, migrations, `numeric(12,2)` prices
- **pg-boss** — the queue; Postgres is the only interface between web and worker
- **Better Auth** — one seeded admin, signup closes once that account exists
- **Turborepo + pnpm**, **Biome** (via ultracite), **evlog**, **vitest**

## Getting started (development)

```bash
pnpm install
pnpm db:start          # Postgres in Docker, port 5432
pnpm db:migrate        # apply migrations
pnpm db:seed           # admin user + a few products
pnpm dev               # web on http://localhost:3001, plus the worker
```

Development configuration lives in `apps/web/.env`. Copy
[`.env.example`](.env.example) as a starting point.

## Database setup

### Development

`pnpm db:start` brings up the `postgres` service from `docker-compose.yml` with a
`price-tracker` database. Nothing else is needed.

### Production

The deployment targets a PostgreSQL instance **already running on the host**, not a
container (PLAN.md §3). Give the tracker its own database and role rather than a
schema inside another service's database:

```sql
CREATE ROLE price_tracker WITH LOGIN PASSWORD 'choose-something-long';
CREATE DATABASE price_tracker OWNER price_tracker;
GRANT ALL PRIVILEGES ON DATABASE price_tracker TO price_tracker;
```

Owning the database matters: the role has to be able to **create schemas**. Drizzle
keeps its migration journal in a `drizzle` schema, and pg-boss creates and manages a
`pgboss` schema of its own — leave that one alone, the worker owns it.

If the role does not own the database, grant the schema rights explicitly (Postgres
15+ no longer gives `PUBLIC` create rights on `public`):

```sql
GRANT CREATE ON DATABASE price_tracker TO price_tracker;
GRANT ALL ON SCHEMA public TO price_tracker;
```

### Letting the containers reach the host

The containers connect to `host.docker.internal`. On Docker Desktop that name already
resolves; on Linux it comes from the `extra_hosts: host.docker.internal:host-gateway`
entry in `docker-compose.prod.yml`. The host's Postgres also has to be listening on
something the Docker bridge can reach:

`postgresql.conf`

```conf
listen_addresses = '*'          # or the bridge gateway address specifically
```

`pg_hba.conf` — allow the Docker networks. Compose creates its own bridge network, so
the address is usually somewhere in `172.16.0.0/12` rather than the `172.17.0.0/16`
default bridge:

```conf
# TYPE  DATABASE       USER           ADDRESS          METHOD
host    price_tracker  price_tracker  172.16.0.0/12    scram-sha-256
```

Reload afterwards (`SELECT pg_reload_conf();`, or `systemctl reload postgresql`).
`listen_addresses` needs a full restart. If a container logs
`no pg_hba.conf entry for host ...`, the address in that error is the subnet to add.

## Deployment

Three services, plus a Postgres container that only exists for local development:

| Service | Image | Role |
|---|---|---|
| `migrate` | `packages/db/Dockerfile` | One-shot. Waits for Postgres, applies migrations, exits. |
| `web` | `apps/web/Dockerfile` | Next.js dashboard on port 3001. |
| `worker` | `apps/worker/Dockerfile` | pg-boss: the minutely dispatcher and every check. |
| `postgres` | `postgres:18` | Development only; disabled by the production override. |

`web` and `worker` both declare
`depends_on: migrate: { condition: service_completed_successfully }`, so a failed
migration stops the deployment instead of letting the apps boot against an old
schema. Migrations deliberately do **not** run at app boot — two processes racing
`drizzle-kit migrate` on startup is a real failure mode (PLAN.md §9).

All three images build from a `turbo prune --docker` workspace, so a change to the
worker does not invalidate the web image's dependency layer, and vice versa.

### Production

```bash
cp .env.example .env            # then edit it
pnpm docker:prod:up             # build + start, detached
pnpm docker:prod:logs
pnpm docker:prod:down
```

That is shorthand for layering the override:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

The override points `DATABASE_URL` at the host instance and switches the bundled
`postgres` service off. `DATABASE_URL` is required — there is no default for someone
else's database.

`web` and `worker` are `restart: unless-stopped`, so the stack comes back by itself
after a host reboot. The migrate container retries its connection for up to a minute
before giving up, which covers the common case of containers starting before the
host's Postgres has finished.

### Local stack (containers, with the bundled Postgres)

```bash
pnpm docker:up      # docker compose up -d --build
pnpm docker:logs
pnpm docker:down
```

This binds port 5432 on the host; if something else already has it, use the
production override against that instance instead.

## Environment variables

Read through the zod schemas in `packages/env` — never `process.env` directly.
Compose reads `apps/web/.env` first and then the root `.env`, so the root file wins
in a deployment; `docker-compose.yml` sets `DATABASE_URL`, `NODE_ENV` and `TZ`
itself.

| Variable | Required | Used by | Notes |
|---|---|---|---|
| `DATABASE_URL` | yes | everything | Set by compose. In production, `postgresql://price_tracker:...@host.docker.internal:5432/price_tracker`. |
| `BETTER_AUTH_SECRET` | yes (web) | `web` | ≥32 chars. `openssl rand -base64 32`. |
| `BETTER_AUTH_URL` | yes (web) | `web` | The URL the browser uses, e.g. `http://server.local:3001`. Defaults to `http://localhost:3001`. |
| `CORS_ORIGIN` | yes (web) | `web` | Normally identical to `BETTER_AUTH_URL`. |
| `HA_URL` | no | `web`, `worker` | **Seed value only** — see below. Base URL of Home Assistant, e.g. `http://homeassistant:8123`. |
| `HA_WEBHOOK_ID` | no | `web`, `worker` | **Seed value only.** The webhook id is itself the secret. |
| `TZ` | no | all | Defaults to `Europe/London`. Affects scheduling and every rendered timestamp. |
| `POSTGRES_PASSWORD` | no | dev `postgres` | Dev container only. Defaults to `password`. |
| `NODE_ENV` | no | all | Set to `production` by compose. |
| `SEED_ADMIN_EMAIL` | seed only | `pnpm db:seed` | |
| `SEED_ADMIN_NAME` | seed only | `pnpm db:seed` | Defaults to `Admin`. |
| `SEED_ADMIN_PASSWORD` | seed only | `pnpm db:seed` | ≥8 chars. No default on purpose. |
| `SKIP_ENV_VALIDATION` | no | builds | Set during the Docker build only. |

### `HA_URL` / `HA_WEBHOOK_ID` are seed values, not runtime config

This one bites. The Home Assistant configuration lives in a singleton `settings` row
so the settings page can write it. That row is created **once**, on the first
`loadSettings()` call, from these two variables — after which the row wins and
changing the environment has no effect at all. To change the webhook later, use the
settings page (or `UPDATE settings SET ha_url = ..., ha_webhook_id = ...`).

Either `web` or `worker` may be the first process to touch the row, so set them on
**both** services or on neither. Setting neither is fine: alerting is simply
unconfigured until someone fills in the settings page.

## Home Assistant

`packages/core/notify` POSTs JSON to `${haUrl}/api/webhook/${webhookId}`. Webhooks
need no auth token — the id is the secret, and `local_only: true` keeps it LAN-bound.
Delivery failures are logged and never fail a check.

```yaml
- alias: Price drop alert
  trigger:
    - platform: webhook
      webhook_id: price_tracker
      local_only: true
  action:
    - service: notify.mobile_app_yourphone
      data:
        title: "{{ trigger.json.title }}"
        message: "{{ trigger.json.currency }}{{ trigger.json.price }} (was {{ trigger.json.previousPrice }})"
        data:
          url: "{{ trigger.json.url }}"
```

Every field is always present, `null` where it does not apply, so a template can
address `trigger.json.previousPrice` without guarding first:

| Field | Notes |
|---|---|
| `productId`, `url` | Always set. |
| `title`, `imageUrl`, `currency` | `null` until a check has extracted them. |
| `price`, `previousPrice`, `pctChange` | Decimal **strings**, never floats. `pctChange` is signed, one decimal place. |
| `inStock` | `null` when the page did not say. |
| `rule` | `target`, `drop_percent`, `restock`, `tracker_broken`, or `test`. |
| `consecutiveFailures` | Length of the failure streak on `tracker_broken`; `null` otherwise. |
| `error` | Failure detail on `tracker_broken`; `null` otherwise. |

`tracker_broken` fires once after N consecutive failed checks (default 5) and stays
quiet until the product recovers — selectors rot silently, and this is how you find
out. Branch on it if you want a different notification:

```yaml
  action:
    - choose:
        - conditions: "{{ trigger.json.rule == 'tracker_broken' }}"
          sequence:
            - service: notify.mobile_app_yourphone
              data:
                title: "Tracker broken: {{ trigger.json.title }}"
                message: "{{ trigger.json.consecutiveFailures }} failed checks — {{ trigger.json.error }}"
```

The settings page's "send test" button posts the same shape with `rule: "test"`, which
is the only way to prove the automation exists: Home Assistant answers 200 to a
webhook with no automation behind it.

## Known limitations

- **Do not scale `web` past one replica.** The add-product preview caches the fetched
  HTML in memory, per process, so the selector picker would test against a body a
  different replica holds. Single-user self-hosted; one replica is the design.
- **Sites with active bot protection are unsupported** (Amazon in particular). See
  PLAN.md §4 — the fetch layer is deliberately polite and does not escalate.
- `checkRuns` grows without a retention job; the plan's ~30-day retention is not
  implemented.
- The `worker` and `migrate` images are fat (~1.5 GB against the web image's
  ~410 MB). pnpm auto-installs peer dependencies, so Next.js and its SWC binary
  land in both via `better-auth` and `evlog` even though neither process loads
  them. Slimming that down means `peerDependencyRules` in `pnpm-workspace.yaml`,
  which affects every install, not just the Docker ones.

## Project structure

```
price-tracker/
├── apps/
│   ├── web/         # Next.js — UI, oRPC route handlers, Better Auth
│   └── worker/      # pg-boss: dispatcher + check handler
├── packages/
│   ├── api/         # oRPC routers
│   ├── auth/        # Better Auth configuration
│   ├── config/      # shared tsconfig base
│   ├── core/        # extract/, rules/, notify/, fetch/ — pure logic
│   ├── db/          # Drizzle schema, migrations, queue wiring, migrate image
│   ├── env/         # zod-validated env: ./db, ./seed, ./server, ./web, ./worker
│   └── ui/          # shared shadcn/ui primitives
```

`packages/core/extract` is imported by both apps: the worker runs it on every
scheduled check, and the web app runs the identical code for the add-product preview.

## UI customization

Shared shadcn/ui primitives live in `packages/ui`.

- Design tokens and global styles: `packages/ui/src/styles/globals.css`
- Shared primitives: `packages/ui/src/components/*`
- shadcn aliases: `packages/ui/components.json`, `apps/web/components.json`

```bash
npx shadcn@latest add accordion dialog popover sheet table -c packages/ui
```

```tsx
import { Button } from "@price-tracker/ui/components/button";
```

Run the shadcn CLI from `apps/web` instead for app-specific blocks.

## Available scripts

- `pnpm dev` / `pnpm dev:web` / `pnpm dev:worker` — development servers
- `pnpm build` — build all applications
- `pnpm test` — vitest across the workspace
- `pnpm check-types` — TypeScript across all apps
- `pnpm check` / `pnpm fix` — Biome via ultracite (husky runs it pre-commit)
- `pnpm db:start` / `db:stop` / `db:down` — the development Postgres container
- `pnpm db:generate` / `db:migrate` / `db:push` / `db:seed` / `db:studio` — Drizzle
- `pnpm --filter @price-tracker/core test-url <url>` — run the extraction chain on one URL
- `pnpm docker:build` / `docker:up` / `docker:logs` / `docker:down` — local container stack
- `pnpm docker:prod:build` / `docker:prod:up` / `docker:prod:logs` / `docker:prod:down` — against host Postgres
