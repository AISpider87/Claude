#!/usr/bin/env bash
# PreToolUse hook: before any `git commit`, run the fast checks (lint + typecheck).
# Full tests run in CI. Exit 2 blocks the commit and feeds stderr back to Claude.
set -uo pipefail

input="$(cat)"
command=$(printf '%s' "$input" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("command",""))' 2>/dev/null || true)

case "$command" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac

# Nothing to check until the app scaffold exists (M1).
[ -f package.json ] || exit 0

fail=0
if grep -q '"lint"' package.json; then
  npm run -s lint || { echo "Lint failed — fix before committing." >&2; fail=1; }
fi
if grep -q '"typecheck"' package.json; then
  npm run -s typecheck || { echo "Typecheck failed — fix before committing." >&2; fail=1; }
fi

[ "$fail" -eq 0 ] || exit 2
exit 0
