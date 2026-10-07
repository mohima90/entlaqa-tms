-- db-test: run-as=app_worker
-- Invitations under SYSTEM claims (T-M2-07, FR-IAM-03): the mailer job reads its tenant's invitations and
-- issues a token for a PENDING one only (send count + 1, valid 7 more days, at most 4 e-mails); it never
-- reads a token hash, invites, revokes, accepts or reaches another tenant. Runs CONNECTED AS app_worker.
-- Fixtures: 00_helpers_and_fixtures.sql, 35_invitations_fixtures.sql. Each block is rolled back.
\set ON_ERROR_STOP on

do $$ begin perform tests.assert(session_user = 'app_worker', 'must run connected as app_worker'); end $$;

begin;
set local role authenticated;
select tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001', 'platform.invitations.mailer'));
do $$
declare
  issue constant text := $q$update platform.invitations set token_hash = tests.token_hash(%L) where id = %L$q$;
begin
  perform tests.assert((select count(*) from platform.invitations) >= 8, 'system: reads its tenant''s invitations');
  perform tests.assert_eq((select count(*) from platform.invitations where tenant_id <> 'a0000000-0000-4000-8000-000000000001'),
    0::bigint, 'system: no other tenant''s invitations');
  perform tests.assert_privilege_denied($q$select token_hash from platform.invitations$q$, 'system: token_hash not readable');

  -- The first e-mail of a4…06 (no token yet).
  perform tests.assert_eq(tests.rows_affected(format(issue, 'job-1', 'a4000000-0000-4000-8000-000000000006')), 1::bigint,
    'system: issues the first token of a pending invitation');
  perform tests.assert_eq((select row(send_count, token_issued_at = now(), expires_at = now() + interval '7 days')::text
                           from platform.invitations where id = 'a4000000-0000-4000-8000-000000000006'),
    row(1::smallint, true, true)::text, 'first e-mail: count 1, issued now, valid 7 days');
  perform tests.assert_eq((select state from private.invitation_by_token(tests.token_hash('job-1'))), null,
    'app_worker cannot look links up (app_server only)');

  -- Resends: a new token replaces the old one, up to 4 e-mails in all.
  perform tests.assert_eq(tests.rows_affected(format(issue, 'job-2', 'a4000000-0000-4000-8000-000000000006')), 1::bigint, '2nd');
  perform tests.assert_eq(tests.rows_affected(format(issue, 'job-3', 'a4000000-0000-4000-8000-000000000006')), 1::bigint, '3rd');
  perform tests.assert_eq(tests.rows_affected(format(issue, 'job-4', 'a4000000-0000-4000-8000-000000000006')), 1::bigint, '4th');
  perform tests.assert_check_constraint(format(issue, 'job-5', 'a4000000-0000-4000-8000-000000000006'),
    'invitations_send_count_check', 'no 5th e-mail');
  perform tests.assert_fails(format($q$update platform.invitations set token_hash = null where id = %L$q$, 'a4000000-0000-4000-8000-000000000006'),
    array['23514'], 'a token cannot be removed');
  perform tests.assert_fails(format(issue, 'job-4', 'a4000000-0000-4000-8000-000000000001'), array['23505'],
    'token hashes are unique');

  -- An expired invitation gets a fresh link (resend).
  perform tests.assert_eq(tests.rows_affected(format(issue, 'job-exp', 'a4000000-0000-4000-8000-000000000002')), 1::bigint,
    'system: a new token for an expired pending invitation');
  perform tests.assert((select expires_at > now() from platform.invitations where id = 'a4000000-0000-4000-8000-000000000002'),
    'and it is valid again for 7 days');

  -- Only pending invitations: revoked (a4…03) and accepted (a4…04, committed by 36) are final.
  perform tests.assert_eq(tests.rows_affected(format(issue, 'job-rev', 'a4000000-0000-4000-8000-000000000003')), 0::bigint,
    'system: no token for a revoked invitation');
  perform tests.assert_eq(tests.rows_affected(format(issue, 'job-acc', 'a4000000-0000-4000-8000-000000000004')), 0::bigint,
    'system: no token for an accepted invitation');
  perform tests.assert_eq(tests.rows_affected(format(issue, 'job-b', 'b4000000-0000-4000-8000-000000000001')), 0::bigint,
    'system: no token for tenant B''s invitation');

  -- Nothing else.
  -- (The trigger refuses first; the policies would too: jobs keep rows pending.)
  perform tests.assert_fails_like($q$update platform.invitations set status = 'revoked' where id = 'a4000000-0000-4000-8000-000000000001'$q$,
    'only signed-in members revoke invitations', 'system: cannot revoke');
  perform tests.assert_fails_like($q$update platform.invitations set resend_requested_at = now() where id = 'a4000000-0000-4000-8000-000000000001'$q$,
    'only signed-in members ask for a new invitation e-mail', 'system: cannot ask for a resend (only members do)');
  -- The mailer checks who asked for a resend against their CURRENT roles (review M2): it can read them.
  perform tests.assert_eq(private.actor_role_codes('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000ab'),
    array['hr_manager', 'learner'], 'system: reads a member''s current roles in its tenant');
  perform tests.assert_eq(private.actor_role_codes('b0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000b1'),
    '{}'::text[], 'system: no roles of another tenant');
  perform tests.assert_fails_like($q$update platform.invitations set status = 'accepted' where id = 'a4000000-0000-4000-8000-000000000001'$q$,
    'invitations are accepted through the invitation link only', 'system: cannot accept');
  perform tests.assert_privilege_denied($q$update platform.invitations set expires_at = now() + interval '1 year'$q$,
    'system: cannot extend a link without a new token');
  perform tests.assert_fails_like($q$insert into platform.invitations (person_id, email, locale, primary_role) values ('a1000000-0000-4000-8000-0000000000e6', 'notoken@a.test', 'ar', 'learner')$q$,
    'only signed-in members invite people', 'system: never invites');
  perform tests.assert_privilege_denied($q$delete from platform.invitations$q$, 'system: never deletes');

  -- Acceptance is for app_server connections only; the sign-up gate is Auth's alone.
  perform tests.assert_fails_like($q$select private.accept_invitation_as_caller(tests.token_hash('tok-a'))$q$,
    'accept_invitation_as_caller needs a signed-in user', 'app_worker: accept_invitation_as_caller refused');
  perform tests.assert_privilege_denied($q$select private.invitation_allows_signup('invitee@a.test', repeat('A', 43))$q$,
    'app_worker: cannot call the sign-up gate');
  perform tests.assert_privilege_denied($q$select private.before_user_created_hook('{}'::jsonb)$q$,
    'app_worker: cannot call the sign-up hook');
end $$;
-- Without claims too; and with user claims (the session check is app_server's).
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000f4', '10000000-0000-4000-8000-0000000000f4', null));
do $$
begin
  perform tests.assert_fails_like($q$select private.accept_invitation_as_caller(tests.token_hash('tok-a'))$q$,
    'accept_invitation_as_caller needs a signed-in user', 'app_worker with user claims: accept_invitation_as_caller refused');
end $$;
select tests.set_claims(null);
do $$
begin
  perform tests.assert_eq((select count(*) from private.invitation_by_token(tests.token_hash('tok-a'))), 0::bigint,
    'app_worker without claims: no link lookups');
end $$;
reset role;
rollback;

\echo '37_invitations_app_worker: ok'
