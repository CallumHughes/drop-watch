# Price Tracker — Implementation Plan

A self-hosted price tracker for arbitrary online products. Runs in Docker on a home
server, checks product pages on a schedule, records price history, and pushes alerts
to a local Home Assistant webhook.

This document is the agreed design. Sections marked **DECIDED** were settled
deliberately — implement them as written rather than re-evaluating. Sections marked
**OPEN** are genuinely undecided and worth a recommendation when you reach them.

See `EPICS.md` for the implementation breakdown and current status.

---

## 1. Stack — DECIDED

| Concern | Choice | Why |
|---|---|---|
| Scaffold | Better-T-Stack CLI | Generates the monorepo + Turborepo wiring |
| Monorepo | Turborepo, pnpm workspaces | |
| Frontend + API | Next.js (App Router), `--backend self` | Single-user CRUD dashboard; no second HTTP service needed |
| API layer | oRPC | Type-safe client *and* an OpenAPI surface Home Assistant can call |
| Runtime | Node 24 (Active LTS) | Not 22 (maintenance only), not 26 (still Current) |
| Database | PostgreSQL (existing instance on the host) | Already running for other services |
| ORM | Drizzle | |
| Queue | pg-boss | Postgres-backed; cron, retries, backoff, dedupe. No Redis |
| Auth | Better Auth | Single admin user, signup disabled after seed |
| Worker | Separate `apps/worker` process | Crawl bursts must not block the UI |
| Lint/format | Biome | |

### Explicitly rejected

- **Fastify as a separate backend.** Considered and dropped. The backend is ~12
  CRUD procedures for a single user; the real background work lives in the worker
  either way. Serverless constraints don't apply because this is self-hosted Node.
  Adding Fastify later is a contained change — move oRPC routers, repoint the client.
- **SQLite.** Viable, but Postgres is already running on the target box, which makes
  pg-boss free.
- **Redis / BullMQ.** Unnecessary given Postgres.
- **Running the worker inside Next.js** (e.g. booting pg-boss from
  `instrumentation.ts`). Looks clean, then a crawl blocks the event loop and the
  dashboard stops responding, or a rebuild leaves two schedulers running at once.
  Postgres is the only interface between web and worker — no HTTP between them.

---

## 2. Scaffold — ALREADY DONE

The repo was scaffolded with Better-T-Stack (`bts.jsonc` records the config) and
restructured in Epic 1. Current layout:

```
apps/
  web/                    # Next.js — UI + oRPC route handlers + Better Auth
  worker/                 # (Epic 1) bare tsx entrypoint; pg-boss lands in Epic 4
packages/
  api/                    # oRPC routers, consumed by apps/web
  auth/                   # Better Auth config
  config/                 # shared tsconfig base
  core/                   # (Epic 1) extract/, rules/, notify/, fetch/
  db/                     # Drizzle schema, client, migrations, drizzle.config.ts
  env/                    # zod-validated env: ./db, ./server, ./web, ./worker
  ui/                     # shared UI components
```

`packages/core/extract` is imported by **both** apps: the worker runs it on every
scheduled check, and `apps/web` runs the identical code for the live "test this URL"
preview. Same code path, no drift.

---

## 3. Database

### Setup

Dedicated database and role on the existing Postgres instance, not a schema inside
another service's database:

```sql
CREATE DATABASE price_tracker;
CREATE ROLE price_tracker WITH LOGIN PASSWORD '...';
GRANT ALL PRIVILEGES ON DATABASE price_tracker TO price_tracker;
```

pg-boss creates and manages its own `pgboss` schema — leave it alone.

### Connectivity from containers

- Postgres in Docker → put `web` and `worker` on its network, address by service name.
- Postgres on the host → `host.docker.internal` plus
  `extra_hosts: ["host.docker.internal:host-gateway"]` on Linux. Confirm
  `listen_addresses` and `pg_hba.conf` allow the Docker bridge subnet.

### Schema

```ts
// packages/db — shape, not final code
products
  id            uuid pk
  url           text not null unique
  title         text
  imageUrl      text
  currency      char(3)
  active        boolean default true
  intervalMinutes  integer default 180
  jitterPercent    integer default 20
  nextCheckAt   timestamptz not null
  // extraction config
  extractor     enum('auto','selector')  default 'auto'
  selector      text                      // used when extractor = 'selector'
  locale        text                      // optional hint for price parsing
  render        enum('http','browser') default 'http'
  // alerting
  targetPrice   numeric(12,2)
  dropPercent   integer
  rules         text[]                    // ['target','drop_percent','restock']
  createdAt / updatedAt

pricePoints
  id            bigserial pk
  productId     uuid fk -> products
  price         numeric(12,2) not null
  currency      char(3) not null
  inStock       boolean
  observedAt    timestamptz not null default now()

checkRuns
  id            bigserial pk
  productId     uuid fk -> products
  status        enum('ok','extract_failed','http_error','timeout')
  extractorUsed text                      // 'jsonld' | 'opengraph' | 'selector'
  httpStatus    integer
  durationMs    integer
  error         text
  startedAt     timestamptz

alertState
  productId     uuid fk -> products
  rule          text
  lastAlertedPrice  numeric(12,2)
  lastAlertedAt     timestamptz
  primary key (productId, rule)
```

