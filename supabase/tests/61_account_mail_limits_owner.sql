-- db-test: run-as=owner
-- Checks of 60 (T-M2-17), then the queue is emptied for the TypeScript integration tests
-- (DB_TEST_INTEGRATION=1), which make their own requests.
\set ON_ERROR_STOP on

do $$
begin
  perform tests.assert(not exists (select 1 from private.account_mail_requests where email = 'multi@ab.test'),
    'a request without attempts left is removed by the next lease');
  perform tests.assert_eq((select attempts::int from private.account_mail_requests where email = 'oldest@bd.test'), 1,
    'the lease counts an attempt');
  perform tests.assert((select leased_until > now() from private.account_mail_requests where email = 'oldest@bd.test'),
    'the leased request is held for a while');
end $$;

delete from private.account_mail_requests;

\echo '61_account_mail_limits_owner: ok'
