-- db-test: run-as=owner
-- Catalog checks for the security policy, MFA and sign-in session objects (T-M2-10): the definer functions
-- are tenant_guard's (invitation_guard's for the invitation rule) with exact EXECUTE grants; the decision
-- function is tenant_guard's alone; the factor and session views expose no secret and are tenant_guard's
-- alone (SELECT, DELETE); the private tables are forced-RLS and tenant_guard's alone. Then what only the owner
-- can observe: the e-mailed code of a new app (re-review N1: only the session that set it up confirms it), the
-- Auth rows that ending a session, removing an app, the "not you" link, the purge of unconfirmed apps (re-review
-- N2) and the resets delete (security review M1/H1/M2) — the web app's and the worker's calls made as app_server
-- / app_worker (SET SESSION AUTHORIZATION), Auth's tables read and prepared as owner.
-- (10_catalog.sql lists every SECURITY DEFINER function; verify-deployment.sql repeats these.)
\set ON_ERROR_STOP on

begin;
do $$
declare
  r record;
  v_list text;
begin
  for r in select * from (values
      ('private.session_access(uuid,uuid,uuid,boolean,boolean)', 'tenant_guard', ''),
      ('private.request_aal2()', 'tenant_guard', 'authenticated'),
      ('private.request_code_fresh()', 'tenant_guard', 'authenticated'),
      ('private.request_session_facts()', 'tenant_guard', 'authenticated'),
      ('private.session_access_state()', 'tenant_guard', 'authenticated'),
      ('private.dismiss_mfa_prompt()', 'tenant_guard', 'authenticated'),
      ('private.tenant_member_mfa(uuid)', 'tenant_guard', 'authenticated'),
      ('private.password_min_length_for_caller()', 'tenant_guard', 'authenticated'),
      ('private.tenant_lockout_policy(uuid)', 'tenant_guard', 'authenticated'),
      ('private.invitation_password_min_length(bytea)', 'invitation_guard', 'authenticated'),
      ('private.touch_session()', 'tenant_guard', 'authenticated'),
      ('private.apply_device_limit()', 'tenant_guard', 'authenticated'),
      ('private.my_sessions()', 'tenant_guard', 'authenticated'),
      ('private.end_my_sessions(uuid)', 'tenant_guard', 'authenticated'),
      ('private.tenant_member_sessions(uuid)', 'tenant_guard', 'authenticated'),
      ('private.end_member_sessions(uuid,uuid)', 'tenant_guard', 'authenticated'),
      ('private.purge_ended_sessions(integer)', 'tenant_guard', 'authenticated'),
      ('private.request_mfa_factor_mail(uuid)', 'tenant_guard', 'authenticated'),
      ('private.confirm_mfa_setup(uuid,text)', 'tenant_guard', 'authenticated'),
      ('private.my_mfa_apps()', 'tenant_guard', 'authenticated'),
      ('private.remove_mfa_app(uuid)', 'tenant_guard', 'authenticated'),
      ('private.issue_mfa_factor_tokens(uuid,uuid,bytea,bytea)', 'tenant_guard', 'authenticated'),
      ('private.account_has_app(uuid)', 'tenant_guard', 'authenticated'),
      ('private.reject_mfa_factor(bytea)', 'tenant_guard', 'authenticated'),
      ('private.purge_unconfirmed_mfa_apps(integer)', 'tenant_guard', 'authenticated'),
      ('private.reset_member_mfa(uuid)', 'tenant_guard', 'authenticated'),
      ('private.reset_account_mfa(uuid,text)', 'tenant_guard', current_user::text),
      -- Internal: tenant_guard's own functions only.
      ('private.audit_account_event(uuid,text,jsonb,text,uuid,uuid)', 'tenant_guard', ''),
      ('private.end_sessions(uuid,uuid[],uuid,text,uuid)', 'tenant_guard', ''),
      ('private.enforce_device_limit(uuid,uuid,uuid)', 'tenant_guard', ''),
      ('private.queue_mfa_mail(text,uuid,uuid,text,uuid)', 'tenant_guard', ''),
      ('private.remove_account_factors(uuid,uuid[])', 'tenant_guard', ''),
      ('private.end_all_account_sessions(uuid,uuid,uuid)', 'tenant_guard', ''),
      ('private.request_live_user()', 'tenant_guard', ''),
      ('private.security_policy_changed_mail()', 'tenant_guard', '')) as f (fn, owner, callers)
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
  -- Platform constants, one place each (PO answers of 9 Oct 2026; TM-0003 T-IAM-11; review H1, re-review N1).
  perform tests.assert_eq(private.mfa_prompt_reask_after(), interval '30 days', '"not now" asks again after 30 days');
  perform tests.assert_eq(private.mfa_no_grace_roles(), array['tenant_admin'], 'no grace period: the Organization Admin');
  perform tests.assert_eq(private.step_up_max_age(), interval '15 minutes', 'a high-risk action: a code from the last 15 minutes');
  perform tests.assert_eq(private.mfa_code_lifetime(), interval '72 hours',
    'the set-up code: 72 hours (longer than any sign-in session: 24 hours at most)');
  perform tests.assert_eq(private.mfa_code_max_attempts(), 5::smallint, 'the set-up code: 5 tries');
  perform tests.assert_eq(private.mfa_code_resend_after(), interval '2 minutes', '"send again": every 2 minutes at most');
  perform tests.assert_eq(private.mfa_remove_link_lifetime(), interval '7 days', '"not you" link: 7 days');
  perform tests.assert_eq(private.mfa_code_account_max_failures(), 15, 'per account: 15 wrong set-up codes…');
  perform tests.assert_eq(private.mfa_code_failure_window(), interval '24 hours', '…within 24 hours (final re-review L2)');
  perform tests.assert_eq(private.security_notice_daily_ceiling(), 20,
    'per account: 20 security notices a day one by one… (final re-review L1)');
  perform tests.assert_eq(private.security_digest_after(), interval '1 hour', '…then one digest an hour');
  perform tests.assert(private.mfa_code_lifetime() > interval '24 hours'
                       and private.mfa_code_max_attempts() = (select (regexp_match(pg_get_constraintdef(c.oid), '<= (\d+)'))[1]::smallint
                                                              from pg_constraint c
                                                              where c.conname = 'mfa_factor_confirmations_code_attempts_check'),
    'the code outlives the session that set the app up; the tries match the table''s check');

  -- Views over Auth: never a secret or a token; SELECT and DELETE for tenant_guard only.
  perform tests.assert_eq((select string_agg(a.attname, ', ' order by a.attnum) from pg_attribute a
                           where a.attrelid = 'private.auth_mfa_factor'::regclass and a.attnum > 0 and not a.attisdropped),
    'id, user_id, factor_type, status, created_at, updated_at', 'private.auth_mfa_factor: never the TOTP secret');
  perform tests.assert_eq((select string_agg(a.attname, ', ' order by a.attnum) from pg_attribute a
                           where a.attrelid = 'private.auth_session_validity'::regclass and a.attnum > 0 and not a.attisdropped),
    'id, user_id, not_after, created_at, updated_at, user_agent, aal, factor_id', 'private.auth_session_validity: no address, no token');
  for r in select * from (values ('private.auth_mfa_factor'), ('private.auth_session_validity'),
                                 ('private.revoked_sessions'), ('private.mfa_prompt_dismissals'),
                                 ('private.mfa_factor_confirmations'), ('private.mfa_setup_code_failures'),
                                 ('private.security_notice_digests')) as o (obj) loop
    foreach v_list in array array['anon', 'authenticated', 'app_server', 'app_worker', 'app_queue', 'invitation_guard',
                                  'account_mail_guard', 'tenant_guard', 'service_role', 'supabase_auth_admin'] loop
      continue when v_list = case when r.obj = 'private.security_notice_digests' then 'account_mail_guard'
                                  else 'tenant_guard' end;
      perform tests.assert(not has_table_privilege(v_list, r.obj, 'select, insert, update, delete, truncate, references, trigger'),
        format('%s must have no privilege on %s', v_list, r.obj));
    end loop;
    perform tests.assert(has_table_privilege(case when r.obj = 'private.security_notice_digests' then 'account_mail_guard'
                                                  else 'tenant_guard' end, r.obj, 'select'),
      format('its guard reads %s', r.obj));
  end loop;
  perform tests.assert(not has_table_privilege('tenant_guard', 'private.security_notice_digests', 'select, insert, update, delete')
                       and not has_table_privilege('account_mail_guard', 'private.mfa_setup_code_failures', 'select, insert, delete'),
    'the digests are account_mail_guard''s alone, the wrong-code count tenant_guard''s alone');
  perform tests.assert(has_table_privilege('tenant_guard', 'private.auth_mfa_factor', 'delete')
                       and has_table_privilege('tenant_guard', 'private.auth_session_validity', 'delete')
                       and not has_table_privilege('tenant_guard', 'private.auth_mfa_factor', 'insert, update')
                       and not has_table_privilege('tenant_guard', 'private.auth_session_validity', 'insert, update'),
    'tenant_guard deletes through the Auth views (removal, sign-out), never inserts or changes');
  perform tests.assert((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class
                        where oid in ('private.revoked_sessions'::regclass, 'private.mfa_prompt_dismissals'::regclass,
                                      'private.mfa_factor_confirmations'::regclass,
                                      'private.mfa_setup_code_failures'::regclass,
                                      'private.security_notice_digests'::regclass)),
    'private tables: row level security ENABLED and FORCED');
  -- tenant_guard: ends sessions and records "not now" — it cannot change ended sessions or Auth's data.
  perform tests.assert(not has_table_privilege('tenant_guard', 'private.revoked_sessions', 'update'),
    'tenant_guard never changes an ended session (only adds or purges)');
  perform tests.assert(not has_table_privilege('tenant_guard', 'auth.sessions', 'select, delete')
                       and not has_table_privilege('tenant_guard', 'auth.mfa_factors', 'select, delete'),
    'tenant_guard reaches Auth only through the views');
  perform tests.assert(not has_table_privilege('tenant_guard', 'platform.security_policies', 'update')
                       and not has_any_column_privilege('tenant_guard', 'platform.security_policies', 'update'),
    'tenant_guard never changes a policy');
  perform tests.assert(not has_any_column_privilege('tenant_guard', 'platform.role_assignments', 'insert, update')
                       and not has_column_privilege('tenant_guard', 'platform.role_assignments', 'created_by', 'select'),
    'tenant_guard reads roles in force (columns), never changes them');
  perform tests.assert(not has_table_privilege('tenant_guard', 'platform.audit_events', 'update, delete, select'),
    'tenant_guard only adds audit rows');
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

