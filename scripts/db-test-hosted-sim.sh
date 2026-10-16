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
        -- The migrations' own 'grant <guard role> to current_user': not wanted beyond this run.
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
        if exists (select 1 from pg_auth_members m join pg_roles g on g.oid = m.roleid
                     join pg_roles u on u.oid = m.member join pg_roles gr on gr.oid = m.grantor
                   where g.rolname = 'account_mail_guard' and u.rolname = '$MIGRATOR' and gr.rolname = '$MIGRATOR') then
          execute 'revoke account_mail_guard from $MIGRATOR granted by $MIGRATOR';
        end if;
        if exists (select 1 from pg_auth_members m join pg_roles g on g.oid = m.roleid
                     join pg_roles u on u.oid = m.member join pg_roles gr on gr.oid = m.grantor
                   where g.rolname = 'membership_guard' and u.rolname = '$MIGRATOR' and gr.rolname = '$MIGRATOR') then
          execute 'revoke membership_guard from $MIGRATOR granted by $MIGRATOR';
        end if;
        if exists (select 1 from pg_auth_members m join pg_roles g on g.oid = m.roleid
                     join pg_roles u on u.oid = m.member join pg_roles gr on gr.oid = m.grantor
                   where g.rolname = 'rate_limit_guard' and u.rolname = '$MIGRATOR' and gr.rolname = '$MIGRATOR') then
          execute 'revoke rate_limit_guard from $MIGRATOR granted by $MIGRATOR';
        end if;
        if exists (select 1 from pg_auth_members m join pg_roles g on g.oid = m.roleid
                     join pg_roles u on u.oid = m.member join pg_roles gr on gr.oid = m.grantor
                   where g.rolname = 'file_guard' and u.rolname = '$MIGRATOR' and gr.rolname = '$MIGRATOR') then
          execute 'revoke file_guard from $MIGRATOR granted by $MIGRATOR';
        end if;
        if exists (select 1 from pg_auth_members m join pg_roles g on g.oid = m.roleid
                     join pg_roles u on u.oid = m.member join pg_roles gr on gr.oid = m.grantor
                   where g.rolname = 'user_import_guard' and u.rolname = '$MIGRATOR' and gr.rolname = '$MIGRATOR') then
          execute 'revoke user_import_guard from $MIGRATOR granted by $MIGRATOR';
        end if;
        if exists (select 1 from pg_auth_members m join pg_roles g on g.oid = m.roleid
                     join pg_roles u on u.oid = m.member join pg_roles gr on gr.oid = m.grantor
                   where g.rolname = 'platform_admin_guard' and u.rolname = '$MIGRATOR' and gr.rolname = '$MIGRATOR') then
          execute 'revoke platform_admin_guard from $MIGRATOR granted by $MIGRATOR';
        end if;
        -- The supautils.policy_grants simulation below (T-M2-18).
        if pg_has_role('$MIGRATOR', 'supabase_storage_admin', 'MEMBER') then
          execute 'revoke supabase_storage_admin from $MIGRATOR';
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
-- private.auth_account (account e-mails, T-M2-17). The observed ACL (postgres=ar*… below) gives postgres
-- SELECT on every column of auth.users; only the columns the view reads are simulated.
grant select (banned_until, recovery_sent_at, recovery_token, is_sso_user, deleted_at) on auth.users to $MIGRATOR;
grant references on auth.sessions, auth.users to $MIGRATOR;
-- private.auth_mfa_factor (MFA policy, T-M2-10). Assumption: auth.mfa_factors carries the same ACL as
-- auth.users (postgres=ar*wdDxtm/supabase_auth_admin — Supabase grants postgres its privileges on every Auth
-- table); only SELECT is simulated. The migration checks it and fails loudly without it (confirmed by the
-- staging plan run).
grant select on auth.mfa_factors to $MIGRATOR;
-- Security review H1 / M1 / M2 (T-M2-10): the views private.auth_mfa_factor and private.auth_session_validity
-- let tenant_guard DELETE (remove an authenticator app; end a session in Auth), and
-- private.mfa_factor_confirmations references auth.mfa_factors. Same assumption (postgres=ar*wdDxtm on
-- every Auth table): d and x are simulated. The migration checks both and fails loudly without them.
grant delete, references on auth.mfa_factors to $MIGRATOR;
grant delete on auth.sessions to $MIGRATOR;
-- TRIGGER on auth.users: the e-mail change guard of migration 20261009090000 (re-review N1). Assumption,
-- from Supabase's own image (supabase/postgres 17.11.0.003, the version staging runs): auth.users ACL
-- postgres=ar*wdDxtm/supabase_auth_admin — postgres is not the owner but holds TRIGGER (Supabase keeps
-- triggers on auth tables allowed, like its handle_new_user pattern). Only that privilege is simulated
-- here; the migration checks it and fails loudly without it (confirmed by the staging plan run).
grant trigger on auth.users to $MIGRATOR;
-- Storage (T-M2-18), as on supabase/postgres 17.11.0.003 + storage-api v1.74.0 (checked 9 Oct 2026):
-- storage.buckets/objects belong to supabase_storage_admin; storage migration 0049 grants the migration role
-- ALL WITH GRANT OPTION (bucket rows; SELECT for the view private.storage_object_facts), and supautils'
-- policy_grants lets it create policies on storage.objects although it does not own the table. Plain
-- PostgreSQL has no policy grant: membership of the owner role stands in for it (it allows more than
-- supautils does, e.g. ALTER TABLE — the migrations only insert buckets and create policies there).
grant usage on schema storage to $MIGRATOR;
grant all on storage.buckets, storage.objects to $MIGRATOR with grant option;
grant supabase_storage_admin to $MIGRATOR;
-- Login roles left by an earlier run on this cluster: on Supabase they would have been created by the
-- migration role itself, which then holds ADMIN OPTION on them.
do \$\$
declare r text;
begin
  foreach r in array array['app_server', 'app_worker', 'app_queue', 'tenant_guard', 'invitation_guard',
                          'account_mail_guard', 'membership_guard', 'rate_limit_guard', 'file_guard',
                          'user_import_guard', 'platform_admin_guard'] loop
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

