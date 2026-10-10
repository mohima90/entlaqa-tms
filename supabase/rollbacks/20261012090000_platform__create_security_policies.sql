-- Rollback of 20261012090000_platform__create_security_policies.sql.
drop trigger tenants_security_policy on platform.tenants;
drop function private.create_tenant_security_policy();
drop table platform.security_policies;
drop function private.stamp_security_policy();
drop function private.actor_may_change_security_policy(uuid);