-- tenant_guard's audit rows: an allow-list of account-level security events only.
begin;
set local role tenant_guard;
do $$
begin
  perform tests.assert_fails($q$insert into platform.audit_events (tenant_id, action) values ('a0000000-0000-4000-8000-000000000001', 'platform.user.updated')$q$,
    array['42501'], 'tenant_guard cannot write other audit events');
end $$;
rollback;

-- A marker outlives the Auth session it ended (the browser holding that session is told why), and markers
-- carry one of the known reasons.
begin;
do $$
begin
  insert into private.revoked_sessions (session_id, user_id, reason)
    values ('10000000-0000-4000-8000-000000000c16', '00000000-0000-4000-8000-000000000c01', 'user');
  delete from auth.sessions where id = '10000000-0000-4000-8000-000000000c16';
  perform tests.assert_eq((select count(*) from private.revoked_sessions where session_id = '10000000-0000-4000-8000-000000000c16'),
    1::bigint, 'the marker stays after Auth deleted the session');
  perform tests.assert_eq((private.session_access('00000000-0000-4000-8000-000000000c01', '10000000-0000-4000-8000-000000000c16',
                                                  'a0000000-0000-4000-8000-000000000001', false, false)).state, 'ended',
    '…and the session reads as ended');
  perform tests.assert_fails($q$insert into private.revoked_sessions (session_id, user_id, reason) values ('10000000-0000-4000-8000-000000000c11', '00000000-0000-4000-8000-000000000c01', 'whim')$q$,
    array['23514'], 'reasons are user, admin, device_limit, expired or security');
end $$;
rollback;

-- "Not now" (PO decision 2) is remembered for 30 days, then the prompt comes back (PO answer, 9 Oct 2026).
begin;
do $$
begin
  insert into private.mfa_prompt_dismissals (tenant_id, user_id, dismissed_at)
    values ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', now() - interval '29 days');
  perform tests.assert_eq((private.session_access('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
                                                  'a0000000-0000-4000-8000-000000000001', false, true)).state, 'ok',
    'dismissed 29 days ago: not asked');
  update private.mfa_prompt_dismissals set dismissed_at = now() - interval '31 days';
  perform tests.assert_eq((private.session_access('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
                                                  'a0000000-0000-4000-8000-000000000001', false, true)).state, 'prompt_admin',
    'dismissed 31 days ago: asked again');
end $$;
rollback;

-- Ending sessions deletes them in Auth too (review M1): force sign-out by an Organization Admin…
begin;
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c09', '10000000-0000-4000-8000-000000000c91',
                                          'a0000000-0000-4000-8000-000000000001') || tests.fresh_code());
do $$
begin
  perform tests.assert_eq(private.end_member_sessions('a1000000-0000-4000-8000-000000000c03', null), 2, 'uS3''s two sessions in A');
end $$;
set local session authorization default;
do $$
begin
  perform tests.assert_eq((select count(*) from auth.sessions where id in ('10000000-0000-4000-8000-000000000c31',
                                                                          '10000000-0000-4000-8000-000000000c32')),
    0::bigint, 'force sign-out: the Auth sessions are gone');
  perform tests.assert_eq((select count(*) from auth.sessions where id = '10000000-0000-4000-8000-000000000c33'), 1::bigint,
    'the session in B stays (T-IAM-40)');
  perform tests.assert_eq((select string_agg(reason || ':' || revoked_by, ',') from private.revoked_sessions
                           where user_id = '00000000-0000-4000-8000-000000000c03'),
    'admin:00000000-0000-4000-8000-000000000c09,admin:00000000-0000-4000-8000-000000000c09', 'marked: by the admin');
