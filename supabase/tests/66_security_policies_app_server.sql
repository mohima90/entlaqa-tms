-- db-test: run-as=app_server
-- Security policy (T-M2-10; FR-IAM-12/13; T-IAM-24): only an Organization Admin at AAL2 changes it, only
-- in their own organization; members read their own organization's policy; the password rule is the
-- strictest of the account's organizations (PO decision 5) and says nothing else; the lockout settings
-- for the sign-in limiter (T-M2-11). Runs CONNECTED AS app_server (fixtures: 00, 65).
\set ON_ERROR_STOP on

do $$ begin perform tests.assert(session_user = 'app_server', 'must run connected as app_server'); end $$;

-- Who may change the policy: uA (Organization Admin of A) at AAL2 only.
begin;
set local role authenticated;
do $$
declare
  v_a constant uuid := 'a0000000-0000-4000-8000-000000000001';
  v_set constant text := 'update platform.security_policies set password_min_length = 16, session_idle_minutes = 15';
begin
  -- Organization Admin, AAL1: the row is not updatable for this session (0 rows), nothing changes.
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', v_a,
                                             'a1000000-0000-4000-8000-0000000000a1'));
  perform tests.assert_eq((select count(*) from platform.security_policies), 1::bigint, 'the Organization Admin reads the policy');
  perform tests.assert_eq(tests.rows_affected(v_set), 0::bigint, 'AAL1: the Organization Admin cannot change the policy');
  -- HR Manager of A at AAL2: not an Organization Admin.
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab', v_a,
                                             'a1000000-0000-4000-8000-0000000000ab') || '{"aal": "aal2"}');
  perform tests.assert_eq(tests.rows_affected(v_set), 0::bigint, 'an HR Manager cannot change the policy, even at AAL2');
  -- A learner at AAL2 reads it (password rules) but cannot change it.
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c01', '10000000-0000-4000-8000-000000000c11', v_a,
                                             'a1000000-0000-4000-8000-000000000c01') || '{"aal": "aal2"}');
  perform tests.assert_eq((select password_min_length from platform.security_policies), 12::smallint, 'members read their organization''s rule');
  perform tests.assert_eq(tests.rows_affected(v_set), 0::bigint, 'a learner cannot change the policy');
  -- The Organization Admin at AAL2: changed, stamped with the admin's person, version 2.
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', v_a,
                                             'a1000000-0000-4000-8000-0000000000a1') || '{"aal": "aal2"}');
  perform tests.assert_eq(tests.rows_affected(v_set), 1::bigint, 'the Organization Admin at AAL2 changes the policy');
  perform tests.assert((select password_min_length = 16 and session_idle_minutes = 15 and version = 2
                               and updated_by = 'a1000000-0000-4000-8000-0000000000a1'
                        from platform.security_policies), 'stamped with the editor and a new version');
  -- … but only the settings: not the stamps, the start of a requirement or the organization.
  perform tests.assert_privilege_denied($q$update platform.security_policies set updated_by = null$q$, 'updated_by is not updatable');
  perform tests.assert_privilege_denied($q$update platform.security_policies set mfa_required_since = now()$q$,
    'the start of a requirement is not updatable');
  perform tests.assert_privilege_denied($q$update platform.security_policies set version = 1$q$, 'version is not updatable');
  -- Floors hold for the admin too.
  perform tests.assert_check_constraint($q$update platform.security_policies set password_min_length = 8$q$,
    'security_policies_password_min_length_check', 'the admin cannot go below 12 characters');
  perform tests.assert_check_constraint($q$update platform.security_policies set mfa_mode = 'required_roles', mfa_required_roles = '{owner}'$q$,
    'security_policies_mfa_required_roles_check', 'only organization roles can be required');
  -- Never another organization's policy (RLS), by id or in bulk.
  perform tests.assert_eq(tests.rows_affected($q$update platform.security_policies set password_min_length = 30 where tenant_id = 'b0000000-0000-4000-8000-000000000001'$q$),
    0::bigint, 'the admin of A cannot change B''s policy');
end $$;
rollback;

-- A role ended or not started yet is no authority (role in force now).
begin;
set local role authenticated;
do $$
begin
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c06', '10000000-0000-4000-8000-000000000c61',
                                             'a0000000-0000-4000-8000-000000000001') || '{"aal": "aal2"}');
  perform tests.assert(not private.actor_may_change_security_policy('a0000000-0000-4000-8000-000000000001'),
    'a Training Manager may not change the policy');
end $$;
rollback;

-- Strictest wins (PO decision 5): uS3 is a member of A and B. With B at 20 and A at 16 the account's rule
-- is 20 — from either organization, and also before one is chosen. Others: their own organization only.
begin;
set local role authenticated;
do $$
declare
  v_a constant uuid := 'a0000000-0000-4000-8000-000000000001';
  v_b constant uuid := 'b0000000-0000-4000-8000-000000000001';
