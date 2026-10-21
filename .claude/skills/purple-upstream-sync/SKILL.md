---
name: purple-upstream-sync
description: >
  Procedure to backport fixes from upstream Evolution API into evolution-in-purple by
  cherry-pick, with provenance, conflict resolution, build verification and a denylist of
  upstream changes that must never be imported (license activation, telemetry, EvoHub,
  mass dependency bumps).
  Trigger: backport, cherry-pick, upstream fix, "sync with upstream", porting an Evolution API PR or commit.
---

# Skill: purple-upstream-sync

Base: tag `2.3.7` (`cd800f29 Merge branch 'release/2.3.7'`). The fork does **not** merge or
rebase onto upstream; it imports selected commits only.

## Remote

```bash
git remote -v   # upstream must exist
# if missing or pointing elsewhere (e.g. the old EvolutionAPI org):
git remote add upstream https://github.com/evolution-foundation/evolution-api.git \
  || git remote set-url upstream https://github.com/evolution-foundation/evolution-api.git
git fetch upstream --tags
```

`upstream` must point to `https://github.com/evolution-foundation/evolution-api.git`
(`EvolutionAPI/evolution-api` is the old org name and only redirects). Never push to upstream.

## Procedure (one backport = one branch = one PR)

1. Identify the source: upstream PR number and commit sha(s). `git log upstream/main --oneline`
   or `gh pr view <n> --repo evolution-foundation/evolution-api`.
2. Check the denylist below. If the commit touches any denylisted area, stop and ask.
3. Branch from `main`: `git switch -c backport/<short-slug>`.
4. Cherry-pick with provenance:
   - normal commit: `git cherry-pick -x <sha>`
   - merge commit: `git cherry-pick -x -m 1 <merge-sha>`
5. Resolve conflicts preserving fork behavior (contract, `@lid` rules). Prefer the minimal
   hunk; drop unrelated upstream refactors.
6. Amend the message body (keep the `(cherry picked from commit ...)` trailer) with:
   ```
   Upstream: evolution-foundation/evolution-api#<PR> (<sha>)
   Conflicts: <files and how resolved | none>
   ```
7. Verify: `npx tsc --noEmit`, `npm run build`, `npm run lint:check`; manual run if it touches
   Baileys (`purple-baileys`).
8. If the change alters routes or payloads, follow `purple-contract` before opening the PR.
9. Add a `CHANGELOG.md` line under the `evolution-in-purple` section (see `purple-release`).
10. Push / open PR only with explicit user approval.

## Denylist (never import)

| Upstream change | Reason |
|---|---|
| License activation — PR #2530, commit `3fb04ed6` | Phones home / gates features |
| Telemetry additions or expansions (`src/utils/sendTelemetry.ts` call sites) | Data leaves the deployment |
| EvoHub — PRs #2577, #2636 | Upstream SaaS coupling |
| Mass dependency bump — PR #2575 | Unreviewable; bump deps individually instead |

A commit that mixes a wanted fix with a denylisted area: port the fix by hand, cite the source
sha in the body as `Adapted-from:` instead of `-x`.

## Conflict hot spots

`src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts`, `package.json` /
`package-lock.json` (Baileys pin `package.json:80`), the three `prisma/*-schema.prisma` files
and provider migrations. For lockfile conflicts, take ours and re-run the install only with user
approval.
