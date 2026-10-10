-- db-test: run-as=app_server
-- Invitations on the request path (T-M2-07, FR-IAM-03): who may invite and revoke (database guard, same
-- rules as roles), what users can never do (read token hashes, issue tokens, accept for someone), the
-- state of a link and acceptance — single use, expiry, the account must match; the sign-up gate is out
-- of reach (39_invitations_signup_hook.sql runs it as Auth). Runs CONNECTED AS
-- app_server. Fixtures: 00_helpers_and_fixtures.sql, 35_invitations_fixtures.sql. Each block is rolled
-- back except one committed acceptance (a4…04 by uFresh, as caller), checked again by 38_invitations_owner.sql.
-- Users in tenant A: uA = Organization Admin, uAB = HR Manager + learner, uM = member without a role.
\set ON_ERROR_STOP on

do $$ begin perform tests.assert(session_user = 'app_server', 'must run connected as app_server'); end $$;

-- ---------------------------------------------------------------------------------------------------
-- State of a link: public page, no claims (as invitationByToken() calls it).
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(null);
do $$
declare
begin
  perform tests.assert_eq((select row(x.*)::text from private.invitation_by_token(tests.token_hash('tok-a')) x),
    row('valid', 'المنشأة أ', 'Tenant A', 'invitee@a.test', 'مدعوة أ', 'Invitee A', 'ar')::text,
    'valid link: organization, login e-mail, display names and language');
  perform tests.assert_eq((select state from private.invitation_by_token(tests.token_hash('tok-b'))), 'valid',
    'a link of another organization is valid too (the page needs no tenant)');
  perform tests.assert_eq((select row(x.*)::text from private.invitation_by_token(tests.token_hash('tok-expired')) x), row('expired', null, null, null, null, null, null)::text,
    'pending and past its expiry: expired, no details');
  perform tests.assert_eq((select row(x.*)::text from private.invitation_by_token(tests.token_hash('tok-revoked')) x), row('revoked', null, null, null, null, null, null)::text, 'revoked, no details');
  perform tests.assert_eq((select state from private.invitation_by_token(tests.token_hash('tok-unknown'))), 'invalid',
    'unknown token: invalid');
  perform tests.assert_eq((select state from private.invitation_by_token(null)), 'invalid', 'no token: invalid');
  perform tests.assert_eq((select state from private.invitation_by_token('\x0102'::bytea)), 'invalid', 'not a SHA-256: invalid');
  perform tests.assert_eq((select state from private.invitation_by_token(tests.token_hash('tok-c'))), 'invalid',
    'suspended organization: invalid');
  perform tests.assert_eq((select state from private.invitation_by_token(tests.token_hash('tok-changed'))), 'invalid',
    'the person''s e-mail changed since: invalid');
  perform tests.assert_eq((select count(*) from private.invitation_by_token(tests.token_hash('tok-a'))), 1::bigint,
    'exactly one row');
  -- The token hash itself is never readable, not even through RLS-free paths of the request role.
  perform tests.assert_privilege_denied($q$select token_hash from platform.invitations$q$,
    'no claims: token_hash not readable');