# Deploy lock (T-M2-38 security reviews; scripts/lib/db-connect.sh § Deploy lock): a deploy waits for the
# lock held by another session and gives up with a clear message after its wait; a worker pass
# (scripts/run-outside-deploy.sh) waits for a deploy, fails (never runs) when its wait runs out, and holds
# the lock shared while it runs; the transaction pooler's port is refused; nothing is left behind.
echo "db-test-hosted-sim: deploy lock"
lock_out="$(mktemp)" pass_out="$(mktemp)"
lock_fail() {
  echo "db-test-hosted-sim: deploy lock: $1" >&2
  cat "$lock_out" "$pass_out" >&2
  rm -f "$lock_out" "$pass_out"
  exit 1
}
psql -X -q --no-psqlrc -d "$DB" -c "select pg_advisory_lock(20261015, 1)" -c "select pg_sleep(5)" >/dev/null &
holder=$!
sleep 1
if DB_DEPLOY_LOCK_WAIT_SECONDS=1 bash "$ROOT/scripts/db-deploy.sh" plan >"$lock_out" 2>&1; then
  lock_fail "plan ran while another session held the lock"
fi
grep -q "could not take the deploy lock" "$lock_out" || lock_fail "no clear message when the wait ran out"
if DB_DEPLOY_LOCK_WAIT_SECONDS=1 bash "$ROOT/scripts/run-outside-deploy.sh" echo pass-ran >"$pass_out" 2>&1; then
  lock_fail "a pass whose wait ran out must fail"
fi
if grep -q pass-ran "$pass_out" || ! grep -q "this pass did not run" "$pass_out"; then
  lock_fail "the pass ran during a deploy, or said nothing"
fi
# Both wait for the holder: the pass (shared) and a plan (exclusive).
DB_DEPLOY_LOCK_WAIT_SECONDS=30 bash "$ROOT/scripts/run-outside-deploy.sh" echo pass-ran >"$pass_out" 2>&1 &
waiting_pass=$!
DB_DEPLOY_LOCK_WAIT_SECONDS=30 bash "$ROOT/scripts/db-deploy.sh" plan >"$lock_out" 2>&1 ||
  lock_fail "plan did not run after the lock was released"
grep -q "waiting up to 30s" "$lock_out" || lock_fail "plan did not wait for the lock"
wait "$waiting_pass" || lock_fail "the waiting pass failed"
grep -q pass-ran "$pass_out" || lock_fail "the waiting pass did not run"
wait "$holder"
bash "$ROOT/scripts/run-outside-deploy.sh" sleep 4 >/dev/null 2>&1 &
holder=$!
sleep 2
if DB_DEPLOY_LOCK_WAIT_SECONDS=1 bash "$ROOT/scripts/db-deploy.sh" plan >"$lock_out" 2>&1; then
  lock_fail "plan ran during a worker pass"
