# The Next.js dashboard.
#
# Built from a `turbo prune` workspace rather than the whole repo:
# the pruner emits only the packages `web` actually depends on, so a change to
# `apps/worker` cannot invalidate this image's dependency layer.
#
# The two-step copy — `out/json` (manifests only) then `out/full` (sources) — is
# what makes that pay off: `pnpm install` re-runs only when a package.json or
# the lockfile changes, not on every source edit.

FROM node:24-slim AS base
RUN npm install --global pnpm@11
WORKDIR /app

FROM base AS pruner
# turbo has to be available *before* anything is installed, which is the whole
# point of the prune step, so it comes from npm rather than the workspace.
RUN npm install --global turbo@2.10.7
COPY . .
RUN turbo prune @drop-watch/web --docker

FROM base AS builder
# NODE_ENV is deliberately not set here: pnpm reads it and would skip the dev
# dependencies the build needs (typescript, tailwind, the shared tsconfig).
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,target=/pnpm-store pnpm install --frozen-lockfile --store-dir /pnpm-store
COPY --from=pruner /app/out/full/ .

# The build evaluates the Better Auth config and the env schemas; the real
# values arrive from compose at runtime. Both names are declared on the `build`
# task in turbo.json — turbo runs tasks in a strict environment by default and
# would otherwise not pass them through to `next build`.
ENV SKIP_ENV_VALIDATION=1
ENV BETTER_AUTH_SECRET=build-time-placeholder-secret-not-used-at-runtime

RUN NODE_ENV=production pnpm exec turbo build --filter=@drop-watch/web
# standalone output excludes public/; ensure it exists so the runner copy never fails
RUN mkdir -p apps/web/public

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

ENV HOSTNAME=0.0.0.0
ENV PORT=3001
EXPOSE 3001

CMD ["node", "apps/web/server.js"]
