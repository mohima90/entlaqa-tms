-- db-test: run-as=app_worker
-- Background jobs and the security policy / MFA objects (T-M2-10): system claims under app_worker are not
-- subject to MFA, read only their own organization's policy, change none, and every user-session function
-- answers nothing for them. Runs CONNECTED AS app_worker.
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
  perform tests.assert_eq(private.current_tenant_id(), v_a, 'a job of A acts in A (no MFA)');
  perform tests.assert_eq((select count(*) from platform.security_policies), 1::bigint, 'a job reads only its organization''s policy');
  perform tests.assert_eq((select tenant_id from platform.security_policies), v_a, '… A''s');
  perform tests.assert_eq(tests.rows_affected('update platform.security_policies set password_min_length = 30'), 0::bigint,
    'a job cannot change the policy');
  perform tests.assert_eq((select state from private.session_access_state()), 'invalid', 'no user session state for a job');
  perform tests.assert(private.password_min_length_for_caller() is null, 'no password rule for a job');
  perform tests.assert(not private.dismiss_mfa_prompt(), 'a job records no prompt answer');
  perform tests.assert_eq(private.invitation_password_min_length(tests.token_hash('tok-a')), 12::smallint,
    'the invitation rule is the web app''s (app_server) only');
  select * into r from private.tenant_lockout_policy(v_a);
  perform tests.assert(r.lockout_threshold = 5 and r.lockout_minutes = 15, 'lockout settings: the web app''s only (default)');
  -- User claims under app_worker are refused as before (ADR 0002 §6a).
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c01', '10000000-0000-4000-8000-000000000c11', v_a));
  perform tests.assert(private.current_tenant_id() is null, 'user claims under app_worker: no tenant');
  perform tests.assert(not private.switch_active_tenant(v_a), 'user claims under app_worker: no switch');
end $$;
rollback;

\echo '69_security_app_worker: ok'
