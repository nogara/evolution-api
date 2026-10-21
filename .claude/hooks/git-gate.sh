#!/usr/bin/env bash
# Claude Code PreToolUse hook (Bash matcher).
# Denies git commit/push/merge/rebase when:
#   - the command uses --no-verify (bypasses Husky hooks), or
#   - `npx tsc --noEmit` fails, or
#   - ESLint fails on the staged (commit) or unpushed (push) .ts/.js files under src/.
# Emits a PreToolUse deny decision as JSON; otherwise exits 0 silently.

set -o pipefail

INPUT=$(cat)
if command -v jq >/dev/null 2>&1; then
  CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
else
  CMD=$INPUT
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

# --no-verify anywhere, or the `git commit -n` short form.
if printf '%s' "$CMD" | grep -qE -- '--no-verify|git[[:space:]]+commit[^|;&]*[[:space:]]-n([[:space:]]|$)'; then
  deny "Git gate: --no-verify is not allowed. Fix the failing Husky hooks instead of bypassing them."
fi

ROOT=${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}
[ -n "$ROOT" ] || exit 0
cd "$ROOT" || exit 0

if printf '%s' "$CMD" | grep -qE 'git([[:space:]]+-[^[:space:]]+)*[[:space:]]+push'; then
  UPSTREAM=$(git rev-parse --abbrev-ref '@{u}' 2>/dev/null)
  if [ -n "$UPSTREAM" ]; then
    FILES=$(git diff --name-only --diff-filter=d "$UPSTREAM"...HEAD 2>/dev/null)
  else
    FILES=$(git diff --name-only --diff-filter=d origin/main...HEAD 2>/dev/null)
  fi
else
  FILES=$(git diff --cached --name-only --diff-filter=d 2>/dev/null)
fi

CODE_FILES=$(printf '%s\n' "$FILES" | grep -E '^src/.*\.(ts|js)$' || true)
[ -n "$CODE_FILES" ] || exit 0

FAILURES=""

TSC=$(npx --no tsc --noEmit 2>&1)
if [ $? -ne 0 ]; then
  FAILURES="${FAILURES}--- TypeScript (tsc --noEmit) ---
${TSC}

"
fi

LINT=$(printf '%s\n' "$CODE_FILES" | xargs npx --no eslint 2>&1)
if [ $? -ne 0 ]; then
  FAILURES="${FAILURES}--- ESLint (changed files) ---
${LINT}

"
fi

if [ -n "$FAILURES" ]; then
  deny "Git gate: commit/push/merge/rebase BLOCKED by errors in changed files.

Fix the errors below and retry.

${FAILURES}"
fi

exit 0
