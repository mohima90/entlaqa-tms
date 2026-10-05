-- Rollback of 20261005100100_platform__create_role_assignments.sql.
drop trigger tenant_memberships_keep_admin on platform.tenant_memberships;
drop trigger tenant_memberships_guard on platform.tenant_memberships;
drop table platform.role_assignments;
drop function private.check_last_admin_membership();
drop function private.check_last_admin_assignment();
drop function private.tenant_has_admin(uuid);
drop function private.check_membership_change_actor();
drop function private.check_role_assignment_actor();
drop function private.membership_is_privileged(uuid, uuid);
drop function private.lock_tenant_roles(uuid);
drop function private.actor_role_codes(uuid, uuid);
