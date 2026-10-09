-- db-test: run-as=app_server
-- The organization's MFA policy, enforced by private.current_tenant_id() on every statement (T-M2-10;
-- FR-IAM-12; T-IAM-41, T-IAM-43); the state the web app reads; whether a member uses an app. Runs
-- CONNECTED AS app_server (fixtures: 00, 65). Every block is rolled back.
\set ON_ERROR_STOP on

do $$ begin perform tests.assert(session_user = 'app_server', 'must run connected as app_server'); end $$;

-- ---------------------------------------------------------------------------------------------------
-- MFA policy
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
do $$
declare
  v_a constant uuid := 'a0000000-0000-4000-8000-000000000001';
  v_admin_aal2 constant jsonb := tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
                                                   'a0000000-0000-4000-8000-000000000001') || '{"aal": "aal2"}';
  -- uM1 has a verified authenticator app, uM2 an unverified one only, uS1 none; uM3 is a Training Manager.
  v_m1 constant jsonb := tests.user_claims('00000000-0000-4000-8000-000000000c04', '10000000-0000-4000-8000-000000000c41', 'a0000000-0000-4000-8000-000000000001');
  v_m2 constant jsonb := tests.user_claims('00000000-0000-4000-8000-000000000c05', '10000000-0000-4000-8000-000000000c51', 'a0000000-0000-4000-8000-000000000001');
  v_m3 constant jsonb := tests.user_claims('00000000-0000-4000-8000-000000000c06', '10000000-0000-4000-8000-000000000c61', 'a0000000-0000-4000-8000-000000000001');
  v_s1 constant jsonb := tests.user_claims('00000000-0000-4000-8000-000000000c01', '10000000-0000-4000-8000-000000000c11', 'a0000000-0000-4000-8000-000000000001');
  v_admin constant jsonb := tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-000000000001');
  r record;
