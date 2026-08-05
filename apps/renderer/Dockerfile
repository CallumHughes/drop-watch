# The Playwright render sidecar: browser rendering for pages that build their
# own DOM in JavaScript, kept out of apps/worker entirely — see
# apps/worker/Dockerfile and apps/worker/rolldown.config.ts for why that
# image ships a bundle with no node_modules at all.
#
# This image is NOT that bundle-only pattern. Playwright has a native
# launcher and out-of-tree browser binaries under /ms-playwright, so its code
# cannot be bundled the way the worker's can. The runner stage below is a
# real install, on top of Microsoft's own Playwright image, which already
# carries browsers matching the pinned Playwright version.

# Single source of truth for the Playwright version: it drives both the base
# image tag on the runner stage and the npm install there, so the two can
# never drift apart. Declared before the first FROM so it is in scope for
# the `FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble` below.
ARG PLAYWRIGHT_VERSION=1.62.1

FROM node:24-slim AS base
RUN npm install --global pnpm@11
WORKDIR /app

FROM base AS pruner
RUN npm install --global turbo@2.10.7
COPY . .
RUN turbo prune @drop-watch/renderer --docker

FROM base AS builder
# The two-step copy — `out/json` (manifests only) then `out/full` (sources) —
# keeps `pnpm install` off the critical path for source-only changes.
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,target=/pnpm-store pnpm install --frozen-lockfile --store-dir /pnpm-store
COPY --from=pruner /app/out/full/ .
RUN pnpm exec turbo build --filter=@drop-watch/renderer

FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/apps/renderer/dist ./dist

# A plain `npm install` in a clean directory, deliberately not `pnpm install`
# against the workspace: that is exactly the optional-peers problem
# apps/worker/Dockerfile's header describes, and this sidecar exists so that
# problem never has to be solved instead of sidestepped. The image already
# ships matching browsers under /ms-playwright, so skip re-downloading them.
ARG PLAYWRIGHT_VERSION
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm install --omit=dev playwright@${PLAYWRIGHT_VERSION}

# Drop to the non-root account Microsoft's image already ships for exactly
# this. The bundle and node_modules are read-only; Chromium's temporary profile
# lives in the bounded /tmp tmpfs configured by compose.
USER pwuser

EXPOSE 3002

# `node` directly, so compose's SIGTERM reaches the graceful-shutdown handler
# in src/index.ts rather than a package-manager wrapper.
CMD ["node", "--enable-source-maps", "dist/index.js"]
