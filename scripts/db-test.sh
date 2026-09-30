#!/usr/bin/env bash
# Database test gate (Development Plan §5.3 gates 4–5; ADR 0002 Verification 1–3a).
#
# Creates a throwaway database, applies the TEST-ONLY Supabase shim, then (gate 4) applies every
# migration in order (each in its own transaction), applies every rollback in reverse order and checks
# the schemas are gone, applies the migrations again (up → down → up, migration-conventions.md §6),
# and finally runs supabase/tests/NN_*.sql. Each test file declares its connection on line 1:
#   -- db-test: run-as=owner       the superuser/owner connection
#   -- db-test: run-as=app_server  connected as login role app_server (session_user = app_server)
#   -- db-test: run-as=app_worker  connected as login role app_worker
# Exits non-zero on the first failure. Drops the database and clears test passwords on exit.
#
# Connection: standard libpq variables (PGHOST, PGPORT, PGUSER = a superuser, PGPASSWORD).
# Options (env): DB_TEST_KEEP=1 keeps the database; DB_TEST_INTEGRATION=1 also runs the TypeScript
# integration tests (pnpm test:integration) against it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="$ROOT/supabase/migrations"
TESTS_DIR="$ROOT/supabase/tests"
SHIM="$TESTS_DIR/_shim/supabase_shim.sql"

export PGHOST="${PGHOST:-127.0.0.1}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGDATABASE=postgres
# Keep output focused on test results (idempotent GRANTs emit NOTICEs).
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"

DB="jadarat_test_$(date +%s)_$$"
# Test-only passwords for the login roles, generated per run and cleared on exit (never in migrations).
APP_SERVER_PW="test-$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
APP_WORKER_PW="test-$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"

PSQL=(psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -o /dev/null)

cleanup() {
  local status=$?
  "${PSQL[@]}" -d postgres -c "do \$\$ begin
      if exists (select 1 from pg_roles where rolname = 'app_server') then execute 'alter role app_server password null'; end if;
      if exists (select 1 from pg_roles where rolname = 'app_worker') then execute 'alter role app_worker password null'; end if;
    end \$\$;" >/dev/null 2>&1 || true
  if [[ "${DB_TEST_KEEP:-0}" != "1" ]]; then
    dropdb --if-exists "$DB" >/dev/null 2>&1 || true
  else
    echo "db-test: kept database $DB"
  fi
  if [[ $status -eq 0 ]]; then echo "db-test: PASSED"; else echo "db-test: FAILED (exit $status)" >&2; fi
}
trap cleanup EXIT

echo "db-test: server $(psql -X -At -c 'show server_version') at $PGHOST:$PGPORT, database $DB"
createdb "$DB"

echo "db-test: applying test-only Supabase shim"
"${PSQL[@]}" -d "$DB" -f "$SHIM"

shopt -s nullglob
migrations=("$MIGRATIONS_DIR"/*.sql)
if [[ ${#migrations[@]} -eq 0 ]]; then echo "db-test: no migrations found" >&2; exit 1; fi
ROLLBACKS_DIR="$ROOT/supabase/rollbacks"
migrate_up() {
  for migration in "${migrations[@]}"; do
    echo "db-test: up   $(basename "$migration")"
    "${PSQL[@]}" -d "$DB" --single-transaction -f "$migration"
  done
}
migrate_down() {
  for (( i=${#migrations[@]}-1; i>=0; i-- )); do
    local name rollback
    name="$(basename "${migrations[$i]}")"
    rollback="$ROLLBACKS_DIR/$name"
    if [[ ! -f "$rollback" ]]; then echo "db-test: missing rollback supabase/rollbacks/$name" >&2; exit 1; fi
    echo "db-test: down $name"
    "${PSQL[@]}" -d "$DB" --single-transaction -f "$rollback"
  done
}

migrate_up
migrate_down
leftover="$(psql -X -At -d "$DB" -c "select string_agg(nspname, ',') from pg_namespace where nspname in ('platform','tms','private')")"
if [[ -n "$leftover" ]]; then echo "db-test: rollbacks left schemas behind: $leftover" >&2; exit 1; fi
migrate_up

"${PSQL[@]}" -d "$DB" -c "alter role app_server password '$APP_SERVER_PW'; alter role app_worker password '$APP_WORKER_PW';"

for test_file in "$TESTS_DIR"/[0-9]*.sql; do
  name="$(basename "$test_file")"
  run_as="$(head -n 1 "$test_file" | sed -n 's/^-- db-test: run-as=\([a-z_]*\).*$/\1/p')"
  case "$run_as" in
    app_server) echo "db-test: run $name (as app_server)"
      PGPASSWORD="$APP_SERVER_PW" "${PSQL[@]}" -U app_server -d "$DB" -f "$test_file" ;;
    app_worker) echo "db-test: run $name (as app_worker)"
      PGPASSWORD="$APP_WORKER_PW" "${PSQL[@]}" -U app_worker -d "$DB" -f "$test_file" ;;
    owner) echo "db-test: run $name (as $PGUSER)"
      "${PSQL[@]}" -d "$DB" -f "$test_file" ;;
    *) echo "db-test: $name must start with '-- db-test: run-as=owner|app_server|app_worker'" >&2; exit 1 ;;
  esac
done

if [[ "${DB_TEST_INTEGRATION:-0}" == "1" ]]; then
  echo "db-test: TypeScript integration tests (withUserTx / withSystemTx)"
  # Integration tests insert their own rows with random ids; they never rely on SQL fixtures.
  enc() { node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$1"; }
  export TEST_DATABASE_URL="postgres://$(enc "$PGUSER"):$(enc "${PGPASSWORD:-}")@$PGHOST:$PGPORT/$DB"
  export TEST_APP_SERVER_URL="postgres://app_server:$(enc "$APP_SERVER_PW")@$PGHOST:$PGPORT/$DB"
  export TEST_APP_WORKER_URL="postgres://app_worker:$(enc "$APP_WORKER_PW")@$PGHOST:$PGPORT/$DB"
  export JADARAT_REQUIRE_INTEGRATION=1
  (cd "$ROOT" && pnpm run test:integration)
fi
