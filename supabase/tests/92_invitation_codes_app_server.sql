-- db-test: run-as=app_server
-- Invitation codes (FR-IAM-03, migration 20261018090000; PO decision 16 Oct 2026, Kawadir): a member who
-- may manage an invitation issues its code (first code when inviting, a new one on resend — the old link
-- stops working, 7 more days, at most 4 codes) and reads the codes of the invitations they may manage.
-- An HR Manager neither issues nor reads the code of an invitation with a privileged role; other members,
-- other organizations, callers without a valid session and system jobs get nothing. Runs CONNECTED AS
-- app_server. Fixtures: 00_helpers_and_fixtures.sql, 35_invitations_fixtures.sql (a4…01 pending 'tok-a',
-- a4…02 expired, a4…03 revoked, a4…04 accepted by 36, a4…06 never mailed, a4…0a auditor invited by uAB).
-- Each block is rolled back.
\set ON_ERROR_STOP on

do $$ begin perform tests.assert(session_user = 'app_server', 'must run connected as app_server'); end $$;

-- ---------------------------------------------------------------------------------------------------
-- Organization Admin uA: issues, rotates, reads; the limits and states.
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
do $$
declare
  v_first text;
  v_second text;
  v_code text;
  n integer;
begin
  perform tests.assert_privilege_denied($q$select invite_code from platform.invitations$q$,
    'admin: codes are not readable directly');
  perform tests.assert_privilege_denied($q$select * from private.invitation_code_caller()$q$,
    'admin: the caller check is the code functions'' only');

  -- The first code of a4…06 (never mailed).
  v_first := private.issue_invitation_code('a4000000-0000-4000-8000-000000000006');
  perform tests.assert(v_first ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$', 'a code: 8 characters of the Kawadir alphabet');
  perform tests.assert_eq((select row(send_count, token_issued_at = now(), expires_at = now() + interval '7 days')::text
                           from platform.invitations where id = 'a4000000-0000-4000-8000-000000000006'),
    row(1::smallint, true, true)::text, 'first code: counted once, issued now, valid 7 days');
  perform tests.assert_eq((select state from private.invitation_by_token(tests.token_hash(v_first))), 'valid',
    'the code is the link: its SHA-256 is the token hash');
  perform tests.assert_eq((select invite_code from private.invitation_codes(array['a4000000-0000-4000-8000-000000000006'::uuid])),
    v_first, 'admin reads the code (copy code / copy link)');
  perform tests.assert_eq(private.invitation_password_min_length(tests.token_hash(v_first)), 12::smallint,
    'the link page''s password rule finds it');

  -- Resend: a new code; the old link stops working.
  v_second := private.issue_invitation_code('a4000000-0000-4000-8000-000000000006');
  perform tests.assert(v_second <> v_first, 'a new code');
  perform tests.assert_eq((select state from private.invitation_by_token(tests.token_hash(v_first))), 'invalid',
    'the old code no longer opens anything');
  perform tests.assert_eq((select state from private.invitation_by_token(tests.token_hash(v_second))), 'valid',
    'the new code does');
  perform tests.assert_eq((select invite_code from private.invitation_codes(array['a4000000-0000-4000-8000-000000000006'::uuid])),
    v_second, 'the list shows the new code');
  -- Copying changes nothing: reading the code twice keeps the count.
  perform private.invitation_codes();
  perform private.invitation_codes();
  perform tests.assert_eq((select send_count from platform.invitations where id = 'a4000000-0000-4000-8000-000000000006'),
    2::smallint, 'reading codes is not a resend');
  -- Up to 4 codes in all (the first and 3 new ones).
  perform private.issue_invitation_code('a4000000-0000-4000-8000-000000000006');
  v_code := private.issue_invitation_code('a4000000-0000-4000-8000-000000000006');
  perform tests.assert_fails($q$select private.issue_invitation_code('a4000000-0000-4000-8000-000000000006')$q$,
    array['JI004'], 'no 5th code');
  perform tests.assert_eq((select state from private.invitation_by_token(tests.token_hash(v_code))), 'valid',
    'the 4th code still works after the refused 5th');

  -- A link e-mailed before codes (a4…01, 'tok-a'): a code replaces the token.
  v_code := private.issue_invitation_code('a4000000-0000-4000-8000-000000000001');
  perform tests.assert_eq((select state from private.invitation_by_token(tests.token_hash('tok-a'))), 'invalid',
    'the old token stops working');
  perform tests.assert_eq((select row(x.state, x.email)::text from private.invitation_by_token(tests.token_hash(v_code)) x),
    row('valid', 'invitee@a.test')::text, 'the code works, for the invitation''s e-mail');

  -- An expired invitation gets a fresh code and 7 more days.
  v_code := private.issue_invitation_code('a4000000-0000-4000-8000-000000000002');
  perform tests.assert((select expires_at > now() + interval '6 days' from platform.invitations
                        where id = 'a4000000-0000-4000-8000-000000000002'), 'expired: valid 7 days again');
  perform tests.assert_eq((select state from private.invitation_by_token(tests.token_hash(v_code))), 'valid', 'expired: usable again');

  -- An invitation with a privileged role: the Organization Admin may.
  perform tests.assert(private.issue_invitation_code('a4000000-0000-4000-8000-00000000000a') is not null,
    'admin: issues the code of a privileged invitation');
  perform tests.assert((select count(*) from private.invitation_codes() where invitation_id = 'a4000000-0000-4000-8000-00000000000a') = 1,
    'admin: reads it');

  -- Final or invisible invitations: not pending.
  perform tests.assert_fails($q$select private.issue_invitation_code('a4000000-0000-4000-8000-000000000003')$q$,
    array['JI005'], 'revoked: no code');
  perform tests.assert_fails($q$select private.issue_invitation_code('a4000000-0000-4000-8000-000000000004')$q$,
    array['JI005'], 'accepted: no code');
  perform tests.assert_fails($q$select private.issue_invitation_code('b4000000-0000-4000-8000-000000000001')$q$,
    array['JI005'], 'another organization''s invitation: not found');
  perform tests.assert_fails($q$select private.issue_invitation_code('a4000000-0000-4000-8000-0000000000ff')$q$,
    array['JI005'], 'unknown invitation');
  perform tests.assert_eq((select count(*) from private.invitation_codes() c
                           join platform.invitations i on i.id = c.invitation_id where i.status <> 'pending'), 0::bigint,
    'only pending invitations have readable codes');
  perform tests.assert_eq((select count(*) from private.invitation_codes() c
                           where c.invitation_id::text like 'b%'), 0::bigint, 'no code of another organization');

  -- Every code is unique, its hash too.
  perform tests.assert_eq((select count(*) from private.invitation_codes()),
    (select count(distinct invite_code) from private.invitation_codes()), 'codes are unique');
end $$;
reset role;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- HR Manager uAB: ordinary invitations only (the rules of inviting, security review M1/M2).
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
-- The Organization Admin gives the privileged invitation a4…0a a code first.
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
select private.issue_invitation_code('a4000000-0000-4000-8000-00000000000a') is not null;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000ab'));
do $$
declare
  v_code text;
begin
  v_code := private.issue_invitation_code('a4000000-0000-4000-8000-000000000001');
  perform tests.assert(v_code is not null, 'HR: issues the code of an ordinary invitation');
  perform tests.assert_eq((select invite_code from private.invitation_codes(array['a4000000-0000-4000-8000-000000000001'::uuid])),
    v_code, 'HR: reads it');
  perform tests.assert_fails_like($q$select private.issue_invitation_code('a4000000-0000-4000-8000-00000000000a')$q$,
    'only an Organization Admin or an HR Manager (ordinary roles) issues invitation codes',
    'HR: no code for an invitation with a privileged role');
  perform tests.assert_eq((select count(*) from private.invitation_codes() where invitation_id = 'a4000000-0000-4000-8000-00000000000a'),
    0::bigint, 'HR: cannot read the code of an invitation with a privileged role');
  perform tests.assert_eq((select count(*) from platform.invitations where id = 'a4000000-0000-4000-8000-00000000000a'),
    1::bigint, '(though the invitation itself is on HR''s list)');
  perform tests.assert_privilege_denied($q$select invite_code from platform.invitations where id = 'a4000000-0000-4000-8000-00000000000a'$q$,
    'HR: and not through the table either');
end $$;
reset role;
rollback;

-- Demoted to learner: nothing.

begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
select private.issue_invitation_code('a4000000-0000-4000-8000-000000000001') is not null;
delete from platform.role_assignments
 where role_code = 'hr_manager'
   and membership_id = (select id from platform.tenant_memberships where user_id = '00000000-0000-4000-8000-0000000000ab' and tenant_id = 'a0000000-0000-4000-8000-000000000001');
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000ab'));
do $$
begin
  perform tests.assert_eq((select count(*) from private.invitation_codes()), 0::bigint, 'learner: reads no code');
  perform tests.assert_fails_like($q$select private.issue_invitation_code('a4000000-0000-4000-8000-000000000001')$q$,
    'only an Organization Admin or an HR Manager (ordinary roles) issues invitation codes', 'learner: issues no code');
end $$;
reset role;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Another organization, no session, an ended session: nothing.
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
select private.issue_invitation_code('a4000000-0000-4000-8000-000000000001') is not null;
-- Tenant B's Organization Admin.
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1',
  'b0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-0000000000b1'));