end $$;
rollback;

-- …the account's own "end other sessions", and the device limit.
begin;
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c01', '10000000-0000-4000-8000-000000000c11',
                                          'a0000000-0000-4000-8000-000000000001'));
select private.end_my_sessions(null);
select tests.set_claims(jsonb_build_object('role', 'authenticated', 'sub', '00000000-0000-4000-8000-000000000c02',
                                           'session_id', '10000000-0000-4000-8000-000000000c25'));
select private.switch_active_tenant('a0000000-0000-4000-8000-000000000001');
set local session authorization default;
do $$
begin
  perform tests.assert_eq((select count(*) from auth.sessions where id in ('10000000-0000-4000-8000-000000000c16',
                                                                          '10000000-0000-4000-8000-000000000c17')),
    0::bigint, 'end other sessions: gone in Auth');
  perform tests.assert_eq((select count(*) from auth.sessions where id = '10000000-0000-4000-8000-000000000c11'), 1::bigint,
    'the current session stays');
  perform tests.assert_eq((select count(*) from auth.sessions where id = '10000000-0000-4000-8000-000000000c21'), 0::bigint,
    'device limit: the oldest session is gone in Auth');
  perform tests.assert_eq((select reason from private.revoked_sessions where session_id = '10000000-0000-4000-8000-000000000c21'),
    'device_limit', '…marked device_limit');
end $$;
rollback;

-- Set-up e-mail and the e-mailed code (re-review N1, T-IAM-11): only the Auth session that set the app up
-- (passed its first code: aal2 through that factor) records it and confirms it with the code.
begin;
-- The fixture's waiting notice and record are removed: the web app records the app and queues the e-mail.
delete from private.account_mail_requests where user_id = '00000000-0000-4000-8000-000000000c08';
delete from private.mfa_factor_confirmations where factor_id = '20000000-0000-4000-8000-000000000c08';
set local session authorization app_server;
set local role authenticated;
-- Another sign-in of the account (Auth: aal1, no factor) cannot record the app as its own, even claiming aal2.
select tests.set_claims(jsonb_build_object('role', 'authenticated', 'sub', '00000000-0000-4000-8000-000000000c08',
                                           'session_id', '10000000-0000-4000-8000-000000000c82', 'aal', 'aal2'));
do $$
begin
  perform tests.assert_eq(private.request_mfa_factor_mail('20000000-0000-4000-8000-000000000c08'), 'refused',
    'only the session that passed the app''s code records it');
end $$;
-- The session that set it up, but with an aal1 token: refused too.
select tests.set_claims(jsonb_build_object('role', 'authenticated', 'sub', '00000000-0000-4000-8000-000000000c08',
                                           'session_id', '10000000-0000-4000-8000-000000000c81', 'aal', 'aal1'));
do $$
begin
  perform tests.assert_eq(private.request_mfa_factor_mail('20000000-0000-4000-8000-000000000c08'), 'refused',
    'an aal1 token: not recorded');
end $$;
-- Before an organization is chosen (no tenant claim): the set-up is still recorded, e-mailed and audited.
select tests.set_claims(jsonb_build_object('role', 'authenticated', 'sub', '00000000-0000-4000-8000-000000000c08',
                                           'session_id', '10000000-0000-4000-8000-000000000c81', 'aal', 'aal2'));
do $$
begin
  perform tests.assert_eq(private.request_mfa_factor_mail('20000000-0000-4000-8000-000000000c08'), 'queued',
    'the set-up e-mail is queued');
  perform tests.assert_eq(private.request_mfa_factor_mail('20000000-0000-4000-8000-000000000c08'), 'waiting',
    'one waits already: not queued twice');
  perform tests.assert_eq(private.request_mfa_factor_mail('20000000-0000-4000-8000-000000000c04'), 'refused',
    'not another account''s app');
  perform tests.assert_eq(private.request_mfa_factor_mail(null), 'refused', 'no app');
  perform tests.assert_eq(private.confirm_mfa_setup('20000000-0000-4000-8000-000000000c08', '40718263'), 'invalid',
    'no code e-mailed yet');
end $$;
set local session authorization default;
do $$
begin
  perform tests.assert((select confirmed_at is null and session_id = '10000000-0000-4000-8000-000000000c81'
                               and setup_user_agent like '%Firefox/131.0' and code_attempts = 0
                        from private.mfa_factor_confirmations where factor_id = '20000000-0000-4000-8000-000000000c08'),
    'recorded with the session that set it up and its browser, waiting for the code');
  perform tests.assert_eq((select count(*) from private.account_mail_requests
                           where kind = 'mfa_factor_added' and user_id = '00000000-0000-4000-8000-000000000c08'
                             and factor_id = '20000000-0000-4000-8000-000000000c08'), 1::bigint, 'one set-up notice waits');
  perform tests.assert_eq((select count(*) from platform.audit_events
                           where action = 'platform.auth.mfa_enrolled' and entity_id = '00000000-0000-4000-8000-000000000c08'
                             and tenant_id = 'a0000000-0000-4000-8000-000000000001'
                             and actor_user_id = '00000000-0000-4000-8000-000000000c08'
                             and actor_person_id = 'a1000000-0000-4000-8000-000000000c08'
                             and data = '{"method": "totp", "confirmed": false}'::jsonb), 1::bigint,
    'audited in the account''s organization, without an organization chosen');
  -- What the worker stores when it writes the e-mail (69 checks the worker's own call).
  update private.mfa_factor_confirmations
  set code_hash = tests.mfa_code_hash('20000000-0000-4000-8000-000000000c08', '40718263'),
      code_expires_at = now() + interval '1 hour', code_issued_at = now(),
      remove_token_hash = tests.token_hash('remove-m4'), remove_expires_at = now() + interval '1 hour'
  where factor_id = '20000000-0000-4000-8000-000000000c08';
end $$;
-- THE ATTACK (re-review N1): the mailbox owner's other session, with the right code from the e-mail, cannot
-- confirm an app someone else set up — not at AAL1, not claiming aal2.
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c08', '10000000-0000-4000-8000-000000000c82',
                                          'a0000000-0000-4000-8000-000000000001'));
do $$
begin
  perform tests.assert_eq(private.confirm_mfa_setup('20000000-0000-4000-8000-000000000c08', '40718263'), 'refused',
    'the owner''s other session, AAL1, with the right code: refused');
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c08', '10000000-0000-4000-8000-000000000c82',
                                             'a0000000-0000-4000-8000-000000000001') || tests.fresh_code());
  perform tests.assert_eq(private.confirm_mfa_setup('20000000-0000-4000-8000-000000000c08', '40718263'), 'refused',
    'the owner''s other session claiming aal2, with the right code: refused');
  -- The session that set it up, but with an aal1 token: refused.
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c08', '10000000-0000-4000-8000-000000000c81',
                                             'a0000000-0000-4000-8000-000000000001'));
  perform tests.assert_eq(private.confirm_mfa_setup('20000000-0000-4000-8000-000000000c08', '40718263'), 'refused',
    'the set-up session with an aal1 token: refused');