end $$;
reset role;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Accepting with the account just created through the hook-gated sign-up (uFresh, session sFresh):
-- accept_invitation_as_caller is the only way to accept (security review H1). Refusals first.
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000f4', '10000000-0000-4000-8000-0000000000f4', null));
do $$
begin
  perform tests.assert(to_regprocedure('private.accept_invitation(bytea,uuid,text,text)') is null,
    'no acceptance for a given user id: the app_server-only entry point is gone');
  perform tests.assert_fails($q$select private.accept_invitation_as_caller(tests.token_hash('tok-a'), null, null)$q$,
    array['JI003'], 'another person''s invitation (other e-mail) is refused');
  perform tests.assert_fails($q$select private.accept_invitation_as_caller(tests.token_hash('tok-expired'))$q$,
    array['JI001'], 'expired: not valid');
  perform tests.assert_fails($q$select private.accept_invitation_as_caller(tests.token_hash('tok-revoked'))$q$,
    array['JI001'], 'revoked: not valid');
  perform tests.assert_fails($q$select private.accept_invitation_as_caller(tests.token_hash('tok-unknown'))$q$,
    array['JI001'], 'unknown token: not valid');
  perform tests.assert_fails($q$select private.accept_invitation_as_caller(tests.token_hash('tok-c'))$q$,
    array['JI001'], 'suspended organization: not valid');
  perform tests.assert_fails($q$select private.accept_invitation_as_caller(tests.token_hash('tok-changed'))$q$,
    array['JI001'], 'the person''s e-mail changed: not valid');
  perform tests.assert_fails($q$select private.accept_invitation_as_caller(null)$q$,
    array['42501'], 'no token');
  perform tests.assert_fails($q$select private.apply_invitation_acceptance(tests.token_hash('tok-fresh'), '00000000-0000-4000-8000-0000000000f4', null, null)$q$,
    array['42501'], 'the acceptance effects cannot be called directly');
  -- Nor can anybody accept through the tables (here: the Organization Admin of A), or reach the sign-up
  -- gate or the link state directly.
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
    'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
  perform tests.assert_fails_like($q$update platform.invitations set status = 'accepted' where id = 'a4000000-0000-4000-8000-000000000004'$q$,
    'invitations are accepted through the invitation link only', 'users cannot mark an invitation accepted');
  perform tests.assert_privilege_denied($q$update platform.invitations set accepted_user_id = '00000000-0000-4000-8000-0000000000a1'$q$,
    'users cannot set the accepting account');
  perform tests.assert_privilege_denied($q$select private.invitation_allows_signup('fresh@a.test', repeat('A', 43))$q$,
    'the request path cannot call the sign-up gate');
  perform tests.assert_privilege_denied($q$select private.before_user_created_hook('{}'::jsonb)$q$,
    'the request path cannot call the sign-up hook');
  perform tests.assert_privilege_denied($q$select * from private.invitation_link(tests.token_hash('tok-fresh'))$q$,
    'the link state is read through invitation_by_token only');
end $$;
reset role;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Acceptance by the new account: success (committed), effects, single use.
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000f4', '10000000-0000-4000-8000-0000000000f4', null));
do $$
declare
  v_membership uuid;
begin
  perform tests.assert_eq(
    private.accept_invitation_as_caller(tests.token_hash('tok-fresh'), '  سارة الجديدة ', 'Sara New'),
    'a0000000-0000-4000-8000-000000000001'::uuid, 'accepted: returns the organization');
  perform tests.assert_eq((select state from private.invitation_by_token(tests.token_hash('tok-fresh'))), 'used',
    'the link now reads as used');
  perform tests.assert_fails($q$select private.accept_invitation_as_caller(tests.token_hash('tok-fresh'))$q$,
    array['JI001'], 'single use: a second acceptance fails');
  perform tests.assert_eq(private.request_claims() ->> 'sub', '00000000-0000-4000-8000-0000000000f4',
    'the transaction''s claims are put back');

  -- Effects, read as the Organization Admin of A through RLS.
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
    'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
  select id into v_membership from platform.tenant_memberships
  where user_id = '00000000-0000-4000-8000-0000000000f4' and person_id = 'a1000000-0000-4000-8000-0000000000e4' and status = 'active';
  perform tests.assert(v_membership is not null, 'an ACTIVE membership for the new account and the invited person');
  perform tests.assert_eq(
    (select string_agg(role_code || ':' || is_primary || ':' || coalesce(created_by::text, '-'), ',' order by role_code)
     from platform.role_assignments where membership_id = v_membership),
    'hr_manager:true:-,learner:false:-,mentor:false:-', 'the invitation''s roles (privileged too), stamped as a platform operation');
  perform tests.assert_eq((select row(display_name_ar, display_name_en, updated_by)::text from platform.persons where id = 'a1000000-0000-4000-8000-0000000000e4'), row('سارة الجديدة', 'Sara New', null::uuid)::text, 'display names chosen on the page (trimmed)');
  perform tests.assert_eq((select row(status, accepted_user_id, accepted_at is not null)::text
                           from platform.invitations where id = 'a4000000-0000-4000-8000-000000000004'),
    row('accepted', '00000000-0000-4000-8000-0000000000f4'::uuid, true)::text,
    'the invitation is accepted by that account');
  perform tests.assert_eq((select row(actor_user_id, actor_person_id, entity_type, entity_id)::text from platform.audit_events
  where action = 'platform.invitation.accepted'),
    row('00000000-0000-4000-8000-0000000000f4'::uuid, 'a1000000-0000-4000-8000-0000000000e4'::uuid, 'invitation',
        'a4000000-0000-4000-8000-000000000004')::text, 'audit: the new member accepted the invitation');
