# Monorepo conventions

pnpm workspaces + Turborepo. `turbo.json` holds the task graph; read the
`turborepo` skill or the installed package's bundled docs before changing it,
since the CLI differs between versions.

## Who owns what

| Workspace | Owns |
| --- | --- |
| `apps/web` | Next.js App Router UI; Server Components call the API router in-process, client components use the oRPC client |
| `apps/worker` | pg-boss job handlers — scheduled checks, alert dispatch |
| `apps/renderer` | Browser render mode, behind a contract in `@drop-watch/core/render/contract` |
| `apps/e2e` | Playwright suite |
| `packages/api` | oRPC router — the only transport boundary |
| `packages/core` | Pure logic: extraction, alert rules, notification shaping, fetching. No database, no clock, no network of its own |
| `packages/db` | Drizzle schema, migrations, queue wiring. Owns every row |
| `packages/auth` | Better Auth config — see the `better-auth-best-practices` skill |
| `packages/brand` | The product name and the logo artwork, plus the Canva import/generate script. Every other brand asset is derived from `assets/*.svg` |
| `packages/email`, `env`, `ui`, `config` | Templates, validated env, shadcn components, shared tsconfig/biome |

`docs/architecture/primitives.yaml` maps path globs to these primitives and is
the authority. A change that adds or reshapes a primitive updates that file in
the same PR.

## Imports

Cross-package imports go through the package's declared `exports`, never a deep
relative path into another workspace:

```ts
import { extractPrice } from "@drop-watch/core/extract";
import { Button } from "@drop-watch/ui/components/button";
```

Keep `packages/core` free of database and network dependencies — it is the layer
that stays unit-testable. Anything needing a row belongs in `packages/db`;
anything needing a request belongs in `packages/api`.

Dependency versions come from the pnpm catalog (`catalog:` in `package.json`),
not pinned per workspace. Add to `pnpm-workspace.yaml` rather than drifting.

## Running one workspace

```bash
pnpm dev:web                              # or dev:worker
pnpm turbo run test -F @drop-watch/core   # one package's suite
```
