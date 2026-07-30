# DropWatch

Self-hosted price tracking. Paste a product URL, and DropWatch checks the page on
a schedule you choose, keeps every price it sees, and tells you when something
actually moves — a target hit, a real drop, or a restock. It runs on your own
box, against your own Postgres, and talks to nothing you did not configure.

Alerts go to a Home Assistant webhook, to email, or to both. Neither is required
to start.

## Features

**Track almost any store.** Paste a URL and DropWatch works out where the price
is: JSON-LD first, then microdata/RDFa, then OpenGraph, then a CSS selector you
pick yourself. No per-site adapters to write or maintain, and nothing to update
when a shop redesigns — the structured data most stores already publish is
usually enough.

**Pick the price yourself when a page is awkward.** When the automatic chain
comes up empty, the add-product flow gives you a live selector picker: type a
selector and see the match count and sample elements immediately, with the raw
page source a click away. It all runs against a single cached fetch, so
experimenting costs the shop nothing.

**Keep the price history.** Every successful check records a point, not just the
changes. Cards carry a sparkline; the detail page draws the full series with your
target price as a reference line, so "is this actually cheap?" is a glance rather
than a guess.

**Watch stock, not just price.** Availability is read from the same structured
data and normalised across the usual spellings, so "in stock", "preorder" and
"sold out" mean the same thing whatever the shop calls them. A back-in-stock
alert falls out of that.

**Alerts that fire once, not every check.** Arm any combination of three rules
per product: a target price, a percentage drop, or a restock. Each fires once and
then goes quiet for a cooldown, so a price that sits below your target does not
notify you every three hours. A cheaper price is always news and reopens it.

**Know when a watch breaks.** Selectors rot silently — a shop changes its markup
and a tracker just stops seeing prices, forever, without complaining. DropWatch
counts consecutive failures and sends a `watch_broken` alert when a product stops
working, then stays quiet until it recovers.

**Check on your schedule.** Interval is per product, from 5 minutes to a week,
with jitter so twenty products added the same evening do not stampede the same
shop on the same minute. Pause anything you are done with, or hit **Check now**
when you cannot wait.

**Share it with the household.** The first account created becomes the admin;
after that sign-up closes and new people join by invite — single-use links that
expire in 48 hours. Everyone's products, targets and email preferences are their
own.

**Host it yourself.** Docker Compose, a Postgres, and nothing else. No accounts
to create, no API keys required, no telemetry. Email and Home Assistant are both
opt-in.

**Typed API.** Everything the UI does goes through oRPC, with an OpenAPI document
and a browsable reference at `/api/rpc/api-reference`.

## Quick start

Docker Compose, with the bundled Postgres:

```bash
git clone https://github.com/CallumHughes/drop-watch.git
cd drop-watch
cp .env.example .env
```

Set `BETTER_AUTH_SECRET` in `.env` to at least 32 random characters:

```bash
openssl rand -base64 32
```

That is the only value you must change — everything else in the file has a
working default for the local stack. Then:

```bash
docker compose up -d --build
```

Open <http://localhost:3001> and create your account. The sign-up form is served
only while no account exists, so the first one you make is the admin; after that
people join by invite. Nothing seeds an account for you.

Add a product by pasting a URL, and the first check runs within the minute.

To run against a Postgres you already have, see
[Installation](docs/installation.md).

## Configuration

The variables most people touch, all in the root `.env`:

| Variable | Required | Notes |
|---|---|---|
| `BETTER_AUTH_SECRET` | yes | ≥32 chars. `openssl rand -base64 32`. |
| `BETTER_AUTH_URL` | no | The URL the browser uses. Defaults to `http://localhost:3001`; set it to e.g. `http://server.local:3001` on a home server. |
| `CORS_ORIGIN` | no | Normally identical to `BETTER_AUTH_URL`. |
| `TZ` | no | Defaults to `Europe/London`. Affects scheduling and every rendered timestamp. |
| `RESEND_API_KEY` | no | Turns email on. Leave it unset for a webhook-only instance. |

Home Assistant is configured on the settings page rather than the environment,
along with the alert cooldown and failure threshold. Per-product settings —
interval, target price, which rules are armed — live on each product.

Full reference: [Configuration](docs/configuration.md).

## How checks run

The worker runs a dispatcher every minute. It looks for products whose next check
is due, and enqueues one job each — a product that stays due accumulates exactly
one job, never a backlog.

Each product carries its own interval and a jitter percentage. After a check, the
next one is scheduled at the interval ± jitter, which is what stops products
added together from converging on the same minute forever. Checks run in small
batches, one request per hostname at a time, with conditional requests and
backoff on rate limits.

Postgres is the only interface between the web app and the worker. Changing a
setting takes effect on the next check with nothing to restart, and there is no
message broker to run.

## Known limitations

- **Sites with active bot protection are unsupported**, Amazon in particular. The
  fetch layer is deliberately polite — a realistic user agent and conditional
  requests, but no escalation beyond that. If a shop is determined to block
  scripted access, DropWatch will not fight it.
- **Products cannot be deleted, only paused.** Un-ticking "actively tracked"
  stops the checks and keeps the history; there is no delete in the UI or the
  API yet.
- **One `web` replica.** The add-product preview caches the fetched page in
  memory per process, so behind a load balancer the selector picker would test
  against a page a different replica holds.
- **Check history grows without bound.** `check_runs` records every attempt and
  nothing prunes it yet.
- **Prices render in `en-GB` formatting.** The currency follows the shop; the
  number and date formatting does not yet follow you.
- **The `worker` and `migrate` images are large** (~1.5 GB against the web
  image's ~410 MB), because pnpm's auto-installed peer dependencies pull Next.js
  into both even though neither process loads it.

DropWatch tracks one URL per product — it does not compare the same item across
several retailers, and it does not compute all-time lows or averages.

## Documentation

- [Installation](docs/installation.md) — deploying, host Postgres, upgrading
- [Configuration](docs/configuration.md) — every environment variable, and which file it belongs in
- [Notifications](docs/notifications.md) — Home Assistant automations, email setup, alert rules
- [Development](docs/development.md) — running locally, project layout, tests

## Development

```bash
pnpm install
pnpm db:start && pnpm db:migrate && pnpm db:seed
pnpm dev            # web on http://localhost:3001, plus the worker
```

Next.js, oRPC, Drizzle and Postgres, pg-boss, Better Auth, Turborepo. Full setup
in [Development](docs/development.md). Scaffolded with
[Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack).
