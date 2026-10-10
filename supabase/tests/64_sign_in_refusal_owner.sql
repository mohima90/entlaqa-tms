-- db-test: run-as=owner
-- Sign-in refusal (FR-IAM-05, T-M2-09; migration 20261011090100): the rule private.account_sign_in_refused —
-- an account with memberships, none active in an active or trial organization and no pending, unexpired
-- invitation for its e-mail in one, gets no token; an account without any membership always does — and
-- the access-token hook that applies it (as supabase_auth_admin, the role Auth uses), fail-closed. Also:
-- the password-reset mailer (worker mode) sends nothing to a refused account. Every block is rolled back;
-- the last part removes the fixtures of 62_member_deactivation_owner.sql again (committed).
--   uX  active in A and B          uR   active in A          uS   deactivated in A only (suspended)
--   uN  no membership, a pending invitation of A           uE / uF  active in A
--   base fixtures: uA active in A · uInv (00a2) an `invited` membership only · uSus (00a3) suspended in A
--   only · uC (00c1) active only in suspended C · uD (00d1) active in trial D · uNone (00e1) no membership
\set ON_ERROR_STOP on

create or replace function pg_temp.refused(p_user uuid) returns boolean language sql as $$
  select private.account_sign_in_refused(p_user);
$$;
-- The hook as Auth calls it (password sign-in; session id in the claims).
create or replace function pg_temp.hook(p_user uuid, p_session uuid) returns jsonb language sql as $$
  select private.custom_access_token_hook(jsonb_build_object(
    'user_id', p_user,
    'authentication_method', 'password',
    'claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1', 'session_id', p_session)));
$$;
create or replace function pg_temp.become_worker() returns void language plpgsql as $$
begin
  set local session authorization app_worker;
  set local role authenticated;
  perform tests.set_claims(jsonb_build_object('role', 'system', 'job_id', 'tests.sign_in_refusal'));
end $$;
create or replace function pg_temp.become_owner() returns void language plpgsql as $$
begin
  reset role;
  reset session authorization;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- The rule
-- ---------------------------------------------------------------------------------------------------
begin;
do $$
begin
  perform tests.assert(not pg_temp.refused('9d000000-0000-4000-8000-000000000001'), 'active in A and B: signs in');
  perform tests.assert(not pg_temp.refused('00000000-0000-4000-8000-0000000000d1'), 'active in a trial organization: signs in');
  perform tests.assert(not pg_temp.refused('00000000-0000-4000-8000-0000000000e1'),
    'no membership at all (platform staff, break-glass, a new invitee): never refused');
  perform tests.assert(not pg_temp.refused('9d000000-0000-4000-8000-000000000007'),
    'no membership, with a pending invitation: signs in');
  perform tests.assert(not pg_temp.refused('9d000000-0000-4000-8000-0000000000ff'), 'unknown account (no membership): not refused');
  perform tests.assert(pg_temp.refused(null), 'no account id: refused');
  perform tests.assert(pg_temp.refused('9d000000-0000-4000-8000-000000000004'), 'deactivated in its only organization: refused');
  perform tests.assert(pg_temp.refused('00000000-0000-4000-8000-0000000000a3'), 'suspended membership only: refused');
  perform tests.assert(pg_temp.refused('00000000-0000-4000-8000-0000000000a2'), 'an invited membership only (no invitation): refused');
  perform tests.assert(pg_temp.refused('00000000-0000-4000-8000-0000000000c1'), 'active only in a suspended organization: refused');

  -- Deactivated in A but active elsewhere (B): signs in (T-IAM-40); deactivated in B too: refused.
  update platform.tenant_memberships set status = 'suspended'
  where user_id = '9d000000-0000-4000-8000-000000000001' and tenant_id = 'a0000000-0000-4000-8000-000000000001';
  perform tests.assert(not pg_temp.refused('9d000000-0000-4000-8000-000000000001'), 'deactivated in A, active in B: signs in');
  update platform.tenant_memberships set status = 'suspended'
  where user_id = '9d000000-0000-4000-8000-000000000001' and tenant_id = 'b0000000-0000-4000-8000-000000000001';
  perform tests.assert(pg_temp.refused('9d000000-0000-4000-8000-000000000001'), 'deactivated in A and B: refused');
  -- Reactivated: at once (the rule is evaluated live; no queue).
  update platform.tenant_memberships set status = 'active'
  where user_id = '9d000000-0000-4000-8000-000000000001' and tenant_id = 'b0000000-0000-4000-8000-000000000001';
  perform tests.assert(not pg_temp.refused('9d000000-0000-4000-8000-000000000001'), 'reactivated: signs in again at once');

  -- Organization status: reinstating C lets uC in; a cancelled organization keeps them out.
  update platform.tenants set status = 'active' where id = 'c0000000-0000-4000-8000-000000000001';
  perform tests.assert(not pg_temp.refused('00000000-0000-4000-8000-0000000000c1'), 'organization reinstated: signs in');
  update platform.tenants set status = 'cancelled' where id = 'c0000000-0000-4000-8000-000000000001';
  perform tests.assert(pg_temp.refused('00000000-0000-4000-8000-0000000000c1'), 'organization cancelled: refused');
