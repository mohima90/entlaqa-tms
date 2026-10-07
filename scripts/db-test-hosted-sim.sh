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
      if exists (select 1 from pg_roles where rolname = 'app_queue') then execute 'alter role app_queue password null'; end if;
      if exists (select 1 from pg_roles where rolname = '$MIGRATOR') then
        execute 'alter role $MIGRATOR nologin password null';
        if exists (select 1 from pg_auth_members m join pg_roles g on g.oid = m.roleid
                     join pg_roles u on u.oid = m.member join pg_roles gr on gr.oid = m.grantor
                   where g.rolname = 'app_queue' and u.rolname = '$MIGRATOR' and gr.rolname = '$MIGRATOR') then
          execute 'revoke app_queue from $MIGRATOR granted by $MIGRATOR';
        end if;
        -- The migrations' own 'grant tenant_guard / invitation_guard to current_user': not wanted beyond this run.
        if exists (select 1 from pg_auth_members m join pg_roles g on g.oid = m.roleid
                     join pg_roles u on u.oid = m.member join pg_roles gr on gr.oid = m.grantor
                   where g.rolname = 'tenant_guard' and u.rolname = '$MIGRATOR' and gr.rolname = '$MIGRATOR') then
          execute 'revoke tenant_guard from $MIGRATOR granted by $MIGRATOR';
        end if;
        if exists (select 1 from pg_auth_members m join pg_roles g on g.oid = m.roleid
                     join pg_roles u on u.oid = m.member join pg_roles gr on gr.oid = m.grantor
                   where g.rolname = 'invitation_guard' and u.rolname = '$MIGRATOR' and gr.rolname = '$MIGRATOR') then
          execute 'revoke invitation_guard from $MIGRATOR granted by $MIGRATOR';
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
-- WITHOUT the grant option ("no privileges were granted for auth"); it can read auth.sessions (grant
-- option on it not assumed). Likewise auth.users (id, email) for private.auth_user_email (invitations,
-- T-M2-07: to be confirmed by the staging plan run — the migration fails loudly otherwise).
grant usage on schema auth to $MIGRATOR;
grant select on auth.sessions to $MIGRATOR;
grant select (id, email) on auth.users to $MIGRATOR;
grant references on auth.sessions, auth.users to $MIGRATOR;
-- TRIGGER on auth.users: the e-mail change guard of migration 20261009090000 (re-review N1). Assumption,
-- from Supabase's own image (supabase/postgres 17.11.0.003, the version staging runs): auth.users ACL
-- postgres=ar*wdDxtm/supabase_auth_admin — postgres is not the owner but holds TRIGGER (Supabase keeps
-- triggers on auth tables allowed, like its handle_new_user pattern). Only that privilege is simulated
-- here; the migration checks it and fails loudly without it (confirmed by the staging plan run).
grant trigger on auth.users to $MIGRATOR;
-- Login roles left by an earlier run on this cluster: on Supabase they would have been created by the
-- migration role itself, which then holds ADMIN OPTION on them.
do \$\$
declare r text;
begin
  foreach r in array array['app_server', 'app_worker', 'app_queue', 'tenant_guard', 'invitation_guard'] loop
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
export APP_SERVER_DB_PASSWORD="sim-$(rand)" APP_WORKER_DB_PASSWORD="sim-$(rand)" APP_QUEUE_DB_PASSWORD="sim-$(rand)"

echo "db-test-hosted-sim: plan as non-superuser $MIGRATOR"
bash "$ROOT/scripts/db-deploy.sh" plan
echo "db-test-hosted-sim: apply as non-superuser $MIGRATOR"
bash "$ROOT/scripts/db-deploy.sh" apply

