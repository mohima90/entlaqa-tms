-- Rollback of 20261019090100_platform__create_custom_roles.sql.
-- Custom-role assignments are removed first (their roles go away). Invitations naming a custom role are
-- kept as history (review L7): a pending one is revoked; every one keeps its row with the role it gave
-- replaced by Employee (learner) — the foreign key to ref_roles comes back below — and the change is
-- recorded in the audit log. (The invitation lifecycle trigger is disabled for this update only.)
delete from platform.role_assignments where role_code like 'custom\_%';
insert into platform.audit_events (tenant_id, action, entity_type, entity_id, data)
select i.tenant_id, 'platform.invitation.role_rewritten', 'invitation', i.id::text,
       jsonb_build_object('before', i.primary_role, 'after', 'learner',
                          'reason', 'rollback of 20261019090100 (custom roles removed)')
from platform.invitations i where i.primary_role like 'custom\_%';
alter table platform.invitations disable trigger invitations_check;
update platform.invitations
set status = 'revoked', revoked_at = now(), invite_code = null, send_at = null
where primary_role like 'custom\_%' and status = 'pending';
update platform.invitations set primary_role = 'learner' where primary_role like 'custom\_%';
alter table platform.invitations enable trigger invitations_check;

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
