-- Rollback of 20261026100100_private__create_kept_sessions.sql.
drop function private.forget_kept_sessions();
drop function private.my_kept_sessions();
drop function private.keep_session();
drop policy audit_events_tenant_guard_keep_insert on platform.audit_events;
revoke select (tenant_id, remembered_browser_days) on platform.security_policies from tenant_guard;
drop table private.kept_sessions;