begin
  -- off (default): nobody is asked for a code at sign-in, also with an app.
  perform tests.set_claims(v_m1);
  perform tests.assert_eq(private.current_tenant_id(), v_a, 'off: an AAL1 session with an app acts');
  perform tests.assert_eq((select state from private.session_access_state()), 'ok', 'off: state ok');
  perform tests.assert_eq((select count(*) from platform.persons where id = 'a1000000-0000-4000-8000-000000000c04'), 1::bigint,
    'off: reads its organization');
  -- The Organization Admin without an app is invited to set one up (PO decision 2) — access is allowed.
  perform tests.set_claims(v_admin);
  perform tests.assert_eq(private.current_tenant_id(), v_a, 'the prompt does not block');
  perform tests.assert_eq((select state from private.session_access_state()), 'prompt_admin', 'Organization Admin: prompt');
  -- "Not now" is remembered for this organization.
  perform tests.assert(private.dismiss_mfa_prompt(), '"not now" is recorded');
  perform tests.assert_eq((select state from private.session_access_state()), 'ok', 'after "not now": no prompt');
  perform tests.set_claims(v_s1);
  perform tests.assert_eq((select state from private.session_access_state()), 'ok', 'a learner is not prompted');

  -- optional: members WITH an app must use it (AAL1 reads nothing); others act at AAL1.
  perform tests.set_claims(v_admin_aal2);
  perform tests.assert_eq(tests.rows_affected('update platform.security_policies set mfa_mode = ''optional'''), 1::bigint, 'optional');
  perform tests.set_claims(v_m1);
  perform tests.assert(private.current_tenant_id() is null, 'optional: an AAL1 session with an app is refused');
  perform tests.assert_eq((select count(*) from platform.persons), 0::bigint, 'optional: it reads nothing');
  perform tests.assert_eq((select state from private.session_access_state()), 'mfa_challenge', 'optional: challenge');
  perform tests.set_claims(v_m1 || '{"aal": "aal2"}');
  perform tests.assert_eq(private.current_tenant_id(), v_a, 'optional: after the code it acts');
  perform tests.set_claims(v_m2);
  perform tests.assert_eq(private.current_tenant_id(), v_a, 'optional: an unverified app does not count');
  perform tests.set_claims(v_s1);
  perform tests.assert_eq(private.current_tenant_id(), v_a, 'optional: no app, AAL1 acts');

  -- required_roles {training_manager} with a 7-day grace that started now: covered members are prompted.
  perform tests.set_claims(v_admin_aal2);
  perform tests.assert_eq(tests.rows_affected('update platform.security_policies set mfa_mode = ''required_roles'', mfa_required_roles = ''{training_manager}'''),
    1::bigint, 'required for Training Managers');
  perform tests.set_claims(v_m3);
  perform tests.assert_eq(private.current_tenant_id(), v_a, 'grace period: a covered member without an app still acts');
  select * into r from private.session_access_state();
  perform tests.assert(r.state = 'prompt_grace' and r.mfa_deadline > now() + interval '6 days', 'grace period: prompt with its end');
  perform tests.set_claims(v_s1);
  perform tests.assert_eq((select state from private.session_access_state()), 'ok', 'a member not covered is not prompted');

  -- Grace over (0 days): the covered member must set an app up first; others are untouched.
  perform tests.set_claims(v_admin_aal2);
  perform tests.assert_eq(tests.rows_affected('update platform.security_policies set mfa_grace_days = 0'), 1::bigint, 'no grace');
  perform tests.set_claims(v_m3);
  perform tests.assert(private.current_tenant_id() is null, 'no grace: a covered member without an app is refused');
  perform tests.assert_eq((select count(*) from platform.security_policies), 0::bigint, 'no grace: reads nothing');
  perform tests.assert_eq((select state from private.session_access_state()), 'mfa_enrol', 'no grace: enrol');
  perform tests.set_claims(v_s1);
  perform tests.assert_eq(private.current_tenant_id(), v_a, 'not covered: acts');

  -- required_all without grace: everyone needs AAL2; with an app → challenge, without → enrol.
  perform tests.set_claims(v_admin_aal2);
  perform tests.assert_eq(tests.rows_affected('update platform.security_policies set mfa_mode = ''required_all'''), 1::bigint, 'required for all');
  perform tests.set_claims(v_s1);
  perform tests.assert(private.current_tenant_id() is null, 'required for all: AAL1 refused');
  perform tests.assert_eq((select state from private.session_access_state()), 'mfa_enrol', 'required for all, no app: enrol');
  perform tests.set_claims(v_m1);
  perform tests.assert_eq((select state from private.session_access_state()), 'mfa_challenge', 'required for all, app: challenge');
  perform tests.set_claims(v_m2);
  perform tests.assert_eq((select state from private.session_access_state()), 'mfa_enrol', 'unverified app: enrol');
  perform tests.set_claims(v_admin);
  perform tests.assert(private.current_tenant_id() is null, 'the Organization Admin at AAL1 too');
  perform tests.assert(not private.dismiss_mfa_prompt(), 'a refused session records nothing');
  perform tests.set_claims(v_admin_aal2);
  perform tests.assert_eq(private.current_tenant_id(), v_a, 'AAL2 acts');
  -- Other organizations are not affected by A's policy.
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c03', '10000000-0000-4000-8000-000000000c33',
                                             'b0000000-0000-4000-8000-000000000001'));
  perform tests.assert_eq(private.current_tenant_id(), 'b0000000-0000-4000-8000-000000000001'::uuid,
    'the same account in B is not covered by A''s policy');
end $$;
rollback;

-- Whether a member uses an app (screen 3): user managers and the member themself, own organization only.
begin;
set local role authenticated;
do $$
declare
  r record;
begin
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
                                             'a0000000-0000-4000-8000-000000000001'));
  select * into r from private.tenant_member_mfa('a1000000-0000-4000-8000-000000000c04');
  perform tests.assert(r.uses_app and r.since is not null, 'admin: uM1 uses an app');
  select * into r from private.tenant_member_mfa('a1000000-0000-4000-8000-000000000c05');
  perform tests.assert(not r.uses_app, 'admin: an unverified app is not "in use"');
  perform tests.assert_eq((select count(*) from private.tenant_member_mfa('b1000000-0000-4000-8000-0000000000b1')), 0::bigint,
    'admin of A: nothing about a member of B');
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c01', '10000000-0000-4000-8000-000000000c11',
                                             'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000c01'));
  perform tests.assert_eq((select count(*) from private.tenant_member_mfa('a1000000-0000-4000-8000-000000000c04')), 0::bigint,
    'a learner: nothing about others');
  perform tests.assert_eq((select count(*) from private.tenant_member_mfa('a1000000-0000-4000-8000-000000000c01')), 1::bigint,
    'a learner: their own');
end $$;
rollback;

\echo '67_mfa_and_sessions_app_server: ok'
