# Code style

Formatting and most lint rules are enforced, not documented: `biome.json` plus
the `ultracite` preset. `pnpm fix` writes them; a husky pre-commit hook and the
Claude Code `PostToolUse` hook both run it, so don't hand-apply what Biome
fixes. The full rule rationale lives in the `ultracite`
skill (`.agents/skills/ultracite/`), which loads automatically for JS/TS work.

What follows is only where this repo differs from that preset, or where Biome
cannot see the problem.

## Deviations from the preset

**Barrel files.** The preset says avoid them. Here, a package's entry point and
its subpath entries are barrels by design — `packages/core` exports
`./extract`, `./rules`, `./notify`, `./fetch`, `./render`, each a directory
`index.ts`, and `packages/api`, `auth` and `db` export a single `src/index.ts`.
The rule applies to a package's internals: don't add re-export files below an
exported subpath.

**console.log.** Don't just delete it. Logging here is structured wide events
via evlog — convert a meaningful log at an entry point into a wide event, and
an unstructured `throw` into a structured error. See the
`review-logging-patterns` skill. Debug leftovers still go.

**next/head.** `apps/web` is App Router on Next 16. Use the metadata API;
`next/head` does not apply. Read `node_modules/next/dist/docs/` before writing
Next code — see `apps/web/AGENTS.md`.

## What Biome can't check

- Business logic and edge cases — boundary conditions, error states
- Naming: say what a thing is, not that it exists
- Where a change belongs: which package owns it (see [Monorepo](monorepo.md))
- Accessibility beyond the mechanical rules: heading order, focus order,
  whether a control is reachable by keyboard at all

Comments are few and short. Explain a non-obvious decision; don't narrate the
code or write rationale headers.
