-- db-test: run-as=owner
-- «Remember this browser» = «keep me signed in» and the Send Email hook's functions (WP-ADM-05; FR-IAM-12;
-- business flow EP-AUTH-signin-extras, PO answers 21 and 23 Oct 2026). Runs as the owner and switches to the
-- login roles (app_server for the web app, app_worker for the job), as 68_security_owner.sql does. Every block
-- is rolled back. Covers: the strictest organization decides the days, no sign-in without a code, the session
-- rules (idle / maximum length / 24 hours do not end a kept session, its own date does), what ends it (sign-out
-- by deleting the Auth session, «Forget all», the worker's purge), no access to the table, the hook's account
-- and sender functions (platform sender for several organizations), the audit functions, cross-tenant cases.

-- ---------------------------------------------------------------------------------------------------
-- Keeping a session: the days, the strictest organization wins
-- ---------------------------------------------------------------------------------------------------
begin;
update platform.security_policies set remembered_browser_days = 14 where tenant_id = 'a0000000-0000-4000-8000-000000000001';
set local session authorization app_server;
set local role authenticated;
-- A tenant-less session, as right after a code sign-in (no organization selected yet).
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', null));
do $$
begin
  perform tests.assert_eq(private.keep_session(), 14::integer, 'uA (organization A only, 14 days): the session is kept for 14 days');
  perform tests.assert_eq((select count(*) from private.my_kept_sessions()), 1::bigint, 'it is listed');
  perform tests.assert((select is_current and kept_until between now() + interval '13 days 23 hours' and now() + interval '14 days'
                        from private.my_kept_sessions()), 'the current one, with its date');
  perform tests.assert_eq(private.keep_session(), 14::integer, 'again: the same row is renewed');
  perform tests.assert_eq((select count(*) from private.my_kept_sessions()), 1::bigint, 'still one');
end $$;
-- uAB belongs to A (14 days) and B (Off): the strictest wins - nothing is kept.
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ad', null));
do $$
begin
  perform tests.assert_eq(private.keep_session(), 0::integer, 'one organization with Off: nothing is kept');
  perform tests.assert_eq((select count(*) from private.my_kept_sessions()), 0::bigint, 'and nothing is listed');
end $$;
set local session authorization default;
update platform.security_policies set remembered_browser_days = 7 where tenant_id = 'b0000000-0000-4000-8000-000000000001';
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ad', null));
do $$
begin
  perform tests.assert_eq(private.keep_session(), 7::integer, 'A 14 and B 7: the shortest');
end $$;
-- Only the account's own sessions: uA sees nothing of uAB's, nor the other way round.
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', null));
do $$
begin
  perform tests.assert((select bool_and(session_id = '10000000-0000-4000-8000-0000000000a1') from private.my_kept_sessions()), 'uA lists only their own');
end $$;
-- A session of someone else (or a bad one) cannot be kept; no claims or no session: refused.
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a9', null));
do $$
begin
  perform tests.assert_eq(private.keep_session(), 0::integer, 'an expired session is not kept');
end $$;
select tests.set_claims(null);
do $$
begin
  perform tests.assert_fails($q$select private.keep_session()$q$, array['42501'], 'no claims: refused');
  perform tests.assert_fails($q$select * from private.my_kept_sessions()$q$, array['42501'], 'no claims: no list');
  perform tests.assert_fails($q$select private.forget_kept_sessions()$q$, array['42501'], 'no claims: nothing forgotten');
end $$;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', null, null));
do $$
begin
  perform tests.assert_fails($q$select private.keep_session()$q$, array['42501'], 'no session in the token: refused');
end $$;
select tests.set_claims(tests.ua_claims());
do $$
begin
  perform tests.assert_privilege_denied($q$select * from private.kept_sessions$q$, 'the table is not readable by the web app');
  perform tests.assert_privilege_denied($q$insert into private.kept_sessions (session_id, user_id, kept_until) values (gen_random_uuid(), '00000000-0000-4000-8000-0000000000a1', now() + interval '1 day')$q$,
    'nor writable');
end $$;
set local session authorization default;
do $$
begin
  perform tests.assert_eq((select count(*) from platform.audit_events where action = 'platform.auth.browser_remembered'), 4::bigint,
    'keeping is audited (once per organization of the account, each time)');
  perform tests.assert_eq((select count(distinct data::text) from platform.audit_events where action = 'platform.auth.browser_remembered'), 1::bigint,
    'always the same data, without browser data');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- The session rules: a kept session lives until its own date
-- ---------------------------------------------------------------------------------------------------
begin;
update platform.security_policies set remembered_browser_days = 14 where tenant_id = 'a0000000-0000-4000-8000-000000000001';
-- sA signed in 3 days ago and has been idle for 2 days: the organization's rules (30 minutes, 12 hours, and the
-- platform's 24 hours) would have ended it long ago.
update auth.sessions set created_at = now() - interval '3 days' where id = '10000000-0000-4000-8000-0000000000a1';
update platform.session_context set last_seen_at = now() - interval '2 days' where session_id = '10000000-0000-4000-8000-0000000000a1';
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(tests.ua_claims());
do $$
begin
  perform tests.assert(private.current_tenant_id() is null, 'not kept: the session is over (24 hours / idle)');
end $$;
set local session authorization default;
do $$
begin
  perform tests.assert(not private.user_session_is_valid('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1'), 'not kept: and invalid');
end $$;
insert into private.kept_sessions (session_id, user_id, kept_until, created_at)
values ('10000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a1', now() + interval '11 days', now() - interval '3 days');
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(tests.ua_claims());
do $$
begin
  perform tests.assert_eq(private.current_tenant_id(), 'a0000000-0000-4000-8000-000000000001'::uuid, 'kept: the session still acts in its organization');
  perform tests.assert_eq((select count(*) from platform.persons where id = 'a1000000-0000-4000-8000-0000000000a1'), 1::bigint, 'and reads its data');
end $$;
set local session authorization default;
do $$
begin
  perform tests.assert(private.user_session_is_valid('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1'), 'kept: and valid');
end $$;
set local session authorization app_server;
set local role authenticated;
-- Another account's session is not kept by it.
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1', 'b0000000-0000-4000-8000-000000000001'));
do $$
begin
  perform tests.assert_eq(private.current_tenant_id(), 'b0000000-0000-4000-8000-000000000001'::uuid, 'another account''s own session is unaffected');
end $$;
-- Its own date ends it: the date passes, the platform's rules apply again.
set local session authorization default;
update private.kept_sessions set kept_until = now() - interval '1 minute', created_at = now() - interval '4 days';
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(tests.ua_claims());
do $$
begin
  perform tests.assert(private.current_tenant_id() is null, 'past its date: the session is over');
end $$;
-- «Forget all»: the session is no longer kept (and then follows the rules).
set local session authorization default;
update private.kept_sessions set kept_until = now() + interval '5 days', created_at = now() - interval '4 days';
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(tests.ua_claims());
do $$
begin
  perform tests.assert_eq(private.forget_kept_sessions(), 1::integer, 'forget all: one session');
  perform tests.assert_eq(private.forget_kept_sessions(), 0::integer, 'again: nothing');
  perform tests.assert(private.current_tenant_id() is null, 'the forgotten session follows the rules again');
end $$;
rollback;

-- Ending the Auth session (sign-out, «End sessions», deactivation) ends a kept session: the Auth row is gone and
-- the worker's purge removes what is left. A kept session expires at its date for the worker too.
begin;
insert into private.kept_sessions (session_id, user_id, kept_until, created_at) values
  ('10000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a1', now() + interval '10 days', now() - interval '1 day'),
  ('10000000-0000-4000-8000-0000000000ab', '00000000-0000-4000-8000-0000000000ab', now() + interval '10 days', now() - interval '1 day'),
  ('10000000-0000-4000-8000-0000000000ac', '00000000-0000-4000-8000-0000000000ab', now() - interval '1 minute', now() - interval '40 days');
-- sA is 3 days old and idle (would be purged by the rules), sAB1 too but kept, sAB2 kept but past its date.
update auth.sessions set created_at = now() - interval '3 days'
where id in ('10000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ac');
set local session authorization app_worker;
set local role authenticated;
select tests.set_claims(tests.system_claims(null, 'tests.purge'));
do $$
begin
  perform private.purge_ended_sessions(100);
end $$;
set local session authorization default;
do $$
begin
  perform tests.assert((select count(*) = 1 from auth.sessions where id = '10000000-0000-4000-8000-0000000000a1'), 'the purge leaves a kept session within its date');
  perform tests.assert((select count(*) = 1 from auth.sessions where id = '10000000-0000-4000-8000-0000000000ab'), 'also the second');
  perform tests.assert((select count(*) = 0 from auth.sessions where id = '10000000-0000-4000-8000-0000000000ac'), 'a kept session past its date is ended');
  perform tests.assert_eq((select count(*) from private.kept_sessions where session_id = '10000000-0000-4000-8000-0000000000ac'), 1::bigint,
    'its row waits for the next pass (a day after its date)');
end $$;
-- Sign-out: the Auth session is deleted; the kept row of a session that is gone is removed by the next pass.
delete from auth.sessions where id = '10000000-0000-4000-8000-0000000000a1';
set local session authorization app_worker;
set local role authenticated;
select tests.set_claims(tests.system_claims(null, 'tests.purge'));
do $$
begin
  perform private.purge_ended_sessions(100);
end $$;
set local session authorization default;
do $$
begin
  perform tests.assert_eq((select count(*) from private.kept_sessions where session_id = '10000000-0000-4000-8000-0000000000a1'), 0::bigint,
    'signed out: no kept row is left');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- The Send Email hook: account, sender rule, route and audit
-- ---------------------------------------------------------------------------------------------------
begin;
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(null);
do $$
declare
  r record;
begin
  select * into r from private.auth_mail_account('00000000-0000-4000-8000-0000000000a1');
  perform tests.assert(r.email = 'ua@a.test' and r.tenant_id = 'a0000000-0000-4000-8000-000000000001'
                       and r.person_id = 'a1000000-0000-4000-8000-0000000000a1' and r.locale in ('ar', 'en'),
    'the account: address, organization, person and language');
  perform tests.assert(not r.platform_sender, 'one organization, no platform role: the organization''s own sender may carry the e-mail');
  select * into r from private.auth_mail_account('00000000-0000-4000-8000-0000000000ab');
  perform tests.assert(r.platform_sender, 'two organizations: the platform sender only (M1)');
  perform tests.assert_eq((select count(*) from private.auth_mail_account('00000000-0000-4000-8000-0000000000a3')), 0::bigint, 'a suspended member: no e-mail');
  perform tests.assert_eq((select count(*) from private.auth_mail_account('00000000-0000-4000-8000-0000000000e1')), 0::bigint, 'an account without a membership: no e-mail');
  perform tests.assert_eq((select count(*) from private.auth_mail_account(gen_random_uuid())), 0::bigint, 'an unknown account: no e-mail');
  perform tests.assert_eq((select count(*) from private.auth_mail_account(null)), 0::bigint, 'no account: nothing');
  select * into r from private.auth_mail_route('a0000000-0000-4000-8000-000000000001');
  perform tests.assert(r.brand_name_en = 'Tenant A', 'the route: the organization''s name');
  perform tests.assert_eq((select count(*) from private.auth_mail_route('c0000000-0000-4000-8000-000000000001')), 0::bigint, 'a suspended organization: no route');
  perform tests.assert_eq((select count(*) from private.auth_mail_route(gen_random_uuid())), 0::bigint, 'an unknown organization: no route');
end $$;
-- Only the web app's login role.
set local session authorization app_worker;
set local role authenticated;
select tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001', 'tests.sic'));
do $$
begin
  perform tests.assert_fails($q$select * from private.auth_mail_account('00000000-0000-4000-8000-0000000000a1')$q$, array['42501'], 'the worker does not ask');
  perform tests.assert_fails($q$select * from private.auth_mail_route('a0000000-0000-4000-8000-000000000001')$q$, array['42501'], 'nor for the route');
  perform tests.assert_fails($q$select private.audit_sign_in_code_sent('00000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-000000000001')$q$, array['42501'], 'nor audits');
  perform tests.assert_fails($q$select private.audit_sign_in_code_refused('ua@a.test', false)$q$, array['42501'], 'nor audits refusals');
  perform tests.assert(not private.account_needs_platform_sender('00000000-0000-4000-8000-0000000000a1'), 'worker: one organization, no platform role: the organization may send');
  perform tests.assert(private.account_needs_platform_sender('00000000-0000-4000-8000-0000000000ab'), 'worker: two organizations: the platform sender only');
  perform tests.assert(private.account_needs_platform_sender(null), 'worker: unknown: the safe answer');
end $$;
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(null);
do $$
begin
  perform tests.assert_fails($q$select private.account_needs_platform_sender('00000000-0000-4000-8000-0000000000ab')$q$, array['42501'], 'the web app does not ask the worker''s question');
  perform tests.assert_fails($q$select private.account_sender_is_platform('00000000-0000-4000-8000-0000000000ab')$q$, array['42501'], 'the internal helper is not callable');
  perform private.audit_sign_in_code_sent('00000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-000000000001');
  perform private.audit_sign_in_code_refused('UA@a.test ', false);
  perform private.audit_sign_in_code_refused('uab@ab.test', true);
  perform private.audit_sign_in_code_refused('nobody@nowhere.test', false);
end $$;
set local session authorization default;
do $$
begin
  perform tests.assert_eq((select count(*) from platform.audit_events where action = 'platform.auth.sign_in_code_sent'), 1::bigint, 'code sent is audited');
  perform tests.assert_eq((select data::text from platform.audit_events where action = 'platform.auth.sign_in_code_sent'), '{"method": "email_code"}', 'without the code or the address');
  perform tests.assert_eq((select count(*) from platform.audit_events where action = 'platform.auth.sign_in_code_refused' and entity_id = '00000000-0000-4000-8000-0000000000a1'),
    1::bigint, 'a refused code is audited for the account');
  perform tests.assert_eq((select count(*) from platform.audit_events where action = 'platform.auth.sign_in_code_refused' and entity_id = '00000000-0000-4000-8000-0000000000ab'),
    2::bigint, 'in each organization of the account');
  perform tests.assert_eq((select count(*) from platform.audit_events where action = 'platform.auth.sign_in_code_refused'), 3::bigint, 'nothing for an address without an account');
  perform tests.assert((select bool_and((select count(*) from jsonb_object_keys(data)) = 2 and data ->> 'method' = 'email_code')
                        from platform.audit_events where action = 'platform.auth.sign_in_code_refused'), 'only the method and whether the code was killed');
end $$;
rollback;
