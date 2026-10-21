# Feature: repo-agentic-setup — agentic development setup for evolution-in-purple

## Objective

Organize `purple-dice/evolution-in-purple` (fork of Evolution API 2.3.7) for
agentic development following the orbit conventions, adapted to a single
TypeScript repo. This engine will replace Evolution API in three consumers:
orbit, canal-whatsapp (alien) and stenfar.

## Scope

- Canonical `AGENTS.md` (index + hard rules), `CLAUDE.md` as `@AGENTS.md` pointer.
- `odd/agent-protocol.md`, `odd/tasks/`, `odd/archive/`.
- Project skills in `.claude/skills/purple-*`, shared with Pi via `.pi/settings.json`.
- Automated gates: prettier hook, git-gate (relative paths), check-docs,
  integrated with the existing Husky hooks (not a second hook system).
- CI: PR checks (tsc, build, lint, check-docs); image publish adapted to the fork.
- Own `VERSION` + `CHANGELOG.md` section, separated from upstream history.

## Non-goals

- No source (`src/`) changes. No upstream backports (separate feature).
- No OpenSpec, no gga (can be added later pointing at `AGENTS.md`).
- No removal of telemetry/license yet (separate feature).

## Parallel plan (isolated worktrees, disjoint surfaces, parent commits)

| Task | Surface | Worktree branch |
|---|---|---|
| T1 Core docs | `AGENTS.md`, `CLAUDE.md`, `odd/agent-protocol.md`, `odd/archive/.gitkeep` | `agentic/t1-docs` |
| T2 Skills | `.claude/skills/purple-*/**`, `.pi/settings.json`, `.pi/subagents.json` | `agentic/t2-skills` |
| T3 Tooling/CI | `.claude/settings.json`, `.claude/hooks/**`, `.husky/**`, `Makefile`, `scripts/check-docs.sh`, `.github/workflows/**`, `VERSION`, `CHANGELOG.md` | `agentic/t3-tooling` |
| T4 Integrate | merge T1–T3 into `chore/agentic-setup`, cross-check links, run checks | `chore/agentic-setup` |

## Checklist

- [ ] T1 Core docs
- [ ] T2 Skills
- [ ] T3 Tooling/CI
- [ ] T4 Integrate and verify

## Acceptance criteria

- `AGENTS.md` is the single source; `CLAUDE.md` only points to it.
- Every skill has valid frontmatter with a `Trigger:` line and is listed in `AGENTS.md`.
- `make check-docs` passes; `npm run build` and `npm run lint:check` unaffected.
- Hooks use repo-relative paths only.

## Evidence

(commit ids recorded per task)
