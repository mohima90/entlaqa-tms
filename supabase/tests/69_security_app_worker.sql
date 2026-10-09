-- db-test: run-as=app_worker
-- Background jobs and the security policy / sign-in session objects (T-M2-10): system claims under
-- app_worker are not subject to user session rules or MFA, read only their own organization's policy,
-- change none, and every user-session function answers nothing for them. The worker's own calls: the
-- authenticator notices (claim, link hashes), whether an account has an app (reset e-mail), and the purge of
-- ended sessions in Auth (review M1). Runs CONNECTED AS app_worker.
\set ON_ERROR_STOP on

do $$ begin perform tests.assert(session_user = 'app_worker', 'must run connected as app_worker'); end $$;

begin;
set local role authenticated;
do $$
declare
  v_a constant uuid := 'a0000000-0000-4000-8000-000000000001';
  r record;
begin
  perform tests.set_claims(tests.system_claims(v_a));
  perform tests.assert_eq(private.current_tenant_id(), v_a, 'a job of A acts in A (no session rules, no MFA)');
  perform tests.assert_eq((select count(*) from platform.security_policies), 1::bigint, 'a job reads only its organization''s policy');
  perform tests.assert_eq((select tenant_id from platform.security_policies), v_a, '… A''s');
  perform tests.assert_eq(tests.rows_affected('update platform.security_policies set password_min_length = 30'), 0::bigint,
    'a job cannot change the policy');
  perform tests.assert_eq((select state from private.session_access_state()), 'invalid', 'no user session state for a job');
  perform tests.assert(private.password_min_length_for_caller() is null, 'no password rule for a job');
  perform tests.assert(not private.dismiss_mfa_prompt(), 'a job records no prompt answer');
  perform tests.assert(not private.request_aal2(), 'a job is never AAL2');
  perform tests.assert_eq((select count(*) from private.my_sessions()), 0::bigint, 'a job lists no sessions');
  perform tests.assert_eq(private.end_my_sessions(null), 0, 'a job ends no sessions of its own');
  perform tests.assert_eq((select count(*) from private.tenant_member_sessions('a1000000-0000-4000-8000-000000000c03')), 0::bigint,
    'a job lists no member''s sessions');
  perform tests.assert_fails($q$select private.end_member_sessions('a1000000-0000-4000-8000-000000000c03', null)$q$,
    array['42501'], 'a job cannot sign members out');
  perform tests.assert_eq(private.apply_device_limit(), 0, 'a job applies no device limit');
  perform tests.assert(not private.request_mfa_factor_mail(null), 'a job sets up no app');
  perform tests.assert_fails($q$select private.reset_member_mfa('a1000000-0000-4000-8000-000000000c04')$q$,
    array['42501'], 'a job resets no app');
  perform tests.assert_fails($q$select private.confirm_mfa_factor(tests.token_hash('x'))$q$,
    array['42501'], 'the confirmation link is the web app''s');
  perform private.touch_session();
  perform tests.assert_eq(private.invitation_password_min_length(tests.token_hash('tok-a')), 12::smallint,
    'the invitation rule is the web app''s (app_server) only');
  select * into r from private.tenant_lockout_policy(v_a);
  perform tests.assert(r.lockout_threshold = 5 and r.lockout_minutes = 15, 'lockout settings: the web app''s only (default)');
  -- User claims under app_worker are refused as before (ADR 0002 §6a), whatever the session rules say.
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c01', '10000000-0000-4000-8000-000000000c11', v_a));
  perform tests.assert(private.current_tenant_id() is null, 'user claims under app_worker: no tenant');
  perform tests.assert(not private.switch_active_tenant(v_a), 'user claims under app_worker: no switch');
  perform tests.assert_fails($q$select private.purge_ended_sessions(10)$q$, array['42501'], 'the purge needs system claims');
end $$;
rollback;

-- Authenticator notices (review H1): the set-up notice of uM4 waits (fixture 65).
begin;
set local role authenticated;
do $$
declare
  r record;
  e record;
begin
  perform tests.set_claims(jsonb_build_object('role', 'system', 'job_id', 'tests.account_mail'));
  select * into r from private.claim_account_mail_request();
  perform tests.assert(r.kind = 'mfa_factor_added' and r.outcome = 'send'
                       and r.user_id = '00000000-0000-4000-8000-000000000c08'
                       and r.factor_id = '20000000-0000-4000-8000-000000000c08' and r.mfa_reason is null
                       and r.tenant_id = 'a0000000-0000-4000-8000-000000000001'
                       and r.person_id = 'a1000000-0000-4000-8000-000000000c08' and r.email = 'um4@a.test',
    'the set-up notice: whom, which organization, which app');
  select * into e from private.issue_mfa_factor_tokens(r.factor_id, r.user_id, tests.token_hash('confirm-w'), tests.token_hash('remove-w'));
  perform tests.assert(e.confirm_expires_at between now() + interval '71 hours' and now() + interval '73 hours'
                       and e.remove_expires_at between now() + interval '6 days' and now() + interval '8 days',
    'the links'' hashes are stored, with their lifetimes');
  select * into e from private.issue_mfa_factor_tokens('20000000-0000-4000-8000-000000000c04', '00000000-0000-4000-8000-000000000c04',
                                                       tests.token_hash('a'), tests.token_hash('b'));
  perform tests.assert(e.confirm_expires_at is null, 'an app already confirmed: nothing to send');
  perform tests.assert_fails($q$select private.issue_mfa_factor_tokens('20000000-0000-4000-8000-000000000c08', '00000000-0000-4000-8000-000000000c08', '\x00'::bytea, '\x00'::bytea)$q$,
    array['22023'], 'only SHA-256 hashes');
  perform tests.assert(private.account_has_app('00000000-0000-4000-8000-000000000c08'), 'uM4 has an app (the reset e-mail asks a code)');
  perform tests.assert(not private.account_has_app('00000000-0000-4000-8000-000000000c01'), 'uS1 has none');
  perform tests.assert(private.finish_account_mail_request(r.id), 'the notice is answered');
  -- Not for the web app's login role.
  perform tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001'));
  perform tests.assert(private.account_has_app('00000000-0000-4000-8000-000000000c08'), 'also with a tenant''s system claims');
end $$;
rollback;

-- Purge (review M1): Auth forgets sessions that ended — with a marker (s1e), older than 24 hours (s1d), or ended
-- by A's rules (s1b 13 hours, s1c and s2d inactive); expired ones get a marker first.
begin;
set local role authenticated;
do $$
begin
  perform tests.set_claims(jsonb_build_object('role', 'system', 'job_id', 'tests.session_purge'));
  perform tests.assert(private.purge_ended_sessions(100) >= 5, 'the ended sessions (at least these five) are deleted in Auth');
  perform tests.assert_eq(private.purge_ended_sessions(100), 0, 'nothing left to delete');
  perform tests.assert_eq(private.purge_ended_sessions(0), 0, 'a limit of 0 deletes nothing');
end $$;
rollback;

\echo '69_security_app_worker: ok'
