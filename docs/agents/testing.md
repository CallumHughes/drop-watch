# Testing

Three suites with different prerequisites. [Development](../development.md) has
the full setup — database bootstrap, throwaway database names, Playwright UI
mode caveats. This page is about choosing and writing one.

## Which suite

| | Where | Needs |
| --- | --- | --- |
| Unit (vitest) | `apps/web`, `apps/worker`, `packages/{api,core,email}` | nothing — `pnpm test` |
| Integration (vitest) | `packages/db` | compose Postgres — `pnpm db:start && pnpm test:integration` |
| E2E (Playwright) | `apps/e2e` | Postgres + `pnpm exec playwright install` |

Default to a unit test in `packages/core` — extraction, rules and notification
shaping are pure, so most behaviour can be tested there without a database.
Reach for integration only when the thing under test is schema, queue policy or
a concurrency race. Reach for e2e only when the point is the whole loop:
browser → oRPC → pg-boss → worker → webhook.

`pnpm test` must stay database-free. Don't add a suite to it that needs Postgres.

## Writing one

- Assertions go in the `it()`/`test()` body, never behind a helper that hides
  the `expect` — it wrecks the failure message
- No `.only` or `.skip` in committed code
- `async`/`await`, never a done callback
- Keep `describe` nesting shallow; one behaviour per test

Playwright specs have their own house rules — fixture-injected page objects,
semantic locators, `storageState` auth, `expect` in the spec and not the page
object. Read the `playwright-e2e-conventions` skill before touching
`apps/e2e`; it loads on any `.spec.ts` or page-object work.

E2E specs for not-found paths are slow because the client retries 404s — that
is expected, not a flake.