end $$;
set local session authorization default;
do $$
begin
  perform tests.assert((select confirmed_at is null and code_attempts = 0 and code_hash is not null
                        from private.mfa_factor_confirmations where factor_id = '20000000-0000-4000-8000-000000000c08'),
    'refused attempts confirm nothing and use no try');
end $$;
-- The session that set it up, at aal2 through that app: wrong codes count, the right one confirms, once.
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c08', '10000000-0000-4000-8000-000000000c81',
                                          'a0000000-0000-4000-8000-000000000001') || tests.fresh_code());
do $$
begin
  perform tests.assert_eq(private.confirm_mfa_setup('20000000-0000-4000-8000-000000000c08', '00000000'), 'invalid', 'a wrong code');
  perform tests.assert_eq(private.confirm_mfa_setup('20000000-0000-4000-8000-000000000c08', '4071826'), 'invalid', 'not 8 digits');
  perform tests.assert_eq(private.confirm_mfa_setup('20000000-0000-4000-8000-000000000c08', null), 'invalid', 'no code');
  perform tests.assert_eq(private.confirm_mfa_setup('20000000-0000-4000-8000-000000000c04', '40718263'), 'refused',
    'not another account''s app');
  perform tests.assert_eq(private.confirm_mfa_setup(null, '40718263'), 'refused', 'no app');
  perform tests.assert(not private.request_aal2(), 'not AAL2 before the code');
  perform tests.assert_eq(private.confirm_mfa_setup('20000000-0000-4000-8000-000000000c08', '40718263'), 'confirmed',
    'the right code in the session that set the app up');
  perform tests.assert_eq(private.confirm_mfa_setup('20000000-0000-4000-8000-000000000c08', '40718263'), 'refused',
    'single use: already confirmed');
  perform tests.assert_eq(private.request_mfa_factor_mail('20000000-0000-4000-8000-000000000c08'), 'refused',
    'confirmed: no more set-up e-mail');
  -- From now on uM4's code counts: its session (aal2 through that app) is at AAL2.
  perform tests.assert(private.request_aal2(), 'a confirmed app gives AAL2');
  perform tests.assert((select here and confirmed from private.my_mfa_apps()), 'listed as confirmed');
end $$;
set local session authorization default;
do $$
begin
  perform tests.assert((select confirmed_at is not null and code_hash is null and code_expires_at is null and code_attempts = 0
                        from private.mfa_factor_confirmations where factor_id = '20000000-0000-4000-8000-000000000c08'),
    'confirmed; the code is gone');
  perform tests.assert_eq((select count(*) from platform.audit_events where action = 'platform.auth.mfa_confirmed'
                             and entity_id = '00000000-0000-4000-8000-000000000c08'), 1::bigint, 'the confirmation is audited');
end $$;
rollback;

-- An app whose set-up e-mail could not be asked for (not recorded): the Auth session that passed its code sees
-- it "here" and "send again" records it; another sign-in sees it as added elsewhere.
begin;
delete from private.account_mail_requests where user_id = '00000000-0000-4000-8000-000000000c08';
delete from private.mfa_factor_confirmations where factor_id = '20000000-0000-4000-8000-000000000c08';
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c08', '10000000-0000-4000-8000-000000000c82',
                                          'a0000000-0000-4000-8000-000000000001'));
do $$
begin
  perform tests.assert((select not here and not confirmed and user_agent is null from private.my_mfa_apps()),
    'not recorded: another sign-in sees it as added elsewhere (no browser known)');
end $$;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c08', '10000000-0000-4000-8000-000000000c81',
                                          'a0000000-0000-4000-8000-000000000001') || tests.fresh_code());
do $$
begin
  perform tests.assert((select here and not confirmed from private.my_mfa_apps()),
    'not recorded: the session that passed its code sees it here');
  perform tests.assert_eq(private.request_mfa_factor_mail('20000000-0000-4000-8000-000000000c08'), 'queued',
    '"send again" records it and asks for the e-mail');
  perform tests.assert((select here and set_up_at > now() - interval '1 minute' and user_agent like '%Firefox/131.0'
                        from private.my_mfa_apps()), 'recorded with its browser');
end $$;
rollback;

-- An expired code, five wrong tries, and "send again" from the session that set the app up.
begin;
update private.mfa_factor_confirmations
set code_hash = tests.mfa_code_hash('20000000-0000-4000-8000-000000000c08', '40718263'),
    code_expires_at = now() - interval '1 minute', code_issued_at = now() - interval '72 hours'
where factor_id = '20000000-0000-4000-8000-000000000c08';
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c08', '10000000-0000-4000-8000-000000000c81',
                                          'a0000000-0000-4000-8000-000000000001') || tests.fresh_code());
do $$
begin
  perform tests.assert_eq(private.confirm_mfa_setup('20000000-0000-4000-8000-000000000c08', '40718263'), 'expired', 'an expired code');
  perform tests.assert_eq(private.request_mfa_factor_mail('20000000-0000-4000-8000-000000000c08'), 'waiting',
    'send again while an e-mail is on its way: it is the one');
end $$;
set local session authorization default;
delete from private.account_mail_requests where user_id = '00000000-0000-4000-8000-000000000c08';
update private.mfa_factor_confirmations
set code_expires_at = now() + interval '1 hour', code_issued_at = now() - interval '1 minute'
where factor_id = '20000000-0000-4000-8000-000000000c08';
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c08', '10000000-0000-4000-8000-000000000c81',
                                          'a0000000-0000-4000-8000-000000000001') || tests.fresh_code());
do $$
begin
  perform tests.assert_eq(private.request_mfa_factor_mail('20000000-0000-4000-8000-000000000c08'), 'too_soon',
    'send again a minute after the last e-mail: too soon');
  for i in 1..4 loop
    perform tests.assert_eq(private.confirm_mfa_setup('20000000-0000-4000-8000-000000000c08', '1234567' || i), 'invalid',
      format('wrong code %s', i));
  end loop;
  perform tests.assert_eq(private.confirm_mfa_setup('20000000-0000-4000-8000-000000000c08', '12345675'), 'locked',
    'the fifth wrong code: the code dies');
  perform tests.assert_eq(private.confirm_mfa_setup('20000000-0000-4000-8000-000000000c08', '40718263'), 'locked',
    'the right code after that: still refused');
end $$;
set local session authorization default;
do $$
begin
  perform tests.assert((select code_hash is null and code_expires_at is null and code_attempts = 5 and confirmed_at is null
                        from private.mfa_factor_confirmations where factor_id = '20000000-0000-4000-8000-000000000c08'),
    'locked: no code left, the tries kept');
  update private.mfa_factor_confirmations set code_issued_at = now() - interval '3 minutes'
  where factor_id = '20000000-0000-4000-8000-000000000c08';