end $$;
reset role;
commit;

-- An account that existed before the link was sent (uStale) accepts the same way once signed in.
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000f5', '10000000-0000-4000-8000-0000000000f5', null));
do $$
begin
  perform tests.assert_eq(private.accept_invitation_as_caller(tests.token_hash('tok-stale')),
    'a0000000-0000-4000-8000-000000000001'::uuid, 'an existing account accepts after signing in');
end $$;
reset role;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- accept_invitation_as_caller (an existing account, signed in).
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
do $$
begin
  perform tests.assert_fails($q$select private.accept_invitation_as_caller(tests.token_hash('tok-a'))$q$,
    array['JI003'], 'caller: another person''s invitation (other e-mail) is refused');
  perform tests.assert_eq(private.current_tenant_id(), 'a0000000-0000-4000-8000-000000000001'::uuid,
    'a refused acceptance leaves the caller''s claims in place');
  perform tests.assert_fails($q$select private.accept_invitation_as_caller(tests.token_hash('tok-unknown'))$q$,
    array['JI001'], 'caller: unknown token');
  perform tests.assert_eq(private.accept_invitation_as_caller(tests.token_hash('tok-caller')),
    'b0000000-0000-4000-8000-000000000001'::uuid, 'caller (uA, member of A) accepts the invitation of B for their e-mail');
  perform tests.assert_eq(private.current_tenant_id(), 'a0000000-0000-4000-8000-000000000001'::uuid,
    'the caller''s claims are restored after the acceptance (still acting in A)');
  perform tests.assert_fails($q$select private.accept_invitation_as_caller(tests.token_hash('tok-caller'))$q$,
    array['JI001'], 'caller: single use');
  -- Read in B as its Organization Admin.
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1',
    'b0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-0000000000b1'));
  perform tests.assert_eq(
    (select string_agg(m.status || ':' || ra.role_code || ':' || coalesce(ra.created_by::text, '-'), ',')
     from platform.tenant_memberships m join platform.role_assignments ra on ra.membership_id = m.id
     where m.user_id = '00000000-0000-4000-8000-0000000000a1'),
    'active:learner:-', 'uA is now an active learner of B (not stamped with their person of A)');
end $$;
reset role;
rollback;

begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000f7', '10000000-0000-4000-8000-0000000000f7', null));
do $$
begin
  perform tests.assert_fails($q$select private.accept_invitation_as_caller(tests.token_hash('tok-member'))$q$,
    array['JI002'], 'caller already a member of the organization (through another person)');
end $$;
-- Expired session, no claims, system-shaped claims: refused.
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a9', null));
do $$ begin
  perform tests.assert_fails_like($q$select private.accept_invitation_as_caller(tests.token_hash('tok-caller'))$q$,
    'accept_invitation_as_caller needs a valid session', 'caller: expired session');
end $$;
select tests.set_claims(null);
do $$ begin
  perform tests.assert_fails_like($q$select private.accept_invitation_as_caller(tests.token_hash('tok-caller'))$q$,
    'accept_invitation_as_caller needs a signed-in user', 'caller: no claims');
end $$;
select tests.set_claims(tests.system_claims('b0000000-0000-4000-8000-000000000001'));
do $$ begin
  perform tests.assert_fails_like($q$select private.accept_invitation_as_caller(tests.token_hash('tok-caller'))$q$,
    'accept_invitation_as_caller needs a signed-in user', 'caller: system claims');
end $$;
reset role;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- The inviter's authority is checked again when the link is used (security review M1): a pending
-- invitation stops working when its inviter is revoked, suspended or no longer may give its roles.
-- a4…09 (learner) and a4…0a (auditor, privileged) were sent by uAB, now an HR Manager only.
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(null);
do $$
begin
  perform tests.assert_eq((select state from private.invitation_by_token(tests.token_hash('tok-by-hr'))), 'valid',
    'an ordinary invitation of an active HR Manager is valid');
  perform tests.assert_eq((select row(x.*)::text from private.invitation_by_token(tests.token_hash('tok-priv-by-hr')) x),
    row('invalid', null, null, null, null, null, null)::text,
    'a privileged invitation of a member who is not an Organization Admin: invalid, no details');
