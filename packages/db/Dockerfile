# The one-shot migration job.
#
# Migrations run in their own container, not at web/worker boot, because two
# processes racing `drizzle-kit migrate` on startup is a real failure mode.
# Compose gates both apps behind
# `service_completed_successfully` on this one, so a bad migration stops the
# deployment instead of half-starting it.
#
# Pruned to `@drop-watch/db`, which carries the migration SQL, the drizzle
# config and drizzle-kit itself. The install is not `--prod`: drizzle-kit is a
# dev dependency.

FROM node:24-slim AS base
RUN npm install --global pnpm@11
WORKDIR /app

FROM base AS pruner
RUN npm install --global turbo@2.10.7
COPY . .
RUN turbo prune @drop-watch/db --docker

FROM base AS runner
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,target=/pnpm-store pnpm install --frozen-lockfile --store-dir /pnpm-store
COPY --from=pruner /app/out/full/ .

COPY packages/db/docker-entrypoint.sh /usr/local/bin/migrate
RUN chmod +x /usr/local/bin/migrate

ENV NODE_ENV=production
WORKDIR /app/packages/db

CMD ["migrate"]
