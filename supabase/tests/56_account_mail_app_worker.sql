-- db-test: run-as=app_worker
-- Account e-mails, the worker side (T-M2-17): only a job (system claims under the app_worker login) may
-- lease, answer or put back a request; a lease says who gets which e-mail — the R1 rule for the
-- organization (docs/engineering/password-reset.md §3) and the person's language — or why nothing is sent.
-- The queue itself stays unreachable. Requests: committed by 55_account_mail_app_server.sql; every block
-- here is rolled back (61_account_mail_limits_owner.sql empties the queue).
\set ON_ERROR_STOP on

do $$ begin perform tests.assert(session_user = 'app_worker', 'must run connected as app_worker'); end $$;

begin;
set local role authenticated;
select tests.set_claims(null);
do $$
begin
  perform tests.assert_fails($q$select * from private.claim_account_mail_request()$q$, array['42501'],
    'no claims: refused');
  perform tests.assert_privilege_denied($q$select * from private.account_mail_requests$q$,
    'the queue is not readable by jobs either (only through the functions)');
  perform tests.assert_fails($q$select private.request_password_reset_mail('reset1@a.test')$q$, array['42501'],
    'jobs do not queue reset requests');
  perform tests.assert_fails($q$select private.request_password_changed_mail('e7000000-0000-4000-8000-000000000001')$q$,
    array['42501'], 'jobs do not queue password-changed notices');
end $$;
-- User claims under the worker login: refused.
select tests.set_claims(tests.user_claims('e7000000-0000-4000-8000-000000000002',
                                          'e7200000-0000-4000-8000-0000000002a1',
                                          'a0000000-0000-4000-8000-000000000001'));
do $$
begin
  perform tests.assert_fails($q$select * from private.claim_account_mail_request()$q$, array['42501'],
    'user claims: refused');
end $$;
-- System claims without a job id: refused.
select tests.set_claims(jsonb_build_object('role', 'system'));
do $$
begin
  perform tests.assert_fails($q$select * from private.claim_account_mail_request()$q$, array['42501'],
    'system claims without a job: refused');
end $$;
reset role;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Every request in turn (oldest first), as the worker leases them (platform job: no tenant).
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(jsonb_build_object('role', 'system', 'job_id', 'tests.account_mail'));
do $$
declare
  v_expected text[] := array[
    'password_reset|send|reset1@a.test|e7000000-0000-4000-8000-000000000001|a0000000-0000-4000-8000-000000000001|e7100000-0000-4000-8000-0000000001a1|ar|1',
    'password_reset|send|multi@ab.test|e7000000-0000-4000-8000-000000000002|b0000000-0000-4000-8000-000000000001|e7100000-0000-4000-8000-0000000002b1|en|1',
    'password_reset|send|oldest@bd.test|e7000000-0000-4000-8000-000000000003|b0000000-0000-4000-8000-000000000001|e7100000-0000-4000-8000-0000000003b1|ar|1',
    'password_reset|banned||||||1',
    'password_reset|too_soon||||||1',
    'password_reset|no_membership||||||1',
    'password_reset|no_membership||||||1',
    'password_reset|unknown_account||||||1',
    'password_changed|send|multi@ab.test|e7000000-0000-4000-8000-000000000002|a0000000-0000-4000-8000-000000000001|e7100000-0000-4000-8000-0000000002a1|ar|1',
    'password_changed|send|oldest@bd.test|e7000000-0000-4000-8000-000000000003|b0000000-0000-4000-8000-000000000001|e7100000-0000-4000-8000-0000000003b1|ar|1'];
  v_got text[] := '{}';
  v_ids uuid[] := '{}';
  r record;
begin
  loop
    select * into r from private.claim_account_mail_request();
    exit when r.id is null;
    v_ids := v_ids || r.id;
    -- Nothing about the account is handed out unless an e-mail is to be sent (banned, no membership, …
    -- carry the user id at most).
    v_got := v_got || concat_ws('|', r.kind, r.outcome, coalesce(r.email, ''),
                                case when r.outcome = 'send' then r.user_id::text else '' end,
                                coalesce(r.tenant_id::text, ''), coalesce(r.person_id::text, ''),
                                coalesce(r.locale, ''), r.attempts::text);
    exit when cardinality(v_ids) > 20;
  end loop;
  perform tests.assert_eq(v_got, v_expected, 'each request: outcome, address, account, organization, person, language');
  perform tests.assert_eq((select count(*) from private.claim_account_mail_request()), 0::bigint,
    'leased requests are not handed out twice');
  -- Answered: removed (once).
  perform tests.assert(private.finish_account_mail_request(v_ids[1]), 'finish removes the request');
  perform tests.assert(not private.finish_account_mail_request(v_ids[1]), 'finishing twice: nothing left');
end $$;
reset role;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Temporary failures: put back with a back-off; the next lease is another request. "too_soon" applies to
-- the first attempt only (the worker's own retry of a request may follow its own link at once).
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(jsonb_build_object('role', 'system', 'job_id', 'tests.account_mail'));
do $$
declare
  r record;
  v_first uuid;
begin
  select * into r from private.claim_account_mail_request();
  v_first := r.id;
  perform tests.assert_eq(r.email, 'reset1@a.test', 'the oldest first');
  perform tests.assert(private.retry_account_mail_request(v_first), 'put back for a later attempt');
  select * into r from private.claim_account_mail_request();
  perform tests.assert(r.id <> v_first and r.email = 'multi@ab.test',
    'a request put back waits (back-off): the next one is leased');
  perform tests.assert(not private.retry_account_mail_request(gen_random_uuid()), 'unknown request: false');
end $$;
-- A tenant job (system claims of an organization) may finish a request too: the e-mail is queued in the
-- organization's delivery log in that same transaction.
select tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001', 'tests.account_mail'));
do $$
declare
  r record;
begin
  select * into r from private.claim_account_mail_request();
  perform tests.assert(r.id is not null, 'tenant job: leases too');
  perform tests.assert(private.finish_account_mail_request(r.id), 'tenant job: finishes the request');
end $$;
reset role;
rollback;

\echo '56_account_mail_app_worker: ok'
