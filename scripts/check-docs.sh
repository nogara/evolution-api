#!/usr/bin/env bash
# Docs drift guard. Usage: scripts/check-docs.sh [root]
#
# Rules (one `file:line: reason` per violation; exit 1 when any is found):
#   a) CLAUDE.md is a pointer to AGENTS.md (references AGENTS.md, at most 20 lines)
#   b) every .claude/skills/*/SKILL.md has frontmatter with `name:` and a
#      `description:` containing `Trigger:`
#   c) every .claude/skills/<dir> name appears in AGENTS.md
#   d) relative markdown links in AGENTS.md, odd/agent-protocol.md and
#      .claude/skills/**/*.md resolve (http(s)/mailto/anchors are skipped)
# Run via `make check-docs`; also invoked by .husky/pre-commit and CI.
set -euo pipefail

root=${1:-$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)}
cd "$root"

violations=$(mktemp)
trap 'rm -f "$violations"' EXIT
report() { echo "$1" >>"$violations"; }

# --- a) CLAUDE.md pointer ---------------------------------------------------
if [[ ! -f AGENTS.md ]]; then
  report "AGENTS.md:0: missing (canonical agent guide)"
fi
if [[ ! -f CLAUDE.md ]]; then
  report "CLAUDE.md:0: missing (must be a pointer to AGENTS.md)"
else
  grep -q 'AGENTS\.md' CLAUDE.md || report "CLAUDE.md:1: does not reference AGENTS.md"
  lines=$(wc -l <CLAUDE.md | tr -d ' ')
  ((lines <= 20)) || report "CLAUDE.md:1: $lines lines; must be a short pointer to AGENTS.md (<= 20 lines)"
fi

# --- b) + c) skills ---------------------------------------------------------
for skill in .claude/skills/*/SKILL.md; do
  [[ -f $skill ]] || continue
  dir=$(basename "$(dirname "$skill")")
  if [[ $(head -n 1 "$skill") != "---" ]]; then
    report "$skill:1: missing frontmatter"
  else
    front=$(awk 'NR == 1 { next } /^---$/ { exit } { print }' "$skill")
    grep -qE '^name:[[:space:]]*[^[:space:]]' <<<"$front" || report "$skill:1: frontmatter has no 'name:'"
    grep -qE '^description:' <<<"$front" || report "$skill:1: frontmatter has no 'description:'"
    # description may be a multi-line block; Trigger: must appear in the frontmatter
    grep -q 'Trigger:' <<<"$front" || report "$skill:1: description has no 'Trigger:'"
  fi
  if [[ -f AGENTS.md ]] && ! grep -qF "$dir" AGENTS.md; then
    report "AGENTS.md:0: skill '$dir' (.claude/skills/$dir) is not listed"
  fi
done

# --- d) relative markdown links --------------------------------------------
docs=()
[[ -f AGENTS.md ]] && docs+=(AGENTS.md)
[[ -f odd/agent-protocol.md ]] && docs+=(odd/agent-protocol.md)
if [[ -d .claude/skills ]]; then
  while IFS= read -r f; do docs+=("$f"); done < <(find .claude/skills -name '*.md' -type f | sort)
fi

for f in "${docs[@]+"${docs[@]}"}"; do
  base=$(dirname "$f")
  grep -noE '\]\([^)]+\)' "$f" 2>/dev/null |
    while IFS=: read -r line link; do
      target=${link#](}
      target=${target%)}
      target=${target%% *} # drop optional "title"
      target=${target%%#*} # drop anchors
      case $target in
      '' | http://* | https://* | mailto:*) continue ;;
      /*) path=.$target ;;
      *) path=$base/$target ;;
      esac
      [[ -e $path ]] || report "$f:$line: broken link '$target'"
    done || true
done

if [[ -s $violations ]]; then
  cat "$violations"
  echo "check-docs: $(wc -l <"$violations" | tr -d ' ') violation(s)" >&2
  exit 1
fi
echo "check-docs: OK"
