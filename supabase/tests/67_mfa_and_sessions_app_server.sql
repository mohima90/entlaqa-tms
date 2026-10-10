-- db-test: run-as=app_server
-- The organization's MFA policy and sign-in session rules, enforced by private.current_tenant_id() on every
-- statement (T-M2-10; FR-IAM-12/13; T-IAM-41, T-IAM-43, T-IAM-40); the state the web app reads; the
-- account's and the user manager's session lists and sign-out. Runs CONNECTED AS app_server (fixtures:
-- 00, 65). Every block is rolled back.
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
  -- uA2: an Organization Admin of A at AAL2 through a confirmed app (changes the policy below).
  v_admin_aal2 constant jsonb := tests.user_claims('00000000-0000-4000-8000-000000000c09', '10000000-0000-4000-8000-000000000c91',
                                                   'a0000000-0000-4000-8000-000000000001') || tests.fresh_code();
  -- uM4 set up an app that waits for its e-mailed confirmation; its session passed the code in Auth.
  v_m4 constant jsonb := tests.user_claims('00000000-0000-4000-8000-000000000c08', '10000000-0000-4000-8000-000000000c81',
                                           'a0000000-0000-4000-8000-000000000001') || tests.fresh_code();
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
  -- A token claiming aal2 on an Auth session that did not pass the code (sM1 is aal1): still refused.
  perform tests.set_claims(v_m1 || tests.fresh_code());
  perform tests.assert(private.current_tenant_id() is null, 'optional: a claimed aal2 alone does not count (review H1)');
  perform tests.assert_eq((select state from private.session_access_state()), 'mfa_challenge', 'optional: still the code');
  -- An app waiting for its e-mailed confirmation does not count (nothing to challenge): AAL1 acts, the page
  -- can say the e-mail waits.
  perform tests.set_claims(v_m4);
  perform tests.assert_eq(private.current_tenant_id(), v_a, 'optional: an unconfirmed app acts at AAL1');
  perform tests.assert((select mfa_pending and not uses_app and not aal2 from private.session_access_state()),
    'optional: the app waits for confirmation, not AAL2');
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
  -- Roles holding high-risk permissions get NO grace period (TM-0003 T-IAM-11): with the Organization Admin
  -- covered too, uA (no app) must set one up at once, while the Training Manager keeps the grace period.
  perform tests.set_claims(v_admin_aal2);
  perform tests.assert_eq(tests.rows_affected('update platform.security_policies set mfa_required_roles = ''{training_manager,tenant_admin}'''),
    1::bigint, 'required for Training Managers and Organization Admins');
  perform tests.set_claims(v_admin);
  perform tests.assert(private.current_tenant_id() is null, 'no grace for the Organization Admin: refused at once');
  select * into r from private.session_access_state();
  perform tests.assert(r.state = 'mfa_enrol' and r.mfa_deadline <= now(), 'no grace for the Organization Admin: set up first');
  perform tests.set_claims(v_m3);
  perform tests.assert_eq((select state from private.session_access_state()), 'prompt_grace', 'the Training Manager keeps the grace period');
  perform tests.set_claims(v_admin_aal2);
  perform tests.assert_eq(tests.rows_affected('update platform.security_policies set mfa_required_roles = ''{training_manager}'''),
    1::bigint, 'back to Training Managers only');

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
  perform tests.set_claims(v_m4);
  perform tests.assert(private.current_tenant_id() is null, 'an app waiting for confirmation does not let the session in');
  select * into r from private.session_access_state();
  perform tests.assert(r.state = 'mfa_enrol' and r.mfa_pending and not r.aal2, 'required: the set-up waits for the e-mail');
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
  perform tests.assert(not r.uses_app and not r.pending, 'admin: an unverified app is not "in use"');
  select * into r from private.tenant_member_mfa('a1000000-0000-4000-8000-000000000c08');
  perform tests.assert(not r.uses_app and r.pending and r.since is null, 'admin: uM4''s app waits for confirmation');
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

-- The account's apps as each of its sessions sees them (re-review N1): the session that set an app up sees it
-- waiting for the e-mailed code; every OTHER session of the account sees "an app was added from another
-- sign-in" (when, which browser) — and can neither confirm it nor ask for its e-mail.
begin;
set local role authenticated;
do $$
declare
  v_a constant uuid := 'a0000000-0000-4000-8000-000000000001';
  r record;
