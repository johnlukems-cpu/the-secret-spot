#!/usr/bin/env bash
# Creates a fresh test database, applies the Supabase shim, all migrations and seed.
# Usage: DB_SUPERUSER_URL=postgres://postgres@localhost:5432/postgres bash scripts/db-test-setup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
SUPER_URL="${DB_SUPERUSER_URL:-postgres:///postgres}"
DB="${TEST_DB_NAME:-tss_test}"
psql "$SUPER_URL" -v ON_ERROR_STOP=1 -q -c "drop database if exists $DB with (force)" -c "create database $DB"
TEST_URL="${SUPER_URL%/*}/$DB"
psql "$TEST_URL" -v ON_ERROR_STOP=1 -q -f scripts/supabase-shim.sql
for f in supabase/migrations/*.sql; do
  echo "applying $f"
  psql "$TEST_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done
psql "$TEST_URL" -v ON_ERROR_STOP=1 -q -f supabase/seed.sql
echo "test database $DB ready"
