#!/usr/bin/env bash
# Concatenates the migrations into one file for the Supabase SQL Editor
# (deploy without the CLI). Re-run after adding a migration.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/supabase/deploy/schema.sql"
{
  echo "-- SuperLega — schema completo per Supabase (generato da supabase/migrations/*)."
  echo "-- Incollare nella dashboard: SQL Editor > New query > Run. Eseguire UNA volta sola."
  echo "-- Rigenerare con: scripts/build-deploy-sql.sh"
  echo
  for m in "$ROOT"/supabase/migrations/*.sql; do
    echo "-- ===== $(basename "$m") ====="
    cat "$m"
    echo
  done
} > "$OUT"
echo "written $OUT ($(wc -l < "$OUT") lines)"
