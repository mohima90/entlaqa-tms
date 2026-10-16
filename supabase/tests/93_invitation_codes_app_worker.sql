-- db-test: run-as=app_worker
-- Invitation codes under SYSTEM claims (FR-IAM-03, migration 20261018090000): the invitation mailer reads
-- the code of a pending, sent invitation of its job's organization — and nothing else — through
-- private.invitation_code_for_mail; it never reads codes from the table, issues or rotates one. Runs
-- CONNECTED AS app_worker. Fixtures: 35_invitations_fixtures.sql; a4…06's first code was committed by
-- 92_invitation_codes_app_server.sql. Each block is rolled back.
\set ON_ERROR_STOP on

do $$ begin perform tests.assert(session_user = 'app_worker', 'must run connected as app_worker'); end $$;

begin;
set local role authenticated;
select tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001', 'platform.invitations.mailer'));
do $$
begin
  perform tests.assert(private.invitation_code_for_mail('a4000000-0000-4000-8000-000000000006') ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$',
    'mailer: the code of a pending invitation of its organization');
  perform tests.assert_eq(private.invitation_code_for_mail('a4000000-0000-4000-8000-000000000001'), null::text,
    'mailer: no code for a link e-mailed before codes');
  perform tests.assert_eq(private.invitation_code_for_mail('a4000000-0000-4000-8000-000000000003'), null::text,
    'mailer: no code of a revoked invitation');
  perform tests.assert_eq(private.invitation_code_for_mail('a4000000-0000-4000-8000-000000000004'), null::text,
    'mailer: no code of an accepted invitation');
  perform tests.assert_eq(private.invitation_code_for_mail('b4000000-0000-4000-8000-000000000001'), null::text,
    'mailer: nothing of another organization');
  perform tests.assert_privilege_denied($q$select invite_code from platform.invitations$q$,
    'mailer: no direct read of codes');
  perform tests.assert_privilege_denied($q$update platform.invitations set invite_code = 'ABCDEFGHJKLM' where id = 'a4000000-0000-4000-8000-000000000006'$q$,
    'mailer: cannot change a code');
  perform tests.assert_fails_like($q$select private.issue_invitation_code('a4000000-0000-4000-8000-000000000006')$q$,
    'invitation codes need a signed-in member%', 'mailer: issues no code');
end $$;
-- Tenant B's job: not tenant A's code.
select tests.set_claims(tests.system_claims('b0000000-0000-4000-8000-000000000001', 'platform.invitations.mailer'));
do $$
begin
  perform tests.assert_eq(private.invitation_code_for_mail('a4000000-0000-4000-8000-000000000006'), null::text,
    'tenant B''s job: no code of tenant A');
end $$;
-- A suspended organization's job, no job id, user claims, no claims: refused.
select tests.set_claims(tests.system_claims('c0000000-0000-4000-8000-000000000001', 'platform.invitations.mailer'));
do $$
begin
  perform tests.assert_fails_like($q$select private.invitation_code_for_mail('c4000000-0000-4000-8000-000000000001')$q$,
    'invitation_code_for_mail needs the job''s organization', 'suspended organization: refused');
end $$;
select tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001', ''));
do $$
begin
  perform tests.assert_fails_like($q$select private.invitation_code_for_mail('a4000000-0000-4000-8000-000000000006')$q$,
    'invitation_code_for_mail needs the job''s organization', 'system claims without a job: refused');
end $$;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
do $$
begin
  perform tests.assert_fails_like($q$select private.invitation_code_for_mail('a4000000-0000-4000-8000-000000000006')$q$,
    'invitation_code_for_mail is for the invitation mailer%', 'user claims on app_worker: refused');
  perform tests.assert_fails_like($q$select * from private.invitation_codes()$q$,
    'invitation codes need a signed-in member%', 'user claims on app_worker: no codes (app_server only)');
end $$;
select tests.set_claims(null);
do $$
begin
  perform tests.assert_fails_like($q$select private.invitation_code_for_mail('a4000000-0000-4000-8000-000000000006')$q$,
    'invitation_code_for_mail is for the invitation mailer%', 'no claims: refused');
end $$;
reset role;
rollback;

\echo '93_invitation_codes_app_worker: ok'
