# The background worker: pg-boss, the minutely dispatcher, and every check.
#
# Same `turbo prune` shape as the web image (PLAN.md §9), scoped to `worker`, so
# a UI-only change never rebuilds this one.
#
# The worker has no build step — it runs its TypeScript directly through tsx —
# so there is no separate runner stage to copy a bundle into. That also means
# the install cannot be `--prod`: tsx resolves `tsconfig.json`, which extends
# the shared `@drop-watch/config` base, and that is a dev dependency.

FROM node:24-slim AS base
RUN npm install --global pnpm@11
WORKDIR /app

FROM base AS pruner
RUN npm install --global turbo@2.10.7
COPY . .
RUN turbo prune worker --docker

FROM base AS runner
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,target=/pnpm-store pnpm install --frozen-lockfile --store-dir /pnpm-store
COPY --from=pruner /app/out/full/ .

ENV NODE_ENV=production
WORKDIR /app/apps/worker

# `node --import tsx` rather than `pnpm start`: this way the process the
# container supervises *is* the worker, so compose's SIGTERM reaches the
# graceful-shutdown handler in src/index.ts instead of a package-manager
# wrapper that would be killed alongside it.
CMD ["node", "--import", "tsx", "src/index.ts"]