end $$;
rollback;

-- A pending invitation keeps a deactivated account able to sign in to accept it — only while it is
-- pending, unexpired and of a served organization. The account's e-mail is compared lower-cased.
begin;
set local jadarat.allow_auth_email_change = 'on';
-- uS (deactivated in A only) gets the address of B's pending invitation (base fixture), in capitals.
update auth.users set email = 'INVITEE@B.TEST' where id = '9d000000-0000-4000-8000-000000000004';
do $$
begin
  perform tests.assert(not pg_temp.refused('9d000000-0000-4000-8000-000000000004'),
    'a pending invitation in B for its e-mail (any case): signs in to accept it');
  update platform.tenants set status = 'suspended' where id = 'b0000000-0000-4000-8000-000000000001';
  perform tests.assert(pg_temp.refused('9d000000-0000-4000-8000-000000000004'), 'the invitation''s organization is suspended: refused');
  update platform.tenants set status = 'active' where id = 'b0000000-0000-4000-8000-000000000001';
  update platform.invitations set expires_at = now() - interval '1 minute' where id = 'b4000000-0000-4000-8000-000000000001';
  perform tests.assert(pg_temp.refused('9d000000-0000-4000-8000-000000000004'), 'the invitation expired: refused');
  update platform.invitations set expires_at = now() + interval '1 day' where id = 'b4000000-0000-4000-8000-000000000001';
  update platform.invitations set status = 'revoked', revoked_at = now(), revoked_by = '00000000-0000-4000-8000-0000000000b1'
  where id = 'b4000000-0000-4000-8000-000000000001';
  perform tests.assert(pg_temp.refused('9d000000-0000-4000-8000-000000000004'), 'the invitation was revoked: refused');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- The hook (as supabase_auth_admin): no token for a refused account, the usual claims otherwise
-- ---------------------------------------------------------------------------------------------------
begin;
set local role supabase_auth_admin;
do $$
declare
  v jsonb;
begin
  v := pg_temp.hook('9d000000-0000-4000-8000-000000000004', '9d200000-0000-4000-8000-000000000007');
  perform tests.assert_eq(v, '{"error": {"http_code": 403, "message": "Sign-in is not available for this account."}}'::jsonb,
    'a refused account: Auth''s error object, no claims (sign-in and refresh alike)');
  perform tests.assert_eq(pg_temp.hook('00000000-0000-4000-8000-0000000000c1', '10000000-0000-4000-8000-0000000000c1') -> 'error' ->> 'http_code',
    '403', 'active only in a suspended organization: refused');
  v := pg_temp.hook('9d000000-0000-4000-8000-000000000001', '9d200000-0000-4000-8000-000000000001');
  perform tests.assert_eq(v -> 'claims' ->> 'tenant_id', 'a0000000-0000-4000-8000-000000000001', 'an active member: the usual claims');
  perform tests.assert(not (v ? 'error'), 'and no error');
  v := pg_temp.hook('00000000-0000-4000-8000-0000000000e1', '10000000-0000-4000-8000-0000000000e1');
  perform tests.assert(not (v ? 'error') and v -> 'claims' ->> 'sub' = '00000000-0000-4000-8000-0000000000e1'
                       and not (v -> 'claims' ? 'tenant_id'),
    'no membership: a token without organization');
  v := private.custom_access_token_hook('{"claims": {"role": "authenticated"}}'::jsonb);
  perform tests.assert_eq(v -> 'error' ->> 'http_code', '403', 'no user id: refused');
