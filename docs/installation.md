# Installation

DropWatch runs as three containers — `web`, `worker`, and a one-shot `migrate`
job — against a PostgreSQL database, with an optional fourth for browser-mode
listings. The images are published to GitHub Container Registry, so the normal
way to deploy is to pull them; building from source is also supported and is
covered further down.

## The services

| Service | Image | Role |
|---|---|---|
| `migrate` | `ghcr.io/callumhughes/drop-watch/migrate` | One-shot. Waits for Postgres, applies migrations, exits. |
| `web` | `ghcr.io/callumhughes/drop-watch/web` | Next.js dashboard on port 3001. |
| `worker` | `ghcr.io/callumhughes/drop-watch/worker` | pg-boss: the minutely dispatcher and every check. |
| `renderer` | `ghcr.io/callumhughes/drop-watch/renderer` | Optional headless-Chromium sidecar on port 3002, for listings whose price is composed by JavaScript. Opt-in behind the `browser` profile; reached only over the compose network, never published. |
| `postgres` | `postgres:18` | Optional. Bundled database, behind the `bundled-db` profile. |

Each image is built for `linux/amd64` and `linux/arm64`, and each is public —
pulling needs no GitHub account and no `docker login`.

`web` and `worker` both declare
`depends_on: migrate: { condition: service_completed_successfully }`, so a failed
migration stops the deployment instead of letting the apps boot against an old
schema. Migrations deliberately do **not** run at app boot — two processes racing
to migrate on startup is a real failure mode.

Nothing depends on `postgres`. The migrate job retries its own connection for up
to a minute (`packages/db/src/migrate.ts`), which is what lets the bundled
database be a profile you can switch off, and what makes the stack come back
cleanly after a host reboot, when containers routinely start before Postgres has
finished.

## Running the published images

Two files, no clone:

```bash
mkdir drop-watch && cd drop-watch
curl -fsSLO https://raw.githubusercontent.com/CallumHughes/drop-watch/main/deploy/docker-compose.yml
curl -fsSL  https://raw.githubusercontent.com/CallumHughes/drop-watch/main/deploy/.env.example -o .env
```

Set `BETTER_AUTH_SECRET` in `.env` to at least 32 random characters
(`openssl rand -base64 32`). It is the only value you must change. Then:

```bash
docker compose up -d
docker compose logs -f
```

If the host is reached by anything other than `localhost`, set `BETTER_AUTH_URL`
and `CORS_ORIGIN` to the URL the browser actually uses — for example
`http://server.local:3001`. Better Auth rejects requests whose origin does not
match.

### Profiles

`COMPOSE_PROFILES` in `.env` decides which optional services run. It ships as
`bundled-db`, which is the zero-configuration path: Postgres runs in a container
and `DATABASE_URL` already points at it.

| Value | Effect |
|---|---|
| `bundled-db` | Runs Postgres in a container, with a named volume for its data. |
| `browser` | Runs the `renderer` sidecar. See below. |
| `bundled-db,browser` | Both. |

The bundled database publishes port 5432 on loopback only, so `psql` works from
the host without exposing it to the rest of the network.

### Pinning a version

`DROP_WATCH_VERSION` selects the image tag and defaults to `latest`, which moves
with every push to `main`. Every commit also publishes an immutable
`sha-<short>` tag; set that instead if you would rather choose when to move:

```bash
DROP_WATCH_VERSION=sha-1a2b3c4
```

There is no versioned release series yet, so `latest` is what most deployments
want. `DROP_WATCH_IMAGE` changes the namespace the images come from — set it to
run a fork's own published images, since a fork's CI publishes under its own
account with no edit to the workflow.

### Upgrading

```bash
docker compose pull
docker compose up -d
```

The `migrate` container runs first and `web` and `worker` come back behind it, so
a failed migration stops the upgrade rather than leaving the apps on a schema
they do not understand. Nothing is lost if you are already current — `pull` is a
no-op and the containers are not recreated.

### Browser render mode

The `renderer` sidecar is a full Chromium and is opt-in for that reason. It runs
with capabilities dropped, a read-only filesystem, and Playwright's seccomp
profile — Docker's default plus the user-namespace syscalls Chromium's own
sandbox needs. That profile is a file the compose file reads by relative path,
so it has to sit next to `docker-compose.yml`:

```bash
curl -fsSLO https://raw.githubusercontent.com/CallumHughes/drop-watch/main/apps/renderer/seccomp_profile.json
```

Then add `browser` to `COMPOSE_PROFILES` and set `RENDER_URL=http://renderer:3002`
in `.env`. Without the profile file the container will not start; without
`RENDER_URL` a browser-mode listing simply records a failed check run rather than
crashing the worker. See [Configuration](configuration.md#browser-render-mode).

## Using a Postgres you already run

Remove `bundled-db` from `COMPOSE_PROFILES` and set `DATABASE_URL`. There is no
default — there is no sensible one for someone else's database:

```bash
COMPOSE_PROFILES=
DATABASE_URL=postgresql://drop_watch:choose-something-long@host.docker.internal:5432/drop_watch
```

### Create the database and role

Give DropWatch its own database and role rather than a schema inside another
service's database:

```sql
CREATE ROLE drop_watch WITH LOGIN PASSWORD 'choose-something-long';
CREATE DATABASE drop_watch OWNER drop_watch;
GRANT ALL PRIVILEGES ON DATABASE drop_watch TO drop_watch;
```

Owning the database matters: the role has to be able to **create schemas**.
Drizzle keeps its migration journal in a `drizzle` schema, and pg-boss creates
and manages a `pgboss` schema of its own — leave that one alone, the worker owns
it.

If the role does not own the database, grant the schema rights explicitly
(Postgres 15+ no longer gives `PUBLIC` create rights on `public`):

```sql
GRANT CREATE ON DATABASE drop_watch TO drop_watch;
GRANT ALL ON SCHEMA public TO drop_watch;
```

### Letting the containers reach the host

The containers connect to `host.docker.internal`. On Docker Desktop that name
already resolves; on Linux it comes from the
`extra_hosts: host.docker.internal:host-gateway` entry the compose file already
carries. The host's Postgres also has to be listening on something the Docker
bridge can reach:

`postgresql.conf`

```conf
listen_addresses = '*'          # or the bridge gateway address specifically
```

`pg_hba.conf` — allow the Docker networks. Compose creates its own bridge
network, so the address is usually somewhere in `172.16.0.0/12` rather than the
`172.17.0.0/16` default bridge:

```conf
# TYPE  DATABASE    USER        ADDRESS          METHOD
host    drop_watch  drop_watch  172.16.0.0/12    scram-sha-256
```

Reload afterwards (`SELECT pg_reload_conf();`, or `systemctl reload postgresql`).
`listen_addresses` needs a full restart. If a container logs
`no pg_hba.conf entry for host ...`, the address in that error is the subnet to
add.

## Building from source

Cloning and building is the path for development, for architectures the
published images do not cover, and for running a change that is not on `main`.

```bash
git clone https://github.com/CallumHughes/drop-watch.git
cd drop-watch
cp .env.example .env            # then edit it
pnpm docker:up                  # docker compose up -d --build
pnpm docker:logs
pnpm docker:down
```

That uses the repo's own `docker-compose.yml`, which builds every image locally
and binds the bundled Postgres on port 5432. Against a Postgres you already run,
layer the production override instead:

```bash
pnpm docker:prod:up             # build + start, detached
pnpm docker:prod:logs
pnpm docker:prod:down
```

which is shorthand for:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

The override points `DATABASE_URL` at the host instance and switches the bundled
`postgres` service off. The host-Postgres setup above applies unchanged.

Upgrading a source build is `git pull` followed by the same `up` command, which
rebuilds, reruns `migrate`, and restarts `web` and `worker`.

All the images build from a `turbo prune --docker` workspace, so a change to the
worker does not invalidate the web image's dependency layer, and vice versa.
Each ships a bundle rather than a `node_modules` install: `next build` for `web`,
rolldown for `worker` and `migrate`.

## Creating the first account

No container runs `pnpm db:seed`, so the first account comes from the UI. Open
the app and sign up — the sign-up form is served only while the `user` table is
empty. After that, signup is invite-only and new accounts are issued from
**Invites** by an admin. The first account is the admin.

If you would rather seed from the command line (development, or a database you
can reach directly), see [Development](development.md#seeding).
