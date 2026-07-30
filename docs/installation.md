# Installation

DropWatch runs as three containers — `web`, `worker`, and a one-shot `migrate`
job — against a PostgreSQL database. The quick start in the
[README](../README.md#quick-start) covers the bundled-Postgres case. This page
covers deploying against a Postgres you already run.

## The services

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
to migrate on startup is a real failure mode.

All three images build from a `turbo prune --docker` workspace, so a change to
the worker does not invalidate the web image's dependency layer, and vice versa.
Each ships a bundle rather than a `node_modules` install: `next build` for `web`,
rolldown for `worker` and `migrate`.

## Local stack (bundled Postgres)

```bash
pnpm docker:up      # docker compose up -d --build
pnpm docker:logs
pnpm docker:down
```

This binds port 5432 on the host; if something else already has it, use the
production override against that instance instead.

## Production (host Postgres)

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
`postgres` service off. `DATABASE_URL` is required — there is no default for
someone else's database.

`web` and `worker` are `restart: unless-stopped`, so the stack comes back by
itself after a host reboot. The migrate container retries its connection for up
to a minute before giving up, which covers the common case of containers
starting before the host's Postgres has finished.

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
`extra_hosts: host.docker.internal:host-gateway` entry in
`docker-compose.prod.yml`. The host's Postgres also has to be listening on
something the Docker bridge can reach:

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

## Creating the first account

No container runs `pnpm db:seed`, so the first account comes from the UI. Open
the app and sign up — the sign-up form is served only while the `user` table is
empty. After that, signup is invite-only and new accounts are issued from
**Invites** by an admin. The first account is the admin.

If you would rather seed from the command line (development, or a database you
can reach directly), see [Development](development.md#seeding).

## Upgrading

```bash
git pull
pnpm docker:prod:up      # rebuilds, reruns migrate, restarts web and worker
```

The `migrate` container runs before `web` and `worker` come back, and the stack
refuses to start if it fails.