end $$;
reset role;
rollback;

-- Fail closed: if the rule cannot be asked (here: EXECUTE revoked), the hook issues no token — with a
-- server error (500), not the refusal (403), so that clients keep their session and retry (review N1).
begin;
revoke execute on function private.account_sign_in_refused(uuid) from supabase_auth_admin;
set local role supabase_auth_admin;
do $$
begin
  perform tests.assert_eq(pg_temp.hook('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1'),
    '{"error": {"http_code": 500, "message": "Sign-in is temporarily unavailable."}}'::jsonb,
    'the rule raised: no token, even for an active member — a server error, not the refusal');
end $$;
reset role;
rollback;

-- Who may ask the rule: Auth only.
begin;
do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role', 'app_server', 'app_worker', 'app_queue',
                                'tenant_guard', 'invitation_guard', 'account_mail_guard'] loop
    perform tests.assert(not has_function_privilege(v_role, 'private.account_sign_in_refused(uuid)', 'execute'),
      format('%s must not execute the sign-in rule', v_role));
  end loop;
  perform tests.assert(has_function_privilege('supabase_auth_admin', 'private.account_sign_in_refused(uuid)', 'execute'),
    'Auth (the access-token hook) asks it');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- The password-reset mailer (worker mode) sends nothing to a refused account: it needs an active
-- membership in a served organization (outcome no_membership — the request is answered without e-mail).
-- ---------------------------------------------------------------------------------------------------
begin;
delete from private.account_mail_requests;
insert into private.account_mail_requests (kind, email) values ('password_reset', 'ds@a.test');
do $$
declare
  v_lease record;
begin
  perform tests.assert(private.account_sign_in_refused('9d000000-0000-4000-8000-000000000004'), 'uS is refused');
  perform pg_temp.become_worker();
  select * into v_lease from private.claim_account_mail_request();
  perform tests.assert_eq(v_lease.outcome, 'no_membership', 'no reset e-mail for a refused account');
  perform pg_temp.become_owner();
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Remove the fixtures of 62 (committed): the accounts (their memberships, roles, sessions and apps go with
-- them), people, placements, departments, the invitation and the helpers.
-- ---------------------------------------------------------------------------------------------------
delete from platform.invitations where id = '9d400000-0000-4000-8000-000000000001';
-- And the authenticator apps of uA and uAB from 00 (T-M2-10 × T-M2-09): the T-M2-10 tests start without them.
delete from auth.mfa_factors where id in ('20000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-0000000000ab');
update auth.sessions set aal = null, factor_id = null
where id in ('10000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000ab');
delete from auth.users where id::text like '9d000000-%';
delete from platform.person_employment where person_id::text like '9d100000-%';
delete from platform.departments where id::text like '9d300000-%';
delete from platform.persons where id::text like '9d100000-%';
drop function tests.t09_as(text, text);
drop function tests.t09_deactivate(uuid);
drop function tests.t09_holds_lock(text, text);
do $$
begin
  perform tests.assert(not exists (select 1 from platform.tenant_memberships where user_id::text like '9d000000-%')
                       and not exists (select 1 from platform.session_context where user_id::text like '9d000000-%')
                       and not exists (select 1 from auth.mfa_factors)
                       and not exists (select 1 from private.mfa_factor_confirmations)
                       and not exists (select 1 from auth.sessions where aal is not null or factor_id is not null),
    'fixtures removed');
end $$;

\echo '64_sign_in_refusal_owner: ok'
