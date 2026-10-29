# Skills

Skills live in `.agents/skills/` and are mirrored into `.claude/skills/` for
Claude Code. Managed with the `skills` CLI against `skills-lock.json`:

```bash
npx skills list
npx skills add <owner>/<repo> --skill <name>
npx skills update
npx skills remove <name>
npx skills experimental_install    # restore from the lock file
```

Newer installs put the real directory in `.agents/skills/` and a symlink in
`.claude/skills/`. Some older skills are still two independent copies that have
drifted apart — if you edit one of those, edit both.

Review a skill before trusting it. They run with full agent permissions, and
most of them come from third-party repositories.

## What each one needs

| Skill | Needs | Runs here |
| --- | --- | --- |
| `review-and-recommend` | nothing | yes |
| `visual-recap` | `gh`, Node | yes |
| `orchestrate` | nothing | yes |
| `prefer-local-kody-execute` | a Kody account, Node 22+ | yes |
| `friction-log` | `@kentcdodds/friction-log` | falls back |
| `ship-pr` | nothing | yes — ours, not Kent's |

`ship-pr` is this repo's own: it drives a PR with `gh` and the local scripts,
needing no account. Kent Dodds's `ship-pr` was installed over it briefly and
reverted, because it ticks his `@kentcdodds/ship-pr` Kody package, which in turn
imports `@kentcdodds/discord`, `@kentcdodds/bugbot` and `@kentcdodds/jev` —
none of them public — and pins itself to his setup (`github-bot` OAuth
connections, Bugbot "unavailable for non-kentcdodds authors", a deploy check
hardcoded to `kody-hq/kody`). Don't let `npx skills update` reintroduce it; it
is deliberately absent from `skills-lock.json`.

`friction-log` does import a Kody package of his, but documents a fallback:
open the issue by hand with the `friction` label and a priority.

Community listings only show up through Kody's `communitySearch`, never its
general `search`. An unpublished fork also cannot be removed through the API, so
`@callum/ship-pr` (a leftover of that experiment) has to go from its page on
kody.codes.

## Kody is opt-in here

Kody's MCP tools (`search`, `execute`, `api`) are connected at the session
level, so Kody is available to try whenever you want it. What is deliberately
*not* installed is `use-kody`, which instructs agents to default to Kody for
every task and to persist reusable work as Kody packages rather than as scripts
in this repo. Reach for Kody when you mean to, not by default.

`prefer-local-kody-execute` is kept because it is narrower: it only chooses
between two Kody transports once you are already running something through
Kody, and prefers the local CLI over the hosted sandbox.

To change your mind:

```bash
npx skills add kentcdodds/kcd-skills --skill use-kody
```

## Outside the lock file

`orchestrate` is vendored by hand from
[`kody-hq/kody`](https://github.com/kody-hq/kody/tree/main/packages/cli/.agents/skills/orchestrate)
at commit `fe6cdd7`, because it lives under `packages/cli/` and the `skills` CLI
only scans a repository's top-level `.agents/skills/`. So it has no
`skills-lock.json` entry: `npx skills update` won't update it and
`experimental_install` won't restore it. Re-copy it by hand to update.

It is also written for the Kody repo itself — it says "scoped to
`@kodycodes/cli`" and references `npm run validate`, which here is
`pnpm check && pnpm check-types`.