Plus the Better Auth tables from the scaffold.

**Constraints:**

- Prices are `numeric(12,2)`. **Never float.** Currency is a separate `char(3)`.
- Index `products(active, nextCheckAt)` — the dispatcher hits it every minute.
- Index `pricePoints(productId, observedAt DESC)` — powers every chart query.
- `checkRuns` is what makes "why did this silently stop working" answerable. Write a
  row on every attempt including failures. Retain ~30 days.
- Write a `pricePoints` row on every successful check, not only on change. Storage is
  trivial at this volume and stock-status history is useful.

---

## 4. Extraction chain — `packages/core/extract`

The core insight: "track any product" is not one scraper, it's a fallback chain. Most
ecommerce platforms emit `schema.org/Product` JSON-LD, so a large share of URLs work
with zero per-site configuration.

Order, first valid result wins:

1. **JSON-LD** — `schema.org/Product` → `offers.price`, `offers.priceCurrency`,
   `offers.availability`. Handle `@graph` arrays and multiple `<script>` blocks.
2. **Microdata / RDFa** — `itemprop="price"`.
3. **OpenGraph** — `product:price:amount`, `product:price:currency`.
4. **Configured CSS selector** — cheerio, plus regex extraction from the matched text.

Return a discriminated result including which strategy succeeded, so the UI can show
it and `checkRuns` can record it.

`offers.availability` is what powers restock alerts — capture it whenever present.

### Price parsing — `packages/core/src/extract/price.ts`

Locale ambiguity is the main correctness trap. `1,234` is either 1234 or 1.234.

- If both `.` and `,` appear, the **rightmost is the decimal separator**.
- If only one appears followed by exactly three digits, treat as a thousands
  separator **unless** the product has an explicit `locale` override.
- Strip non-breaking spaces, narrow no-break spaces, and currency symbols.
- Prefer the currency from JSON-LD when present; fall back to symbol detection.

This function deserves a real unit test suite. Cover at minimum: `£1,234.56`,
`1.234,56 €`, `$1234`, `1 234,56 kr`, `¥12,345`.

### Fetching — `packages/core/src/fetch`

- `undici` with a realistic User-Agent and `Accept-Language`.
- Per-domain concurrency of 1 via `p-queue`, keyed by hostname.
- Conditional requests: store and send `ETag` / `If-Modified-Since`.
- Exponential backoff on 429 and 5xx.
- Sensible total timeout (~20s).

At personal-tracking volume this is invisible to target sites. Do not escalate
against sites with active bot protection (Amazon in particular) — treat those as
unsupported and note it in the UI rather than building evasion.

---

## 5. Worker — `apps/worker`

Standalone Node process. Owns pg-boss.

```ts
// Dispatcher: every minute, enqueue everything due
await boss.schedule('enqueue-due-checks', '* * * * *');

await boss.work('enqueue-due-checks', async () => {
  const due = await db.select().from(products)
    .where(and(eq(products.active, true), lte(products.nextCheckAt, new Date())));
  for (const p of due) {
    await boss.send('check-product', { productId: p.id }, {
      singletonKey: p.id,        // never two checks in flight for one product
      retryLimit: 3,
      retryBackoff: true,
    });
  }
});

await boss.work('check-product', { batchSize: 5 }, async (jobs) => {
  for (const job of jobs) await checkProduct(job.data.productId);
});
```

`checkProduct` does: fetch → extract → write `pricePoints` + `checkRuns` → evaluate
rules → notify → set `nextCheckAt = now + interval ± jitter`.

**Jitter is not optional.** Without it every product on the same interval fires at the
same second forever. Apply `jitterPercent` on each reschedule.

Also expose a `check-product-now` path so the UI's "check now" button enqueues a job
with the same handler.

---

## 6. Alert rules — `packages/core/rules`

Supported rules: `target` (price ≤ target), `drop_percent` (≥ N% below previous),
`restock` (out of stock → in stock).

**Dedupe is what determines whether this stays running.** Naive implementation
notifies every three hours forever about a product sitting £1 under target.
Fire only when:

```
condition is true
AND (price < alertState.lastAlertedPrice OR now - lastAlertedAt > cooldown)
```

