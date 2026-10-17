-- Who may give which roles, with module permissions in standard roles (T-M3-10; ADR 0003 §5, EP-ROLES).
-- SECURITY-RELEVANT (flag for the security review).
--
-- From T-M3-10 the L&D Manager and the Training Coordinator (standard, non-privileged roles) grant TMS
-- permissions (tms.needs_form.*, migration 20261020180000). «Nobody gives a permission they do not hold»
-- (EP-ROLES) would then stop the HR Manager — who holds no training permission by design — from giving
-- these roles, against the PO rule of 5 Oct 2026 (non-privileged roles are the HR Manager's to give).
-- The rule now reads: the Organization Admin (platform.role.assign_privileged) gives every role; otherwise
-- platform.role.assign, no privileged role, and every permission of the roles held organization-wide —
-- for a STANDARD role its platform.* permissions (its module permissions are fixed by ENTLAQA with the
-- role), for a CUSTOM role all of them (unchanged). Same rule in code: packages/platform-rbac
-- role-grants.ts givenPermissions / canAssignRole and iam/role-catalogue.ts canGive.
-- Same signature, volatility, owner and grants as 20261019090100 (create or replace keeps the grants).

create or replace function private.member_may_give_roles(p_tenant_id uuid, p_user_id uuid, p_roles text[])
returns boolean
language plpgsql stable
set search_path = ''
as $$
declare
  v_held text[];
begin
  if p_user_id is null then
    return false;
  end if;
  v_held := private.member_permissions(p_tenant_id, p_user_id);
  if 'platform.role.assign_privileged' = any (v_held) then
    return true;
  end if;
  if not ('platform.role.assign' = any (v_held)) or private.roles_include_privileged(p_tenant_id, p_roles) then
    return false;
  end if;
  -- Nobody gives a permission they do not hold (EP-ROLES); of a standard role, its platform permissions.
  return not exists (select 1 from unnest(p_roles) r
                     cross join lateral unnest(private.role_permission_codes(p_tenant_id, r)) c
                     where not (c = any (v_held))
                       and (r like 'custom\_%' or c like 'platform.%'));
end
$$;

comment on function private.member_may_give_roles(uuid, uuid, text[]) is
  'SECURITY-RELEVANT (ADR 0003 §5, EP-ROLES, T-M3-10). Who may give which roles: the Organization Admin every role; role.assign holders non-privileged roles whose permissions they hold (of a standard role: its platform permissions).';
