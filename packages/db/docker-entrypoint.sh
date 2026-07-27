#!/bin/sh
# Entrypoint for the one-shot migrate container.
#
# Waits for Postgres before migrating. In production the database is on the
# host, outside compose's view, so there is no `service_healthy` condition to
# depend on — and after a host reboot the containers routinely come back before
# Postgres has finished starting. Retrying here is what makes the stack survive
# that, and it is why `web` and `worker` can trust
# `depends_on: migrate: service_completed_successfully`.
#
# Only the *connection* is retried. Once the database answers, `drizzle-kit
# migrate` runs exactly once: a migration that fails is a real failure and must
# fail the deployment, not spin.
set -eu

ATTEMPTS=30
INTERVAL=2

attempt=1
while :; do
  if node -e "
    const { Client } = require('pg');
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    client
      .connect()
      .then(() => client.end())
      .catch((error) => {
        console.error(error.message);
        process.exit(1);
      });
  "; then
    break
  fi

  if [ "$attempt" -ge "$ATTEMPTS" ]; then
    echo "migrate: database unreachable after $attempt attempts, giving up" >&2
    exit 1
  fi

  echo "migrate: database not ready (attempt $attempt/$ATTEMPTS), retrying in ${INTERVAL}s"
  attempt=$((attempt + 1))
  sleep "$INTERVAL"
done

echo "migrate: database reachable, applying migrations"
exec pnpm exec drizzle-kit migrate
