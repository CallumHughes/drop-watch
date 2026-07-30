# Development

Node ≥24 and pnpm ≥11 (see `.nvmrc`), plus Docker for the Postgres container.

```bash
cp apps/web/.env.example apps/web/.env         # web app + db scripts
cp apps/worker/.env.example apps/worker/.env   # the worker
pnpm install
pnpm db:start          # Postgres in Docker, port 5432
pnpm db:migrate        # apply migrations
pnpm db:seed           # admin user + a few demo products
pnpm dev               # web on http://localhost:3001, plus the worker
```

The examples' defaults work as-is against the `pnpm db:start` Postgres — the only
thing worth editing on day one is `SEED_ADMIN_PASSWORD` in `apps/web/.env`. Email
stays off until you add a Resend API key; everything else works without one. See
[Configuration](configuration.md) for where each `.env` file goes.

## Seeding

`pnpm db:seed` is idempotent. It creates an admin (`SEED_ADMIN_EMAIL`,
`SEED_ADMIN_NAME`, `SEED_ADMIN_PASSWORD`) with `emailVerified: true`, then
inserts four demo products pointing at scraping-practice sites. No container runs
it — in Docker the first account comes from the sign-up page instead.

## Testing one URL from the command line

```bash
pnpm --filter @drop-watch/core test-url <url> [--selector <css>] [--locale <tag>] [--json]
```

Runs the real extraction chain against a live page and prints what each strategy
found. The fastest way to tell whether a site is trackable at all.

The chain lives in `packages/core/extract` and is imported by both apps: the
worker runs it on every scheduled check, and the web app runs the identical code
for the add-product preview, so a preview cannot drift from what a later check
will record.

## Unit tests

```bash
pnpm test
```

Vitest across `apps/web`, `apps/worker`, `packages/api`, `packages/core` and
`packages/email`. No database, no network.

## Integration tests

`packages/db` has a vitest suite that runs against a real Postgres: the queue
wiring (pg-boss policies and dedupe), `signupOpen`, the settings singleton
(including the concurrent seeding race), and a **migrations-vs-push parity
check** — production applies `src/migrations` while e2e uses `drizzle-kit push`,
and this test proves the two produce identical schemas by diffing normalised
`pg_dump` output. Prerequisite is the compose Postgres (the parity check also
runs `pg_dump` inside that container):

```bash
pnpm db:start
pnpm test:integration
```

Global setup drops and recreates a throwaway `drop-watch-integration` database
(override with `INTEGRATION_DATABASE_URL`) and applies the real migration chain;
the parity check uses two more throwaway databases,
`drop-watch-parity-migrate` and `drop-watch-parity-push`, on the same server. All
three are dropped afterwards. The suite is not part of `pnpm test`, which stays
database-free.

## End-to-end tests

`apps/e2e` is a Playwright suite covering the real loop: browser → oRPC →
pg-boss → worker → webhook. It needs a Postgres on `localhost:5432` (the compose
one is fine) and the Playwright browsers, which no script installs for you:

```bash
pnpm exec playwright install    # once
pnpm db:start
pnpm test:e2e      # headless run
pnpm test:e2e:ui   # Playwright UI mode
```

UI mode notes: global setup recreates the throwaway database when the window
opens, so on a fresh database run `auth.setup.ts` once before cherry-picking
individual specs (running whole projects respects the dependency order on its
own), and relaunch the window after a headless `pnpm test:e2e` — that run
recreates the database underneath an open UI session.

Everything else is owned by the suite. Global setup drops and recreates a
throwaway `drop-watch-e2e` database (override with `E2E_DATABASE_URL`), pushes
the schema, and spawns the worker against it. Playwright then starts its own web
server on **:3101** with its own `.next-e2e` build dir — a `pnpm dev` on :3001 can
keep running — plus a fixture server on **:4100** that plays both external roles:
the retailer pages the app scrapes (the app's outbound HTTP is server-side
undici, so browser-level mocking can't touch it) and the Home Assistant webhook
the alerts land on.

The first test (`tests/setup/auth.setup.ts`) runs against the empty database: it
signs up the admin through the UI — covering the signup-open path — and saves the
session as `storageState` for every other test. The suite runs fully parallel;
isolation is by data (each test registers its own uniquely-named fixture
product), and the specs that mutate the singleton settings row run in a serial
project after the parallel bulk. Specs import `test`/`expect` from
`tests/fixtures.ts` only, which injects the page objects — see
`.claude/skills/playwright-e2e-conventions` for the house rules.

## UI customization

Shared shadcn/ui primitives live in `packages/ui`.

- Design tokens and global styles: `packages/ui/src/styles/globals.css`
- Shared primitives: `packages/ui/src/components/*`
- shadcn aliases: `packages/ui/components.json`, `apps/web/components.json`

```bash
npx shadcn@latest add accordion dialog popover sheet table -c packages/ui
```

```tsx
import { Button } from "@drop-watch/ui/components/button";
```

Run the shadcn CLI from `apps/web` instead for app-specific blocks.

## Scripts

- `pnpm dev` / `pnpm dev:web` / `pnpm dev:worker` — development servers
- `pnpm build` — build all applications
- `pnpm test` — vitest across the workspace
- `pnpm test:integration` — the database-backed suite in `packages/db`
- `pnpm test:e2e` / `pnpm test:e2e:ui` — Playwright, headless or interactive
- `pnpm check-types` — TypeScript across all apps
- `pnpm check` / `pnpm fix` — Biome via ultracite (husky runs it pre-commit)
- `pnpm db:start` / `db:stop` / `db:down` — the development Postgres container
- `pnpm db:generate` / `db:migrate` / `db:push` / `db:seed` / `db:studio` — Drizzle
- `pnpm db:verify-user <email>` — mark an account verified; the lockout escape hatch
- `pnpm --filter @drop-watch/core test-url <url>` — run the extraction chain on one URL
- `pnpm docker:build` / `docker:up` / `docker:logs` / `docker:down` — local container stack
- `pnpm docker:prod:build` / `docker:prod:up` / `docker:prod:logs` / `docker:prod:down` — against host Postgres
