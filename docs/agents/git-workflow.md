# Git workflow

## Before committing

```bash
pnpm check
pnpm check-types
```

A husky pre-commit hook formats staged files and re-stages them, so `check`
failing in CI is usually a lint rule rather than formatting.

## Commits

Conventional commits, matching the existing log:

```
fix(core): fall back to microdata when JSON-LD has no offer
chore(deps): bump next from 16.4.0 to 16.4.3
```

Scope is the workspace or primitive the change lands in. Don't add a
`Co-Authored-By` trailer for Claude.

Commit or push only when asked. Branch first if on `main`.

## Pull requests

If the change touches more than one primitive or carries real risk, the
`visual-recap` skill generates the system recap block for the description from
`docs/architecture/primitives.yaml`. It also ships
`check-primitives-map.mjs`, which fails when a PR reshapes a primitive without
updating that file.

## Reproducing a CI failure

CI runs six jobs in parallel, so expect several failures per round rather than
one. Read the failing job with `gh run view <run-id> --log-failed`, then
reproduce it locally with its script before pushing:

| CI job | Locally |
| --- | --- |
| Lint | `pnpm check` (`pnpm fix` autofixes) |
| Types | `pnpm check-types` |
| Unit tests | `pnpm test` |
| Build | `SKIP_ENV_VALIDATION=1 pnpm build` |
| Integration tests | `pnpm db:start && pnpm test:integration` |
| E2E tests | `pnpm db:start && pnpm test:e2e` |

When an E2E failure isn't obvious from the log, download the
`playwright-report` artifact from the run.

The `ship-pr` skill drives a PR to done using these commands and `gh`, with no
account or external service needed.