end $$;
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c08', '10000000-0000-4000-8000-000000000c81',
                                          'a0000000-0000-4000-8000-000000000001') || tests.fresh_code());
do $$
begin
  perform tests.assert_eq(private.request_mfa_factor_mail('20000000-0000-4000-8000-000000000c08'), 'queued',
    'send again: a new e-mail with a new code');
end $$;
rollback;

-- "An app was added from another sign-in" → Remove (re-review N1): the owner's other session (AAL1) removes
-- it; every OTHER session of the account ends (whoever set it up keeps nothing); the account is e-mailed.
begin;
delete from private.account_mail_requests where user_id = '00000000-0000-4000-8000-000000000c08';
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c08', '10000000-0000-4000-8000-000000000c82',
                                          'a0000000-0000-4000-8000-000000000001'));
do $$
begin
  perform tests.assert_eq(private.remove_mfa_app('20000000-0000-4000-8000-000000000c04'), 'refused', 'not another account''s app');
  perform tests.assert_eq(private.remove_mfa_app(null), 'refused', 'no app');
  perform tests.assert_eq(private.remove_mfa_app('20000000-0000-4000-8000-000000000c08'), 'removed',
    'an app added from another sign-in is removed');
  perform tests.assert_eq(private.remove_mfa_app('20000000-0000-4000-8000-000000000c08'), 'refused', 'gone');
end $$;
set local session authorization default;
do $$
begin
  perform tests.assert_eq((select count(*) from auth.mfa_factors where id = '20000000-0000-4000-8000-000000000c08'), 0::bigint,
    'the app is gone in Auth');
  perform tests.assert_eq((select count(*) from private.mfa_factor_confirmations where factor_id = '20000000-0000-4000-8000-000000000c08'),
    0::bigint, '…and its record with it');
  perform tests.assert_eq((select string_agg(id::text, ',') from auth.sessions where user_id = '00000000-0000-4000-8000-000000000c08'),
    '10000000-0000-4000-8000-000000000c82', 'the session that set it up ended in Auth; the remover''s stays');
  perform tests.assert_eq((select string_agg(reason, ',') from private.revoked_sessions where user_id = '00000000-0000-4000-8000-000000000c08'),
    'security', 'marked: security');
  perform tests.assert_eq((select mfa_reason from private.account_mail_requests
                           where kind = 'mfa_factor_removed' and user_id = '00000000-0000-4000-8000-000000000c08'), 'not_me',
    'the removal notice waits');
  perform tests.assert_eq((select data from platform.audit_events where action = 'platform.auth.mfa_removed'
                             and entity_id = '00000000-0000-4000-8000-000000000c08'),
    '{"via": "notice", "method": "totp"}'::jsonb, 'the removal is audited');
end $$;
rollback;

-- The session that set the app up cancels its own set-up: removed, no other session ends.
begin;
delete from private.account_mail_requests where user_id = '00000000-0000-4000-8000-000000000c08';
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c08', '10000000-0000-4000-8000-000000000c81',
                                          'a0000000-0000-4000-8000-000000000001') || tests.fresh_code());
do $$
begin
  perform tests.assert_eq(private.remove_mfa_app('20000000-0000-4000-8000-000000000c08'), 'removed', 'its own set-up cancelled');
end $$;
set local session authorization default;
do $$
begin
  perform tests.assert_eq((select count(*) from auth.mfa_factors where id = '20000000-0000-4000-8000-000000000c08'), 0::bigint,
    'cancelled: gone in Auth');
  perform tests.assert_eq((select count(*) from auth.sessions where user_id = '00000000-0000-4000-8000-000000000c08'), 2::bigint,
    'no session ends');
  perform tests.assert_eq((select mfa_reason from private.account_mail_requests
                           where kind = 'mfa_factor_removed' and user_id = '00000000-0000-4000-8000-000000000c08'), 'removed',
    'the account is e-mailed');
  perform tests.assert_eq((select data from platform.audit_events where action = 'platform.auth.mfa_removed'
                             and entity_id = '00000000-0000-4000-8000-000000000c08'),
    '{"via": "cancelled", "method": "totp"}'::jsonb, 'audited');
end $$;
rollback;

-- A confirmed app (My profile): only at AAL2 through a confirmed app with a code from the last 15 minutes.
begin;
update auth.sessions set aal = 'aal2', factor_id = '20000000-0000-4000-8000-000000000c04'
where id = '10000000-0000-4000-8000-000000000c41';
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c04', '10000000-0000-4000-8000-000000000c41',
                                          'a0000000-0000-4000-8000-000000000001'));
do $$
begin
  perform tests.assert_eq(private.remove_mfa_app('20000000-0000-4000-8000-000000000c04'), 'step_up', 'AAL1: a code first');
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c04', '10000000-0000-4000-8000-000000000c41',
                                             'a0000000-0000-4000-8000-000000000001') || tests.fresh_code(interval '16 minutes'));
  perform tests.assert_eq(private.remove_mfa_app('20000000-0000-4000-8000-000000000c04'), 'step_up', 'a code from 16 minutes ago: again');
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c04', '10000000-0000-4000-8000-000000000c41',
                                             'a0000000-0000-4000-8000-000000000001') || tests.fresh_code());
  perform tests.assert_eq(private.remove_mfa_app('20000000-0000-4000-8000-000000000c04'), 'removed', 'a recent code: removed');
end $$;
set local session authorization default;
do $$
begin
  perform tests.assert_eq((select count(*) from auth.mfa_factors where user_id = '00000000-0000-4000-8000-000000000c04'), 0::bigint,
    'gone in Auth');
  perform tests.assert_eq((select mfa_reason from private.account_mail_requests
                           where kind = 'mfa_factor_removed' and user_id = '00000000-0000-4000-8000-000000000c04'), 'removed',
    'the removal notice waits');
  perform tests.assert_eq((select data from platform.audit_events where action = 'platform.auth.mfa_removed'
                             and entity_id = '00000000-0000-4000-8000-000000000c04'),
    '{"via": "profile", "method": "totp"}'::jsonb, 'audited');
end $$;
rollback;

-- An unfinished set-up (not verified in Auth) is simply deleted (final re-review L1): no session ends, no e-mail,
-- no audit row — a loop of "create in Auth, remove here" tells nobody anything and ends nothing.
begin;
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c05', '10000000-0000-4000-8000-000000000c51',
                                          'a0000000-0000-4000-8000-000000000001'));
do $$
begin
  perform tests.assert_eq(private.remove_mfa_app('20000000-0000-4000-8000-000000000c05'), 'removed', 'an unfinished set-up is deleted');
