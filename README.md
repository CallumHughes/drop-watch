# DropWatch

DropWatch keeps an eye on product pages and tells you if the price drops. You
give it a URL, it checks the page on a schedule and records what it finds.
Self-hosted: your machine, your Postgres.

It is early software with a deliberately narrow scope. A product can track more
than one store's URL — alerts and history follow whichever one is cheapest right
now — but there is still no browsing for deals across retailers you have not
already pointed it at. It copes with shops that publish structured data, which
is most of them, and gives up politely on the ones that do not.

Alerts go to a Home Assistant webhook or to email. Neither is required.

## What it does

**Reading the price.** It tries JSON-LD, then microdata/RDFa, then OpenGraph,
then a CSS selector if you supply one. Most shops publish at least one of the
first three, so usually there is nothing to configure. There are no per-site
adapters, which means nothing to update when a shop redesigns — and also means a
shop can quietly break a watch.

**Picking a selector.** When none of that finds anything, the add-product page
lets you type a CSS selector and shows the match count and a few matched
elements as you type, with the page source to hand. It works off a single cached
fetch, so trying selectors does not hammer the shop.

**Multiple stores.** A product can track more than one retailer's URL for the
same item. The detail page draws one line per store on the price chart, and the
current price and target alerts follow whichever tracked store is cheapest
right now; drop and restock alerts watch each store's own history.

**History.** Every successful check writes a price point, not only the ones that
changed. Product cards get a sparkline, and the detail page draws the series with
your target marked on it. No averages or all-time lows.

**Stock.** Availability comes from the same structured data, normalised to in,
out, or unknown. Mainly this exists so the restock rule has something to go on.

**Alerts.** Three rules per product, in any combination: target price, percentage
drop, restock. The target rule is evaluated against whichever tracked store is
currently cheapest; drop and restock fire on the store that was just checked.
Each fires once and then keeps quiet for a cooldown, on the theory that being
told the same thing every three hours is how a notifier gets muted. A lower
price reopens it.

**Broken watches.** Selectors rot. A shop changes its markup, the tracker stops
finding a price, and left alone it would sit there indefinitely saying nothing.
After a few consecutive failures it sends a `watch_broken` alert, then shuts up
until the product recovers.

**Scheduling.** Interval is per store, five minutes to a week, with some jitter
so a batch added in one sitting does not hit the same shop on the same minute.
Each store can be paused, or checked on demand, independently of its siblings.

**More than one person.** The first account created is the admin. After that
sign-up closes and people join by invite — single-use links, good for 48 hours.
Products and alert preferences belong to whoever added them.

**Running it.** Docker Compose and a Postgres. The four images are prebuilt and
published to GitHub Container Registry, so there is nothing to build to get
started. Nothing phones home, and neither email nor Home Assistant is needed.

**API.** The UI talks to the backend over oRPC. There is an OpenAPI document and
a reference page at `/api/rpc/api-reference` if you want to script against it.

## Quick start

Docker, with the bundled Postgres. No clone needed — the four images are
pulled prebuilt from GitHub Container Registry:

```bash
mkdir drop-watch && cd drop-watch
curl -fsSLO https://raw.githubusercontent.com/CallumHughes/drop-watch/main/deploy/docker-compose.yml
curl -fsSL  https://raw.githubusercontent.com/CallumHughes/drop-watch/main/deploy/.env.example -o .env
```

Set `BETTER_AUTH_SECRET` in `.env` to at least 32 random characters:

```bash
openssl rand -base64 32
```

That is the only value you must change — everything else in the file has a
working default for the local stack. Then:

```bash
docker compose up -d
```

Open <http://localhost:3001> and create your account. The sign-up form is served
only while no account exists, so the first one you make is the admin; after that
people join by invite. Nothing seeds an account for you.

Add a product by pasting a URL, and the first check runs within the minute.

To run against a Postgres you already have, or to pin a version instead of
tracking `latest`, see [Installation](docs/installation.md).

### Building from source

To build the images yourself instead of pulling them:

```bash
git clone https://github.com/CallumHughes/drop-watch.git
cd drop-watch
cp .env.example .env
# set BETTER_AUTH_SECRET, as above
docker compose up -d --build
```

See [Development](docs/development.md) for running without Docker at all.

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

Postgres is the only interface between the web app and the worker, so a setting
changed in the UI takes effect on the next check without restarting anything.

## Known limitations

- **Sites with active bot protection are unsupported**, Amazon in particular. The
  fetch layer is deliberately polite — a realistic user agent and conditional
  requests, but no escalation beyond that. If a shop is determined to block
  scripted access, DropWatch will not fight it.
- **One `web` replica.** The add-product preview caches its result in memory
  per process, so behind a load balancer the selector picker would test against
  a page a different replica holds.
- **Check history grows without bound.** `check_runs` records every attempt and
  nothing prunes it yet.
- **Prices render in `en-GB` formatting.** The currency follows the shop; the
  number and date formatting does not yet follow you.

There is no browsing for alternatives you have not added yourself — DropWatch
only ever compares the stores you are already tracking against each other,
never against the wider market.

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