begin
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c08', '10000000-0000-4000-8000-000000000c81', v_a)
                           || tests.fresh_code());
  select * into r from private.my_mfa_apps();
  perform tests.assert(r.factor_id = '20000000-0000-4000-8000-000000000c08' and not r.confirmed and r.here
                       and r.set_up_at > now() - interval '1 minute' and r.user_agent like '%Firefox/131.0',
    'the session that set the app up: waiting for its code, here');
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c08', '10000000-0000-4000-8000-000000000c82', v_a));
  select * into r from private.my_mfa_apps();
  perform tests.assert(r.factor_id = '20000000-0000-4000-8000-000000000c08' and not r.confirmed and not r.here
                       and r.user_agent like '%Firefox/131.0',
    'another sign-in of the account: added elsewhere, with when and which browser');
  perform tests.assert_eq(private.confirm_mfa_setup('20000000-0000-4000-8000-000000000c08', '12345678'), 'refused',
    'another sign-in cannot confirm the app');
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c08', '10000000-0000-4000-8000-000000000c82', v_a)
                           || tests.fresh_code());
  perform tests.assert_eq(private.confirm_mfa_setup('20000000-0000-4000-8000-000000000c08', '12345678'), 'refused',
    '…not even claiming AAL2');
  perform tests.assert_eq(private.request_mfa_factor_mail('20000000-0000-4000-8000-000000000c08'), 'refused',
    '…nor ask for its e-mail');
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c04', '10000000-0000-4000-8000-000000000c41', v_a));
  select * into r from private.my_mfa_apps();
  perform tests.assert(r.factor_id = '20000000-0000-4000-8000-000000000c04' and r.confirmed, 'uM1: a confirmed app');
  perform tests.assert_eq((select count(*) from private.my_mfa_apps()), 1::bigint, '…its only one');
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c05', '10000000-0000-4000-8000-000000000c51', v_a));
  perform tests.assert_eq((select count(*) from private.my_mfa_apps()), 0::bigint, 'an unverified factor is no app');
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c08', '10000000-0000-4000-8000-000000000c41', v_a));
  perform tests.assert_eq((select count(*) from private.my_mfa_apps()), 0::bigint, 'another account''s session: nothing');
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c01', '10000000-0000-4000-8000-000000000c15', v_a));
  perform tests.assert_eq((select count(*) from private.my_mfa_apps()), 0::bigint, 'an ended session: nothing');
  perform tests.set_claims(tests.system_claims(v_a));
  perform tests.assert_eq((select count(*) from private.my_mfa_apps()), 0::bigint, 'system claims: nothing');
  perform tests.assert_eq(private.remove_mfa_app('20000000-0000-4000-8000-000000000c08'), 'refused', 'system claims remove nothing');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Session rules (defaults: 30 minutes inactive, 12 hours, 3 devices; platform: 24 hours)
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  c record;
begin
  for c in select * from (values
      ('fresh session (control)', '10000000-0000-4000-8000-000000000c11'::uuid, true, 'ok'),
      ('started 13 hours ago (maximum 12)', '10000000-0000-4000-8000-000000000c12', false, 'ended'),
      ('31 minutes inactive (maximum 30)', '10000000-0000-4000-8000-000000000c13', false, 'ended'),
      ('ended by the account', '10000000-0000-4000-8000-000000000c15', false, 'ended'),
      ('last seen 5 minutes ago', '10000000-0000-4000-8000-000000000c16', true, 'ok')) as v (label, session_id, allowed, state)
  loop
    set local role authenticated;
    perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c01', c.session_id, 'a0000000-0000-4000-8000-000000000001'));
    perform tests.assert_eq(private.current_tenant_id() is not null, c.allowed, format('current_tenant_id(): %s', c.label));
    perform tests.assert_eq((select state from private.session_access_state()), c.state, format('state: %s', c.label));
    if not c.allowed then
      perform tests.assert_eq((select count(*) from platform.persons), 0::bigint, format('%s: reads nothing', c.label));
    end if;
    reset role;
  end loop;
end $$;

-- An organization's own rules: a stricter inactivity limit ends s1f (5 minutes) at once; s1b (13 hours)
-- comes back when the organization allows 24 hours. The platform's 24 hours hold before an organization is
-- chosen too (s1d, 25 hours): no organizations, no switch.
begin;
set local role authenticated;
do $$
declare
  v_a constant uuid := 'a0000000-0000-4000-8000-000000000001';