end $$;
set local session authorization default;
do $$
begin
  perform tests.assert_eq((select count(*) from auth.mfa_factors where id = '20000000-0000-4000-8000-000000000c05'), 0::bigint,
    'gone in Auth');
  perform tests.assert_eq((select count(*) from auth.sessions where user_id = '00000000-0000-4000-8000-000000000c05'), 1::bigint,
    'no session ends');
  perform tests.assert_eq((select count(*) from private.revoked_sessions where user_id = '00000000-0000-4000-8000-000000000c05'),
    0::bigint, 'nothing marked');
  perform tests.assert_eq((select count(*) from private.account_mail_requests where user_id = '00000000-0000-4000-8000-000000000c05'),
    0::bigint, 'no e-mail');
  perform tests.assert_eq((select count(*) from platform.audit_events where entity_id = '00000000-0000-4000-8000-000000000c05'
                             and action like 'platform.auth.mfa%'), 0::bigint, 'no audit row');
end $$;
rollback;

-- 15 wrong e-mailed codes on one account within 24 hours (any app, any e-mail; final re-review L2): its waiting
-- apps go, the sessions that passed their code end, the owner is told once, the count starts again.
begin;
delete from private.account_mail_requests where user_id = '00000000-0000-4000-8000-000000000c08';
update private.mfa_factor_confirmations
set code_hash = tests.mfa_code_hash('20000000-0000-4000-8000-000000000c08', '40718263'),
    code_expires_at = now() + interval '1 hour', code_issued_at = now()
where factor_id = '20000000-0000-4000-8000-000000000c08';
-- 13 recent wrong codes (earlier apps and e-mails) and one from yesterday (outside the window).
insert into private.mfa_setup_code_failures (user_id, failed_at)
select '00000000-0000-4000-8000-000000000c08', now() - make_interval(mins => i) from generate_series(1, 13) i;
insert into private.mfa_setup_code_failures (user_id, failed_at)
values ('00000000-0000-4000-8000-000000000c08', now() - interval '25 hours');
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c08', '10000000-0000-4000-8000-000000000c81',
                                          'a0000000-0000-4000-8000-000000000001') || tests.fresh_code());
do $$
begin
  perform tests.assert_eq(private.confirm_mfa_setup('20000000-0000-4000-8000-000000000c08', '12345678'), 'invalid',
    'the 14th wrong code within 24 hours (yesterday''s does not count)');
  perform tests.assert_eq(private.confirm_mfa_setup('20000000-0000-4000-8000-000000000c08', '12345679'), 'removed',
    'the 15th: the waiting app is removed');
end $$;
set local session authorization default;
do $$
begin
  perform tests.assert_eq((select count(*) from auth.mfa_factors where id = '20000000-0000-4000-8000-000000000c08'), 0::bigint,
    'the waiting app is gone in Auth');
  perform tests.assert_eq((select string_agg(id::text, ',') from auth.sessions where user_id = '00000000-0000-4000-8000-000000000c08'),
    '10000000-0000-4000-8000-000000000c82', 'the session that passed its code ended; the other stays');
  perform tests.assert_eq((select string_agg(reason, ',') from private.revoked_sessions where user_id = '00000000-0000-4000-8000-000000000c08'),
    'security', 'marked: security');
  perform tests.assert_eq((select string_agg(mfa_reason || ':' || coalesce(factor_id::text, 'all'), ',') from private.account_mail_requests
                           where kind = 'mfa_factor_removed' and user_id = '00000000-0000-4000-8000-000000000c08'),
    'too_many_codes:all', 'the owner is told once');
  perform tests.assert_eq((select data from platform.audit_events where action = 'platform.auth.mfa_removed'
                             and entity_id = '00000000-0000-4000-8000-000000000c08' and actor_user_id is null),
    '{"via": "too_many_codes", "apps": 1, "method": "totp"}'::jsonb, 'audited, by the platform');
  perform tests.assert_eq((select count(*) from private.mfa_setup_code_failures where user_id = '00000000-0000-4000-8000-000000000c08'),
    0::bigint, 'the count starts again');
end $$;
rollback;

-- Security notices over the account's daily ceiling are merged into an hourly digest, never dropped (final
-- re-review L1): 20 security e-mails to uM4 in the last 24 hours (any organization).
begin;
delete from private.account_mail_requests where user_id is distinct from '00000000-0000-4000-8000-000000000c08';
alter table platform.message_deliveries disable trigger message_deliveries_check;
insert into platform.message_deliveries (tenant_id, template, template_version, locale, recipient_person_id,
    destination_masked, status, provider, sent_at, created_at)
select 'a0000000-0000-4000-8000-000000000001', 'platform.mfa_factor_removed', 1, 'ar', 'a1000000-0000-4000-8000-000000000c08',
       'u***@a.test', 'sent', 'smtp', now() - make_interval(hours => i), now() - make_interval(hours => i)
from generate_series(1, 19) i;
-- One more, but from yesterday: outside the 24 hours.
insert into platform.message_deliveries (tenant_id, template, template_version, locale, recipient_person_id,
    destination_masked, status, provider, sent_at, created_at)
values ('a0000000-0000-4000-8000-000000000001', 'platform.password_changed', 1, 'ar', 'a1000000-0000-4000-8000-000000000c08',
        'u***@a.test', 'sent', 'smtp', now() - interval '25 hours', now() - interval '25 hours');
alter table platform.message_deliveries enable trigger message_deliveries_check;
set local session authorization app_worker;
set local role authenticated;
select tests.set_claims(jsonb_build_object('role', 'system', 'job_id', 'tests.account_mail'));
do $$
declare
  r record;
begin
  -- 19 within 24 hours: still sent on its own.
  select * into r from private.claim_account_mail_request();
  perform tests.assert(r.kind = 'mfa_factor_added' and r.outcome = 'send', 'under the ceiling: sent on its own');
end $$;
rollback;

begin;
delete from private.account_mail_requests where user_id is distinct from '00000000-0000-4000-8000-000000000c08';
alter table platform.message_deliveries disable trigger message_deliveries_check;
insert into platform.message_deliveries (tenant_id, template, template_version, locale, recipient_person_id,
    destination_masked, status, provider, sent_at, created_at)
select 'a0000000-0000-4000-8000-000000000001', 'platform.mfa_factor_removed', 1, 'ar', 'a1000000-0000-4000-8000-000000000c08',
       'u***@a.test', 'sent', 'smtp', now() - make_interval(hours => i), now() - make_interval(hours => i)
from generate_series(1, 20) i;
alter table platform.message_deliveries enable trigger message_deliveries_check;
set local session authorization app_worker;
set local role authenticated;
select tests.set_claims(jsonb_build_object('role', 'system', 'job_id', 'tests.account_mail'));
do $$
declare
  r record;
begin
  select * into r from private.claim_account_mail_request();
  perform tests.assert(r.kind = 'mfa_factor_added' and r.outcome = 'held' and r.email is null
                       and r.user_id = '00000000-0000-4000-8000-000000000c08',
    'at the ceiling: held for the digest, nothing to send now');