do $$
begin
  perform tests.assert_eq((select count(*) from private.invitation_codes() where invitation_id::text like 'a%'), 0::bigint,
    'B: no code of tenant A');
  perform tests.assert_eq((select count(*) from private.invitation_codes(array['a4000000-0000-4000-8000-000000000001'::uuid])),
    0::bigint, 'B: not even when asking for its id');
  perform tests.assert_fails($q$select private.issue_invitation_code('a4000000-0000-4000-8000-000000000001')$q$,
    array['JI005'], 'B: cannot rotate tenant A''s code');
end $$;
-- A forged claim: uB claiming tenant A (not a member there) → no organization.
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1',
  'a0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-0000000000b1'));
do $$
begin
  perform tests.assert_fails_like($q$select * from private.invitation_codes()$q$,
    'invitation codes need a signed-in member of the organization', 'forged tenant claim: refused');
  perform tests.assert_fails_like($q$select private.issue_invitation_code('a4000000-0000-4000-8000-000000000001')$q$,
    'invitation codes need a signed-in member of the organization', 'forged tenant claim: no code');
end $$;
-- uA's expired session.
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a9',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
do $$
begin
  perform tests.assert_fails_like($q$select * from private.invitation_codes()$q$,
    'invitation codes need a signed-in member of the organization', 'expired session: refused');
