-- db-test: run-as=owner
-- Catalog checks for the security policy, MFA and sign-in session objects (T-M2-10): the definer functions
-- are tenant_guard's (invitation_guard's for the invitation rule) with exact EXECUTE grants; the decision
-- function is tenant_guard's alone; the factor and session views expose no secret and are tenant_guard's
-- alone; the private tables are forced-RLS and tenant_guard's alone; tenant_guard writes only what it
-- must. (10_catalog.sql lists every SECURITY DEFINER function; verify-deployment.sql repeats these.)
\set ON_ERROR_STOP on

begin;
do $$
declare
  r record;
  v_list text;
begin
  for r in select * from (values
      ('private.session_access(uuid,uuid,uuid,boolean,boolean)', 'tenant_guard', ''),
      ('private.session_access_state()', 'tenant_guard', 'authenticated'),
      ('private.dismiss_mfa_prompt()', 'tenant_guard', 'authenticated'),
      ('private.tenant_member_mfa(uuid)', 'tenant_guard', 'authenticated'),
      ('private.password_min_length_for_caller()', 'tenant_guard', 'authenticated'),
      ('private.tenant_lockout_policy(uuid)', 'tenant_guard', 'authenticated'),
      ('private.invitation_password_min_length(bytea)', 'invitation_guard', 'authenticated'),
      ('private.touch_session()', 'tenant_guard', 'authenticated'),
      ('private.my_sessions()', 'tenant_guard', 'authenticated'),
      ('private.end_my_sessions(uuid)', 'tenant_guard', 'authenticated'),
      ('private.tenant_member_sessions(uuid)', 'tenant_guard', 'authenticated'),
      ('private.end_member_sessions(uuid,uuid)', 'tenant_guard', 'authenticated')) as f (fn, owner, callers)
  loop
    perform tests.assert((select prosecdef and pg_get_userbyid(proowner) = r.owner
                                 and exists (select 1 from unnest(proconfig) c where c in ('search_path=""', 'search_path='))
                          from pg_proc where oid = r.fn::regprocedure),
      format('%s: SECURITY DEFINER, owner %s, empty search_path', r.fn, r.owner));
    select coalesce(string_agg(distinct case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, ','
                               order by case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end), '')
      into v_list
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = r.fn::regprocedure and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner;
    perform tests.assert_eq(v_list, r.callers, format('%s: EXECUTE for exactly %s', r.fn, r.callers));
  end loop;
  -- The invoker helpers the definer functions use are not callable by the request path.
  perform tests.assert((select not prosecdef from pg_proc where oid = 'private.password_min_length_of(uuid)'::regprocedure)
                       and not has_function_privilege('authenticated', 'private.password_min_length_of(uuid)', 'execute'),
    'password_min_length_of: invoker, tenant_guard only');

  -- Views over Auth: never a secret; SELECT for tenant_guard only.
  perform tests.assert_eq((select string_agg(a.attname, ', ' order by a.attnum) from pg_attribute a
                           where a.attrelid = 'private.auth_mfa_factor'::regclass and a.attnum > 0 and not a.attisdropped),
    'id, user_id, factor_type, status, created_at, updated_at', 'private.auth_mfa_factor: never the TOTP secret');
  perform tests.assert_eq((select string_agg(a.attname, ', ' order by a.attnum) from pg_attribute a
                           where a.attrelid = 'private.auth_session_validity'::regclass and a.attnum > 0 and not a.attisdropped),
    'id, user_id, not_after, created_at, updated_at, user_agent, aal', 'private.auth_session_validity: no address, no token');
  for r in select * from (values ('private.auth_mfa_factor'), ('private.auth_session_validity'),
                                 ('private.revoked_sessions'), ('private.mfa_prompt_dismissals')) as o (obj) loop
    foreach v_list in array array['anon', 'authenticated', 'app_server', 'app_worker', 'app_queue', 'invitation_guard',
                                  'account_mail_guard', 'service_role', 'supabase_auth_admin'] loop
      perform tests.assert(not has_table_privilege(v_list, r.obj, 'select, insert, update, delete, truncate, references, trigger'),
        format('%s must have no privilege on %s', v_list, r.obj));
    end loop;
    perform tests.assert(has_table_privilege('tenant_guard', r.obj, 'select'), format('tenant_guard reads %s', r.obj));
  end loop;
  perform tests.assert((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class
                        where oid in ('private.revoked_sessions'::regclass, 'private.mfa_prompt_dismissals'::regclass)),
    'private tables: row level security ENABLED and FORCED');
  -- tenant_guard: ends sessions and records "not now" — it cannot change ended sessions or Auth's data.
  perform tests.assert(not has_table_privilege('tenant_guard', 'private.revoked_sessions', 'update'),
    'tenant_guard never changes an ended session (only adds or purges)');
  perform tests.assert(not has_table_privilege('tenant_guard', 'auth.sessions', 'select')
                       and not has_table_privilege('tenant_guard', 'auth.mfa_factors', 'select'),
    'tenant_guard reads Auth only through the views');
  perform tests.assert(not has_table_privilege('tenant_guard', 'platform.security_policies', 'update')
                       and not has_any_column_privilege('tenant_guard', 'platform.security_policies', 'update'),
    'tenant_guard never changes a policy');
  perform tests.assert(not has_any_column_privilege('tenant_guard', 'platform.role_assignments', 'insert, update')
                       and not has_column_privilege('tenant_guard', 'platform.role_assignments', 'created_by', 'select'),
    'tenant_guard reads roles in force (columns), never changes them');
  -- The policy: request path updates the settings columns only, never inserts or deletes.
  perform tests.assert_eq((select string_agg(a.attname, ', ' order by a.attname::text collate "C") from pg_attribute a
                           where a.attrelid = 'platform.security_policies'::regclass and a.attnum > 0 and not a.attisdropped
                             and has_column_privilege('authenticated', a.attrelid, a.attnum, 'update')),
    'lockout_minutes, lockout_threshold, mfa_grace_days, mfa_mode, mfa_prompt_admins, mfa_required_roles, '
    'password_min_length, session_idle_minutes, session_max_devices, session_max_hours',
    'security_policies: the settings are the only updatable columns');
  perform tests.assert(not has_table_privilege('authenticated', 'platform.security_policies', 'insert, delete, truncate'),
    'security_policies: no insert / delete for the request path');
  perform tests.assert_eq((select string_agg(a.attname, ', ' order by a.attnum) from pg_attribute a
                           where a.attrelid = 'platform.security_policies'::regclass and a.attnum > 0 and not a.attisdropped
                             and has_column_privilege('invitation_guard', a.attrelid, a.attnum, 'select')),
    'tenant_id, password_min_length', 'invitation_guard reads the password rule only');
end $$;
rollback;

-- Ending a session in Auth removes the database marker with it (the web app signs ended sessions out).
begin;
do $$
begin
  insert into private.revoked_sessions (session_id, user_id, reason)
    values ('10000000-0000-4000-8000-000000000c16', '00000000-0000-4000-8000-000000000c01', 'user');
  delete from auth.sessions where id = '10000000-0000-4000-8000-000000000c16';
  perform tests.assert_eq((select count(*) from private.revoked_sessions where session_id = '10000000-0000-4000-8000-000000000c16'),
    0::bigint, 'the marker goes with the Auth session');
  perform tests.assert_fails($q$insert into private.revoked_sessions (session_id, user_id, reason) values ('10000000-0000-4000-8000-000000000c11', '00000000-0000-4000-8000-000000000c01', 'whim')$q$,
    array['23514'], 'reasons are user, admin or device_limit');
end $$;
rollback;

\echo '68_security_owner: ok'
