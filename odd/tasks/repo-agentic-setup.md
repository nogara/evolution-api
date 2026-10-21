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

- [x] T1 Core docs — 901c00df
- [x] T2 Skills — 453773b2, c2aa1dd5
- [x] T3 Tooling/CI — f2718917
- [x] T4 Integrate and verify — merge f81c78e0

## Acceptance criteria

- `AGENTS.md` is the single source; `CLAUDE.md` only points to it.
- Every skill has valid frontmatter with a `Trigger:` line and is listed in `AGENTS.md`.
- `make check-docs` passes; `npm run build` and `npm run lint:check` unaffected.
- Hooks use repo-relative paths only.

## Evidence

- `bash scripts/check-docs.sh` → `check-docs: OK` after integration.
- `npm run build` / `lint:check` not run: no `src/` changes and `node_modules` not installed.
- Engram mirror `odd/repo-agentic-setup/tasks` failed (server requires upgrade).

## Follow-ups

- canal-whatsapp calls `GET /group/findGroupByJid`, which does not exist in 2.3.7 (see purple-contract consumer matrix).
- Confirm whether `/instance/create` honors the `webhook` field (orbit relies on it; canal comment says it does not).
- Locate where stenfar registers its webhook.
- Decide whether to delete disabled upstream publish workflows and `check_code_quality.yml`; update `.husky/README.md`.
