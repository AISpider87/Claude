#!/usr/bin/env bash
# Rebuilds the cumulative update bundle (supabase/deploy/updates/*.sql) from the
# migrations that come after the ones the admin has already run, so the file the
# admin pastes into the SQL Editor never drifts from supabase/migrations/.
# Re-run after adding a migration. Every statement must stay idempotent: the
# admin pastes the same file again after each release.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/supabase/deploy/updates/2026-09-10-market-v2.sql"
# First migration in the bundle (everything before it is in schema.sql).
FROM="20260909200000"
{
  head -4 "$OUT"
  for m in "$ROOT"/supabase/migrations/*.sql; do
    name="$(basename "$m")"
    [[ "${name%%_*}" < "$FROM" ]] && continue
    echo "-- ===== $name ====="
    cat "$m"
    echo
  done
} > "$OUT.tmp"
mv "$OUT.tmp" "$OUT"
echo "written $OUT ($(wc -l < "$OUT") lines)"
