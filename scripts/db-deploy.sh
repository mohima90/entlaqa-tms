#!/usr/bin/env bash
# Applies supabase/migrations to a hosted environment (staging first; T-M1-D03, docs/engineering/db-deploy.md).
#
#   DATABASE_URL=… DATABASE_CA_CERT="$(cat ca.crt)" bash scripts/db-deploy.sh plan    # dry run, rolled back
#   DATABASE_URL=… DATABASE_CA_CERT="$(cat ca.crt)" bash scripts/db-deploy.sh apply   # apply + verify
#
# DATABASE_URL: the project's migration connection (hosted Supabase: role `postgres` through the session
# pooler, which is reachable over IPv4), without query parameters. It is split into libpq variables + a
# pgpass file (scripts/pg-connection.mjs), so the password never appears in arguments or error output.
# DATABASE_CA_CERT: PEM of the server's root CA (Supabase: Database Settings → SSL Configuration). TLS is
# always `verify-full`; only a local server (127.0.0.1/localhost) may set DB_DEPLOY_LOCAL_NO_TLS=1.
# History is kept in Supabase CLI's table supabase_migrations.schema_migrations (version = timestamp
# prefix), so `supabase migration list` agrees with this script (statements are not stored).
# Both modes first validate APP_SERVER_DB_PASSWORD / APP_WORKER_DB_PASSWORD / APP_QUEUE_DB_PASSWORD (optional).
# apply: each pending migration runs in its own transaction together with its history row (same as the
# CI gate, scripts/db-test.sh); then the role passwords are set as SCRAM verifiers; then
# scripts/sql/verify-deployment.sql must pass.
set -euo pipefail

MODE="${1:-}"
if [[ "$MODE" != "plan" && "$MODE" != "apply" ]]; then
  echo "usage: DATABASE_URL=… DATABASE_CA_CERT=… bash scripts/db-deploy.sh plan|apply" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="$ROOT/supabase/migrations"
VERIFY_SQL="$ROOT/scripts/sql/verify-deployment.sql"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
chmod 700 "$WORK"

# Connection: libpq variables + pgpass file + verify-full TLS (scripts/lib/db-connect.sh).
# shellcheck source=lib/db-connect.sh
source "$ROOT/scripts/lib/db-connect.sh"
db_connect "$WORK" db-deploy
export PGAPPNAME="jadarat-db-deploy"
PSQL=(psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc)

# Validate role passwords before touching the database (both modes).
node "$ROOT/scripts/role-passwords-sql.mjs" >"$WORK/roles.sql"

server="$("${PSQL[@]}" -At -c "select current_user || ' to PostgreSQL ' || current_setting('server_version')")"
echo "db-deploy: connected as $server (TLS: $PGSSLMODE)"

history_exists="$("${PSQL[@]}" -At -c "select to_regclass('supabase_migrations.schema_migrations') is not null")"
applied=""
if [[ "$history_exists" == "t" ]]; then
  applied="$("${PSQL[@]}" -At -c "
    select coalesce(string_agg(version, ' ' order by version), '') from supabase_migrations.schema_migrations")"
elif [[ "$history_exists" != "f" ]]; then
  echo "db-deploy: could not read the migration history" >&2
  exit 1
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

# Fail fast instead of waiting on locks held by live sessions.
TX_SETTINGS="set local lock_timeout = '10s'; set local statement_timeout = '5min';"

if [[ "$MODE" == "plan" ]]; then
  if [[ ${#pending[@]} -gt 0 ]]; then
    # Dry run: every pending migration in ONE transaction that is always rolled back.
    {
      echo "begin; $TX_SETTINGS"
      for migration in "${pending[@]}"; do printf "\\\\i '%s'\n" "$migration"; done
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
    echo "begin; $TX_SETTINGS"
    printf "\\\\i '%s'\n" "$migration"
    printf "insert into supabase_migrations.schema_migrations (version, name, statements) values ('%s', '%s', '{}');\n" \
      "$version" "${name#*_}"
    echo 'commit;'
  } >"$WORK/apply.sql"
  echo "db-deploy: applying $name"
  "${PSQL[@]}" -f "$WORK/apply.sql"
done

if [[ -s "$WORK/roles.sql" ]]; then
  echo "db-deploy: setting login role passwords (SCRAM verifiers)"
  "${PSQL[@]}" --single-transaction -f "$WORK/roles.sql"
fi

echo "db-deploy: verifying the deployment"
"${PSQL[@]}" -f "$VERIFY_SQL"
echo "db-deploy: apply OK"
