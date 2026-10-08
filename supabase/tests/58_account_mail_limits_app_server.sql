-- db-test: run-as=app_server
-- The DB-side cap (T-M2-17): with 10,000 requests waiting (45_account_mail_owner.sql) a further reset
-- request — or "password changed" notice — is dropped silently, like a limited one on the request path
-- (the web app's answer does not change). Checked in 48_account_mail_limits_owner.sql.
\set ON_ERROR_STOP on

do $$ begin perform tests.assert(session_user = 'app_server', 'must run connected as app_server'); end $$;

begin; set local role authenticated; select tests.set_claims(null);
select private.request_password_reset_mail('cap@a.test');
select private.request_password_changed_mail('e7000000-0000-4000-8000-000000000001');
commit;

\echo '46_account_mail_limits_app_server: ok'
