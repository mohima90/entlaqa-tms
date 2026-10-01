#!/usr/bin/env bash
# Applies supabase/migrations to a hosted environment (staging first; T-M1-D03, docs/engineering/db-deploy.md).
#
#   DATABASE_URL=postgresql://… bash scripts/db-deploy.sh plan    # list pending, dry-run them, roll back
#   DATABASE_URL=postgresql://… bash scripts/db-deploy.sh apply   # apply pending, set role passwords, verify
#
# DATABASE_URL: the project's migration connection (hosted Supabase: role `postgres` through the session
# pooler, which is reachable over IPv4). It never appears in output.
# History is kept in Supabase CLI's table supabase_migrations.schema_migrations (version = timestamp
# prefix), so `supabase migration list` agrees with this script.
# apply: each pending migration runs in its own transaction together with its history row (same as the
# CI gate, scripts/db-test.sh); then APP_SERVER_DB_PASSWORD / APP_WORKER_DB_PASSWORD (optional) are set
# as SCRAM verifiers (scripts/role-passwords-sql.mjs); then scripts/sql/verify-deployment.sql must pass.
set -euo pipefail

MODE="${1:-}"
if [[ "$MODE" != "plan" && "$MODE" != "apply" ]]; then
  echo "usage: DATABASE_URL=… bash scripts/db-deploy.sh plan|apply" >&2
  exit 2
fi
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "db-deploy: DATABASE_URL is not set" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="$ROOT/supabase/migrations"
VERIFY_SQL="$ROOT/scripts/sql/verify-deployment.sql"
# TLS unless the URL says otherwise (libpq: URL parameters override PG* variables).
export PGSSLMODE="${PGSSLMODE:-require}"
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
export PGAPPNAME="jadarat-db-deploy"
PSQL=(psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -d "$DATABASE_URL")

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "db-deploy: $("${PSQL[@]}" -At -c "select 'connected as ' || current_user || ' to PostgreSQL ' || current_setting('server_version')")"

applied=""
if [[ "$("${PSQL[@]}" -At -c "select to_regclass('supabase_migrations.schema_migrations') is not null")" == "t" ]]; then
  applied="$("${PSQL[@]}" -At -c "
    select coalesce(string_agg(version, ' ' order by version), '') from supabase_migrations.schema_migrations")"
fi

shopt -s nullglob
pending=()
for migration in "$MIGRATIONS_DIR"/*.sql; do
  name="$(basename "$migration" .sql)"
  version="${name%%_*}"
  if [[ ! "$version" =~ ^[0-9]{14}$ || ! "$name" =~ ^[0-9a-z_]+$ ]]; then
    echo "db-deploy: unexpected migration file name $name (run pnpm check:migrations)" >&2
    exit 1
  fi
  if [[ " $applied " != *" $version "* ]]; then pending+=("$migration"); fi
done

echo "db-deploy: ${#pending[@]} pending migration(s)"
for migration in "${pending[@]}"; do echo "  - $(basename "$migration")"; done

if [[ "$MODE" == "plan" ]]; then
  if [[ ${#pending[@]} -gt 0 ]]; then
    # Dry run: every pending migration in ONE transaction that is always rolled back.
    {
      echo 'begin;'
      for migration in "${pending[@]}"; do printf '\\i %s\n' "$migration"; done
      echo 'rollback;'
    } >"$WORK/plan.sql"
    "${PSQL[@]}" -f "$WORK/plan.sql"
    echo "db-deploy: dry run OK — all pending migrations apply cleanly (rolled back, nothing changed)"
  fi
  exit 0
fi

"${PSQL[@]}" -c "
  create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (
    version text primary key, statements text[], name text);"

for migration in "${pending[@]}"; do
  name="$(basename "$migration" .sql)"
  version="${name%%_*}"
  {
    echo 'begin;'
    printf '\\i %s\n' "$migration"
    printf "insert into supabase_migrations.schema_migrations (version, name, statements) values ('%s', '%s', '{}');\n" \
      "$version" "${name#*_}"
    echo 'commit;'
  } >"$WORK/apply.sql"
  echo "db-deploy: applying $name"
  "${PSQL[@]}" -f "$WORK/apply.sql"
done

node "$ROOT/scripts/role-passwords-sql.mjs" >"$WORK/roles.sql"
if [[ -s "$WORK/roles.sql" ]]; then
  echo "db-deploy: setting login role passwords (SCRAM verifiers)"
  "${PSQL[@]}" --single-transaction -f "$WORK/roles.sql"
fi

echo "db-deploy: verifying the deployment"
"${PSQL[@]}" -f "$VERIFY_SQL"
echo "db-deploy: apply OK"
