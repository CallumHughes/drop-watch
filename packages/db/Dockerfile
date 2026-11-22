# The one-shot migration job.
#
# Migrations run in their own container, not at web/worker boot, because two
# processes racing to migrate on startup is a real failure mode. Compose gates
# both apps behind `service_completed_successfully` on this one, so a bad
# migration stops the deployment instead of half-starting it.
#
# The runner ships a bundle, not an install: pnpm resolves optional peers across
# the whole workspace, so an install here arrives with the Next.js `apps/web`
# needs. That is also why the job uses drizzle's runtime migrator over the
# `drizzle-kit` CLI — see packages/db/src/migrate.ts.

FROM node:26-slim AS base
RUN npm install --global pnpm@11
WORKDIR /app

FROM base AS pruner
RUN npm install --global turbo@2.10.7
COPY . .
RUN turbo prune @drop-watch/db --docker

FROM base AS builder
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,target=/pnpm-store pnpm install --frozen-lockfile --store-dir /pnpm-store
COPY --from=pruner /app/out/full/ .
RUN pnpm exec turbo build --filter=@drop-watch/db

FROM node:26-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# Includes the migration SQL, which the migrator reads from disk.
COPY --from=builder /app/packages/db/dist ./dist

CMD ["node", "--enable-source-maps", "dist/migrate.js"]
