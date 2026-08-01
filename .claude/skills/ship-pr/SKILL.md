---
name: ship-pr
description: >
  Babysit a PR: mark it ready, iterate on CI failures and review feedback until
  it's green, then merge if asked or the change is low risk.
---

# Ship PR

Works on the current branch's PR unless given a number or URL. `gh pr view` to
find it; `gh pr create --fill` if it doesn't exist yet.

## Loop

1. Mark ready — `gh pr ready <pr>` (no-op if it isn't a draft)
2. Wait for CI — `gh pr checks <pr> --watch --fail-fast`
3. Fix failures. Read the failing job's log with
   `gh run view <run-id> --log-failed`, reproduce locally with the matching
   script, fix, and re-run that script before pushing:
   - **Lint** → `pnpm check` (Ultracite; `pnpm exec ultracite fix` to autofix)
   - **Types** → `pnpm check-types`
   - **Unit tests** → `pnpm test`
   - **Build** → `SKIP_ENV_VALIDATION=1 pnpm build`
   - **Integration tests** → `pnpm db:start && pnpm test:integration`
   - **E2E tests** → `pnpm db:start && pnpm test:e2e`; download the Playwright
     report artifact from the run when the failure isn't obvious from the log
4. Address review feedback — `gh pr view <pr> --comments` and
   `gh api repos/:owner/:repo/pulls/<pr>/comments`. Skip insignificant nits,
   already-fixed items, and anything wrong; say why in a reply rather than
   silently ignoring it.
5. Check mergeability against the base branch (`mergeStateStatus` from
   `gh pr view <pr> --json mergeable,mergeStateStatus`); rebase on `main` if
   behind or conflicted.
6. Green and no valid feedback left → done. Otherwise push and repeat.

CI runs six jobs in parallel (Lint, Types, Unit tests, Build, Integration
tests, E2E tests), so expect several failures per round rather than one.

## Merge

Only when asked, or when the change is genuinely low risk (docs, a dependency
bump that's green, a small self-contained fix).

```
gh pr merge <pr> --squash --delete-branch
```

Keep the squash title in the repo's Conventional Commits style — e.g.
`feat(worker): retry failed price fetches (#25)`. Never add a Claude
co-author trailer.

There is no deploy workflow; merging to `main` only re-runs CI on the branch.

## Done

Report back in the conversation: what changed, what CI looked like, what
feedback was addressed or declined, and whether it merged. Include the PR link
and a link to the last CI run.
