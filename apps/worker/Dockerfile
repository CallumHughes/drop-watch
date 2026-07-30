# The background worker: pg-boss, the minutely dispatcher, and every check.
#
# Same `turbo prune` shape as the web image, scoped to `worker`, so
# a UI-only change never rebuilds this one.
#
# The runner ships a bundle, not an install: pnpm resolves optional peers across
# the whole workspace, so an install here arrives with the Next.js `apps/web`
# needs. See apps/worker/rolldown.config.ts.

FROM node:24-slim AS base
RUN npm install --global pnpm@11
WORKDIR /app

FROM base AS pruner
RUN npm install --global turbo@2.10.7
COPY . .
RUN turbo prune @drop-watch/worker --docker

FROM base AS builder
# The two-step copy — `out/json` (manifests only) then `out/full` (sources) —
# keeps `pnpm install` off the critical path for source-only changes.
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,target=/pnpm-store pnpm install --frozen-lockfile --store-dir /pnpm-store
COPY --from=pruner /app/out/full/ .
RUN pnpm exec turbo build --filter=@drop-watch/worker

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/apps/worker/dist ./dist

# `node` directly, so compose's SIGTERM reaches the graceful-shutdown handler in
# src/index.ts rather than a package-manager wrapper.
CMD ["node", "--enable-source-maps", "dist/index.js"]