end $$;
set local session authorization default;
do $$
begin
  perform tests.assert_eq((select count(*) from private.account_mail_requests where user_id = '00000000-0000-4000-8000-000000000c08'),
    0::bigint, 'the request is answered');
  perform tests.assert_eq((select held from private.security_notice_digests where user_id = '00000000-0000-4000-8000-000000000c08'),
    '{"mfa_factor_added": 1}'::jsonb, 'merged into the account''s digest');
  -- Another one an hour later: merged too; then the digest is due.
  insert into private.account_mail_requests (kind, user_id, factor_id, mfa_reason)
  values ('mfa_factor_removed', '00000000-0000-4000-8000-000000000c08', '20000000-0000-4000-8000-000000000c08', 'not_me');
end $$;
set local session authorization app_worker;
set local role authenticated;
select tests.set_claims(jsonb_build_object('role', 'system', 'job_id', 'tests.account_mail'));
do $$
declare
  r record;
begin
  select * into r from private.claim_account_mail_request();
  perform tests.assert(r.kind = 'mfa_factor_removed' and r.outcome = 'held', 'merged too');
  select * into r from private.claim_account_mail_request();
  perform tests.assert(r.id is null, 'the digest waits for its hour');
end $$;
set local session authorization default;
update private.security_notice_digests set first_held_at = now() - interval '61 minutes'
where user_id = '00000000-0000-4000-8000-000000000c08';
set local session authorization app_worker;
set local role authenticated;
select tests.set_claims(jsonb_build_object('role', 'system', 'job_id', 'tests.account_mail'));
do $$
declare
  r record;
begin
  select * into r from private.claim_account_mail_request();
  perform tests.assert(r.kind = 'security_digest' and r.outcome = 'send' and r.email = 'um4@a.test'
                       and r.tenant_id = 'a0000000-0000-4000-8000-000000000001'
                       and r.detail -> 'held' = '{"mfa_factor_added": 1, "mfa_factor_removed": 1}'::jsonb
                       and r.detail ? 'since',
    'the digest is sent — over the ceiling too — with the held notices by kind');
end $$;
set local session authorization default;
do $$
begin
  perform tests.assert_eq((select count(*) from private.security_notice_digests), 0::bigint, 'the digest starts again');
end $$;
rollback;

-- "Not you? Remove this app": that app goes in Auth, every session of the account ends, the account is e-mailed.
begin;
update private.mfa_factor_confirmations
set remove_token_hash = tests.token_hash('remove-m4'), remove_expires_at = now() + interval '1 hour'
where factor_id = '20000000-0000-4000-8000-000000000c08';
delete from private.account_mail_requests where user_id = '00000000-0000-4000-8000-000000000c08';
set local session authorization app_server;
set local role authenticated;
do $$
begin
  perform tests.assert_eq(private.reject_mfa_factor(tests.token_hash('remove-other')), 'invalid', 'an unknown link');
  perform tests.assert_eq(private.reject_mfa_factor(tests.token_hash('remove-m4')), 'removed', 'the app is removed');
  perform tests.assert_eq(private.reject_mfa_factor(tests.token_hash('remove-m4')), 'invalid', 'single use');
end $$;
set local session authorization default;
do $$
begin
  perform tests.assert_eq((select count(*) from auth.mfa_factors where id = '20000000-0000-4000-8000-000000000c08'), 0::bigint,
    'the app is gone in Auth');
  perform tests.assert_eq((select count(*) from private.mfa_factor_confirmations where factor_id = '20000000-0000-4000-8000-000000000c08'),
    0::bigint, '…and its record with it');
  perform tests.assert_eq((select count(*) from auth.sessions where user_id = '00000000-0000-4000-8000-000000000c08'), 0::bigint,
    'every session of the account ended in Auth');
  perform tests.assert_eq((select string_agg(distinct reason, ',') from private.revoked_sessions where user_id = '00000000-0000-4000-8000-000000000c08'),
    'security', 'marked: security');
  perform tests.assert_eq((select mfa_reason from private.account_mail_requests
                           where kind = 'mfa_factor_removed' and user_id = '00000000-0000-4000-8000-000000000c08'), 'not_me',
    'the removal notice waits');
  perform tests.assert_eq((select data from platform.audit_events where action = 'platform.auth.mfa_removed'
                             and entity_id = '00000000-0000-4000-8000-000000000c08'),
    '{"via": "email_link", "method": "totp"}'::jsonb, 'the removal is audited');
end $$;
rollback;

-- The worker removes apps nobody confirmed within 72 hours (re-review N2) — also one set up outside the web
-- app (never recorded) — ends the sessions that passed their code and e-mails the account. Recent ones and
-- confirmed ones stay.
begin;
delete from private.account_mail_requests where user_id = '00000000-0000-4000-8000-000000000c08';
update private.mfa_factor_confirmations set created_at = now() - interval '73 hours'
where factor_id = '20000000-0000-4000-8000-000000000c08';
update private.mfa_factor_confirmations set created_at = now() - interval '30 days'
where factor_id = '20000000-0000-4000-8000-000000000c04';
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, secret, created_at) values
  ('20000000-0000-4000-8000-000000000c02', '00000000-0000-4000-8000-000000000c02', 'old', 'totp', 'verified', 'NOT-A-REAL-SECRET',
   now() - interval '4 days'),
  ('20000000-0000-4000-8000-000000000c0a', '00000000-0000-4000-8000-000000000c01', 'new', 'totp', 'verified', 'NOT-A-REAL-SECRET',
   now() - interval '1 hour');
update auth.sessions set aal = 'aal2', factor_id = '20000000-0000-4000-8000-000000000c02'
where id = '10000000-0000-4000-8000-000000000c21';
set local session authorization app_worker;
set local role authenticated;
select tests.set_claims(jsonb_build_object('role', 'system', 'job_id', 'tests.session_purge'));
do $$
begin
  perform tests.assert_eq(private.purge_unconfirmed_mfa_apps(1), 1, 'one at a time (the limit): the oldest');
  perform tests.assert_eq(private.purge_unconfirmed_mfa_apps(10), 1, 'then the other one');
  perform tests.assert_eq(private.purge_unconfirmed_mfa_apps(10), 0, 'nothing left');
