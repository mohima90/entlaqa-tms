-- Rollback of 20261020210500_private__department_scope_change_guard.sql: the unit guards of 20261020090400
-- again; a role's data scope may leave «A department» while it is given for units.

drop trigger custom_roles_scope_units on platform.custom_roles;
drop function private.check_custom_role_scope_units();

create or replace function private.check_role_scope_unit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_role text := case tg_table_name when 'invitations' then v_row ->> 'primary_role' else v_row ->> 'role_code' end;
  v_scope text;
  v_status text;
  v_deleted timestamptz;
begin
  if tg_table_name = 'invitations' and tg_op = 'UPDATE' then
    if new.scope_unit_id is distinct from old.scope_unit_id then
      raise exception 'what an invitation is for cannot change' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if new.scope_unit_id is null then
    return new;
  end if;
  if current_user = 'authenticated' and new.tenant_id is distinct from private.current_tenant_id() then
    return new;  -- another organization's row: the restrictive tenant_isolation policy rejects it
  end if;
  if v_role like 'custom\_%' then
    select cr.data_scope into v_scope from platform.custom_roles cr
    where cr.tenant_id = new.tenant_id and cr.code = v_role;
  end if;
  if v_scope is distinct from 'departments' then
    raise exception 'only a role limited to a department takes a unit' using errcode = 'check_violation';
  end if;
  if current_user = 'authenticated' then
    -- Share-locked: a concurrent soft delete of the unit waits for this transaction, then counts this holder.
    select d.status, d.deleted_at into v_status, v_deleted
    from platform.departments d
    where d.tenant_id = new.tenant_id and d.id = new.scope_unit_id
    for share;
    if not found or v_deleted is not null or v_status <> 'active' then
      raise exception 'the unit must be an active unit of the organization' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end
$$;

comment on function private.check_role_scope_unit() is
  'SECURITY-RELEVANT (FR-IAM-08, EP-ORG). The unit of a role: department-limited custom roles only; live and active when given by a member; fixed on invitations.';

revoke all on function private.check_role_scope_unit() from public;

create or replace function private.check_department_role_scopes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_roles bigint;
  v_invitations bigint;
begin
  if not (old.deleted_at is null and new.deleted_at is not null) then
    return new;
  end if;
  select count(*) into v_roles
  from platform.role_assignments ra
  join platform.tenant_memberships m on m.tenant_id = ra.tenant_id and m.id = ra.membership_id
  where ra.tenant_id = new.tenant_id and ra.scope_unit_id = new.id and m.status <> 'revoked';
  select count(*) into v_invitations
  from platform.invitations i
  where i.tenant_id = new.tenant_id and i.scope_unit_id = new.id and i.status = 'pending';
  if v_roles > 0 or v_invitations > 0 then
    raise exception 'the unit is still the scope of % role assignment(s) and % pending invitation(s)', v_roles, v_invitations
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

comment on function private.check_department_role_scopes() is
  'SECURITY-RELEVANT (EP-ORG BR-ORG-c). A unit picked for a department-limited role (member or pending invitation) cannot be deleted.';

revoke all on function private.check_department_role_scopes() from public;