end $$;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000fa', '10000000-0000-4000-8000-0000000000fa', null));
do $$ begin
  perform tests.assert_fails($q$select private.accept_invitation_as_caller(tests.token_hash('tok-priv-by-hr'))$q$,
    array['JI001'], 'inviter not (or no longer) an Organization Admin: the privileged invitation is refused');
end $$;
-- uA makes uAB an Organization Admin (instead of HR Manager + learner: an Organization Admin holds no
-- other role, BR-IAM-4): the privileged invitation is usable…
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
delete from platform.role_assignments
 where membership_id = (select id from platform.tenant_memberships where user_id = '00000000-0000-4000-8000-0000000000ab' and tenant_id = 'a0000000-0000-4000-8000-000000000001');
insert into platform.role_assignments (membership_id, role_code)
select id, 'tenant_admin' from platform.tenant_memberships
where user_id = '00000000-0000-4000-8000-0000000000ab' and tenant_id = 'a0000000-0000-4000-8000-000000000001';
select tests.set_claims(null);
do $$ begin
  perform tests.assert_eq((select state from private.invitation_by_token(tests.token_hash('tok-priv-by-hr'))), 'valid',
    'inviter is an Organization Admin: the privileged invitation is valid');
end $$;
-- …until uA demotes uAB again (HR Manager only).
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
delete from platform.role_assignments
 where role_code = 'tenant_admin'
   and membership_id = (select id from platform.tenant_memberships where user_id = '00000000-0000-4000-8000-0000000000ab' and tenant_id = 'a0000000-0000-4000-8000-000000000001');
insert into platform.role_assignments (membership_id, role_code, is_primary)
select id, r.code, r.code = 'hr_manager' from platform.tenant_memberships, (values ('hr_manager'), ('learner')) as r (code)
where user_id = '00000000-0000-4000-8000-0000000000ab' and tenant_id = 'a0000000-0000-4000-8000-000000000001';
select tests.set_claims(null);
do $$
begin
  perform tests.assert_eq((select state from private.invitation_by_token(tests.token_hash('tok-priv-by-hr'))), 'invalid',
    'inviter demoted from Organization Admin: the privileged invitation reads invalid');
end $$;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000fa', '10000000-0000-4000-8000-0000000000fa', null));
do $$ begin
  perform tests.assert_fails($q$select private.accept_invitation_as_caller(tests.token_hash('tok-priv-by-hr'))$q$,
    array['JI001'], 'inviter demoted from Organization Admin: the privileged invitation is refused');
end $$;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000f9', '10000000-0000-4000-8000-0000000000f9', null));
do $$ begin
  perform tests.assert_eq(private.accept_invitation_as_caller(tests.token_hash('tok-by-hr')),
    'a0000000-0000-4000-8000-000000000001'::uuid, 'the ordinary invitation of the remaining HR Manager is accepted');
end $$;
reset role;
rollback;

-- Inviter revoked (and, separately, suspended): their pending invitations stop working. The inviter is an
-- HR Manager (a privileged role): the Organization Admin acts at AAL2 (T-M2-09, review M4).
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1') || '{"aal": "aal2"}'::jsonb);
update platform.tenant_memberships set status = 'revoked'
 where user_id = '00000000-0000-4000-8000-0000000000ab' and tenant_id = 'a0000000-0000-4000-8000-000000000001';
select tests.set_claims(null);
do $$
begin
  perform tests.assert_eq((select state from private.invitation_by_token(tests.token_hash('tok-by-hr'))), 'invalid',
    'inviter revoked: the link reads invalid');
end $$;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000f9', '10000000-0000-4000-8000-0000000000f9', null));
do $$ begin
  perform tests.assert_fails($q$select private.accept_invitation_as_caller(tests.token_hash('tok-by-hr'))$q$,
    array['JI001'], 'inviter revoked: acceptance refused');
end $$;
reset role;
rollback;

begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1') || '{"aal": "aal2"}'::jsonb);
update platform.tenant_memberships set status = 'suspended'
 where user_id = '00000000-0000-4000-8000-0000000000ab' and tenant_id = 'a0000000-0000-4000-8000-000000000001';
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000f9', '10000000-0000-4000-8000-0000000000f9', null));
do $$
begin
  perform tests.assert_fails($q$select private.accept_invitation_as_caller(tests.token_hash('tok-by-hr'))$q$,
    array['JI001'], 'inviter suspended: acceptance refused');