end $$;
set local session authorization default;
do $$
begin
  perform tests.assert_eq((select count(*) from auth.mfa_factors
                           where id in ('20000000-0000-4000-8000-000000000c08', '20000000-0000-4000-8000-000000000c02')), 0::bigint,
    'both unconfirmed apps are gone in Auth');
  perform tests.assert_eq((select count(*) from auth.mfa_factors
                           where id in ('20000000-0000-4000-8000-000000000c0a', '20000000-0000-4000-8000-000000000c04',
                                        '20000000-0000-4000-8000-000000000c09', '20000000-0000-4000-8000-0000000000b1')), 4::bigint,
    'a recent unconfirmed app and the confirmed ones stay');
  perform tests.assert_eq((select string_agg(id::text, ',' order by id) from auth.sessions
                           where user_id in ('00000000-0000-4000-8000-000000000c08', '00000000-0000-4000-8000-000000000c02')),
    '10000000-0000-4000-8000-000000000c22,10000000-0000-4000-8000-000000000c23,10000000-0000-4000-8000-000000000c24,'
    '10000000-0000-4000-8000-000000000c25,10000000-0000-4000-8000-000000000c82',
    'the sessions that passed their codes ended; the others stay');
  perform tests.assert_eq((select string_agg(r.user_id::text || ':' || r.mfa_reason, ',' order by r.user_id) from private.account_mail_requests r
                           where r.kind = 'mfa_factor_removed'),
    '00000000-0000-4000-8000-000000000c02:expired,00000000-0000-4000-8000-000000000c08:expired', 'each account is e-mailed');
  perform tests.assert_eq((select count(*) from platform.audit_events where action = 'platform.auth.mfa_removed'
                             and actor_user_id is null and data = '{"via": "expired", "method": "totp"}'::jsonb
                             and entity_id in ('00000000-0000-4000-8000-000000000c08', '00000000-0000-4000-8000-000000000c02')),
    2::bigint, 'audited, by the platform');
end $$;
rollback;

-- An Organization Admin resets a member's app (PO answer, 9 Oct 2026; T-IAM-10).
begin;
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c09', '10000000-0000-4000-8000-000000000c91',
                                          'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000c09') || tests.fresh_code());
do $$
begin
  perform tests.assert_eq(private.reset_member_mfa('a1000000-0000-4000-8000-000000000c03'), 'other_organization',
    'a login that belongs to another organization: support only');
  perform tests.assert_eq(private.reset_member_mfa('a1000000-0000-4000-8000-000000000c09'), 'self', 'not one''s own (My profile)');
  perform tests.assert_eq(private.reset_member_mfa('a1000000-0000-4000-8000-000000000c01'), 'no_app', 'a member without an app');
  perform tests.assert_eq(private.reset_member_mfa('a1000000-0000-4000-8000-000000000c04'), 'reset', 'uM1''s app is reset');
  perform tests.assert_eq(private.reset_member_mfa('b1000000-0000-4000-8000-0000000000b1'), 'not_found',
    'never another organization''s member (not found in this one)');
end $$;
-- Who may not: an Organization Admin whose code is older than 15 minutes (checked here too) or not from a
-- confirmed app, a learner, an HR Manager.
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c09', '10000000-0000-4000-8000-000000000c91',
                                          'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000c09')
                        || tests.fresh_code(interval '16 minutes'));
do $$
begin
  perform tests.assert_fails($q$select private.reset_member_mfa('a1000000-0000-4000-8000-000000000c08')$q$,
    array['42501'], 'an Organization Admin at AAL2 with a code from 16 minutes ago');
end $$;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
                                          'a0000000-0000-4000-8000-000000000001') || tests.fresh_code());
do $$
begin
  perform tests.assert_fails($q$select private.reset_member_mfa('a1000000-0000-4000-8000-000000000c08')$q$,
    array['42501'], 'an Organization Admin whose code did not come from a confirmed app');
end $$;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c01', '10000000-0000-4000-8000-000000000c11',
                                          'a0000000-0000-4000-8000-000000000001'));
do $$
begin
  perform tests.assert_fails($q$select private.reset_member_mfa('a1000000-0000-4000-8000-000000000c08')$q$,
    array['42501'], 'a learner');
end $$;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
                                          'a0000000-0000-4000-8000-000000000001') || tests.fresh_code());
do $$
begin
  perform tests.assert_fails($q$select private.reset_member_mfa('a1000000-0000-4000-8000-000000000c08')$q$,
    array['42501'], 'an HR Manager');
end $$;
set local session authorization default;
do $$
begin
  perform tests.assert_eq((select count(*) from auth.mfa_factors where user_id = '00000000-0000-4000-8000-000000000c04'), 0::bigint,
    'reset: the app is gone in Auth');
  perform tests.assert_eq((select count(*) from auth.sessions where user_id = '00000000-0000-4000-8000-000000000c04'), 0::bigint,
    'reset: every session ended');
  perform tests.assert_eq((select mfa_reason || ':' || tenant_id from private.account_mail_requests
                           where kind = 'mfa_factor_removed' and user_id = '00000000-0000-4000-8000-000000000c04'),
    'admin_reset:a0000000-0000-4000-8000-000000000001', 'the member is e-mailed in the organization');
  perform tests.assert_eq((select count(*) from auth.mfa_factors where user_id = '00000000-0000-4000-8000-000000000c03'), 0::bigint,
    'nothing changed for the refused ones');
end $$;
rollback;

-- A changed policy is e-mailed to every Organization Admin of the organization (T-IAM-24): names, never values.
begin;
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c09', '10000000-0000-4000-8000-000000000c91',
                                          'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000c09') || tests.fresh_code());
update platform.security_policies set password_min_length = 14, session_max_devices = 2;
set local session authorization default;
do $$
begin
  perform tests.assert_eq((select string_agg(r.user_id::text, ',' order by r.user_id) from private.account_mail_requests r
                           where r.kind = 'security_policy_changed' and r.tenant_id = 'a0000000-0000-4000-8000-000000000001'),
    '00000000-0000-4000-8000-0000000000a1,00000000-0000-4000-8000-000000000c09', 'one notice per Organization Admin of A');
  perform tests.assert((select bool_and(r.detail -> 'changed' = '["passwordMinLength", "sessionMaxDevices"]'::jsonb
                                        and r.detail ->> 'changed_by' = 'a1000000-0000-4000-8000-000000000c09'
                                        and not (r.detail::text like '%14%'))
                        from private.account_mail_requests r where r.kind = 'security_policy_changed'),
    'the setting names and the editor, never the values');
end $$;
rollback;

-- ENTLAQA support (operators, runbook): every app of the account, every session, audited with the reference.
begin;
do $$
begin
  perform tests.assert_fails($q$select private.reset_account_mfa('00000000-0000-4000-8000-000000000c04', 'call me')$q$,
    array['22023'], 'a ticket reference, never free text');
  perform tests.assert_eq(private.reset_account_mfa('00000000-0000-4000-8000-000000000c04', 'SUP-1042'), 1, 'one app removed');
  perform tests.assert_eq((select count(*) from auth.sessions where user_id = '00000000-0000-4000-8000-000000000c04'), 0::bigint,
    'every session ended');
  perform tests.assert_eq((select count(*) from platform.audit_events where action = 'platform.auth.mfa_reset'
                             and entity_id = '00000000-0000-4000-8000-000000000c04' and actor_user_id is null
                             and data = '{"by": "support", "apps": 1, "reference": "SUP-1042"}'::jsonb), 1::bigint,
    'audited in the account''s organization, by the platform');
  perform tests.assert_eq((select mfa_reason from private.account_mail_requests
                           where kind = 'mfa_factor_removed' and user_id = '00000000-0000-4000-8000-000000000c04'), 'support_reset',
    'the account is e-mailed');
end $$;
rollback;

\echo '68_security_owner: ok'
