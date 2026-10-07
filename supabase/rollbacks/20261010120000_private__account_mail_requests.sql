-- Rollback of 20261010120000_private__account_mail_requests.sql. The cluster-wide role account_mail_guard
-- is kept (other databases may use it); its privileges in this database are removed.
-- Set PASSWORD_RESET_DELIVERY=auth for the web app BEFORE running this (docs/engineering/password-reset.md):
-- without the request functions the worker path cannot queue anything.
drop function private.retry_account_mail_request(uuid);
drop function private.finish_account_mail_request(uuid);
drop function private.claim_account_mail_request();
drop function private.request_password_changed_mail(uuid);
drop function private.request_password_reset_mail(text);

revoke execute on function private.try_uuid(text) from account_mail_guard;
revoke execute on function private.request_claims() from account_mail_guard;
revoke execute on function private.request_user_id() from account_mail_guard;
revoke execute on function private.current_tenant_id() from account_mail_guard;

drop policy session_context_account_mail_guard_read on platform.session_context;
revoke all on platform.session_context from account_mail_guard;
drop policy persons_account_mail_guard_read on platform.persons;
revoke all on platform.persons from account_mail_guard;
drop policy tenant_memberships_account_mail_guard_read on platform.tenant_memberships;
revoke all on platform.tenant_memberships from account_mail_guard;
drop policy tenants_account_mail_guard_read on platform.tenants;
revoke all on platform.tenants from account_mail_guard;

drop view private.auth_account;
drop table private.account_mail_requests;

revoke usage on schema platform, private from account_mail_guard;
revoke account_mail_guard from current_user;
