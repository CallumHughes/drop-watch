# Price Tracker — Implementation Epics

Derived from the implementation plan, adjusted to what the scaffold already provides.
See the plan document for settled design decisions (marked DECIDED there) — do not
re-litigate them here.

## What the scaffold already provides

- Drizzle lives in `packages/db` with migrations and drizzle-kit scripts. Only the
  Better Auth schema exists so far.
- oRPC routers live in `packages/api` (separate package, consumed by `apps/web`).
  Keep this layout — procedures stay importable without touching Next.js.
- Zod-validated env via `@t3-oss/env-core` in `packages/env`.
- Better Auth wired end to end (login/signup pages, protected procedure, auth
  tables migrated). Web runs on port **3001**.
- Working web Dockerfile + compose (web + postgres), `output: 'standalone'` set.
  No `turbo prune`, no migrate service, no worker.
- Logging: the repo uses **evlog** (not pino as the plan says) — adopt evlog in the
  worker too rather than introducing a second logging stack.

Missing entirely: `apps/worker`, `packages/core`, domain schema, test
infrastructure, alerting, deployment plumbing for worker/migrations.

---

## Epic 1 — Foundation completion ✅ (done 2026-07-27)

Small — most of the plan's Phase 1 already happened at scaffold time.

- Create `packages/core` (`extract/`, `rules/`, `notify/`, `fetch/`) as a strict-TS
  workspace package. No `any`.
- Create `apps/worker` as a bare Node entrypoint depending on `@price-tracker/db`,
  `@price-tracker/env`, `@price-tracker/core`.
- Add vitest and a `test` task to `turbo.json`.
- Fix the pool-singleton hazard: `packages/db/src/index.ts` creates the pool at
  module load; stash it on `globalThis` outside production.
- Add `packages/env/src/worker.ts` (DATABASE_URL + HA vars only — the worker must
  not require Better Auth secrets).

**Done when:** `pnpm dev` runs web + worker, both import `db` and `core` cleanly,
and `pnpm test` passes.

## Epic 2 — Extraction engine (`packages/core`) ✅ (done 2026-07-27)

Pure logic, no DB or network calls inside extract/rules.

- Fallback chain: JSON-LD (incl. `@graph`, multiple script blocks) → microdata →
  OpenGraph → configured CSS selector. Discriminated result naming the winning
  strategy; capture `offers.availability` for restock alerts.
- `price.ts` locale-aware parser with full unit suite (`£1,234.56`, `1.234,56 €`,
  `$1234`, `1 234,56 kr`, `¥12,345`).
- `fetch/`: undici, realistic headers, per-domain concurrency 1 (p-queue),
  ETag/If-Modified-Since, backoff on 429/5xx, ~20s total timeout.
- `pnpm --filter @price-tracker/core test-url <url>` CLI printing the result.

**Done when:** correct prices from 5+ real URLs across different sites; parser
suite green.

## Epic 3 — Domain schema (`packages/db`) ✅ (done 2026-07-27)

Can run in parallel with Epic 2.

- `products`, `pricePoints`, `checkRuns`, `alertState` per the plan's shapes,
  alongside `schema/auth.ts`; merged into the drizzle schema object.
- Indexes: `products(active, nextCheckAt)`, `pricePoints(productId, observedAt
  DESC)`. Prices `numeric(12,2)`, never float.
- Migration `0001`, seed script (admin user + a few products).
- Production `CREATE DATABASE price_tracker` SQL belongs in the Epic 8 README; dev
  compose keeps its `price-tracker` database.

**Done when:** migrations apply cleanly on a fresh DB and seed inserts products.

## Epic 4 — Worker pipeline (`apps/worker`) ✅ (done 2026-07-27)

Depends on Epics 2 + 3.

- pg-boss boot (owns the `pgboss` schema), minutely `enqueue-due-checks`
  dispatcher, `check-product` handler with `singletonKey`, `retryLimit: 3`,
  backoff.
- `checkProduct`: fetch → extract → write `pricePoints` + `checkRuns` (every
  attempt, including failures) → reschedule `nextCheckAt = now + interval ±
  jitter`. Jitter is not optional. No alerting yet.
- `check-product-now` queue for the UI's "check now".
- evlog per check: product id, duration, extractor used, outcome.

**Done when:** seeded products are checked on schedule and history accumulates; a
killed-and-restarted worker resumes cleanly.

## Epic 5 — Read UI + API procedures ✅ (done 2026-07-27)

Depends on Epic 3 (Epic 4 makes it interesting).

- Extend `appRouter` in `packages/api`: list products, detail, price history,
  check-run log, edit rules/interval, trigger check-now (enqueue via pg-boss from
  the web side — Postgres is the only interface between web and worker).
- Replace the placeholder dashboard: product cards with current price, sparkline,
  target distance, last-checked, failure badge.
- Product detail: Recharts history chart, `checkRuns` log, check-now button.
- TanStack Query `refetchInterval` ~15s; `export const dynamic = 'force-dynamic'`
  on every price-reading route.

**Done when:** seeded products render with live-updating history charts.

## Epic 6 — Add-product flow

Depends on Epics 2 + 5.

- `preview` procedure: fetch once, run the identical `core/extract` chain, return
  title/price/currency/stock/image + winning extractor; cache the HTML body
  in memory keyed by preview-session id.
- Confirm-and-save (sets `nextCheckAt` so the worker picks it up immediately).
- Selector picker tests against the **cached** HTML — no re-fetch per keystroke.

**Done when:** a product can be added end to end from a URL, including one that
requires a manual selector.

## Epic 7 — Alerting + Home Assistant

Depends on Epic 4; does not block Epics 5–6.

- `core/rules`: pure evaluation of `target`, `drop_percent`, `restock`;
  cooldown/dedupe against `alertState` (fire only if price < last-alerted or
  cooldown elapsed; default 12h per `(productId, rule)`).
- `core/notify`: HA webhook client per the plan's payload; failures logged, never
  fail the check.
- Failure alerting: one "tracker broken" notification after 5 consecutive
  non-`ok` runs, suppressed until recovery.
- Settings page + "send test". Recommendation: small `settings` table editable in
  the UI, seeded from env on first boot (env-only config would make the settings
  page read-only).
- Disable signup once the seeded admin exists (scaffold currently exposes it).

**Done when:** a manually lowered target fires exactly one HA notification and the
next check does not re-notify.

## Epic 8 — Deployment

Last; depends on everything.

- Refit `apps/web/Dockerfile` to the `turbo prune` pattern (currently `COPY . .`);
  add `worker` + one-shot `migrate` Dockerfiles — nothing currently runs
  migrations in Docker.
- Compose: keep postgres for local dev; production override points
  `DATABASE_URL` at the host instance (`host.docker.internal` + `extra_hosts` on
  Linux); `web`/`worker` `depends_on: migrate: service_completed_successfully`;
  `TZ`; `restart: unless-stopped`.
- README: `CREATE DATABASE`/`CREATE ROLE` SQL, `pg_hba.conf` note, env var table,
  the HA automation YAML.

**Done when:** `docker compose up` works against host Postgres and survives a
restart.

---

**Sequencing:** 1 → (2 ∥ 3) → 4 → 5 → 6 → (7) → 8, with Epic 7 startable any time
after 4. Critical path to something useful running is 1-3-4: after those, prices
accumulate even with no UI beyond the scaffold.
