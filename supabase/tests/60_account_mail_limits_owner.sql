-- db-test: run-as=owner
-- Checks of 58/59 (T-M2-17), then the queue is emptied for the TypeScript integration tests
-- (DB_TEST_INTEGRATION=1), which make their own requests.
\set ON_ERROR_STOP on

do $$
begin
  perform tests.assert(not exists (select 1 from private.account_mail_requests where email in ('reset1@a.test', 'multi@ab.test')),
    'requests older than 60 minutes and requests without attempts left are removed by the next lease');
  perform tests.assert(not exists (select 1 from private.account_mail_requests where email = 'cap@a.test'
                                   or user_id = 'e7000000-0000-4000-8000-000000000001'),
    'a full queue (10,000 waiting) takes no further request');
  perform tests.assert_eq((select attempts::int from private.account_mail_requests where email = 'oldest@bd.test'), 1,
    'the lease counts an attempt');
  perform tests.assert((select leased_until > now() from private.account_mail_requests where email = 'oldest@bd.test'),
    'the leased request is held for a while');
end $$;

delete from private.account_mail_requests;

\echo '48_account_mail_limits_owner: ok'