end $$;
-- No claims (the public link page's connection).
select tests.set_claims(null);
do $$
begin
  perform tests.assert_fails_like($q$select * from private.invitation_codes()$q$,
    'invitation codes need a signed-in member%', 'no claims: refused');
  perform tests.assert_fails_like($q$select private.issue_invitation_code('a4000000-0000-4000-8000-000000000001')$q$,
    'invitation codes need a signed-in member%', 'no claims: no code');
  perform tests.assert_fails_like($q$select private.invitation_code_for_mail('a4000000-0000-4000-8000-000000000001')$q$,
    'invitation_code_for_mail is for the invitation mailer%', 'app_server: not the mailer''s read');
end $$;
-- System claims on the app_server connection are not a job.
select tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001', 'platform.invitations.mailer'));
do $$
begin
  perform tests.assert_fails_like($q$select private.invitation_code_for_mail('a4000000-0000-4000-8000-000000000001')$q$,
    'invitation_code_for_mail is for the invitation mailer%', 'app_server with system claims: refused');
  perform tests.assert_fails_like($q$select private.issue_invitation_code('a4000000-0000-4000-8000-000000000001')$q$,
    'invitation codes need a signed-in member%', 'system claims: no code');
end $$;
reset role;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Through the normal request path: invite (no code yet), issue, then the code works at the link page.
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000ab'));
insert into platform.persons (id, display_name_ar, email) values
  ('a1000000-0000-4000-8000-0000000000d7', 'رمز جديد', 'code1@a.test');
do $$
declare
  v_id uuid;
  v_code text;
begin
  insert into platform.invitations (person_id, email, locale, primary_role)
    values ('a1000000-0000-4000-8000-0000000000d7', 'code1@a.test', 'en', 'learner') returning id into v_id;
  perform tests.assert_eq((select send_count from platform.invitations where id = v_id), 0::smallint,
    'a new invitation starts without a code');
  perform tests.assert_privilege_denied(format($q$insert into platform.invitations (person_id, email, locale, primary_role, invite_code) values ('a1000000-0000-4000-8000-0000000000d7', 'code1@a.test', 'en', 'learner', 'ABCDEFGH')$q$),
    'users cannot insert a code of their choice');
  v_code := private.issue_invitation_code(v_id);
  perform tests.assert_eq((select row(x.state, x.email, x.locale)::text from private.invitation_by_token(tests.token_hash(v_code)) x),
    row('valid', 'code1@a.test', 'en')::text, 'the code opens the link page for the invitee');
  perform tests.assert_eq((select state from private.invitation_by_token(tests.token_hash(lower(v_code)))), 'invalid',
    'codes are exact (the web app upper-cases what is typed)');
  -- Revoking ends the code.
  perform tests.assert_eq(tests.rows_affected(format($q$update platform.invitations set status = 'revoked' where id = %L$q$, v_id)),
    1::bigint, 'HR revokes it');
  perform tests.assert_eq((select state from private.invitation_by_token(tests.token_hash(v_code))), 'revoked',
    'the revoked code shows the revoked state');
  perform tests.assert_fails(format($q$select private.issue_invitation_code(%L)$q$, v_id), array['JI005'],
    'a revoked invitation gets no new code');
end $$;
reset role;
rollback;

-- Committed for 93_invitation_codes_app_worker.sql and 94_invitation_codes_owner.sql: a4…06 (never mailed
-- before) gets its first code from the Organization Admin, as when inviting.
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
select private.issue_invitation_code('a4000000-0000-4000-8000-000000000006') is not null;
reset role;
commit;

\echo '92_invitation_codes_app_server: ok'