Default cooldown 12h, per `(productId, rule)`. Update `alertState` on every fire.

### Failure alerting

After N consecutive non-`ok` rows in `checkRuns` for a product (default 5), send a
distinct "tracker broken" notification once, then suppress until it recovers.
Selectors rot silently; without this you simply stop getting deals and never notice.

---

## 7. Home Assistant — `packages/core/notify`

Webhooks need no auth token; the webhook ID is the secret and `local_only: true`
keeps it LAN-bound.

```ts
await fetch(`${env.HA_URL}/api/webhook/${env.HA_WEBHOOK_ID}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    productId, title, url, imageUrl,
    price, previousPrice, currency, pctChange,
    inStock, rule,
  }),
});
```

Corresponding HA automation (include in the repo README):

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

Notification failures must not fail the check — log and continue.

---

## 8. Frontend — `apps/web`

### Add-product flow (build this properly; it's the feature that justifies a UI)

1. User pastes a URL.
2. Server fetches **once** and runs the full extraction chain.
3. Returns a preview: title, price, currency, stock, image, and **which extractor
   won**.
4. If something matched → confirm and save.
5. If nothing matched → selector picker: show the fetched HTML, let the user type a
   CSS selector and see live what it matches.

**The selector picker must test against the cached HTML from step 2**, not re-fetch
per keystroke. Cache the response body briefly (in-memory keyed by a preview session
id is fine).

### Other views

- **Dashboard** — product cards: current price, sparkline, distance from target,
  last checked, red badge when recent checks are failing.
- **Product detail** — full history chart (Recharts), `checkRuns` log, "check now",
  edit rules and interval.
- **Settings** — HA webhook URL + "send test" button.

Live updates: TanStack Query `refetchInterval` at ~15s. Do not build SSE initially;
Postgres `LISTEN/NOTIFY` bridged to SSE is the upgrade path if it ever feels slow.

### Next.js gotchas — non-negotiable

- **Pool singleton.** Stash the `pg` pool on `globalThis` in development or hot
  reload will exhaust Postgres connections. (Done in Epic 1.)
- **`export const dynamic = 'force-dynamic'`** on every route reading prices. The App
  Router will otherwise serve a cached price from days ago — catastrophic in an app
  whose entire purpose is freshness.
- `output: 'standalone'` in `next.config.ts` for a small Docker image. (Already set.)

### Auth

Better Auth, email + password, one seeded admin, signup disabled afterwards. The
settings page holds the webhook config, so it's worth protecting even on a LAN.

---

## 9. Docker

Three services: `web`, `worker`, and a one-shot `migrate`. Postgres is external in
production (the compose postgres service stays for local dev).

```yaml
services:
  migrate:
    build: { context: ., dockerfile: docker/migrate.Dockerfile }
    environment: { DATABASE_URL: ${DATABASE_URL} }
    restart: "no"
  web:
    build: { context: ., dockerfile: docker/web.Dockerfile }
    depends_on:
      migrate: { condition: service_completed_successfully }
    ports: ["3000:3000"]
    environment:
      DATABASE_URL: ${DATABASE_URL}
      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET}
  worker:
    build: { context: ., dockerfile: docker/worker.Dockerfile }
    depends_on:
      migrate: { condition: service_completed_successfully }
    environment:
      DATABASE_URL: ${DATABASE_URL}
      HA_URL: http://homeassistant:8123
      HA_WEBHOOK_ID: ${HA_WEBHOOK_ID}
      TZ: Europe/London
    restart: unless-stopped
```

**Migrations must be the separate one-shot service.** If `web` and `worker` both run
`drizzle-kit migrate` at boot they race on startup.

**Use `turbo prune` in each Dockerfile** or every app rebuilds whenever any package
changes:

```dockerfile
FROM node:24-bookworm-slim AS pruner
WORKDIR /app
COPY . .
RUN npx turbo prune --scope=worker --docker

FROM node:24-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
RUN pnpm turbo build --filter=worker
```

Validate env with zod at startup in both apps and fail loudly on missing config.

---

## 10. Conventions

- TypeScript strict mode. No `any` in `packages/core`.
- All env access through the validated schemas in `packages/env`, never raw
  `process.env`.
- Structured logging with **evlog** (the repo's existing choice — the original plan
  said pino; evlog won because the scaffold already uses it). Every check logs
  product id, duration, extractor used, and outcome.
- Extraction and rules logic must be pure and unit-testable — no DB or network calls
  inside them. The worker orchestrates; `core` computes.
- Prices as `numeric` in the DB and as strings/Decimal in TS. Never parse a price
  into a JS float for comparison.
- Biome via ultracite (`pnpm check` / `pnpm fix`); husky runs it pre-commit.
- Commits: no Co-Authored-By trailers.