end $$;
reset role;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Asking for a new e-mail (resend, security review M2): a user manager, same rules as revoking; the
-- request is stamped; only the mailer (system jobs) issues the token.
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
insert into platform.persons (id, display_name_ar, email) values
  ('a1000000-0000-4000-8000-0000000000d5', 'مدير مالي', 'fin@a.test');
insert into platform.invitations (person_id, email, locale, primary_role)
  values ('a1000000-0000-4000-8000-0000000000d5', 'fin@a.test', 'ar', 'finance_manager');
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000ab'));
do $$
begin
  perform tests.assert_eq(tests.rows_affected($q$update platform.invitations set resend_requested_at = '2000-01-01' where id = 'a4000000-0000-4000-8000-000000000001'$q$),
    1::bigint, 'HR: asks for a new e-mail of an ordinary invitation');
  perform tests.assert_eq((select row(resend_requested_by, resend_requested_at = now(), send_count)::text
                           from platform.invitations where id = 'a4000000-0000-4000-8000-000000000001'),
    row('00000000-0000-4000-8000-0000000000ab'::uuid, true, 1::smallint)::text,
    'the request is stamped (actor, now); the e-mail count is the mailer''s');
  perform tests.assert_fails_like($q$update platform.invitations set resend_requested_at = clock_timestamp() where person_id = 'a1000000-0000-4000-8000-0000000000d5'$q$,
    'only an Organization Admin can resend an invitation with a privileged role', 'HR: cannot resend a privileged invitation');
  perform tests.assert_privilege_denied($q$update platform.invitations set resend_requested_by = '00000000-0000-4000-8000-0000000000a1'$q$,
    'users cannot choose who asked');
  perform tests.assert_fails($q$update platform.invitations set resend_requested_at = clock_timestamp(), token_hash = tests.token_hash('mine') where id = 'a4000000-0000-4000-8000-000000000001'$q$,
    array['23514'], 'a resend request never carries a token');
  perform tests.assert_fails($q$update platform.invitations set resend_requested_at = clock_timestamp(), status = 'revoked' where id = 'a4000000-0000-4000-8000-000000000001'$q$,
    array['23514'], 'a resend request leaves the invitation pending');
  perform tests.assert_eq(tests.rows_affected($q$update platform.invitations set resend_requested_at = clock_timestamp() where id = 'a4000000-0000-4000-8000-000000000003'$q$),
    0::bigint, 'a revoked invitation is not resent');
end $$;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
do $$
begin
  perform tests.assert_eq(tests.rows_affected($q$update platform.invitations set resend_requested_at = clock_timestamp() where person_id = 'a1000000-0000-4000-8000-0000000000d5'$q$),
    1::bigint, 'Organization Admin: asks for a new e-mail of a privileged invitation');
end $$;
-- A member without a user-management role (uAB demoted to learner) asks for nothing.
delete from platform.role_assignments
 where role_code = 'hr_manager'
   and membership_id = (select id from platform.tenant_memberships where user_id = '00000000-0000-4000-8000-0000000000ab' and tenant_id = 'a0000000-0000-4000-8000-000000000001');
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000ab'));
do $$
begin
  perform tests.assert_eq(tests.rows_affected($q$update platform.invitations set resend_requested_at = clock_timestamp()$q$),
    0::bigint, 'learner: asks for no new e-mail');
end $$;
reset role;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Inviting and revoking (users). HR Manager uAB: ordinary roles only.
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000ab'));
insert into platform.persons (id, display_name_ar, email) values
  ('a1000000-0000-4000-8000-0000000000d1', 'جديد ١', 'new1@a.test'),
  ('a1000000-0000-4000-8000-0000000000d2', 'جديد ٢', 'new2@a.test');
do $$
declare
  v_id uuid;
  -- person suffix, e-mail, primary role, additional roles
  ins constant text := $q$insert into platform.invitations (person_id, email, locale, primary_role, additional_roles)
    values ('a1000000-0000-4000-8000-0000000000%s', %L, 'ar', %L, %L) returning id$q$;
