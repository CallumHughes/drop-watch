# The Next.js dashboard.
#
# Built from a `turbo prune` workspace rather than the whole repo (PLAN.md §9):
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
RUN turbo prune web --docker

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

# The one runtime fact that cannot arrive at runtime. `NEXT_PUBLIC_*` is
# inlined into the browser bundle by `next build`, and next.config.ts otherwise
# derives this flag by asking whether RESEND_API_KEY is set — which, in here,
# it never is: secrets are kept out of image layers on purpose (.dockerignore),
# so the derived answer would always be `false` and the email UI would stay
# hidden however the container is configured at runtime. Hence the build arg.
#
# `false` is the honest default: it is exactly what the derivation would
# produce in this stage. Set it to `true` (compose passes it through from the
# root `.env`) to build a mailer-enabled image. It only controls whether links
# and the email-alerts toggle are *offered*; the routes and the mailer itself
# are gated server-side on the real key, so a wrong value here can at worst
# show a link to a 404 — never send mail that was not configured.
ARG NEXT_PUBLIC_EMAIL_ENABLED=false
ENV NEXT_PUBLIC_EMAIL_ENABLED=${NEXT_PUBLIC_EMAIL_ENABLED}

RUN NODE_ENV=production pnpm exec turbo build --filter=web
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
