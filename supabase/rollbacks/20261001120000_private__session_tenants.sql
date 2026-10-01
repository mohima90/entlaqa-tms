-- Rollback of 20261001120000_private__session_tenants.sql.
drop function private.session_tenants();
revoke select (name_ar, name_en) on platform.tenants from tenant_guard;