begin
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c09', '10000000-0000-4000-8000-000000000c91', v_a) || tests.fresh_code());
  perform tests.assert_eq(tests.rows_affected('update platform.security_policies set session_idle_minutes = 5, session_max_hours = 24'),
    1::bigint, 'A: 5 minutes, 24 hours');
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c01', '10000000-0000-4000-8000-000000000c16', v_a));
  perform tests.assert(private.current_tenant_id() is null, 'inactive 5 minutes under a 5-minute rule: ended');
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c01', '10000000-0000-4000-8000-000000000c12', v_a));
  perform tests.assert_eq(private.current_tenant_id(), v_a, '13 hours under a 24-hour rule: acts');
  perform tests.set_claims(jsonb_build_object('role', 'authenticated', 'sub', '00000000-0000-4000-8000-000000000c01',
                                              'session_id', '10000000-0000-4000-8000-000000000c14'));
  perform tests.assert_eq((select count(*) from private.session_tenants()), 0::bigint, '25 hours: no organizations');
  perform tests.assert(not private.switch_active_tenant(v_a), '25 hours: cannot enter an organization');
  -- An ended session cannot move on to another organization either.
  perform tests.set_claims(jsonb_build_object('role', 'authenticated', 'sub', '00000000-0000-4000-8000-000000000c01',
                                              'session_id', '10000000-0000-4000-8000-000000000c13'));
  perform tests.assert(not private.switch_active_tenant(v_a), 'an inactive session cannot re-enter (sign in again)');
  perform tests.set_claims(jsonb_build_object('role', 'authenticated', 'sub', '00000000-0000-4000-8000-000000000c01',
                                              'session_id', '10000000-0000-4000-8000-000000000c15'));
  perform tests.assert(not private.switch_active_tenant(v_a), 'a session ended by the account cannot re-enter');
end $$;
rollback;

-- Entering ANOTHER organization applies that organization's inactivity limit (review L2): s3b was last active
-- 10 minutes ago in A; B with a 5-minute limit refuses it, with its default 30 minutes it may enter.
begin;
set local role authenticated;
do $$
declare
  v_b constant uuid := 'b0000000-0000-4000-8000-000000000001';
  v_s3b constant jsonb := jsonb_build_object('role', 'authenticated', 'sub', '00000000-0000-4000-8000-000000000c03',
                                             'session_id', '10000000-0000-4000-8000-000000000c32');
begin
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1', v_b) || tests.fresh_code());
  perform tests.assert_eq(tests.rows_affected('update platform.security_policies set session_idle_minutes = 5'), 1::bigint,
    'B: 5 minutes');
  perform tests.set_claims(v_s3b);
  perform tests.assert(not private.switch_active_tenant(v_b), 'inactive longer than B allows: cannot enter B');
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1', v_b) || tests.fresh_code());
  perform tests.assert_eq(tests.rows_affected('update platform.security_policies set session_idle_minutes = 30'), 1::bigint,
    'B: 30 minutes');
  perform tests.set_claims(v_s3b);
  perform tests.assert(private.switch_active_tenant(v_b), 'within B''s limit: enters B');
end $$;
rollback;

-- Activity: at most once a minute, never reviving an inactive session; none for foreign claims.
begin;
set local role authenticated;
do $$
declare
  v_a constant uuid := 'a0000000-0000-4000-8000-000000000001';
  v_seen timestamptz;
begin
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c01', '10000000-0000-4000-8000-000000000c16', v_a));
  perform private.touch_session();
  select last_seen_at into v_seen from platform.session_context;
  perform tests.assert_eq(v_seen, now(), 'last seen 5 minutes ago: moved to now');
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c01', '10000000-0000-4000-8000-000000000c17', v_a));
  perform private.touch_session();
  perform tests.assert((select last_seen_at < now() - interval '10 seconds' from platform.session_context),
    'last seen 20 seconds ago: not moved (once a minute)');
  -- (s1c is inactive: the touch must not bring it back; its context is unreadable, so check the decision.)
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c01', '10000000-0000-4000-8000-000000000c13', v_a));
  perform private.touch_session();
  perform tests.assert(private.current_tenant_id() is null, 'an inactive session stays ended after a touch');
