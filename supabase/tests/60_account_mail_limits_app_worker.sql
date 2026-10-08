-- db-test: run-as=app_worker
-- Retention (T-M2-17): each lease first removes requests older than 60 minutes (the link's lifetime) and
-- requests whose 5 attempts are used up, unanswered; then leases the oldest remaining one. Committed;
-- checked in 61_account_mail_limits_owner.sql.
\set ON_ERROR_STOP on

do $$ begin perform tests.assert(session_user = 'app_worker', 'must run connected as app_worker'); end $$;

begin;
set local role authenticated;
select tests.set_claims(jsonb_build_object('role', 'system', 'job_id', 'tests.account_mail'));
do $$
declare
  r record;
begin
  select * into r from private.claim_account_mail_request();
  perform tests.assert_eq(r.email, 'oldest@bd.test',
    'the exhausted request is skipped (removed); the oldest remaining one is leased');
end $$;
commit;

\echo '60_account_mail_limits_app_worker: ok'