# Tenant provisioning (scripts/provision-tenant.sh) as the same non-superuser migration role.
ADMIN_UID="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
"${PSQL[@]}" -d "$DB" -c "insert into auth.users (id, email) values ('$ADMIN_UID', 'sim-admin@example.test')"
q() { psql -X -At --no-psqlrc -v ON_ERROR_STOP=1 -d "$DB" -c "$1"; }
memberships() {
  q "select count(*) from platform.tenant_memberships m join platform.tenants t on t.id = m.tenant_id
     where t.slug = 'sim-org' and m.user_id = '$ADMIN_UID' and m.status = 'active'"
}
export TENANT_SLUG=sim-org TENANT_NAME_AR='منشأة المحاكاة' TENANT_NAME_EN='Simulation Org' ADMIN_USER_ID="$ADMIN_UID"
echo "db-test-hosted-sim: provision plan + apply as $MIGRATOR"
# expect_refusal <message pattern> [VAR=value …]: the provisioning must fail with that message.
expect_refusal() {
  local pattern="$1" err
  shift
  err="$(mktemp)"
  if env "$@" bash "$ROOT/scripts/provision-tenant.sh" apply >/dev/null 2>"$err"; then
    echo "db-test-hosted-sim: provisioning must fail ($*)" >&2; rm -f "$err"; exit 1
  fi
  grep -q "$pattern" "$err" || { cat "$err" >&2; rm -f "$err"; exit 1; }
  rm -f "$err"
}
bash "$ROOT/scripts/provision-tenant.sh" plan
[[ "$(memberships)" == "0" ]] || { echo "db-test-hosted-sim: provision plan changed the database" >&2; exit 1; }
bash "$ROOT/scripts/provision-tenant.sh" apply
[[ "$(memberships)" == "1" ]] || { echo "db-test-hosted-sim: provision apply did not create the membership" >&2; exit 1; }
[[ "$(q "select name_ar || '|' || name_en || '|' || status from platform.tenants where slug = 'sim-org'")" == "منشأة المحاكاة|Simulation Org|active" ]] ||
  { echo "db-test-hosted-sim: provisioned organization has unexpected values" >&2; exit 1; }
# An existing organization is never joined by accident: refused without add_to_existing, and with it
# when the names differ; with both, an already active member is a no-op.
expect_refusal 'already exists; to add a member'
expect_refusal 'exists with different names' ADD_TO_EXISTING=true TENANT_NAME_AR='منشأة أخرى'
expect_refusal 'exists with different names' ADD_TO_EXISTING=true TENANT_NAME_EN=
ADD_TO_EXISTING=true bash "$ROOT/scripts/provision-tenant.sh" apply
[[ "$(memberships)" == "1" ]] || { echo "db-test-hosted-sim: re-provisioning changed the membership" >&2; exit 1; }
[[ "$(q "select count(*) from platform.audit_events where action = 'platform.tenant.admin_provisioned' and entity_id = '$ADMIN_UID'")" == "1" ]] ||
  { echo "db-test-hosted-sim: expected exactly one provisioning audit event" >&2; exit 1; }
# An Organization Admin holds no other role (BR-IAM-4, T-M2-16): a member with another role is not made
# one by the recovery path (refused, nothing changed).
LEARNER_UID="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
q "insert into auth.users (id, email) values ('$LEARNER_UID', 'sim-learner@example.test');
   with p as (insert into platform.persons (tenant_id, display_name_ar)
              select id, 'متدرب' from platform.tenants where slug = 'sim-org' returning tenant_id, id),
        m as (insert into platform.tenant_memberships (tenant_id, user_id, person_id, status)
              select tenant_id, '$LEARNER_UID', id, 'active' from p returning tenant_id, id)
   insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary)
   select tenant_id, id, 'learner', true from m" >/dev/null
expect_refusal 'holds other roles' ADD_TO_EXISTING=true ADMIN_USER_ID="$LEARNER_UID"
[[ "$(q "select string_agg(ra.role_code, ',') from platform.role_assignments ra join platform.tenant_memberships m on m.id = ra.membership_id where m.user_id = '$LEARNER_UID'")" == "learner" ]] ||
  { echo "db-test-hosted-sim: the recovery path changed the roles of a member with another role" >&2; exit 1; }
# An unknown Auth user: refused, and nothing is left behind.
expect_refusal 'no Auth user with this UID' TENANT_SLUG=sim-other \
  ADMIN_USER_ID="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
[[ "$(q "select count(*) from platform.tenants where slug = 'sim-other'")" == "0" ]] ||
  { echo "db-test-hosted-sim: a failed provisioning left an organization behind" >&2; exit 1; }
# Malformed input is rejected before connecting.
for bad in "TENANT_SLUG=-bad" "TENANT_SLUG=Bad" "ADMIN_USER_ID=not-a-uuid" "TENANT_NAME_AR= " "ADD_TO_EXISTING=yes"; do
  if env "$bad" bash "$ROOT/scripts/provision-tenant.sh" plan >/dev/null 2>&1; then
    echo "db-test-hosted-sim: provisioning accepted invalid input ($bad)" >&2; exit 1
  fi
