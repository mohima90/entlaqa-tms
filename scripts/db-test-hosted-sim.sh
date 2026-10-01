#!/usr/bin/env bash
# Hosted-Supabase simulation gate (DB deploy, docs/engineering/db-deploy.md).
#
# On hosted Supabase the migration role (`postgres`) is NOT a superuser: it has CREATEROLE/CREATEDB,
# ADMIN OPTION on Supabase's API roles and grant options on parts of `auth`, but PostgreSQL refuses it
# anything that needs superuser (e.g. naming SUPERUSER/BYPASSRLS in ALTER ROLE, handing ownership to a
# role without CREATE on the schema). scripts/db-test.sh runs as a superuser and cannot see such errors.
# This script creates a throwaway database plus a NON-superuser migration role shaped like Supabase's,
# then runs the real deploy path (scripts/db-deploy.sh plan + apply + verify-deployment.sql) as that role.
#
# Connection: standard libpq variables for a SUPERUSER (as for scripts/db-test.sh). DB_TEST_KEEP=1 keeps the database.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}"
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
PSQL=(psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -o /dev/null)

DB="jadarat_hostedsim_$(date +%s)_$$"
MIGRATOR=jadarat_sim_migrator
rand() { od -An -N24 -tx1 /dev/urandom | tr -d ' \n'; }
MIGRATOR_PW="$(rand)"

cleanup() {
  local status=$?
  # Cluster-wide state: the login roles' test passwords and the migrator's ability to log in.
  "${PSQL[@]}" -d postgres -c "do \$\$ begin
      if exists (select 1 from pg_roles where rolname = 'app_server') then execute 'alter role app_server password null'; end if;
      if exists (select 1 from pg_roles where rolname = 'app_worker') then execute 'alter role app_worker password null'; end if;
      if exists (select 1 from pg_roles where rolname = '$MIGRATOR') then
        execute 'alter role $MIGRATOR nologin password null';
        -- The migration's own 'grant tenant_guard to current_user': not wanted beyond this run.
        if exists (select 1 from pg_auth_members m join pg_roles g on g.oid = m.roleid
                     join pg_roles u on u.oid = m.member join pg_roles gr on gr.oid = m.grantor
                   where g.rolname = 'tenant_guard' and u.rolname = '$MIGRATOR' and gr.rolname = '$MIGRATOR') then
          execute 'revoke tenant_guard from $MIGRATOR granted by $MIGRATOR';
        end if;
      end if;
    end \$\$;" >/dev/null 2>&1 || echo "db-test-hosted-sim: WARNING: cleanup of cluster-wide roles failed" >&2
  if [[ "${DB_TEST_KEEP:-0}" == "1" ]]; then echo "db-test-hosted-sim: kept database $DB"; else
    dropdb --if-exists "$DB" >/dev/null 2>&1 || true
  fi
  if [[ $status -eq 0 ]]; then echo "db-test-hosted-sim: PASSED"; else echo "db-test-hosted-sim: FAILED (exit $status)" >&2; fi
}
trap cleanup EXIT

createdb "$DB"
"${PSQL[@]}" -d "$DB" -f "$ROOT/supabase/tests/_shim/supabase_shim.sql"

# The migration role, as on hosted Supabase: no SUPERUSER; CREATEROLE/CREATEDB/BYPASSRLS; ADMIN OPTION
# on authenticated; USAGE on `auth` without the grant option.
"${PSQL[@]}" -d "$DB" <<SQL
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname = '$MIGRATOR') then
    create role $MIGRATOR nologin createrole createdb bypassrls nosuperuser;
  end if;
end \$\$;
alter role $MIGRATOR login password '$MIGRATOR_PW';
-- Only what the migrations need: ADMIN on authenticated (grant authenticated to app_server/app_worker).
grant authenticated to $MIGRATOR with admin option;
grant create, temporary on database "$DB" to $MIGRATOR;
-- Observed on hosted Supabase (first DB deploy plan, 1 Oct 2026): postgres has USAGE on schema auth but
-- WITHOUT the grant option ("no privileges were granted for auth"); it can read auth.sessions.
grant usage on schema auth to $MIGRATOR;
grant select on auth.sessions to $MIGRATOR with grant option;
grant references on auth.sessions, auth.users to $MIGRATOR;
-- Login roles left by an earlier run on this cluster: on Supabase they would have been created by the
-- migration role itself, which then holds ADMIN OPTION on them.
do \$\$
declare r text;
begin
  foreach r in array array['app_server', 'app_worker', 'tenant_guard'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('grant %I to $MIGRATOR with admin option, inherit false, set false', r);
    end if;
  end loop;
end \$\$;
SQL

enc() { node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$1"; }
DATABASE_URL="postgresql://$MIGRATOR:$(enc "$MIGRATOR_PW")@$PGHOST:$PGPORT/$DB"
export DATABASE_URL
export DB_DEPLOY_LOCAL_NO_TLS=1
export APP_SERVER_DB_PASSWORD="sim-$(rand)" APP_WORKER_DB_PASSWORD="sim-$(rand)"

echo "db-test-hosted-sim: plan as non-superuser $MIGRATOR"
bash "$ROOT/scripts/db-deploy.sh" plan
echo "db-test-hosted-sim: apply as non-superuser $MIGRATOR"
bash "$ROOT/scripts/db-deploy.sh" apply