fi
wait "$holder" || lock_fail "the pass under the shared lock failed"
if DATABASE_URL="postgresql://$MIGRATOR:x@$PGHOST:6543/$DB" bash "$ROOT/scripts/db-deploy.sh" plan >"$lock_out" 2>&1 ||
  ! grep -q "transaction pooler" "$lock_out"; then
  lock_fail "port 6543 (transaction pooler) must be refused"
fi
[[ "$(psql -X -At --no-psqlrc -d "$DB" -c "select count(*) from pg_locks where locktype = 'advisory' and classid = 20261015")" == "0" ]] ||
  lock_fail "the lock outlived its runs"
rm -f "$lock_out" "$pass_out"

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

# Platform Super Admin (FR-ADM-17): the workflow's script as the same non-superuser migration role, then the
# console's functions as app_server with the Super Admin's session (the guard's grants and policies as made
# by that role).
SUPER_UID="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
SUPER_SESSION="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
q "insert into auth.users (id, email) values ('$SUPER_UID', 'sim-super@example.test');
   insert into auth.sessions (id, user_id, created_at) values ('$SUPER_SESSION', '$SUPER_UID', now())" >/dev/null
super_admins() { q "select count(*) from private.platform_admins where user_id = '$SUPER_UID'"; }
expect_admin_refusal() {
  local pattern="$1" err
  shift
  err="$(mktemp)"
  if env "$@" bash "$ROOT/scripts/platform-admin.sh" apply >/dev/null 2>"$err"; then
    echo "db-test-hosted-sim: platform-admin must fail ($*)" >&2; rm -f "$err"; exit 1
  fi
  grep -q "$pattern" "$err" || { cat "$err" >&2; rm -f "$err"; exit 1; }
  rm -f "$err"
}
echo "db-test-hosted-sim: platform admin plan + apply as $MIGRATOR"
ADMIN_USER_ID="$SUPER_UID" bash "$ROOT/scripts/platform-admin.sh" plan
[[ "$(super_admins)" == "0" ]] || { echo "db-test-hosted-sim: platform-admin plan changed the database" >&2; exit 1; }
GITHUB_RUN_ID=4242 GITHUB_ACTOR=sim-operator ADMIN_USER_ID="$SUPER_UID" bash "$ROOT/scripts/platform-admin.sh" apply
ADMIN_USER_ID="$SUPER_UID" bash "$ROOT/scripts/platform-admin.sh" apply  # again: nothing to do
# The audit row names the workflow run and its login (review L5); `list` shows UIDs and grant times only.
[[ "$(q "select data ->> 'runId' || ':' || (data ->> 'actor') from private.platform_audit_events where action = 'platform.admin.granted' and entity_id = '$SUPER_UID'")" == "4242:sim-operator" ]] ||
  { echo "db-test-hosted-sim: the grant audit row does not record the run" >&2; exit 1; }
listed="$(ADMIN_ACTION=list bash "$ROOT/scripts/platform-admin.sh" plan 2>&1)"
grep -q "platform-admin: $SUPER_UID granted " <<<"$listed" || { echo "db-test-hosted-sim: list does not show the Super Admin" >&2; echo "$listed" >&2; exit 1; }
if grep -q "@" <<<"$listed"; then echo "db-test-hosted-sim: list printed an e-mail" >&2; exit 1; fi
[[ "$(super_admins)" == "1" ]] || { echo "db-test-hosted-sim: platform-admin apply did not grant" >&2; exit 1; }
[[ "$(q "select count(*) from private.platform_audit_events where action = 'platform.admin.granted' and entity_id = '$SUPER_UID'")" == "1" ]] ||
  { echo "db-test-hosted-sim: expected exactly one grant audit event" >&2; exit 1; }
expect_admin_refusal 'no Auth user with this UID' ADMIN_USER_ID="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
for bad in "ADMIN_USER_ID=sim-super@example.test" "ADMIN_USER_ID=" "ADMIN_ACTION=delete" "GITHUB_RUN_ID=12a" "GITHUB_ACTOR=bad;actor"; do
  if env ADMIN_USER_ID="$SUPER_UID" "$bad" bash "$ROOT/scripts/platform-admin.sh" plan >/dev/null 2>&1; then
    echo "db-test-hosted-sim: platform-admin accepted invalid input ($bad)" >&2; exit 1
  fi
