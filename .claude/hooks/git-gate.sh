#!/usr/bin/env bash
# Claude Code PreToolUse hook (Bash matcher).
# Denies git commit/push/merge/rebase when:
#   - the command uses --no-verify (bypasses Husky hooks), or
#   - `npx tsc --noEmit` fails, or
#   - ESLint fails on the staged (commit), unpushed (push) or uncommitted (merge/rebase) .ts/.js
#     files under src/; push with no upstream/origin/main base checks all of src/,
#   - or the toolchain (node_modules/.bin/tsc, eslint) is missing: run `npm ci`.
# Fails closed: unparseable input that looks like a git write, or a failing git diff, is
# blocked or escalated to a full check instead of passing.
# Emits a PreToolUse deny decision as JSON; otherwise exits 0 silently.

set -o pipefail

INPUT=$(cat)
# Parse the tool input with jq, falling back to node (always present in this repo). If neither
# can parse it, fail closed: an unparsed command must never be allowed through silently.
if command -v jq >/dev/null 2>&1; then
  CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null) || CMD_PARSE_FAILED=1
elif command -v node >/dev/null 2>&1; then
  CMD=$(printf '%s' "$INPUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{process.stdout.write(String((JSON.parse(s).tool_input||{}).command||""))})' 2>/dev/null) || CMD_PARSE_FAILED=1
else
  CMD_PARSE_FAILED=1
fi
if [ -n "$CMD_PARSE_FAILED" ]; then
  # Only block unparsed input that looks like a git write; other commands are not gated.
  if printf '%s' "$INPUT" | grep -qE 'git[^a-z].*(commit|push|merge|rebase)'; then
    printf '%s\n' "Git gate: could not parse the tool input (install jq or node). Git write blocked." >&2
    exit 2
  fi
  exit 0
fi

GIT_WRITE='(^|[[:space:]&|;(])git([[:space:]]+-[^[:space:]]+)*[[:space:]]+(commit|push|merge|rebase)([[:space:]]|$)'
if ! printf '%s' "$CMD" | grep -qE "$GIT_WRITE"; then
  exit 0
fi

deny() {
  local reason=$1
  if command -v jq >/dev/null 2>&1; then
    jq -n --arg reason "$reason" \
      '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":$reason}}'
  else
    # Fallback: exit code 2 blocks the tool call and shows stderr to the model.
    printf '%s\n' "$reason" >&2
    exit 2
  fi
  exit 0
}

# Quoted strings (commit messages, echo text) are stripped before matching flags, so
# `git commit -m "fix -n parsing --no-verify"` is not mistaken for a bypass.
STRIPPED=$(printf '%s' "$CMD" | sed -E "s/\"([^\"\\\\]|\\\\.)*\"//g; s/'[^']*'//g")
if ! printf '%s' "$STRIPPED" | grep -qE "$GIT_WRITE"; then
  exit 0
fi

# --no-verify on any git write, or `-n` (alone or in a short-flag cluster) on `git commit` only.
GIT_COMMIT='git([[:space:]]+-[^[:space:]]+)*[[:space:]]+commit'
if printf '%s' "$STRIPPED" | grep -qE -- '(^|[[:space:]])--no-verify([[:space:]=]|$)' \
  || printf '%s' "$STRIPPED" | grep -qE -- "${GIT_COMMIT}[^|;&]*[[:space:]]-[[:alpha:]]*n[[:alpha:]]*([[:space:]]|\$)"; then
  deny "Git gate: --no-verify is not allowed. Fix the failing Husky hooks instead of bypassing them."
fi

ROOT=${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}
[ -n "$ROOT" ] || exit 0
cd "$ROOT" || exit 0

# FULL=1 checks the whole project (tsc + eslint on src/) instead of the changed files only.
FULL=0
if printf '%s' "$STRIPPED" | grep -qE 'git([[:space:]]+-[^[:space:]]+)*[[:space:]]+push'; then
  BASE=$(git rev-parse --abbrev-ref '@{u}' 2>/dev/null)
  if [ -z "$BASE" ] && git rev-parse --verify --quiet origin/main >/dev/null; then
    BASE=origin/main
  fi
  if [ -n "$BASE" ]; then
    # A failing diff (e.g. no merge base) falls back to a full check instead of passing.
    FILES=$(git diff --name-only --diff-filter=d "$BASE"...HEAD 2>/dev/null) || FULL=1
  else
    # No base ref to diff against: fail closed with a full check instead of passing.
    FULL=1
  fi
elif printf '%s' "$STRIPPED" | grep -qE "${GIT_COMMIT}([[:space:]]|\$)"; then
  FILES=$(git diff --cached --name-only --diff-filter=d 2>/dev/null) || FULL=1
else
  # merge/rebase: the incoming commits already passed their own gates; check that the local
  # working tree (staged + unstaged src/ changes vs HEAD) is not broken before rewriting history.
  FILES=$(git diff HEAD --name-only --diff-filter=d 2>/dev/null) || FULL=1
fi

if [ "$FULL" -eq 1 ]; then
  CODE_FILES=src
else
  CODE_FILES=$(printf '%s\n' "$FILES" | grep -E '^src/.*\.(ts|js)$' || true)
  [ -n "$CODE_FILES" ] || exit 0
fi

if [ ! -x node_modules/.bin/tsc ] || [ ! -x node_modules/.bin/eslint ]; then
  deny "Git gate: BLOCKED because the local toolchain is missing (node_modules/.bin/tsc or eslint not found). Run \`npm ci\` in ${ROOT} and retry."
fi

FAILURES=""

TSC=$(node_modules/.bin/tsc --noEmit 2>&1)
if [ $? -ne 0 ]; then
  FAILURES="${FAILURES}--- TypeScript (tsc --noEmit) ---
${TSC}

"
fi

LINT=$(printf '%s\n' "$CODE_FILES" | xargs node_modules/.bin/eslint 2>&1)
if [ $? -ne 0 ]; then
  FAILURES="${FAILURES}--- ESLint ---
${LINT}

"
fi

if [ -n "$FAILURES" ]; then
  deny "Git gate: commit/push/merge/rebase BLOCKED by errors in changed files.

Fix the errors below and retry.

${FAILURES}"
fi

exit 0
