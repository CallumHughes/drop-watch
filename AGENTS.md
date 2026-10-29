# DropWatch

Self-hosted price tracker: watches product pages on a schedule, records price
history, and alerts on target price, percentage drop, or restock.

pnpm 11 workspaces + Turborepo, Node 24. Never `npm` or `yarn`.

## Commands

```bash
pnpm check          # lint (Biome via ultracite); pnpm fix writes the fixes
pnpm check-types    # tsc --noEmit across every workspace
pnpm test           # vitest, database-free
```

`pnpm test` excludes the integration and e2e suites, which need a running
Postgres — see [Development](docs/development.md). `pnpm run` lists the Drizzle
(`db:*`) and container (`docker:*`) scripts.

## Layout

`apps/` web (Next.js App Router), worker (pg-boss), renderer, e2e.
`packages/` api (oRPC), auth (Better Auth), core (extract/rules/notify/fetch),
db (Drizzle), email, env, ui, config.

## Guides

- [Code style](docs/agents/code-style.md) — the deviations; the rest is enforced
- [Monorepo conventions](docs/agents/monorepo.md) — package boundaries, imports, turbo
- [Testing](docs/agents/testing.md) — which suite, and how to write one
- [Git workflow](docs/agents/git-workflow.md) — pre-commit, commits, PRs
- [Skills](docs/agents/skills.md) — the skills CLI, and which ones need Kody

Setup and runtime behaviour: [Installation](docs/installation.md),
[Configuration](docs/configuration.md), [Notifications](docs/notifications.md),
[Development](docs/development.md).

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
