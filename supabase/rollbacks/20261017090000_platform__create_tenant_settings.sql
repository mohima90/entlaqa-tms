-- Rollback of 20261017090000_platform__create_tenant_settings.sql.
drop trigger tenants_settings on platform.tenants;
drop function private.create_tenant_settings();
drop table platform.tenant_settings;
drop function private.stamp_tenant_settings();
drop function private.actor_may_manage_tenant(uuid);
