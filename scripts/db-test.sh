#!/usr/bin/env bash
# Rebuilds a throwaway database on a local PostgreSQL and runs the SQL tests.
#
#   scripts/db-test.sh            # uses PG_SUPERUSER_CMD (default: "su postgres -c")
#   PGDATABASE=x scripts/db-test.sh
#
# Each tests/db/*.test.sql file runs inside a transaction that is rolled back.
# Tests fail the run by raising an exception (see tests/db/README.md).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="${PGDATABASE:-superlega_test}"
RUN="${PG_SUPERUSER_CMD:-su postgres -c}"

psql_db() { $RUN "psql -v ON_ERROR_STOP=1 -q -d $DB $*"; }

$RUN "psql -v ON_ERROR_STOP=1 -q -c 'drop database if exists $DB;' -c 'create database $DB;'"
psql_db -f "$ROOT/tests/db/auth-stub.sql"

for m in "$ROOT"/supabase/migrations/*.sql; do
  echo "migration: $(basename "$m")"
  psql_db -f "$m"
done
psql_db -f "$ROOT/supabase/seed.sql"
for s in "$ROOT"/supabase/seed/*.sql; do [ -e "$s" ] && psql_db -f "$s"; done

status=0
for t in "$ROOT"/tests/db/*.test.sql; do
  [ -e "$t" ] || continue
  # Each test runs inside a transaction that is always rolled back.
  if { echo 'begin;'; cat "$t"; echo 'rollback;'; } | $RUN "psql -v ON_ERROR_STOP=1 -q -d $DB" >/dev/null; then
    echo "PASS $(basename "$t")"
  else
    echo "FAIL $(basename "$t")"
    status=1
  fi
done
# Node-driven tests (real parallel connections) when a connection URL is available.
if [ -n "${DATABASE_URL:-}" ] && command -v npx >/dev/null 2>&1; then
  if (cd "$ROOT" && npx vitest run tests/db --reporter=dot); then
    echo "PASS concurrency.test.ts"
  else
    echo "FAIL concurrency.test.ts"
    status=1
  fi
fi
exit $status
