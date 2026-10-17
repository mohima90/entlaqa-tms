-- Rollback of 20261020180100_private__standard_role_module_permissions_given.sql: the EP-ROLES rule (every
-- permission of every role held by the giver).
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
  -- Nobody gives a permission they do not hold (EP-ROLES).
  return not exists (select 1 from unnest(p_roles) r
                     cross join lateral unnest(private.role_permission_codes(p_tenant_id, r)) c
                     where not (c = any (v_held)));
end
$$;

comment on function private.member_may_give_roles(uuid, uuid, text[]) is
  'SECURITY-RELEVANT (ADR 0003 §5, EP-ROLES). Who may give which roles: the Organization Admin every role; role.assign holders non-privileged roles whose permissions they hold.';
