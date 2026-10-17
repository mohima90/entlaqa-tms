-- Rollback of 20261019090100_platform__create_custom_roles.sql.
-- Custom-role assignments and invitations naming a custom role are removed first (their roles go away).
delete from platform.role_assignments where role_code like 'custom\_%';
delete from platform.invitations where primary_role like 'custom\_%';

drop index platform.invitations_tenant_pending_role_idx;
alter table platform.invitations
  add constraint invitations_primary_role_fkey foreign key (primary_role) references platform.ref_roles (code);

drop index platform.role_assignments_tenant_custom_role_idx;
alter table platform.role_assignments
  drop constraint role_assignments_custom_role_code_fkey,
  drop constraint role_assignments_standard_role_code_fkey,
  drop column custom_role_code,
  drop column standard_role_code;
alter table platform.role_assignments
  add constraint role_assignments_role_code_fkey foreign key (role_code) references platform.ref_roles (code);
comment on column platform.role_assignments.role_code is null;

drop table platform.custom_role_permissions;
drop table platform.custom_roles;

drop function private.check_custom_role_permission();
drop function private.check_custom_role();
drop function private.check_custom_role_actor(uuid);
drop function private.member_may_give_roles(uuid, uuid, text[]);
drop function private.role_permission_codes(uuid, text);
drop function private.role_is_assignable(uuid, text);
drop function private.roles_include_privileged(uuid, text[]);
drop function private.role_is_privileged(uuid, text);
drop function private.member_has_permission(uuid, uuid, text);
drop function private.member_permissions(uuid, uuid);