begin
  execute format(ins, 'd1', 'new1@a.test', 'learner', '{mentor}') into v_id;
  perform tests.assert_eq((select row(status, invited_by, token_issued_at, send_count,
                                      expires_at = now() + interval '7 days')::text
                           from platform.invitations where id = v_id),
    row('pending', '00000000-0000-4000-8000-0000000000ab'::uuid, null::timestamptz, 0::smallint, true)::text,
    'HR: invites with ordinary roles; pending, inviter from the claims, no token yet, valid 7 days');
  perform tests.assert_eq(tests.rows_affected(format($q$update platform.invitations set status = 'revoked' where id = %L$q$, v_id)),
    1::bigint, 'HR: revokes it');
  perform tests.assert_eq((select row(status, revoked_by, revoked_at is not null)::text from platform.invitations where id = v_id), row('revoked', '00000000-0000-4000-8000-0000000000ab'::uuid, true)::text,
    'revocation stamped with the actor');
  perform tests.assert_eq(tests.rows_affected(format($q$update platform.invitations set status = 'revoked' where id = %L$q$, v_id)),
    0::bigint, 'revoked is final (no longer pending: nothing to revoke)');
  perform tests.assert_eq(tests.rows_affected(format($q$update platform.invitations set status = 'pending' where id = %L$q$, v_id)),
    0::bigint, 'a revoked invitation cannot be reopened');
  -- A new invitation for the same person once the first one is revoked; but only one pending.
  execute format(ins, 'd1', 'new1@a.test', 'learner', '{}') into v_id;
  perform tests.assert_fails(format(ins, 'd1', 'new1@a.test', 'mentor', '{}'), array['23505'], 'one pending invitation per person');

  perform tests.assert_fails_like(format(ins, 'd2', 'new2@a.test', 'hr_manager', '{}'),
    'only an Organization Admin can invite with a privileged role', 'HR: cannot invite an HR Manager');
  perform tests.assert_fails_like(format(ins, 'd2', 'new2@a.test', 'tenant_admin', '{}'),
    'only an Organization Admin can invite with a privileged role', 'HR: cannot invite an Organization Admin');
  perform tests.assert_fails_like(format(ins, 'd2', 'new2@a.test', 'learner', '{mentor,auditor}'),
    'only an Organization Admin can invite with a privileged role', 'HR: cannot add a privileged additional role');
  perform tests.assert_fails(format(ins, 'd2', 'new2@a.test', 'learner', '{mentor,mentor}'),
    array['23514'], 'additional roles do not repeat');
  perform tests.assert_check_constraint(format(ins, 'd2', 'new2@a.test', 'learner', '{learner}'),
    'invitations_additional_roles_check', 'the primary role is not repeated as additional');
  perform tests.assert_fails(format(ins, 'd2', 'new2@a.test', 'learner', '{platform_super_admin}'),
    array['23503'], 'additional roles exist in ref_roles');
  perform tests.assert_fails(format(ins, 'd2', 'new2@a.test', 'platform_super_admin', '{}'),
    array['23503'], 'the primary role exists in ref_roles');
  perform tests.assert_fails(format(ins, 'd2', 'other@a.test', 'learner', '{}'),
    array['23514'], 'the invitation e-mail must be the person''s e-mail');
  perform tests.assert_fails(format(ins, 'd2', 'New2@a.test', 'learner', '{}'),
    array['23514'], 'e-mail addresses are stored in lower case (= the person''s; invitations_email_check backs it)');
  perform tests.assert_fails(format(ins, 'a2', 'uinv@a.test', 'learner', '{}'),
    array['23514'], 'a person who already has a membership is not invited');
  perform tests.assert_check_constraint(replace(format(ins, 'd2', 'new2@a.test', 'learner', '{}'), '''ar''', '''fr'''),
    'invitations_locale_check', 'Arabic or English only');
  -- Columns users never write: token, send count, outcome, inviter, expiry.
  perform tests.assert_privilege_denied($q$insert into platform.invitations (person_id, email, locale, primary_role, token_hash) values ('a1000000-0000-4000-8000-0000000000d2', 'new2@a.test', 'ar', 'learner', '\x00')$q$,
    'users cannot insert a token');
  perform tests.assert_privilege_denied($q$insert into platform.invitations (person_id, email, locale, primary_role, invited_by) values ('a1000000-0000-4000-8000-0000000000d2', 'new2@a.test', 'ar', 'learner', '00000000-0000-4000-8000-0000000000a1')$q$,
    'users cannot choose the inviter');
  perform tests.assert_privilege_denied($q$insert into platform.invitations (person_id, email, locale, primary_role, expires_at) values ('a1000000-0000-4000-8000-0000000000d2', 'new2@a.test', 'ar', 'learner', now() + interval '1 year')$q$,
    'users cannot choose the expiry');
  perform tests.assert_privilege_denied($q$update platform.invitations set send_count = 0$q$, 'users cannot reset the send count');
  perform tests.assert_privilege_denied($q$update platform.invitations set expires_at = now() + interval '1 year'$q$, 'users cannot extend a link');
  perform tests.assert_fails_like(format($q$update platform.invitations set token_hash = tests.token_hash('mine') where id = %L$q$, v_id),
    'only the invitation mailer issues tokens', 'users cannot issue a token (jobs only)');
  perform tests.assert_fails(format($q$update platform.invitations set status = 'revoked', token_hash = tests.token_hash('mine') where id = %L$q$, v_id),
    array['23514'], 'nor slip one in while revoking');
  perform tests.assert_privilege_denied($q$delete from platform.invitations$q$, 'nobody deletes invitations');