end $$;
rollback;

-- Device limit (3): entering A with a new session ends the oldest live one beyond the limit (s2a), audited;
-- the inactive s2d does not count.
begin;
set local role authenticated;
do $$
declare
  v_a constant uuid := 'a0000000-0000-4000-8000-000000000001';
  c record;
begin
  perform tests.set_claims(jsonb_build_object('role', 'authenticated', 'sub', '00000000-0000-4000-8000-000000000c02',
                                              'session_id', '10000000-0000-4000-8000-000000000c25'));
  perform tests.assert(private.switch_active_tenant(v_a), 'the new session enters A');
  for c in select * from (values
      ('10000000-0000-4000-8000-000000000c25'::uuid, true), ('10000000-0000-4000-8000-000000000c23', true),
      ('10000000-0000-4000-8000-000000000c22', true), ('10000000-0000-4000-8000-000000000c21', false)) as v (session_id, allowed)
  loop
    perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c02', c.session_id, v_a));
    perform tests.assert_eq(private.current_tenant_id() is not null, c.allowed, format('device limit: session %s', c.session_id));
  end loop;
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c02', '10000000-0000-4000-8000-000000000c21', v_a));
  perform tests.assert_eq((select state from private.session_access_state()), 'ended', 'the oldest session ended');
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c02', '10000000-0000-4000-8000-000000000c25', v_a));
  perform tests.assert((select count(*) = 1 and bool_and(data = '{"reason": "device_limit", "count": 1}'::jsonb
                                                        and actor_user_id = '00000000-0000-4000-8000-000000000c02')
                        from platform.audit_events where action = 'platform.auth.sessions_evicted'),
    'the eviction is audited (review L5)');
end $$;
rollback;

-- …but only once the session may act there with its own AAL (review L1): while A wants a code, a password
-- alone pushes nobody out; after the code (here: the policy relaxed) the web app applies it.
begin;
set local role authenticated;
do $$
declare
  v_a constant uuid := 'a0000000-0000-4000-8000-000000000001';
  v_admin_aal2 constant jsonb := tests.user_claims('00000000-0000-4000-8000-000000000c09', '10000000-0000-4000-8000-000000000c91',
                                                   'a0000000-0000-4000-8000-000000000001') || tests.fresh_code();
begin
  perform tests.set_claims(v_admin_aal2);
  perform tests.assert_eq(tests.rows_affected('update platform.security_policies set mfa_mode = ''required_all'', mfa_grace_days = 0'),
    1::bigint, 'A requires an app from everyone');
  perform tests.set_claims(jsonb_build_object('role', 'authenticated', 'sub', '00000000-0000-4000-8000-000000000c02',
                                              'session_id', '10000000-0000-4000-8000-000000000c25'));
  perform tests.assert(private.switch_active_tenant(v_a), 'the new session enters A (to set an app up)');
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c02', '10000000-0000-4000-8000-000000000c21', v_a));
  perform tests.assert_eq((select state from private.session_access_state()), 'mfa_enrol', 'the oldest session was not ended');
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c02', '10000000-0000-4000-8000-000000000c25', v_a));
  perform tests.assert_eq(private.apply_device_limit(), 0, 'not before the session may act');
  perform tests.set_claims(v_admin_aal2);
  perform tests.assert_eq(tests.rows_affected('update platform.security_policies set mfa_mode = ''off'''), 1::bigint, 'A: off');
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c02', '10000000-0000-4000-8000-000000000c25', v_a));
  perform tests.assert_eq(private.apply_device_limit(), 1, 'once it may act: the oldest session ends');
  perform tests.assert_eq(private.apply_device_limit(), 0, 'and only once');
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c02', '10000000-0000-4000-8000-000000000c21', v_a));
  perform tests.assert_eq((select state from private.session_access_state()), 'ended', 's2a ended');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Session lists and sign-out
-- ---------------------------------------------------------------------------------------------------
-- The account's own sessions (uS3: s3a and s3b in A, s3c in B): every organization's, current first.
begin;
set local role authenticated;
do $$
declare
  v_a constant uuid := 'a0000000-0000-4000-8000-000000000001';
  v_ids uuid[];
