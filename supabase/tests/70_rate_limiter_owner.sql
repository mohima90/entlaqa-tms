-- db-test: run-as=owner
-- Shared rate limiter and sign-in protection (ADR 0011 §4, T-M2-11; migrations 20261013090000/0100):
-- owner, grants and shape, then the fixtures for 71_rate_limiter_app_server.sql (committed): expired
-- counters and an expired trusted browser that the app's calls must purge, an expired, used-up counter
-- whose window must start again, two trusted browsers (renewal), a former (revoked) member of A. Checked in
-- 72_rate_limiter_owner.sql.
\set ON_ERROR_STOP on

-- rate_limit_guard owns exactly the limiter functions (SECURITY DEFINER entry points, SECURITY INVOKER
-- helpers); nobody acts as it; it creates nothing and owns no relation.
do $$
declare
  v_list text;
  v_role text;
begin
  perform tests.assert(not (select rolbypassrls or rolcanlogin or rolsuper or rolinherit or rolcreaterole or rolcreatedb
                            from pg_roles where rolname = 'rate_limit_guard'),
    'rate_limit_guard must be NOLOGIN NOINHERIT and not BYPASSRLS / superuser / createrole / createdb');
  select string_agg(format('%s%s', p.oid::regprocedure, case when p.prosecdef then '' else ' (INVOKER)' end), ', '
                    order by p.oid::regprocedure::text) into v_list
  from pg_proc p where p.proowner = 'rate_limit_guard'::regrole;
  perform tests.assert_eq(v_list,
    'private.member_sign_in_lock(uuid,integer), '
    'private.rate_limit_account_subject(text) (INVOKER), private.rate_limit_check_call(text,bytea) (INVOKER), '
    'private.rate_limit_choose_device(bytea) (INVOKER), '
    'private.rate_limit_clear(text,bytea), private.rate_limit_count(text,bytea,integer,integer,boolean) (INVOKER), '
    'private.rate_limit_forget_other_devices(bytea,bytea), '
    'private.rate_limit_generate_keys() (INVOKER), private.rate_limit_give_back(text,bytea), '
    'private.rate_limit_hit(text,bytea,integer,integer), '
    'private.rate_limit_key(bytea) (INVOKER), private.rate_limit_lock_account_devices(bytea) (INVOKER), '
    'private.rate_limit_member_account(uuid) (INVOKER), private.rate_limit_normalize_email(text) (INVOKER), '
    'private.rate_limit_purge() (INVOKER), private.rate_limit_ref(bytea) (INVOKER), '
    'private.rate_limit_refund(text,bytea) (INVOKER), '
    'private.rate_limit_session_subject(uuid) (INVOKER), '
    'private.rate_limit_sign_in_check(bytea,bytea,bytea,integer,integer,integer,integer,integer,integer,integer,integer), '
    'private.rate_limit_sign_in_not_checked(bytea,bytea,boolean), '
    'private.rate_limit_sign_in_reset(bytea,bytea,bytea,integer), '
    'private.rate_limit_sign_in_succeeded(bytea,bytea,bytea,bytea,boolean,boolean,integer,uuid,bytea,boolean,integer), '
    'private.rate_limit_trust_after_code(bytea,bytea,integer), private.rate_limit_trust_device(bytea,bytea,integer) (INVOKER), '
    'private.rotate_rate_limit_keys(), private.sign_in_account_in_tenant(text,uuid), '
    'private.unlock_member_sign_in(uuid,integer)',
    'rate_limit_guard owns the limiter functions only; the entry points are SECURITY DEFINER');
  perform tests.assert(not exists (
      select 1 from pg_proc p where p.proowner = 'rate_limit_guard'::regrole
        and not exists (select 1 from unnest(p.proconfig) c where c = 'search_path=""' or c = 'search_path=')),
    'every limiter function pins an empty search_path');
  perform tests.assert(not exists (select 1 from pg_class c where c.relowner = 'rate_limit_guard'::regrole),
    'rate_limit_guard owns no relations');
  perform tests.assert(not exists (
      select 1 from pg_auth_members m join pg_roles u on u.oid = m.member
      where m.roleid = 'rate_limit_guard'::regrole and (m.inherit_option or m.set_option)
        and not u.rolsuper and u.rolname <> current_user),
    'nobody acts as rate_limit_guard');
  perform tests.assert(not has_schema_privilege('rate_limit_guard', 'private', 'CREATE')
                       and not has_schema_privilege('rate_limit_guard', 'platform', 'CREATE'),
    'rate_limit_guard creates nothing');
  -- What the Organization Admin functions read: their own organization's memberships and role assignments
  -- (a few columns, policies limited to the session's organization) and Auth addresses through the view —
  -- and, to decide by permission (EP-ROLES: platform.user.unlock_sign_in, standard or custom role), the
  -- permission catalogue, the standard roles' grants and the custom roles.
  perform tests.assert_eq(
    (select string_agg(format('%s.%s', a.attrelid::regclass, a.attname), ', '
                       order by a.attrelid::regclass::text, a.attname::text)
     from pg_attribute a
     where a.attrelid in (select c.oid from pg_class c join pg_namespace n on n.oid = c.relnamespace
                          where n.nspname = 'platform' and c.relkind in ('r', 'p', 'v'))
       and a.attnum > 0 and not a.attisdropped
       and has_column_privilege('rate_limit_guard', a.attrelid, a.attnum, 'select, insert, update, references')),
    'platform.custom_role_permissions.custom_role_id, platform.custom_role_permissions.permission_code, '
    'platform.custom_role_permissions.tenant_id, platform.custom_roles.code, platform.custom_roles.data_scope, '
    'platform.custom_roles.id, platform.custom_roles.tenant_id, platform.ref_permissions.code, '
    'platform.ref_permissions.custom_role_use, platform.ref_permissions.privileged, platform.ref_permissions.risk, platform.ref_role_permissions.permission_code, '
    'platform.ref_role_permissions.role_code, platform.ref_role_permissions.scope, '
    'platform.ref_roles.code, platform.ref_roles.is_privileged, '
    'platform.role_assignments.membership_id, platform.role_assignments.role_code, platform.role_assignments.tenant_id, '
    'platform.role_assignments.valid_from, platform.role_assignments.valid_until, platform.tenant_memberships.id, '
    'platform.tenant_memberships.person_id, platform.tenant_memberships.status, platform.tenant_memberships.tenant_id, '
    'platform.tenant_memberships.user_id',
    'rate_limit_guard reads exactly these platform columns (and writes none)');
  perform tests.assert_eq(
    (select string_agg(format('%s %s %s', p.tablename, p.cmd, p.qual), '; ' order by p.tablename)
     from pg_policies p where 'rate_limit_guard' = any (p.roles) and p.schemaname = 'platform'),
    'custom_role_permissions SELECT (tenant_id = ( SELECT private.current_tenant_id() AS current_tenant_id)); '
    'custom_roles SELECT (tenant_id = ( SELECT private.current_tenant_id() AS current_tenant_id)); '
    'ref_permissions SELECT true; ref_role_permissions SELECT true; ref_roles SELECT true; '
    'role_assignments SELECT (tenant_id = ( SELECT private.current_tenant_id() AS current_tenant_id)); '
    'tenant_memberships SELECT (tenant_id = ( SELECT private.current_tenant_id() AS current_tenant_id))',
    'rate_limit_guard sees its caller''s organization only (and the global permission catalogue)');
  perform tests.assert(not has_table_privilege('rate_limit_guard', 'auth.users', 'select')
                       and has_table_privilege('rate_limit_guard', 'private.auth_user_email', 'select'),
    'rate_limit_guard reads Auth addresses only through private.auth_user_email');
  -- Whether a signing-in user has an authenticator app (integration review L4): three columns of T-M2-10's
  -- view of Auth's factors, never the secret, never a write.
  perform tests.assert_eq(
    (select string_agg(a.attname, ', ' order by a.attnum) from pg_attribute a
     where a.attrelid = 'private.auth_mfa_factor'::regclass and a.attnum > 0 and not a.attisdropped
       and has_column_privilege('rate_limit_guard', a.attrelid, a.attnum, 'select')),
    'user_id, factor_type, status', 'rate_limit_guard reads exactly user_id, factor_type, status of private.auth_mfa_factor');
  perform tests.assert(not has_table_privilege('rate_limit_guard', 'private.auth_mfa_factor',
                                               'select, insert, update, delete, truncate, references, trigger')
                       and not has_any_column_privilege('rate_limit_guard', 'private.auth_mfa_factor', 'insert, update, references')
                       and not has_table_privilege('rate_limit_guard', 'auth.mfa_factors', 'select'),
    'rate_limit_guard: no table-level privilege on the factors view, and none on auth.mfa_factors');

  -- Callers: the entry points are executable by authenticated (each checks session_user = app_server —
  -- and the Organization Admin ones the claims — itself) and nobody else besides the owner; the helpers
  -- and the key rotation by the owner only.
  for v_list in
    select distinct format('%s → %s', p.oid::regprocedure,
                           case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end)
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.proowner = 'rate_limit_guard'::regrole and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner
      and (a.grantee = 0 or pg_get_userbyid(a.grantee) <> 'authenticated'
           or not p.prosecdef or p.proname = 'rotate_rate_limit_keys')
  loop
    perform tests.assert(false, format('unexpected EXECUTE: %s', v_list));
  end loop;
  perform tests.assert_eq(
    (select count(*)::int from pg_proc p
     where p.proowner = 'rate_limit_guard'::regrole and has_function_privilege('authenticated', p.oid, 'execute')),
    12, 'the web app (as authenticated) may call the twelve entry points');
  -- Beyond its own: the unlock notice of the account-mail pipeline (inside unlock_member_sign_in).
  perform tests.assert_eq(
    (select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
     from pg_proc p
     where p.proowner <> 'rate_limit_guard'::regrole
       and exists (select 1 from aclexplode(p.proacl) a where pg_get_userbyid(a.grantee) = 'rate_limit_guard')),
    'private.actor_may_manage_person_with(uuid,uuid,text[]), '
    'private.actor_role_codes(uuid,uuid), private.current_tenant_id(), private.has_active_membership(uuid,uuid), '
    'private.member_has_permission(uuid,uuid,text), private.member_permissions(uuid,uuid), '
    'private.membership_is_privileged(uuid,uuid), private.permission_feature(text), '
    'private.request_aal2(), private.request_claims(), private.request_code_fresh(), '
    'private.request_sign_in_unlocked_mail(uuid), private.request_user_id(), private.role_is_privileged(uuid,text), '
    'private.tenant_plan_features(uuid), private.try_uuid(text)',
    'rate_limit_guard may call exactly these other functions (the plan filter inside member_permissions, WP-ADM-06)');

  -- The keys, the counters and the trusted browsers: RLS forced, reachable by rate_limit_guard alone (no
  -- application role, no Supabase role, no other guard has any privilege, table or column).
  perform tests.assert((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'private.rate_limit_secret'::regclass)
                       and (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'private.rate_limit_counters'::regclass)
                       and (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'private.sign_in_trusted_devices'::regclass),
    'rate_limit_secret / rate_limit_counters / sign_in_trusted_devices: row level security must be ENABLED and FORCED');
  for v_role in select unnest(array['anon', 'authenticated', 'service_role', 'app_server', 'app_worker', 'app_queue',
                                    'tenant_guard', 'invitation_guard', 'account_mail_guard', 'membership_guard',
                                    'file_guard', 'user_import_guard', 'supabase_auth_admin']) loop
    perform tests.assert(
      not has_table_privilege(v_role, 'private.rate_limit_secret', 'select, insert, update, delete, truncate, references, trigger')
        and not has_any_column_privilege(v_role, 'private.rate_limit_secret', 'select, insert, update, references')
        and not has_table_privilege(v_role, 'private.rate_limit_counters', 'select, insert, update, delete, truncate, references, trigger')
        and not has_any_column_privilege(v_role, 'private.rate_limit_counters', 'select, insert, update, references')
        and not has_table_privilege(v_role, 'private.sign_in_trusted_devices', 'select, insert, update, delete, truncate, references, trigger')
        and not has_any_column_privilege(v_role, 'private.sign_in_trusted_devices', 'select, insert, update, references'),
      format('%s must have no privilege on the limiter''s keys, counters or trusted browsers', v_role));
  end loop;
  perform tests.assert(has_table_privilege('rate_limit_guard', 'private.rate_limit_secret', 'select, update')
                       and not has_table_privilege('rate_limit_guard', 'private.rate_limit_secret', 'insert')
                       and not has_table_privilege('rate_limit_guard', 'private.rate_limit_secret', 'delete')
                       and not has_table_privilege('rate_limit_guard', 'private.rate_limit_secret', 'truncate'),
    'rate_limit_guard reads the keys and replaces them (rotation); it never adds or removes the row');

  -- Shape: the counters hold a bucket, a 32-byte keyed hash, a count and the window's end; the trusted
  -- browsers two keyed hashes and dates — no column for a readable key. Counters are unlogged (ADR 0011
  -- §4). The secret: one row of HMAC-SHA-256 padded keys (64 bytes each, inner xor outer = 0x36 xor 0x5c
  -- for every byte: each pair derives from one key) for two different keys.
  select string_agg(a.attname, ', ' order by a.attnum) into v_list
  from pg_attribute a where a.attrelid = 'private.rate_limit_counters'::regclass and a.attnum > 0 and not a.attisdropped;
  perform tests.assert_eq(v_list, 'bucket, key_hash, hits, reset_at', 'rate_limit_counters columns');
  perform tests.assert_eq((select relpersistence::text from pg_class where oid = 'private.rate_limit_counters'::regclass), 'u',
    'rate_limit_counters is UNLOGGED');
  select string_agg(a.attname, ', ' order by a.attnum) into v_list
  from pg_attribute a where a.attrelid = 'private.sign_in_trusted_devices'::regclass and a.attnum > 0 and not a.attisdropped;
  perform tests.assert_eq(v_list, 'account_key, device_key, created_at, expires_at', 'sign_in_trusted_devices columns');
  perform tests.assert_eq((select count(*)::int from private.rate_limit_secret), 1, 'one limiter key row');
  perform tests.assert((select octet_length(inner_key) = 64 and octet_length(outer_key) = 64
                               and not exists (select 1 from generate_series(0, 63) i
                                               where (get_byte(inner_key, i) # get_byte(outer_key, i)) <> 106)  -- 0x6a
                               and not exists (select 1 from generate_series(0, 63) i
                                               where (get_byte(log_inner_key, i) # get_byte(log_outer_key, i)) <> 106)
                               and inner_key <> log_inner_key
                        from private.rate_limit_secret),
    'the secret holds HMAC-SHA-256''s padded keys of two different 64-byte keys (counter, log)');
  perform tests.assert_check_constraint(
    'insert into private.rate_limit_secret (id, inner_key, outer_key, log_inner_key, log_outer_key) '
    'select false, z.k, z.k, z.k, z.k from (select decode(repeat(''00'', 64), ''hex'') as k) z',
    'rate_limit_secret_single_row', 'only one limiter key row can exist');
end $$;

-- Fixtures for 71 (committed). A former member of A (uRev, urev@a.test, membership revoked): its account
-- is no longer the business of A's Organization Admin (security review T-M2-11 M1). Removed in 72.
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000a5', 'urev@a.test');
insert into platform.persons (id, tenant_id, display_name_ar, email) values
  ('a1000000-0000-4000-8000-0000000000a5', 'a0000000-0000-4000-8000-000000000001', 'عضو سابق', 'urev@a.test');
insert into platform.tenant_memberships (tenant_id, user_id, person_id, status) values
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a5', 'a1000000-0000-4000-8000-0000000000a5', 'revoked');
-- Subjects are SHA-256 values like the app's (tests use sha256 of a label).
-- Accounts that sign in (rate_limit_sign_in_succeeded in 71) are real: the token's user must be the
-- account that signed in (integration review hardening), so each has an Auth user whose address gives its
-- subject — tests.rate_limit_account(address), the web app's accountSubject computed independently here
-- (checked against private.rate_limit_account_subject below) — and 71 passes that user's id. 7108 has no
-- address (a phone-only account): it never counts as the signed-in account.
create or replace function tests.rate_limit_account(p_email text) returns bytea
language sql immutable as $$
  select sha256(convert_to('jadarat.rate-limit.v1' || chr(10) || 'account' || chr(10) || p_email, 'UTF8'));
$$;
grant execute on function tests.rate_limit_account(text) to public;
do $$ begin
  perform tests.assert_eq(tests.rate_limit_account('rl-y@a.test'), private.rate_limit_account_subject(' RL-Y@a.test '),
    'tests.rate_limit_account is the account subject of a (normalised) address');
end $$;
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000007101', 'rl-y@a.test'),
  ('00000000-0000-4000-8000-000000007102', 'rl-z@a.test'),
  ('00000000-0000-4000-8000-000000007103', 'rl-q@a.test'),
  ('00000000-0000-4000-8000-000000007104', 'rl-p@a.test'),
  ('00000000-0000-4000-8000-000000007105', 'rl-w@a.test'),
  ('00000000-0000-4000-8000-000000007106', 'rl-renewed@a.test'),
  ('00000000-0000-4000-8000-000000007107', 'rl-kept@a.test'),
  ('00000000-0000-4000-8000-000000007108', null),
  ('00000000-0000-4000-8000-000000007111', 'rl-ok-1@a.test'),
  ('00000000-0000-4000-8000-000000007112', 'rl-ok-2@a.test'),
  ('00000000-0000-4000-8000-000000007113', 'rl-ok-3@a.test'),
  ('00000000-0000-4000-8000-000000007114', 'rl-ok-4@a.test'),
  ('00000000-0000-4000-8000-000000007115', 'rl-ok-5@a.test');
-- 30 counters expired an hour ago (bucket tests.purge): the hits of 71 remove them (20 per hit at most).
insert into private.rate_limit_counters (bucket, key_hash, hits, reset_at)
select 'tests.purge', sha256(convert_to('purge-' || i, 'UTF8')), 3, now() - interval '1 hour'
from generate_series(1, 30) i;
-- A used-up counter whose window ended a second ago (bucket tests.window, subject 'window'): the next hit
-- starts a new window.
insert into private.rate_limit_counters (bucket, key_hash, hits, reset_at)
values ('tests.window', private.rate_limit_key(sha256(convert_to('window', 'UTF8'))), 4, now() - interval '1 second');
-- A trusted browser whose trust ended a day ago (account 'purged-account', browser 'purged-device'): the
-- calls of 71 remove it, and it trusts nothing meanwhile. Two browsers trusted for 10 more days (accounts
-- rl-renewed@a.test / rl-kept@a.test, browsers 'renewed-device' / 'kept-device'): a ticked sign-in renews
-- the trust (sliding), an unticked one does not.
insert into private.sign_in_trusted_devices (account_key, device_key, created_at, expires_at)
values (private.rate_limit_key(sha256(convert_to('purged-account', 'UTF8'))),
        private.rate_limit_key(sha256(convert_to('purged-device', 'UTF8'))),
        now() - interval '31 days', now() - interval '1 day'),
       (private.rate_limit_key(tests.rate_limit_account('rl-renewed@a.test')),
        private.rate_limit_key(sha256(convert_to('renewed-device', 'UTF8'))),
        now() - interval '20 days', now() + interval '10 days'),
       (private.rate_limit_key(tests.rate_limit_account('rl-kept@a.test')),
        private.rate_limit_key(sha256(convert_to('kept-device', 'UTF8'))),
        now() - interval '20 days', now() + interval '10 days');

\echo '70_rate_limiter_owner: ok'