done
SUPER_CLAIMS="{\"sub\":\"$SUPER_UID\",\"role\":\"authenticated\",\"aal\":\"aal1\",\"session_id\":\"$SUPER_SESSION\"}"
console="$(PGPASSWORD="$APP_SERVER_DB_PASSWORD" psql -X -At --no-psqlrc -v ON_ERROR_STOP=1 -U app_server -d "$DB" -c "begin; set local role authenticated;
  select set_config('request.jwt.claims', '$SUPER_CLAIMS', true) is not null;
  select 'admin=' || private.is_platform_admin();
  select 'code=' || (invite_code is not null) from private.platform_create_tenant('sim-console', 'منشأة المنصة', null, 'sim-org-admin@example.test');
  select 'listed=' || admin_state from private.platform_list_tenants() where slug = 'sim-console';
  select 'reissued=' || (invite_code is not null) from private.platform_reissue_admin_code((select tenant_id from private.platform_list_tenants() where slug = 'sim-console'));
  commit")"
for want in admin=true code=true listed=pending reissued=true; do
  grep -qx "$want" <<<"$console" || { echo "db-test-hosted-sim: platform console as deployed: missing $want" >&2; echo "$console" >&2; exit 1; }
done
CONSOLE_CODE="$(q "select invite_code from platform.invitations where email = 'sim-org-admin@example.test' and status = 'pending'")"
[[ "$CONSOLE_CODE" =~ ^[A-Z0-9]+$ ]] || { echo "db-test-hosted-sim: the console's invitation has no code" >&2; exit 1; }
[[ "$(q "set role supabase_auth_admin; select private.invitation_allows_signup('sim-org-admin@example.test', '$CONSOLE_CODE')" | tail -n 1)" == "t" ]] ||
  { echo "db-test-hosted-sim: the console's invitation does not pass the sign-up gate" >&2; exit 1; }
ADMIN_ACTION=revoke ADMIN_USER_ID="$SUPER_UID" bash "$ROOT/scripts/platform-admin.sh" apply
[[ "$(super_admins)" == "0" ]] || { echo "db-test-hosted-sim: platform-admin revoke did not revoke" >&2; exit 1; }
echo "db-test-hosted-sim: platform admin OK"

# Sign-up gate (T-M2-07, review H1): with the grants made by the non-superuser migration role, Auth's
# role can run the hook and its yes/no check (an error inside the hook would also read as a refusal, so
# the check is called directly too).
[[ "$(q "set role supabase_auth_admin;
         select private.invitation_allows_signup('nobody@example.invalid', repeat('A', 43))::text || '|' ||
                private.before_user_created_hook('{}'::jsonb)::text" | tail -n 1)" == 'false|{"error": {"message": "Sign-up is by invitation only.", "http_code": 403}}' ]] ||
  { echo "db-test-hosted-sim: supabase_auth_admin cannot run the sign-up hook as deployed" >&2; exit 1; }
echo "db-test-hosted-sim: sign-up hook OK"

