-- db-test: run-as=app_server
-- Retention without a worker and the DB-side cap (T-M2-17): each request first removes requests older
-- than 60 minutes (57_account_mail_owner.sql aged one); with 10,000 requests still waiting a further reset
-- request — or "password changed" notice (uR5: a recent recovery token, so only the cap stops it) — is
-- dropped silently, like a limited one on the request path (the web app's answer does not change).
-- Checked in 59_account_mail_retention_owner.sql.
\set ON_ERROR_STOP on

do $$ begin perform tests.assert(session_user = 'app_server', 'must run connected as app_server'); end $$;

begin; set local role authenticated; select tests.set_claims(null);
select private.request_password_reset_mail('cap@a.test');
select private.request_password_changed_mail('e7000000-0000-4000-8000-000000000005');
commit;

\echo '58_account_mail_limits_app_server: ok'
