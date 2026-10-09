-- db-test: run-as=owner
-- Security policy, MFA and sign-in session fixtures (T-M2-10) for 66–69, plus checks only the owner can
-- make (defaults, new organizations, constraints, stamps). Own accounts and sessions only: the shared
-- fixtures of 00 stay as they are. Fixed ids:
--   uS1 …c01 (A learner)  sessions s1a fresh · s1b started 13 h ago · s1c inactive 31 min · s1d started 25 h
--                         ago, no organization yet · s1e ended by the account · s1f last seen 5 min ago ·
--                         s1g last seen 20 s ago
--   uS2 …c02 (A learner)  device limit: s2a/s2b/s2c started 3/2/1 h ago, s2d inactive (not counted),
--                         s2n new without an organization
--   uS3 …c03 (A + B learner)  s3a, s3b in A, s3c in B
--   uM1 …c04 (A learner, verified and confirmed authenticator app) sM1 · uM2 …c05 (A learner, unverified app
--   only) sM2 · uM3 …c06 (A Training Manager) sM3 · uS4 …c07 (member of suspended tenant C) sS4
--   uM4 …c08 (A learner) set up an app that waits for the e-mailed confirmation; sM4 …c81 passed its code in
--         Auth (aal2 with that factor) — and one notice waits for the worker (69)
--   uA2 …c09 second Organization Admin of A, confirmed app, sA2 …c91 at AAL2 (changes A's policy in 66–68)
--   uB  (00) gets a confirmed app and its session sB AAL2 (changes B's policy)
--   s3b (…c32) was last active 10 minutes ago (the target organization's inactivity limit, 67)
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000c01', 'us1@a.test'),
  ('00000000-0000-4000-8000-000000000c02', 'us2@a.test'),
  ('00000000-0000-4000-8000-000000000c03', 'us3@ab.test'),
  ('00000000-0000-4000-8000-000000000c04', 'um1@a.test'),
  ('00000000-0000-4000-8000-000000000c05', 'um2@a.test'),
  ('00000000-0000-4000-8000-000000000c06', 'um3@a.test'),
  ('00000000-0000-4000-8000-000000000c07', 'us4@c.test'),
  ('00000000-0000-4000-8000-000000000c08', 'um4@a.test'),
  ('00000000-0000-4000-8000-000000000c09', 'ua2@a.test');

insert into auth.sessions (id, user_id, created_at, not_after) values
  ('10000000-0000-4000-8000-000000000c11', '00000000-0000-4000-8000-000000000c01', now(), null),
  ('10000000-0000-4000-8000-000000000c12', '00000000-0000-4000-8000-000000000c01', now() - interval '13 hours', null),
  ('10000000-0000-4000-8000-000000000c13', '00000000-0000-4000-8000-000000000c01', now() - interval '1 hour', null),
  ('10000000-0000-4000-8000-000000000c14', '00000000-0000-4000-8000-000000000c01', now() - interval '25 hours', null),
  ('10000000-0000-4000-8000-000000000c15', '00000000-0000-4000-8000-000000000c01', now(), null),
  ('10000000-0000-4000-8000-000000000c16', '00000000-0000-4000-8000-000000000c01', now() - interval '10 minutes', null),
  ('10000000-0000-4000-8000-000000000c17', '00000000-0000-4000-8000-000000000c01', now() - interval '10 minutes', null),
  ('10000000-0000-4000-8000-000000000c21', '00000000-0000-4000-8000-000000000c02', now() - interval '3 hours', null),
  ('10000000-0000-4000-8000-000000000c22', '00000000-0000-4000-8000-000000000c02', now() - interval '2 hours', null),
  ('10000000-0000-4000-8000-000000000c23', '00000000-0000-4000-8000-000000000c02', now() - interval '1 hour', null),
  ('10000000-0000-4000-8000-000000000c24', '00000000-0000-4000-8000-000000000c02', now() - interval '4 hours', null),
  ('10000000-0000-4000-8000-000000000c25', '00000000-0000-4000-8000-000000000c02', now(), null),
  ('10000000-0000-4000-8000-000000000c31', '00000000-0000-4000-8000-000000000c03', now() - interval '2 hours', null),
  ('10000000-0000-4000-8000-000000000c32', '00000000-0000-4000-8000-000000000c03', now() - interval '1 hour', null),
  ('10000000-0000-4000-8000-000000000c33', '00000000-0000-4000-8000-000000000c03', now(), null),
  ('10000000-0000-4000-8000-000000000c41', '00000000-0000-4000-8000-000000000c04', now(), null),
  ('10000000-0000-4000-8000-000000000c51', '00000000-0000-4000-8000-000000000c05', now(), null),
  ('10000000-0000-4000-8000-000000000c61', '00000000-0000-4000-8000-000000000c06', now(), null),
  ('10000000-0000-4000-8000-000000000c71', '00000000-0000-4000-8000-000000000c07', now(), null),
  ('10000000-0000-4000-8000-000000000c81', '00000000-0000-4000-8000-000000000c08', now(), null),
  ('10000000-0000-4000-8000-000000000c91', '00000000-0000-4000-8000-000000000c09', now(), null);
update auth.sessions set user_agent = 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0', aal = 'aal1'
where user_id = '00000000-0000-4000-8000-000000000c03';

insert into platform.persons (id, tenant_id, display_name_ar, email) values
  ('a1000000-0000-4000-8000-000000000c01', 'a0000000-0000-4000-8000-000000000001', 'جلسات ١', 'us1@a.test'),
  ('a1000000-0000-4000-8000-000000000c02', 'a0000000-0000-4000-8000-000000000001', 'أجهزة ٢', 'us2@a.test'),
  ('a1000000-0000-4000-8000-000000000c03', 'a0000000-0000-4000-8000-000000000001', 'منشأتان ٣', 'us3@ab.test'),
  ('b1000000-0000-4000-8000-000000000c03', 'b0000000-0000-4000-8000-000000000001', 'منشأتان ٣', 'us3@ab.test'),
  ('a1000000-0000-4000-8000-000000000c04', 'a0000000-0000-4000-8000-000000000001', 'تطبيق ٤', 'um1@a.test'),
  ('a1000000-0000-4000-8000-000000000c05', 'a0000000-0000-4000-8000-000000000001', 'بلا تطبيق ٥', 'um2@a.test'),
  ('a1000000-0000-4000-8000-000000000c06', 'a0000000-0000-4000-8000-000000000001', 'مدير تدريب ٦', 'um3@a.test'),
  ('c1000000-0000-4000-8000-000000000c07', 'c0000000-0000-4000-8000-000000000001', 'منشأة موقوفة ٧', 'us4@c.test'),
  ('a1000000-0000-4000-8000-000000000c08', 'a0000000-0000-4000-8000-000000000001', 'تطبيق ينتظر ٨', 'um4@a.test'),
  ('a1000000-0000-4000-8000-000000000c09', 'a0000000-0000-4000-8000-000000000001', 'مدير ثانٍ ٩', 'ua2@a.test');

insert into platform.tenant_memberships (tenant_id, user_id, person_id, status) values
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000c01', 'a1000000-0000-4000-8000-000000000c01', 'active'),
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000c02', 'a1000000-0000-4000-8000-000000000c02', 'active'),
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000c03', 'a1000000-0000-4000-8000-000000000c03', 'active'),
  ('b0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000c03', 'b1000000-0000-4000-8000-000000000c03', 'active'),
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000c04', 'a1000000-0000-4000-8000-000000000c04', 'active'),
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000c05', 'a1000000-0000-4000-8000-000000000c05', 'active'),
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000c06', 'a1000000-0000-4000-8000-000000000c06', 'active'),
  ('c0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000c07', 'c1000000-0000-4000-8000-000000000c07', 'active'),
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000c08', 'a1000000-0000-4000-8000-000000000c08', 'active'),
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000c09', 'a1000000-0000-4000-8000-000000000c09', 'active');

insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary)
select m.tenant_id, m.id, r.role_code, true
from (values
  ('a0000000-0000-4000-8000-000000000001'::uuid, '00000000-0000-4000-8000-000000000c01'::uuid, 'learner'),
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000c02', 'learner'),
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000c03', 'learner'),
  ('b0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000c03', 'learner'),
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000c04', 'learner'),
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000c05', 'learner'),
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000c06', 'training_manager'),
  ('c0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000c07', 'learner'),
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000c08', 'learner'),
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000c09', 'tenant_admin')
) as r (tenant_id, user_id, role_code)
join platform.tenant_memberships m on m.tenant_id = r.tenant_id and m.user_id = r.user_id;

insert into platform.session_context (session_id, user_id, active_tenant_id, last_seen_at) values
  ('10000000-0000-4000-8000-000000000c11', '00000000-0000-4000-8000-000000000c01', 'a0000000-0000-4000-8000-000000000001', now()),
  ('10000000-0000-4000-8000-000000000c12', '00000000-0000-4000-8000-000000000c01', 'a0000000-0000-4000-8000-000000000001', now()),
  ('10000000-0000-4000-8000-000000000c13', '00000000-0000-4000-8000-000000000c01', 'a0000000-0000-4000-8000-000000000001', now() - interval '31 minutes'),
  ('10000000-0000-4000-8000-000000000c15', '00000000-0000-4000-8000-000000000c01', 'a0000000-0000-4000-8000-000000000001', now()),
  ('10000000-0000-4000-8000-000000000c16', '00000000-0000-4000-8000-000000000c01', 'a0000000-0000-4000-8000-000000000001', now() - interval '5 minutes'),
  ('10000000-0000-4000-8000-000000000c17', '00000000-0000-4000-8000-000000000c01', 'a0000000-0000-4000-8000-000000000001', now() - interval '20 seconds'),
  ('10000000-0000-4000-8000-000000000c21', '00000000-0000-4000-8000-000000000c02', 'a0000000-0000-4000-8000-000000000001', now()),
  ('10000000-0000-4000-8000-000000000c22', '00000000-0000-4000-8000-000000000c02', 'a0000000-0000-4000-8000-000000000001', now()),
  ('10000000-0000-4000-8000-000000000c23', '00000000-0000-4000-8000-000000000c02', 'a0000000-0000-4000-8000-000000000001', now()),
  ('10000000-0000-4000-8000-000000000c24', '00000000-0000-4000-8000-000000000c02', 'a0000000-0000-4000-8000-000000000001', now() - interval '40 minutes'),
  ('10000000-0000-4000-8000-000000000c31', '00000000-0000-4000-8000-000000000c03', 'a0000000-0000-4000-8000-000000000001', now()),
  ('10000000-0000-4000-8000-000000000c32', '00000000-0000-4000-8000-000000000c03', 'a0000000-0000-4000-8000-000000000001', now() - interval '10 minutes'),
  ('10000000-0000-4000-8000-000000000c33', '00000000-0000-4000-8000-000000000c03', 'b0000000-0000-4000-8000-000000000001', now()),
  ('10000000-0000-4000-8000-000000000c41', '00000000-0000-4000-8000-000000000c04', 'a0000000-0000-4000-8000-000000000001', now()),
  ('10000000-0000-4000-8000-000000000c51', '00000000-0000-4000-8000-000000000c05', 'a0000000-0000-4000-8000-000000000001', now()),
  ('10000000-0000-4000-8000-000000000c61', '00000000-0000-4000-8000-000000000c06', 'a0000000-0000-4000-8000-000000000001', now()),
  ('10000000-0000-4000-8000-000000000c71', '00000000-0000-4000-8000-000000000c07', 'c0000000-0000-4000-8000-000000000001', now()),
  ('10000000-0000-4000-8000-000000000c81', '00000000-0000-4000-8000-000000000c08', 'a0000000-0000-4000-8000-000000000001', now()),
  ('10000000-0000-4000-8000-000000000c91', '00000000-0000-4000-8000-000000000c09', 'a0000000-0000-4000-8000-000000000001', now());

insert into private.revoked_sessions (session_id, user_id, reason, revoked_by) values
  ('10000000-0000-4000-8000-000000000c15', '00000000-0000-4000-8000-000000000c01', 'user', '00000000-0000-4000-8000-000000000c01');

insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, secret) values
  ('20000000-0000-4000-8000-000000000c04', '00000000-0000-4000-8000-000000000c04', 'app', 'totp', 'verified', 'NOT-A-REAL-SECRET'),
  ('20000000-0000-4000-8000-000000000c05', '00000000-0000-4000-8000-000000000c05', 'app', 'totp', 'unverified', 'NOT-A-REAL-SECRET'),
  ('20000000-0000-4000-8000-000000000c08', '00000000-0000-4000-8000-000000000c08', 'app', 'totp', 'verified', 'NOT-A-REAL-SECRET'),
  ('20000000-0000-4000-8000-000000000c09', '00000000-0000-4000-8000-000000000c09', 'app', 'totp', 'verified', 'NOT-A-REAL-SECRET'),
  ('20000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b1', 'app', 'totp', 'verified', 'NOT-A-REAL-SECRET');
-- Confirmed from the mailbox (review H1): uM1's, uA2's and uB's apps.
insert into private.mfa_factor_confirmations (factor_id, user_id, confirmed_at) values
  ('20000000-0000-4000-8000-000000000c04', '00000000-0000-4000-8000-000000000c04', now()),
  ('20000000-0000-4000-8000-000000000c09', '00000000-0000-4000-8000-000000000c09', now()),
  ('20000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b1', now());
-- Sessions that passed a code in Auth, with the factor it came from.
update auth.sessions s set aal = 'aal2', factor_id = f.factor_id
from (values ('10000000-0000-4000-8000-000000000c81'::uuid, '20000000-0000-4000-8000-000000000c08'::uuid),
             ('10000000-0000-4000-8000-000000000c91', '20000000-0000-4000-8000-000000000c09'),
             ('10000000-0000-4000-8000-0000000000b1', '20000000-0000-4000-8000-0000000000b1')) as f (session_id, factor_id)
where s.id = f.session_id;
-- uM4's app as the web app records it at set-up (waiting for confirmation), and its set-up notice waiting for
-- the worker (claimed in 69).
insert into private.mfa_factor_confirmations (factor_id, user_id) values
  ('20000000-0000-4000-8000-000000000c08', '00000000-0000-4000-8000-000000000c08');
insert into private.account_mail_requests (kind, user_id, factor_id)
values ('mfa_factor_added', '00000000-0000-4000-8000-000000000c08', '20000000-0000-4000-8000-000000000c08');

-- Every organization has exactly one policy, with the defaults of screen 6 and PO decisions 1 / 2.
do $$
begin
  perform tests.assert_eq((select count(*) from platform.tenants t
                           where not exists (select 1 from platform.security_policies p where p.tenant_id = t.id)),
    0::bigint, 'every organization has a security policy');
  perform tests.assert((select bool_and(p.mfa_mode = 'off' and p.mfa_prompt_admins and p.mfa_required_roles = '{tenant_admin}'
                                        and p.mfa_grace_days = 7 and p.mfa_required_since is null
                                        and p.password_min_length = 12 and p.lockout_threshold = 5 and p.lockout_minutes = 15
                                        and p.session_idle_minutes = 30 and p.session_max_hours = 12
                                        and p.session_max_devices = 3 and p.version = 1)
                        from platform.security_policies p),
    'defaults: MFA off with the admin prompt, 12 characters, 5 attempts / 15 min, 30 min / 12 h / 3 devices');
end $$;

-- A new organization gets its policy with it (provisioning is a platform operation).
begin;
insert into platform.tenants (id, slug, name_ar) values ('e0000000-0000-4000-8000-000000000c99', 'tenant-new', 'منشأة جديدة');
do $$
begin
  perform tests.assert_eq((select count(*) from platform.security_policies where tenant_id = 'e0000000-0000-4000-8000-000000000c99'),
    1::bigint, 'a new organization gets a security policy');
end $$;
rollback;

-- Floors (T-IAM-24) and role codes, whoever writes; stamps and the start of an MFA requirement.
begin;
do $$
declare
  v_a constant uuid := 'a0000000-0000-4000-8000-000000000001';
  v_since timestamptz;
begin
  perform tests.assert_check_constraint(format('update platform.security_policies set password_min_length = 11 where tenant_id = %L', v_a),
    'security_policies_password_min_length_check', 'minimum length below 12 is refused');
  perform tests.assert_check_constraint(format('update platform.security_policies set password_min_length = 37 where tenant_id = %L', v_a),
    'security_policies_password_min_length_check', 'minimum length above 36 (72 bytes in Arabic) is refused');
  perform tests.assert_check_constraint(format('update platform.security_policies set lockout_threshold = 50 where tenant_id = %L', v_a),
    'security_policies_lockout_threshold_check', 'lockout cannot be turned off');
  -- Never more lenient than the platform default of 5 attempts / 15 minutes (TM-0003 T-IAM-24).
  perform tests.assert_check_constraint(format('update platform.security_policies set lockout_threshold = 6 where tenant_id = %L', v_a),
    'security_policies_lockout_threshold_check', 'at most 5 failed attempts');
  perform tests.assert_check_constraint(format('update platform.security_policies set lockout_threshold = 2 where tenant_id = %L', v_a),
    'security_policies_lockout_threshold_check', 'at least 3 failed attempts');
  perform tests.assert_check_constraint(format('update platform.security_policies set lockout_minutes = 14 where tenant_id = %L', v_a),
    'security_policies_lockout_minutes_check', 'locked for at least 15 minutes');
  perform tests.assert_check_constraint(format('update platform.security_policies set lockout_minutes = 61 where tenant_id = %L', v_a),
    'security_policies_lockout_minutes_check', 'locked for at most 60 minutes');
  perform tests.assert_check_constraint(format('update platform.security_policies set session_max_hours = 25 where tenant_id = %L', v_a),
    'security_policies_session_max_hours_check', 'sessions end within 24 hours');
  perform tests.assert_check_constraint(format('update platform.security_policies set session_idle_minutes = 481 where tenant_id = %L', v_a),
    'security_policies_session_idle_minutes_check', 'inactivity at most 8 hours');
  perform tests.assert_check_constraint(format('update platform.security_policies set session_max_devices = 0 where tenant_id = %L', v_a),
    'security_policies_session_max_devices_check', 'at least one device');
  perform tests.assert_check_constraint(format('update platform.security_policies set mfa_mode = ''sometimes'' where tenant_id = %L', v_a),
    'security_policies_mfa_mode_check', 'unknown MFA mode');
  perform tests.assert_check_constraint(format('update platform.security_policies set mfa_mode = ''required_roles'', mfa_required_roles = ''{}'' where tenant_id = %L', v_a),
    'security_policies_mfa_required_roles_check', 'required for roles needs at least one role');
  perform tests.assert_check_constraint(format('update platform.security_policies set mfa_required_roles = ''{platform_super_admin}'' where tenant_id = %L', v_a),
    'security_policies_mfa_required_roles_check', 'role codes must be organization roles');

  update platform.security_policies set mfa_mode = 'required_roles', mfa_required_roles = '{learner,tenant_admin,learner}'
  where tenant_id = v_a;
  select mfa_required_since into v_since from platform.security_policies where tenant_id = v_a;
  perform tests.assert(v_since is not null, 'a requirement records when it started');
  perform tests.assert_eq((select mfa_required_roles from platform.security_policies where tenant_id = v_a),
    '{learner,tenant_admin}'::text[], 'role codes are kept sorted and once');
  perform tests.assert_eq((select version from platform.security_policies where tenant_id = v_a), 2, 'version increments');
  update platform.security_policies set mfa_required_roles = '{tenant_admin}' where tenant_id = v_a;
  perform tests.assert_eq((select mfa_required_since from platform.security_policies where tenant_id = v_a), v_since,
    'fewer roles: the requirement keeps its start');
  -- The organization of a policy never changes (trigger, before the key is even checked).
  perform tests.assert_fails(format('update platform.security_policies set tenant_id = %L where tenant_id = %L',
      'e0000000-0000-4000-8000-000000000c98', v_a),
    array['42501'], 'the organization of a policy cannot change');
end $$;
rollback;

begin;
do $$
declare
  v_a constant uuid := 'a0000000-0000-4000-8000-000000000001';
begin
  update platform.security_policies set mfa_mode = 'required_roles', mfa_required_roles = '{tenant_admin}', mfa_required_since = null
  where tenant_id = v_a;
  update platform.security_policies set mfa_required_since = now() - interval '3 days' where tenant_id = v_a;
  perform tests.assert((select mfa_required_since > now() - interval '1 minute' from platform.security_policies where tenant_id = v_a),
    'the start of a requirement cannot be backdated by a writer');
  update platform.security_policies set mfa_mode = 'required_all' where tenant_id = v_a;
  perform tests.assert((select mfa_required_since is not null from platform.security_policies where tenant_id = v_a),
    'roles → everyone: newly covered members get their grace period');
  update platform.security_policies set mfa_mode = 'optional' where tenant_id = v_a;
  perform tests.assert((select mfa_required_since is null from platform.security_policies where tenant_id = v_a),
    'no requirement: no start');
end $$;
rollback;

\echo '65_security_fixtures_owner: ok'