# Storage policies (T-M2-18), created by the non-superuser migration role: under Storage's own login role
# and the authenticated role, without valid user claims, the policy functions answer (no privilege error)
# and an object cannot be created.
[[ "$(q "set session authorization supabase_storage_admin; set role authenticated;
         select coalesce(private.storage_request_tenant()::text, 'none') || '|' ||
                private.can_upload_object('imports', 'x/y')::text || '|' || private.can_read_object('imports', 'x/y')::text" |
      tail -n 1)" == 'none|false|false' ]] ||
  { echo "db-test-hosted-sim: the storage policy functions do not answer under Storage's role" >&2; exit 1; }
storage_err="$(q "set session authorization supabase_storage_admin; set role authenticated;
                  insert into storage.objects (bucket_id, name) values ('imports', 'x/y')" 2>&1 || true)"
[[ "$storage_err" == *"violates row-level security policy"* ]] ||
  { echo "db-test-hosted-sim: an object without a pending upload was not refused by the storage policies" >&2; exit 1; }
echo "db-test-hosted-sim: storage policies OK"

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

# Ending sessions and removing authenticator apps in Auth (T-M2-10, security review M1/H1/M2): through the
# views owned by the non-superuser migration role (DELETE for tenant_guard), as deployed.
SESSION_A="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
SESSION_B="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
FACTOR_ID="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
SIM_TENANT="$(q "select id from platform.tenants where slug = 'sim-org'")"
q "insert into auth.sessions (id, user_id, created_at) values ('$SESSION_A', '$ADMIN_UID', now()), ('$SESSION_B', '$ADMIN_UID', now());
   insert into auth.mfa_factors (id, user_id, factor_type, status) values ('$FACTOR_ID', '$ADMIN_UID', 'totp', 'verified')" >/dev/null
app_server_q() {
  PGPASSWORD="$APP_SERVER_DB_PASSWORD" psql -X -At --no-psqlrc -v ON_ERROR_STOP=1 -U app_server -d "$DB" -c "$1"
}
CLAIMS="{\"sub\":\"$ADMIN_UID\",\"role\":\"authenticated\",\"aal\":\"aal1\",\"session_id\":\"$SESSION_A\"}"
CLAIMS_TENANT="{\"sub\":\"$ADMIN_UID\",\"role\":\"authenticated\",\"aal\":\"aal1\",\"session_id\":\"$SESSION_A\",\"tenant_id\":\"$SIM_TENANT\"}"
ended="$(app_server_q "begin; set local role authenticated;
                       select set_config('request.jwt.claims', '$CLAIMS', true) is not null;
                       select private.switch_active_tenant('$SIM_TENANT');
                       select set_config('request.jwt.claims', '$CLAIMS_TENANT', true) is not null;
                       select 'ended=' || private.end_my_sessions(null); commit")"
grep -qx 'ended=1' <<<"$ended" || { echo "db-test-hosted-sim: ending another session of the account failed" >&2; exit 1; }
[[ "$(q "select count(*) from auth.sessions where id = '$SESSION_B'")" == "0" ]] ||
  { echo "db-test-hosted-sim: an ended session must be deleted in Auth (review M1)" >&2; exit 1; }
# ENTLAQA support's reset (runbook docs/engineering/mfa-reset.md), as the migration role.
[[ "$(psql -X -At --no-psqlrc -v ON_ERROR_STOP=1 "$DATABASE_URL" -c "select private.reset_account_mfa('$ADMIN_UID', 'SIM-1')")" == "1" ]] ||
  { echo "db-test-hosted-sim: the support reset did not remove the authenticator app" >&2; exit 1; }
[[ "$(q "select (select count(*) from auth.mfa_factors where user_id = '$ADMIN_UID') + (select count(*) from auth.sessions where user_id = '$ADMIN_UID')")" == "0" ]] ||
  { echo "db-test-hosted-sim: the support reset must delete the apps and end every session in Auth" >&2; exit 1; }
[[ "$(q "select count(*) from platform.audit_events where action = 'platform.auth.mfa_reset' and data ->> 'reference' = 'SIM-1'")" == "1" ]] ||
  { echo "db-test-hosted-sim: the support reset must be audited" >&2; exit 1; }
if app_server_q "begin; set local role authenticated; select private.reset_account_mfa('$ADMIN_UID', 'SIM-2'); rollback" >/dev/null 2>&1; then
  echo "db-test-hosted-sim: the web app must not run the support reset" >&2; exit 1
fi
echo "db-test-hosted-sim: ending sessions and removing apps in Auth OK"

# Background jobs (T-M2-06a), as on staging: the worker installs graphile-worker's schema as app_queue —
# which holds no database privilege — on a database migrated by the non-superuser role, then dispatches
# the pending events.
echo "db-test-hosted-sim: worker passes (app_queue, app_worker)"
(cd "$ROOT" && pnpm --filter @jadarat/worker build >/dev/null)
# As in the Jobs workflow: under the deploy lock (shared), taken as app_worker (scripts/run-outside-deploy.sh).
worker_pass() {
  local worker_url
  worker_url="postgresql://app_worker:$(enc "$APP_WORKER_DB_PASSWORD")@$PGHOST:$PGPORT/$DB"
  DATABASE_URL="$worker_url" \
    DATABASE_URL_APP_QUEUE="postgresql://app_queue:$(enc "$APP_QUEUE_DB_PASSWORD")@$PGHOST:$PGPORT/$DB" \
    DATABASE_URL_APP_WORKER="$worker_url" \
    EMAIL_PROVIDER=none \
    bash "$ROOT/scripts/run-outside-deploy.sh" node "$ROOT/apps/worker/dist/main.mjs" once >/dev/null
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
