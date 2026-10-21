# Agent protocol — preventing known failure loops

Operational rules for agents (and their parents) working in this repo. Adapted from the orbit protocol, where
each rule exists because the loop it prevents actually happened. Imperative, no exceptions without an explicit
note in the feature's tracking doc.

## 1. Environment first

Verify against an isolated local stack (`docker-compose -f docker-compose.dev.yaml up -d`, local database,
`DATABASE_PROVIDER` set). If the environment is broken (database down, Prisma client stale, Redis
unreachable), STOP and report `environment: <what failed>` — never debug the feature against a broken stack.
Never verify against shared or production instances, and never connect a test to a consumer's real
WhatsApp number.

**On-device WhatsApp validation** (QR pairing, real send/receive, `@lid` delivery, media) needs a human with
a phone. Agents prepare the steps and expected results; the human runs them. Report it as unverified until
the human confirms.

## 2. Commits (subagents do NOT commit)

**The parent owns commits; workers do not.** A worker implements, runs only the focused checks, and hands
back the diff plus evidence. It must not stage, commit or push.

**Every ODD task closes with at least one Conventional work-unit commit**, and its commit id is recorded in
the feature doc. Slice work into commits of ~400 authored changed lines. Husky runs `lint-staged` on commit
and `build` + `lint:check` on push; never bypass it.

**One branch / PR per feature phase.** Native review takes the whole branch diff against its base; an
accumulated branch exceeds the reviewer's context budget. Keep each phase under ~400 authored changed lines
and review per branch before starting the next phase.

Safety note: uncommitted work lives in the worktree and survives a killed session. The parent commits
promptly after each worker returns and never runs `git checkout`/`git clean` while a worker is mid-flight.

## 3. Verification budget

At most TWO verification attempts per task, always on isolated state. Then commit what is green and report
exactly what stayed unverified. Do not write ad-hoc probe or soak scripts — use the sanctioned checks
(`npx tsc --noEmit`, `npm run build`, `npm run lint:check`, `make check-docs`, and tests once they exist).

## 4. Liveness rule (parent)

If a delegated agent has ~40 turns with no file write, CANCEL and re-scope with evidence. Ask the agent for
its blocker instead of polling it repeatedly.

## 5. Review findings

The native review (RDD) owns severity and stop rules; this repo adds no severity semantics of its own.
Non-blocking findings are recorded in the feature doc as follow-ups and never trigger another fix cycle —
advisory-driven iteration never terminates.

## 6. Worktree/HEAD checks

Before accepting a delegated report, run:

```
git log --oneline -1
git status -s
```

Verify the commit landed on the intended branch and the tree contains only the expected changes. Commits
landing on a detached HEAD or in the wrong order have happened before.

## 7. Host gotchas (Pi / gentle-pi)

- When a review stops, run the recovery command that STATUS returns; do not diagnose the stop by hand.
- Fix managed-asset staleness by running the bundle's `gentle-ai sync --agent pi`, not the workspace's.
- `gentle-pi`'s version is pinned in `~/.pi/agent/settings.json` (`packages`), not in this repo's
  `package.json`; never add it as a dependency here.

## 8. Handoff

The feature doc (`odd/tasks/<feature>.md`) is the verbatim spec and the resume point. Keep it current: state,
commit id per task, and known debts. A restart must be cheap — the next session resumes from the doc, not from
memory. Closed feature docs move to `odd/archive/`.
