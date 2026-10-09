-- db-test: run-as=owner
-- Checks of 58_account_mail_limits_app_server.sql (T-M2-17, security review): no worker has run since
-- 57_account_mail_owner.sql, yet the request older than 60 minutes is gone — the request path itself
-- removes them, so retention (and with it the cap) holds without a running worker; the queue was then
-- exactly full, so neither the reset request nor the notice was stored; the exhausted request is still
-- there (only the worker's lease removes it).
\set ON_ERROR_STOP on

do $$
begin
  perform tests.assert(not exists (select 1 from private.account_mail_requests where email = 'reset1@a.test'),
    'a request older than 60 minutes is removed by the next request, without a worker');
  perform tests.assert(not exists (select 1 from private.account_mail_requests where email = 'cap@a.test'
                                   or user_id = 'e7000000-0000-4000-8000-000000000005'),
    'a full queue (10,000 waiting) takes no further request');
  perform tests.assert_eq((select count(*) from private.account_mail_requests), 10000::bigint,
    'the queue holds exactly its cap');
  perform tests.assert(exists (select 1 from private.account_mail_requests where email = 'multi@ab.test'),
    'requests younger than 60 minutes stay until the worker answers them');
end $$;

\echo '59_account_mail_retention_owner: ok'