done
echo "db-test-hosted-sim: provisioning OK"

# Sign-up gate (T-M2-07, review H1): with the grants made by the non-superuser migration role, Auth's
# role can run the hook and its yes/no check (an error inside the hook would also read as a refusal, so
# the check is called directly too).
[[ "$(q "set role supabase_auth_admin;
         select private.invitation_allows_signup('nobody@example.invalid', repeat('A', 43))::text || '|' ||
                private.before_user_created_hook('{}'::jsonb)::text" | tail -n 1)" == 'false|{"error": {"message": "Sign-up is by invitation only.", "http_code": 403}}' ]] ||
  { echo "db-test-hosted-sim: supabase_auth_admin cannot run the sign-up hook as deployed" >&2; exit 1; }
echo "db-test-hosted-sim: sign-up hook OK"

# E-mail change guard (re-review N1): created on auth.users by the non-superuser migration role, enabled,
# and it refuses an e-mail change (whoever updates: here even a superuser) unless the operator flag is set.
[[ "$(q "select count(*) from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'jadarat_refuse_email_change' and tgenabled = 'O'")" == "1" ]] ||
  { echo "db-test-hosted-sim: the e-mail change guard on auth.users is missing" >&2; exit 1; }
if q "update auth.users set email = 'sim-other@example.test' where id = '$ADMIN_UID'" >/dev/null 2>&1; then
  echo "db-test-hosted-sim: an Auth e-mail change was not refused" >&2; exit 1
fi
grep -qx 'sim-renamed@example.test' <<<"$(q "begin; set local jadarat.allow_auth_email_change = 'on'; update auth.users set email = 'sim-renamed@example.test' where id = '$ADMIN_UID' returning email; rollback")" ||
  { echo "db-test-hosted-sim: the operator flag must allow an e-mail change" >&2; exit 1; }
echo "db-test-hosted-sim: e-mail change guard OK"

# Background jobs (T-M2-06a), as on staging: the worker installs graphile-worker's schema as app_queue —
# which holds no database privilege — on a database migrated by the non-superuser role, then dispatches
# the pending events.
echo "db-test-hosted-sim: worker passes (app_queue, app_worker)"
(cd "$ROOT" && pnpm --filter @jadarat/worker build >/dev/null)
worker_pass() {
  env -u DATABASE_URL \
    DATABASE_URL_APP_QUEUE="postgresql://app_queue:$(enc "$APP_QUEUE_DB_PASSWORD")@$PGHOST:$PGPORT/$DB" \
    DATABASE_URL_APP_WORKER="postgresql://app_worker:$(enc "$APP_WORKER_DB_PASSWORD")@$PGHOST:$PGPORT/$DB" \
    EMAIL_PROVIDER=none \
    node "$ROOT/apps/worker/dist/main.mjs" once >/dev/null
}
event() { q "insert into platform.event_outbox (tenant_id, type) select id, 'com.entlaqa.platform.sim.$1' from platform.tenants where slug = 'sim-org'" >/dev/null; }
dispatched() { q "select count(*) from platform.event_outbox where type = 'com.entlaqa.platform.sim.$1' and dispatched_at is not null"; }
event before_install # no queue yet: the first pass's own dispatch picks it up
worker_pass
[[ "$(q "select nspowner::regrole from pg_namespace where nspname = 'graphile_worker'")" == "app_queue" ]] ||
  { echo "db-test-hosted-sim: graphile_worker must belong to app_queue" >&2; exit 1; }
[[ "$(dispatched before_install)" == "1" ]] || { echo "db-test-hosted-sim: the worker did not dispatch the event" >&2; exit 1; }
[[ "$(q "select has_database_privilege('app_queue', current_database(), 'CREATE')")" == "f" ]] ||
  { echo "db-test-hosted-sim: app_queue must not hold CREATE on the database" >&2; exit 1; }
event after_install # with the queue installed
worker_pass
[[ "$(dispatched after_install)" == "1" ]] || { echo "db-test-hosted-sim: the second pass did not dispatch" >&2; exit 1; }
# A later deploy runs after the worker has installed its queue (as on staging): it must still verify.
echo "db-test-hosted-sim: apply again with the queue installed (nothing pending; verification)"
bash "$ROOT/scripts/db-deploy.sh" apply >/dev/null
echo "db-test-hosted-sim: worker OK"
