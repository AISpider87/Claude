#!/usr/bin/env bash
# Full logical backup of the SuperLega database (schema + data) as plain SQL.
#   DATABASE_URL=postgresql://... scripts/backup.sh [output-dir]
# DATABASE_URL is the Supabase "Connection string" (Settings > Database, use the
# session pooler on IPv4 networks). Requires pg_dump 15+ on the machine.
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL to the Supabase connection string}"
OUT="${1:-backups}"
mkdir -p "$OUT"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
FILE="$OUT/superlega-$STAMP.sql"
pg_dump "$DATABASE_URL" \
  --schema=public --schema=private \
  --no-owner --no-privileges --format=plain \
  --file="$FILE"
gzip -f "$FILE"
echo "backup written: $FILE.gz"
echo "restore (into an EMPTY database): gunzip -c $FILE.gz | psql \"\$DATABASE_URL\""