begin
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c03', '10000000-0000-4000-8000-000000000c32', v_a));
  select array_agg(session_id order by is_current desc, session_id) into v_ids from private.my_sessions();
  perform tests.assert_eq(v_ids, array['10000000-0000-4000-8000-000000000c32', '10000000-0000-4000-8000-000000000c31',
                                       '10000000-0000-4000-8000-000000000c33']::uuid[], 'own sessions, current first');
  perform tests.assert((select bool_and(user_agent like 'Mozilla%' and tenant_name_ar is not null) from private.my_sessions()),
    'each with its browser and organization');
  -- uS1's list leaves out ended sessions (13 hours, inactive, 25 hours, ended).
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c01', '10000000-0000-4000-8000-000000000c11', v_a));
  select array_agg(session_id order by session_id) into v_ids from private.my_sessions();
  perform tests.assert_eq(v_ids, array['10000000-0000-4000-8000-000000000c11', '10000000-0000-4000-8000-000000000c16',
                                       '10000000-0000-4000-8000-000000000c17']::uuid[], 'live sessions only');
  -- End one other session, then all others; never the current one; never another account's.
  perform tests.assert_eq(private.end_my_sessions('10000000-0000-4000-8000-0000000000a1'), 0, 'not another account''s session');
  perform tests.assert_eq(private.end_my_sessions('10000000-0000-4000-8000-000000000c11'), 0, 'not the current one');
  perform tests.assert_eq(private.end_my_sessions('10000000-0000-4000-8000-000000000c16'), 1, 'one other session');
  perform tests.assert_eq(private.end_my_sessions(null), 1, 'all others (the remaining one)');
  perform tests.assert_eq(private.current_tenant_id(), v_a, 'the current session still acts');
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c01', '10000000-0000-4000-8000-000000000c17', v_a));
  perform tests.assert(private.current_tenant_id() is null, 'an ended session reads nothing at once');
  perform tests.assert_eq((select state from private.session_access_state()), 'ended', 'and says so');
  perform tests.assert_eq((select count(*) from private.my_sessions()), 0::bigint, 'an ended session lists nothing');
  perform tests.assert_eq(private.end_my_sessions(null), 0, 'an ended session ends nothing');
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', v_a));
  perform tests.assert_eq(private.current_tenant_id(), v_a, 'other accounts are untouched');
  -- A session its organization refuses (an app waiting for confirmation under "required for everyone")
  -- neither lists nor ends sessions (review L1).
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c09', '10000000-0000-4000-8000-000000000c91', v_a) || tests.fresh_code());
  perform tests.assert_eq(tests.rows_affected('update platform.security_policies set mfa_mode = ''required_all'', mfa_grace_days = 0'),
    1::bigint, 'A requires an app from everyone');
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c08', '10000000-0000-4000-8000-000000000c81', v_a) || tests.fresh_code());
  perform tests.assert_eq((select count(*) from private.my_sessions()), 0::bigint, 'a refused session lists nothing');
  perform tests.assert_eq(private.end_my_sessions(null), 0, 'a refused session ends nothing');
end $$;
rollback;

-- Force sign-out by a user manager (screen 3): one or all of a member's sessions IN THIS organization.
begin;
set local role authenticated;
do $$
declare
  v_a constant uuid := 'a0000000-0000-4000-8000-000000000001';
  v_b constant uuid := 'b0000000-0000-4000-8000-000000000001';
  v_admin_a constant jsonb := tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-000000000001');
  v_ids uuid[];
