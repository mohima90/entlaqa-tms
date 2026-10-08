-- db-test: run-as=app_server
-- Account e-mails on the request path (T-M2-17; FR-IAM-13, FR-IAM-16): the web app (app_server) can only
-- ADD requests through the two request functions — a reset request for any address, unconditionally
-- (nothing on this path looks at accounts), and the "password changed" notice of an account (its own
-- user's, with claims; any, without claims, after a reset). It can never read, change or remove the
-- queue, nor run the worker functions. The requests committed at the end are answered by
-- 56_account_mail_app_worker.sql. Fixtures: 00_helpers_and_fixtures.sql, 54_account_mail_fixtures.sql.
\set ON_ERROR_STOP on

do $$ begin perform tests.assert(session_user = 'app_server', 'must run connected as app_server'); end $$;

-- ---------------------------------------------------------------------------------------------------
-- What the request role can never do.
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(null);
do $$
begin
  perform tests.assert_privilege_denied($q$select * from private.account_mail_requests$q$,
    'the queue is not readable on the request path');
  perform tests.assert_privilege_denied(
    $q$insert into private.account_mail_requests (kind, email) values ('password_reset', 'x@a.test')$q$,
    'no direct insert');
  perform tests.assert_privilege_denied($q$delete from private.account_mail_requests$q$, 'no delete');
  perform tests.assert_privilege_denied($q$select * from private.auth_account$q$, 'Auth accounts are not readable');
  perform tests.assert_fails($q$select * from private.claim_account_mail_request()$q$, array['42501'],
    'the worker functions refuse app_server (no claims)');
  perform tests.assert_fails($q$select private.finish_account_mail_request(gen_random_uuid())$q$, array['42501'],
    'finish: refused for app_server');
  perform tests.assert_fails($q$select private.retry_account_mail_request(gen_random_uuid())$q$, array['42501'],
    'retry: refused for app_server');
end $$;
-- System claims set by the request role are still refused (only the app_worker login may act as a job).
select tests.set_claims(jsonb_build_object('role', 'system', 'job_id', 'tests.forged'));
do $$
begin
  perform tests.assert_fails($q$select * from private.claim_account_mail_request()$q$, array['42501'],
    'forged system claims under app_server: refused');
  perform tests.assert_fails($q$select private.finish_account_mail_request(gen_random_uuid())$q$, array['42501'],
    'forged system claims under app_server: finish refused');
end $$;
reset role;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Reset requests: accepted for every well-formed address, answer nothing (void) whether or not an
-- account exists; malformed addresses are dropped without an error.
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(null);
do $$
begin
  perform tests.assert_eq((select pg_typeof(private.request_password_reset_mail('reset1@a.test'))::text), 'void',
    'a known address: no answer');
  perform tests.assert_eq((select pg_typeof(private.request_password_reset_mail('nobody@nowhere.test'))::text), 'void',
    'an unknown address: the same (no answer)');
  perform private.request_password_reset_mail('not-an-address');
  perform private.request_password_reset_mail(null);
  perform private.request_password_reset_mail(repeat('a', 320) || '@a.test');
  perform private.request_password_reset_mail('RESET1@A.test');  -- a repeat before the worker answered
end $$;
reset role;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- "Password changed": with claims only for the signed-in user themself, in a valid session; without
-- claims (after a reset) for an existing account.
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
-- uR2 signed in, session in tenant A.
select tests.set_claims(tests.user_claims('e7000000-0000-4000-8000-000000000002',
                                          'e7200000-0000-4000-8000-0000000002a1',
                                          'a0000000-0000-4000-8000-000000000001'));
do $$
begin
  perform tests.assert_fails($q$select private.request_password_changed_mail('e7000000-0000-4000-8000-000000000001')$q$,
    array['42501'], 'with claims: never for another account');
  perform tests.assert_fails($q$select private.request_password_changed_mail(null)$q$,
    array['42501'], 'an account is required');
end $$;
-- A session whose claimed tenant is not the session's organization (stale token): refused.
select tests.set_claims(tests.user_claims('e7000000-0000-4000-8000-000000000002',
                                          'e7200000-0000-4000-8000-0000000002a1',
                                          'b0000000-0000-4000-8000-000000000001'));
do $$
begin
  perform tests.assert_fails($q$select private.request_password_changed_mail('e7000000-0000-4000-8000-000000000002')$q$,
    array['42501'], 'claims that do not validate: refused');
end $$;
select tests.set_claims(null);
do $$
begin
  -- An account that does not exist: nothing queued, no error (the reset completion already succeeded).
  perform private.request_password_changed_mail('e7000000-0000-4000-8000-0000000000ff');
end $$;
reset role;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Committed for 56_account_mail_app_worker.sql: one request per transaction (oldest first is the
-- worker's order).
-- ---------------------------------------------------------------------------------------------------
begin; set local role authenticated; select tests.set_claims(null);
select private.request_password_reset_mail(' Reset1@A.test '); commit;
begin; set local role authenticated; select tests.set_claims(null);
select private.request_password_reset_mail('reset1@a.test'); commit;  -- a repeat: dropped
begin; set local role authenticated; select tests.set_claims(null);
select private.request_password_reset_mail('multi@ab.test'); commit;
begin; set local role authenticated; select tests.set_claims(null);
select private.request_password_reset_mail('oldest@bd.test'); commit;
begin; set local role authenticated; select tests.set_claims(null);
select private.request_password_reset_mail('banned@a.test'); commit;
begin; set local role authenticated; select tests.set_claims(null);
select private.request_password_reset_mail('soon@a.test'); commit;
begin; set local role authenticated; select tests.set_claims(null);
select private.request_password_reset_mail('invited@a.test'); commit;
begin; set local role authenticated; select tests.set_claims(null);
select private.request_password_reset_mail('uc@c.test'); commit;
begin; set local role authenticated; select tests.set_claims(null);
select private.request_password_reset_mail('nobody@nowhere.test'); commit;
-- My profile change by uR2 in A (session sR2a): the notice goes to A although B was used more recently.
begin; set local role authenticated;
select tests.set_claims(tests.user_claims('e7000000-0000-4000-8000-000000000002',
                                          'e7200000-0000-4000-8000-0000000002a1',
                                          'a0000000-0000-4000-8000-000000000001'));
select private.request_password_changed_mail('e7000000-0000-4000-8000-000000000002'); commit;
-- After a reset (no claims): uR3's notice, organization chosen by the worker.
begin; set local role authenticated; select tests.set_claims(null);
select private.request_password_changed_mail('e7000000-0000-4000-8000-000000000003'); commit;
begin; set local role authenticated; select tests.set_claims(null);
select private.request_password_changed_mail('e7000000-0000-4000-8000-000000000003'); commit;  -- a repeat: dropped
-- Without claims, an account that had no recovery token within 65 minutes gets no notice — there was no
-- reset (a stolen app_server credential cannot send branded notices to arbitrary accounts). Dropped
-- silently; 57_account_mail_owner.sql checks nothing was stored.
begin; set local role authenticated; select tests.set_claims(null);
select private.request_password_changed_mail('e7000000-0000-4000-8000-000000000001'); commit;  -- never
begin; set local role authenticated; select tests.set_claims(null);
select private.request_password_changed_mail('e7000000-0000-4000-8000-000000000006'); commit;  -- 2 hours ago

\echo '55_account_mail_app_server: ok'
