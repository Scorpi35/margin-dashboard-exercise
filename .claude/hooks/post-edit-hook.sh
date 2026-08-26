#!/usr/bin/env bash
set -uo pipefail

# Every workspace with its own ESLint config and tsconfig. A file outside all of
# them runs no project toolchain — there is no config at the repo root.
WORKSPACES=(frontend backend shared)

# Read the hook's JSON payload from stdin once
INPUT=$(cat)

# Extract the file path Claude just wrote/edited.
# Works for Write, Edit, and MultiEdit tool calls.
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
 
# Nothing to do if we didn't get a path, or the file no longer exists
# (e.g. it was deleted, or this was a non-file tool call)
if [[ -z "$FILE_PATH" || ! -f "$FILE_PATH" ]]; then
  exit 0
fi

# Only act on source files we care about
case "$FILE_PATH" in
  *.js|*.jsx|*.ts|*.tsx) ;;
  *) exit 0 ;;
esac
 
echo "🔧 Running post-edit checks on: $FILE_PATH" >&2

# Figure out which workspace this file belongs to, so we run that project's own
# ESLint config and tsconfig rather than looking for one at the repo root.
PROJECT_DIR=""
for WORKSPACE in "${WORKSPACES[@]}"; do
  if [[ "$FILE_PATH" == "$WORKSPACE"/* || "$FILE_PATH" == ./"$WORKSPACE"/* ]]; then
    PROJECT_DIR="$WORKSPACE"
    break
  fi
done

# A source file outside every workspace has no toolchain to run. Formatting still
# applies, so fall through to Prettier with the linting and type-checking skipped
# rather than reporting a missing config as a failure.
SKIP_PROJECT_TOOLS=0
if [[ -z "$PROJECT_DIR" ]]; then
  PROJECT_DIR="."
  SKIP_PROJECT_TOOLS=1
fi

# npm workspaces hoist dev tooling to the repo root, so a binary is almost never
# under frontend/ or backend/. Look in the sub-project first (in case it pins its
# own copy), then fall back to the root. Prints nothing when the tool is absent,
# which the callers treat as "skip this step" rather than a failure.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
resolve_bin() {
  local name="$1"
  if [[ -x "$PROJECT_DIR/node_modules/.bin/$name" ]]; then
    echo "$PROJECT_DIR/node_modules/.bin/$name"
  elif [[ -x "$REPO_ROOT/node_modules/.bin/$name" ]]; then
    echo "$REPO_ROOT/node_modules/.bin/$name"
  fi
}

# Collect any warnings so we can report them to Claude at the end
WARNINGS=""
 
# ---- 1. Prettier: format the file in place ---------------------------------
# Config comes from .prettierrc.json at the repo root; .prettierignore is honoured.
PRETTIER_BIN="$(resolve_bin prettier)"
if [[ -n "$PRETTIER_BIN" ]]; then
  if ! "$PRETTIER_BIN" --write "$FILE_PATH" >/dev/null 2>/tmp/prettier_err.log; then
    WARNINGS+="Prettier failed on $FILE_PATH:
$(cat /tmp/prettier_err.log)

"
  fi
fi

# ---- 2. ESLint: lint + autofix ---------------------------------------------
# Run from the sub-project so its own eslint config (and Next's plugin
# resolution) applies, with a path relative to that directory.
ESLINT_BIN="$(resolve_bin eslint)"
if [[ -n "$ESLINT_BIN" && "$SKIP_PROJECT_TOOLS" -eq 0 ]]; then
  ESLINT_BIN="$(cd "$(dirname "$ESLINT_BIN")" && pwd)/$(basename "$ESLINT_BIN")"
  if ! (cd "$PROJECT_DIR" && "$ESLINT_BIN" --fix "${FILE_PATH#"$PROJECT_DIR"/}") >/tmp/eslint_err.log 2>&1; then
    WARNINGS+="ESLint found issues in $FILE_PATH:
$(cat /tmp/eslint_err.log)

"
  fi
fi

# ---- 3. TypeScript: type-check the project (only if it's a TS project) ----
if [[ -f "$PROJECT_DIR/tsconfig.json" && "$SKIP_PROJECT_TOOLS" -eq 0 ]]; then
  TSC_BIN="$(resolve_bin tsc)"
  if [[ -n "$TSC_BIN" ]]; then
    TSC_BIN="$(cd "$(dirname "$TSC_BIN")" && pwd)/$(basename "$TSC_BIN")"
    if ! (cd "$PROJECT_DIR" && "$TSC_BIN" --noEmit) >/tmp/tsc_err.log 2>&1; then
      WARNINGS+="TypeScript errors in $PROJECT_DIR:
$(cat /tmp/tsc_err.log)

"
    fi
  fi
fi
 
rm -f /tmp/prettier_err.log /tmp/eslint_err.log /tmp/tsc_err.log

# ---- Report back to Claude ---------------------------------------------
# Exit 2 on a PostToolUse hook doesn't undo the edit (it already happened),
# but it does surface stderr to Claude so it can see and fix the problem.
if [[ -n "$WARNINGS" ]]; then
  echo "$WARNINGS" >&2
  exit 2
fi
 
exit 0