begin
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1', v_b) || '{"aal": "aal2"}');
  perform tests.assert_eq(tests.rows_affected('update platform.security_policies set password_min_length = 20'), 1::bigint,
    'B''s admin sets 20');
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', v_a) || '{"aal": "aal2"}');
  perform tests.assert_eq(tests.rows_affected('update platform.security_policies set password_min_length = 16'), 1::bigint,
    'A''s admin sets 16');

  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c03', '10000000-0000-4000-8000-000000000c31', v_a));
  perform tests.assert_eq(private.password_min_length_for_caller(), 20::smallint, 'member of A and B, acting in A: 20 (B''s)');
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c03', '10000000-0000-4000-8000-000000000c33', v_b));
  perform tests.assert_eq(private.password_min_length_for_caller(), 20::smallint, 'acting in B: 20');
  perform tests.set_claims(jsonb_build_object('role', 'authenticated', 'sub', '00000000-0000-4000-8000-000000000c03',
                                              'session_id', '10000000-0000-4000-8000-000000000c31'));
  perform tests.assert_eq(private.password_min_length_for_caller(), 20::smallint,
    'without an organization (the recovery session of a reset): 20');
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c01', '10000000-0000-4000-8000-000000000c11', v_a));
  perform tests.assert_eq(private.password_min_length_for_caller(), 16::smallint, 'member of A only: 16');
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1', v_b));
  perform tests.assert_eq(private.password_min_length_for_caller(), 20::smallint, 'member of B only: 20');
  -- A suspended organization's rule does not count; a member of nothing active gets the platform's 12.
  perform tests.set_claims(jsonb_build_object('role', 'authenticated', 'sub', '00000000-0000-4000-8000-000000000c07',
                                              'session_id', '10000000-0000-4000-8000-000000000c71'));
  perform tests.assert_eq(private.password_min_length_for_caller(), 12::smallint, 'suspended organization: platform minimum');
  -- No live session, an ended session, foreign claims: no answer.
  perform tests.set_claims(jsonb_build_object('role', 'authenticated', 'sub', '00000000-0000-4000-8000-000000000c03',
                                              'session_id', '10000000-0000-4000-8000-0000000000a1'));
  perform tests.assert(private.password_min_length_for_caller() is null, 'another account''s session: no answer');
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c01', '10000000-0000-4000-8000-000000000c15', v_a));
  perform tests.assert(private.password_min_length_for_caller() is null, 'an ended session: no answer');
  perform tests.set_claims(tests.system_claims(v_a));
  perform tests.assert(private.password_min_length_for_caller() is null, 'system claims: no answer');
  perform tests.set_claims(null);
  perform tests.assert(private.password_min_length_for_caller() is null, 'no claims: no answer');

  -- A new account accepting tenant A's invitation follows A's rule (16); unknown links the platform's 12.
  perform tests.assert_eq(private.invitation_password_min_length(tests.token_hash('tok-a')), 16::smallint,
    'invitation to A: A''s rule');
  perform tests.assert_eq(private.invitation_password_min_length(tests.token_hash('tok-b')), 20::smallint,
    'invitation to B: B''s rule');
  perform tests.assert_eq(private.invitation_password_min_length(tests.token_hash('not-a-token')), 12::smallint,
    'unknown link: 12');
  perform tests.assert_eq(private.invitation_password_min_length(null), 12::smallint, 'no link: 12');
end $$;
rollback;

-- Lockout settings for the sign-in limiter (T-M2-11): no session needed; platform default otherwise.
begin;
set local role authenticated;
do $$
declare
  r record;
begin
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
                                             'a0000000-0000-4000-8000-000000000001') || '{"aal": "aal2"}');
  perform tests.assert_eq(tests.rows_affected('update platform.security_policies set lockout_threshold = 7, lockout_minutes = 30'),
    1::bigint, 'A''s admin changes the lockout');
  perform tests.set_claims(null);
  select * into r from private.tenant_lockout_policy('a0000000-0000-4000-8000-000000000001');
  perform tests.assert(r.lockout_threshold = 7 and r.lockout_minutes = 30, 'A''s lockout, without a session');
  select * into r from private.tenant_lockout_policy('b0000000-0000-4000-8000-000000000001');
  perform tests.assert(r.lockout_threshold = 5 and r.lockout_minutes = 15, 'B: its own (default) lockout');
  select * into r from private.tenant_lockout_policy('c0000000-0000-4000-8000-000000000001');
  perform tests.assert(r.lockout_threshold = 5 and r.lockout_minutes = 15, 'suspended organization: platform default');
  select * into r from private.tenant_lockout_policy(null);
  perform tests.assert(r.lockout_threshold = 5 and r.lockout_minutes = 15, 'no organization (platform sign-in host): default');
  select * into r from private.tenant_lockout_policy('e0000000-0000-4000-8000-00000000ffff');
  perform tests.assert(r.lockout_threshold = 5 and r.lockout_minutes = 15, 'unknown organization: default');
end $$;
rollback;

-- The decision function itself is tenant_guard's only (no probing of other accounts' sessions).
begin;
set local role authenticated;
do $$
begin
  perform tests.assert_privilege_denied(
    $q$select private.session_access('00000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1', 'b0000000-0000-4000-8000-000000000001', true, true)$q$,
    'authenticated cannot ask about other sessions');
  perform tests.assert_privilege_denied($q$select private.password_min_length_of('00000000-0000-4000-8000-0000000000b1')$q$,
    'authenticated cannot ask about other accounts'' rules');
  perform tests.assert_privilege_denied($q$select count(*) from private.revoked_sessions$q$, 'ended sessions: tenant_guard only');
  perform tests.assert_privilege_denied($q$select count(*) from private.mfa_prompt_dismissals$q$, 'prompt answers: tenant_guard only');
  perform tests.assert_privilege_denied($q$select count(*) from private.auth_mfa_factor$q$, 'factors: tenant_guard only');
end $$;
rollback;

\echo '66_security_policies_app_server: ok'
