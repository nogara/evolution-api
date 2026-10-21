---
name: purple-release
description: >
  Release procedure for evolution-in-purple: fork SemVer independent of upstream (VERSION file,
  git tag vX.Y.Z, GHCR image), CHANGELOG.md layout with an evolution-in-purple section above
  the upstream history, and the approval gates for push / PR / release / deploy.
  Trigger: release, version bump, tag, changelog entry, publishing the Docker image, deploy.
---

# Skill: purple-release

## Versioning

- The fork has its **own SemVer**, independent of upstream (`package.json` keeps the upstream
  `2.3.7` lineage; do not use it as the fork version).
- Source of truth: `VERSION` file at repo root, single line `X.Y.Z`. First release `0.1.0`.
- Git tag: `vX.Y.Z` (annotated), must equal `VERSION`. Upstream tags look like `2.3.7` (no `v`) —
  never create or move those.
- Image: `ghcr.io/purple-dice/evolution-in-purple:X.Y.Z` (plus `latest` only for the newest
  release). The upstream workflows under `.github/workflows/publish_docker_image*.yml` push to
  `evoapicloud/evolution-api`; the fork publish workflow is owned by tooling, not by this skill.

### Bump rules (pre-1.0)

| Change | Bump |
|---|---|
| Breaking contract change (see `purple-contract`) | MINOR (`0.x` → `0.(x+1).0`) |
| Feature / backport adding behavior | MINOR |
| Fix only | PATCH |

After `1.0.0`, standard SemVer (breaking ⇒ MAJOR).

## CHANGELOG.md layout

```markdown
# evolution-in-purple

## X.Y.Z (YYYY-MM-DD)

### Breaking
- <change> — consumers affected: orbit | canal-whatsapp | stenfar; migration: <note>

### Features / Fixes / Backports
- <change> (upstream EvolutionAPI/evolution-api#<PR>, <sha>) when backported

---

# 2.3.7 (2025-12-05)   ← upstream history, untouched below
```

The upstream history (currently starting at `CHANGELOG.md:1` with `# 2.3.7 (2025-12-05)`) is
never edited.

## Procedure

1. Ensure `main` is clean and green: `npx tsc --noEmit`, `npm run build`, `npm run lint:check`.
2. Decide the next version from the bump rules; list the changes since the last `v*` tag:
   `git log --oneline $(git describe --tags --match 'v*' --abbrev=0)..HEAD`
   (first release: since `2.3.7`).
3. Update `VERSION` and the `evolution-in-purple` section of `CHANGELOG.md` on a
   `release/vX.Y.Z` branch. Any `Breaking` entry requires a completed consumer check.
4. **Ask the user** before: pushing the branch, opening the PR, merging, creating/pushing the
   tag, publishing the image, deploying. Each is a separate approval.
5. After merge (approved): `git tag -a vX.Y.Z -m "evolution-in-purple vX.Y.Z"` on the merge
   commit, push the tag (approved), let CI publish the image.
6. Verify the image tag exists in GHCR and report it. Consumers switch versions in their own
   repos — never edit them from here.

## Invariants

- `VERSION` == latest `v*` tag == image tag.
- One release per tag; never re-tag. Fix forward with a PATCH.
- No push, PR, release or deploy without explicit user approval in the current conversation.