end $$;
reset role;
rollback;

-- Organization Admin (uA): privileged roles too; a privileged invitation is revoked by an admin only.
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
insert into platform.persons (id, display_name_ar, email) values
  ('a1000000-0000-4000-8000-0000000000d3', 'مدير جديد', 'admin2@a.test');
insert into platform.invitations (person_id, email, locale, primary_role, additional_roles)
  values ('a1000000-0000-4000-8000-0000000000d3', 'admin2@a.test', 'en', 'tenant_admin', '{}');
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000ab'));
do $$
begin
  perform tests.assert_eq((select invited_by from platform.invitations where person_id = 'a1000000-0000-4000-8000-0000000000d3'),
    '00000000-0000-4000-8000-0000000000a1'::uuid, 'admin: invites an Organization Admin');
  perform tests.assert_fails_like($q$update platform.invitations set status = 'revoked' where person_id = 'a1000000-0000-4000-8000-0000000000d3'$q$,
    'only an Organization Admin can revoke an invitation with a privileged role', 'HR: cannot revoke a privileged invitation');
  perform tests.assert_eq(tests.rows_affected($q$update platform.invitations set status = 'revoked' where id = 'a4000000-0000-4000-8000-000000000001'$q$),
    1::bigint, 'HR: revokes an ordinary one');
end $$;
reset role;
rollback;

-- A member without a user-management role neither sees, creates nor revokes invitations.
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
delete from platform.role_assignments
 where role_code = 'hr_manager'
   and membership_id = (select id from platform.tenant_memberships where user_id = '00000000-0000-4000-8000-0000000000ab' and tenant_id = 'a0000000-0000-4000-8000-000000000001');
insert into platform.persons (id, display_name_ar, email) values ('a1000000-0000-4000-8000-0000000000d4', 'جديد ٤', 'new4@a.test');
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000ab'));
do $$
begin
  perform tests.assert_eq(tests.count_rows('platform.invitations'), 0::bigint, 'learner: sees no invitations');
  perform tests.assert_fails_like($q$insert into platform.invitations (person_id, email, locale, primary_role) values ('a1000000-0000-4000-8000-0000000000d4', 'new4@a.test', 'ar', 'learner')$q$,
    'only an Organization Admin or an HR Manager can invite people', 'learner: cannot invite');
  perform tests.assert_eq(tests.rows_affected($q$update platform.invitations set status = 'revoked'$q$),
    0::bigint, 'learner: revokes nothing');
end $$;
reset role;
rollback;

-- Tenant B's Organization Admin sees none of tenant A's invitations and cannot touch them.
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1',
  'b0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-0000000000b1'));
do $$
begin
  perform tests.assert_eq((select count(*) from platform.invitations where tenant_id <> 'b0000000-0000-4000-8000-000000000001'),
    0::bigint, 'B: no invitation of another organization');
  perform tests.assert((select count(*) from platform.invitations) > 0, 'B: sees its own');
  perform tests.assert_eq(tests.rows_affected($q$update platform.invitations set status = 'revoked' where id = 'a4000000-0000-4000-8000-000000000001'$q$),
    0::bigint, 'B: cannot revoke A''s invitation');
  perform tests.assert_rls_violation($q$insert into platform.invitations (tenant_id, person_id, email, locale, primary_role) values ('a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000e6', 'notoken@a.test', 'ar', 'learner')$q$,
    'B: cannot invite into A');
end $$;
reset role;
rollback;

\echo '36_invitations_app_server: ok'
