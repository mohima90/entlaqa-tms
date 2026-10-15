-- db-test: run-as=app_server
-- Security policy (T-M2-10; FR-IAM-12/13; T-IAM-24): only an Organization Admin changes it, only
-- in their own organization; members read their own organization's policy; the password rule is the
-- strictest of the account's organizations (PO decision 5) and says nothing else; the lockout settings
-- for the sign-in limiter (T-M2-11). Runs CONNECTED AS app_server (fixtures: 00, 65).
\set ON_ERROR_STOP on

do $$ begin perform tests.assert(session_user = 'app_server', 'must run connected as app_server'); end $$;

-- Who may change the policy: an Organization Admin of A — at any authentication level, without an
-- authenticator code (PO decision, 14 Oct 2026, reversing D-IAM-01; 20261017090400). What AAL2 means
-- (the lower of the token's claim and the Auth session's own level, through a CONFIRMED app, review H1)
-- is still checked here: the organization's MFA sign-in policy relies on it.
begin;
set local role authenticated;
do $$
declare
  v_a constant uuid := 'a0000000-0000-4000-8000-000000000001';
  v_set constant text := 'update platform.security_policies set password_min_length = 16, session_idle_minutes = 15';
begin
  -- HR Manager of A at AAL2: not an Organization Admin.
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab', v_a,
                                             'a1000000-0000-4000-8000-0000000000ab') || tests.fresh_code());
  perform tests.assert(not private.actor_may_change_security_policy(v_a), 'an HR Manager may not change the policy');
  perform tests.assert_eq(tests.rows_affected(v_set), 0::bigint, 'an HR Manager cannot change the policy');
  -- A learner at AAL2 reads it (password rules) but cannot change it.
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c01', '10000000-0000-4000-8000-000000000c11', v_a,
                                             'a1000000-0000-4000-8000-000000000c01') || tests.fresh_code());
  perform tests.assert_eq((select password_min_length from platform.security_policies), 12::smallint, 'members read their organization''s rule');
  perform tests.assert_eq(tests.rows_affected(v_set), 0::bigint, 'a learner cannot change the policy');
  -- What AAL2 means (kept for the sign-in MFA policy): a token CLAIMING aal2 is not enough (uA's Auth
  -- session is not aal2 and uA has no confirmed app); nor an aal2 Auth session with an AAL1 token; nor an
  -- app that was never confirmed from the mailbox (uM4).
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', v_a,
                                             'a1000000-0000-4000-8000-0000000000a1') || tests.fresh_code());
  perform tests.assert(not private.request_aal2(), 'the claim alone is not AAL2');
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c09', '10000000-0000-4000-8000-000000000c91', v_a,
                                             'a1000000-0000-4000-8000-000000000c09'));
  perform tests.assert(not private.request_aal2(), 'an aal1 token on an aal2 session is not AAL2');
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c08', '10000000-0000-4000-8000-000000000c81', v_a,
                                             'a1000000-0000-4000-8000-000000000c08') || tests.fresh_code());
  perform tests.assert(not private.request_aal2(), 'an unconfirmed app does not give AAL2');
  perform tests.assert_eq((select aal2 from private.request_session_facts()), false, 'session facts: not AAL2');
  -- The Organization Admin uA at AAL1 (no confirmed app): changed, stamped with the admin's person, version 2.
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', v_a,
                                             'a1000000-0000-4000-8000-0000000000a1'));
  perform tests.assert_eq((select count(*) from platform.security_policies), 1::bigint, 'the Organization Admin reads the policy');
  perform tests.assert(private.actor_may_change_security_policy(v_a), 'AAL1: the Organization Admin may change the policy');
  perform tests.assert_eq(tests.rows_affected(v_set), 1::bigint, 'AAL1: the Organization Admin changes the policy');
  perform tests.assert((select password_min_length = 16 and session_idle_minutes = 15 and version = 2
                               and updated_by = 'a1000000-0000-4000-8000-0000000000a1'
                        from platform.security_policies), 'stamped with the editor and a new version');
  -- An Organization Admin at AAL2 whose code is older than 15 minutes, or whose claims do not say when the
  -- code was passed: no freshness rule any more either.
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c09', '10000000-0000-4000-8000-000000000c91', v_a,
                                             'a1000000-0000-4000-8000-000000000c09') || tests.fresh_code(interval '16 minutes'));
  perform tests.assert(private.request_aal2() and not private.request_code_fresh(), 'AAL2, but a code from 16 minutes ago');
  perform tests.assert(private.actor_may_change_security_policy(v_a), 'a stale code: may still change the policy');
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c09', '10000000-0000-4000-8000-000000000c91', v_a,
                                             'a1000000-0000-4000-8000-000000000c09') || '{"aal": "aal2"}');
  perform tests.assert(not private.request_code_fresh(), 'no code time: not fresh');
  perform tests.assert_eq(tests.rows_affected('update platform.security_policies set session_idle_minutes = 20'), 1::bigint,
    'no code time: changed all the same');
  perform tests.assert((select session_idle_minutes = 20 and version = 3
                               and updated_by = 'a1000000-0000-4000-8000-000000000c09'
                        from platform.security_policies), 'stamped with the second editor, version 3');
  -- The AAL2 and code-age helpers themselves (still security-relevant: removing one's own confirmed app,
  -- 68, and remembering a browser after the sign-in code, 71): a malformed code time is not fresh; a code
  -- 14 minutes old is (the boundary is 15); a session through a confirmed app is active and at AAL2.
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c09', '10000000-0000-4000-8000-000000000c91', v_a,
                                             'a1000000-0000-4000-8000-000000000c09') || '{"aal": "aal2", "code_at": "1.7e9"}');
  perform tests.assert(not private.request_code_fresh(), 'a malformed code time: not fresh');
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c09', '10000000-0000-4000-8000-000000000c91', v_a,
                                             'a1000000-0000-4000-8000-000000000c09') || tests.fresh_code(interval '14 minutes'));
  perform tests.assert(private.request_code_fresh(), 'a code from 14 minutes ago is fresh');
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c09', '10000000-0000-4000-8000-000000000c91', v_a,
                                             'a1000000-0000-4000-8000-000000000c09') || tests.fresh_code());
  perform tests.assert(private.request_aal2(), 'uA2 (confirmed app) is at AAL2');
  perform tests.assert((select active and aal2 from private.request_session_facts()), 'session facts: active, AAL2');
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
                                             'a0000000-0000-4000-8000-000000000001') || tests.fresh_code());
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
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1', v_b) || tests.fresh_code());
  perform tests.assert_eq(tests.rows_affected('update platform.security_policies set password_min_length = 20'), 1::bigint,
    'B''s admin sets 20');
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c09', '10000000-0000-4000-8000-000000000c91', v_a) || tests.fresh_code());
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
  -- A session its organization refuses (MFA required, uM4's app not confirmed): no answer in the
  -- organization (review L1); the same account without an organization (a recovery session) still gets it.
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c09', '10000000-0000-4000-8000-000000000c91', v_a) || tests.fresh_code());
  perform tests.assert_eq(tests.rows_affected('update platform.security_policies set mfa_mode = ''required_all'', mfa_grace_days = 0'),
    1::bigint, 'A requires an app from everyone');
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c08', '10000000-0000-4000-8000-000000000c81', v_a) || tests.fresh_code());
  perform tests.assert(private.password_min_length_for_caller() is null, 'a session its organization refuses: no answer');
  perform tests.set_claims(jsonb_build_object('role', 'authenticated', 'sub', '00000000-0000-4000-8000-000000000c08',
                                              'session_id', '10000000-0000-4000-8000-000000000c81'));
  perform tests.assert_eq(private.password_min_length_for_caller(), 16::smallint, 'the same account without an organization: 16');
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
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c09', '10000000-0000-4000-8000-000000000c91',
                                             'a0000000-0000-4000-8000-000000000001') || tests.fresh_code());
  perform tests.assert_eq(tests.rows_affected('update platform.security_policies set lockout_threshold = 3, lockout_minutes = 30'),
    1::bigint, 'A''s admin makes the lockout stricter');
  perform tests.set_claims(null);
  select * into r from private.tenant_lockout_policy('a0000000-0000-4000-8000-000000000001');
  perform tests.assert(r.lockout_threshold = 3 and r.lockout_minutes = 30, 'A''s lockout, without a session');
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
  perform tests.assert_privilege_denied($q$delete from private.auth_mfa_factor$q$, 'factors cannot be deleted by the request path');
  perform tests.assert_privilege_denied($q$delete from private.auth_session_validity$q$, 'Auth sessions cannot be deleted by the request path');
  perform tests.assert_privilege_denied($q$select count(*) from private.mfa_factor_confirmations$q$, 'confirmed apps: tenant_guard only');
  perform tests.assert_privilege_denied($q$select private.end_sessions('00000000-0000-4000-8000-0000000000b1', null, null, 'user', null)$q$,
    'the internal sign-out helper is tenant_guard''s');
  perform tests.assert_privilege_denied($q$select private.remove_account_factors('00000000-0000-4000-8000-0000000000b1', null)$q$,
    'the internal factor removal is tenant_guard''s');
  perform tests.assert_privilege_denied($q$select private.audit_account_event('00000000-0000-4000-8000-0000000000b1', 'platform.auth.mfa_reset', '{}', 'platform')$q$,
    'the internal audit helper is tenant_guard''s');
  perform tests.assert_privilege_denied($q$select private.reset_account_mfa('00000000-0000-4000-8000-0000000000b1', 'X-1')$q$,
    'the support reset is not the web app''s');
end $$;
rollback;

\echo '66_security_policies_app_server: ok'