begin
  perform tests.set_claims(v_admin_a);
  select array_agg(session_id order by session_id) into v_ids from private.tenant_member_sessions('a1000000-0000-4000-8000-000000000c03');
  perform tests.assert_eq(v_ids, array['10000000-0000-4000-8000-000000000c31', '10000000-0000-4000-8000-000000000c32']::uuid[],
    'the admin of A lists uS3''s sessions in A only');
  perform tests.assert_eq((select count(*) from private.tenant_member_sessions('b1000000-0000-4000-8000-000000000c03')), 0::bigint,
    'nothing about uS3''s person in B');
  perform tests.assert_eq(private.end_member_sessions('a1000000-0000-4000-8000-000000000c03', '10000000-0000-4000-8000-000000000c32'), 1,
    'one session');
  perform tests.assert_eq(private.end_member_sessions('a1000000-0000-4000-8000-000000000c03', '10000000-0000-4000-8000-000000000c33'), 0,
    'never a session acting in another organization');
  perform tests.assert_eq(private.end_member_sessions('a1000000-0000-4000-8000-000000000c03', null), 1, 'all (the remaining one in A)');
  perform tests.assert_eq(private.end_member_sessions('b1000000-0000-4000-8000-000000000c03', null), 0, 'not B''s person');
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c03', '10000000-0000-4000-8000-000000000c31', v_a));
  perform tests.assert(private.current_tenant_id() is null, 'uS3 in A: ended at once');
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c03', '10000000-0000-4000-8000-000000000c33', v_b));
  perform tests.assert_eq(private.current_tenant_id(), v_b, 'uS3 in B: untouched (T-IAM-40)');
  -- The admin's own current session is never ended by this path.
  perform tests.set_claims(v_admin_a);
  perform tests.assert_eq(private.end_member_sessions('a1000000-0000-4000-8000-0000000000a1', null), 0,
    'the caller''s own current session stays');
  perform tests.assert_eq(private.current_tenant_id(), v_a, 'the admin still acts');
end $$;
rollback;

-- Who may not: a learner, an HR Manager on the Organization Admin (privileged), another organization's admin.
begin;
set local role authenticated;
do $$
declare
  v_a constant uuid := 'a0000000-0000-4000-8000-000000000001';
begin
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c01', '10000000-0000-4000-8000-000000000c11', v_a,
                                             'a1000000-0000-4000-8000-000000000c01'));
  perform tests.assert_fails($q$select private.end_member_sessions('a1000000-0000-4000-8000-000000000c03', null)$q$,
    array['42501'], 'a learner cannot end others'' sessions');
  perform tests.assert_eq((select count(*) from private.tenant_member_sessions('a1000000-0000-4000-8000-000000000c03')), 0::bigint,
    'a learner lists nothing');
  -- uAB is an HR Manager in A: ordinary members yes, the Organization Admin no.
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab', v_a,
                                             'a1000000-0000-4000-8000-0000000000ab'));
  perform tests.assert_fails($q$select private.end_member_sessions('a1000000-0000-4000-8000-0000000000a1', null)$q$,
    array['42501'], 'an HR Manager cannot sign the Organization Admin out');
  perform tests.assert_eq((select count(*) from private.tenant_member_sessions('a1000000-0000-4000-8000-0000000000a1')), 0::bigint,
    'an HR Manager does not list the Organization Admin''s sessions');
  perform tests.assert_eq(private.end_member_sessions('a1000000-0000-4000-8000-000000000c03', null), 2,
    'an HR Manager signs an ordinary member out');
  -- B's admin: nothing in A.
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1',
                                             'b0000000-0000-4000-8000-000000000001'));
  perform tests.assert_eq(private.end_member_sessions('a1000000-0000-4000-8000-000000000c01', null), 0, 'B''s admin ends nothing in A');
  perform tests.assert_eq((select count(*) from private.tenant_member_sessions('a1000000-0000-4000-8000-000000000c01')), 0::bigint,
    'B''s admin lists nothing in A');
  -- No valid claims: nothing.
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c01', '10000000-0000-4000-8000-0000000000a1', v_a));
  perform tests.assert_eq(private.end_member_sessions('a1000000-0000-4000-8000-000000000c03', null), 0, 'forged claims: nothing');
  perform tests.set_claims(tests.system_claims(v_a));
  perform tests.assert_eq(private.end_my_sessions(null), 0, 'system claims: nothing');
  perform tests.assert_eq((select count(*) from private.my_sessions()), 0::bigint, 'system claims: no list');
  -- The worker's purges and the code and link hashes are not the web app's.
  perform tests.assert_fails($q$select private.purge_ended_sessions(10)$q$, array['42501'], 'the web app cannot purge sessions');
  perform tests.assert_fails($q$select private.issue_mfa_factor_tokens('20000000-0000-4000-8000-000000000c08', '00000000-0000-4000-8000-000000000c08', sha256('a'), sha256('b'))$q$,
    array['42501'], 'the web app cannot issue code or link hashes');
  perform tests.assert_fails($q$select private.purge_unconfirmed_mfa_apps(10)$q$, array['42501'],
    'the web app cannot purge unconfirmed apps');
end $$;
rollback;

\echo '67_mfa_and_sessions_app_server: ok'
