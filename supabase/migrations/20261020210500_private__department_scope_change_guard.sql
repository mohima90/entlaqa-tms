-- A custom role keeps «A department» while it is given for units (code review C-M1 of T-M3-09; FR-IAM-07,
-- FR-IAM-08; business flows EP-ORG BR-ORG-c/d, EP-ROLES). Class: T (guards on platform.custom_roles,
-- platform.role_assignments, platform.invitations, platform.departments). PII: none.
--
-- Changing a department-limited custom role to another data scope stranded what carried its units: pending
-- invitations then failed at acceptance (the unit guard refuses a unit on a role that is no longer
-- department-limited), and the units stayed counted as "a role's scope" (a unit nobody could delete). Now:
--   (b) the data scope of a custom role cannot move away from «A department» (`departments`) while a member
--       (membership not revoked) or a pending invitation holds the role WITH a unit — JR004 with both numbers
--       (like deleting a role that is still held, JR002). The Organization Admin first gives those people the
--       role without a unit, another role, or revokes the invitations;
--   (a) acceptance carries the invitation's unit only while the role is still department-limited
--       (private.check_role_scope_unit, for the acceptance function's role invitation_guard: the unit is
--       dropped instead of refusing the acceptance — unreachable with (b), kept as defence in depth);
--   (c) a unit is "still a role's scope" (no soft delete) only for assignments and pending invitations whose
--       role is still department-limited (private.check_department_role_scopes).
-- Serialised with every other role change of the organization (private.lock_tenant_roles).

-- (b) The scope of a role given for units stays «A department».
create or replace function private.check_custom_role_scope_units()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_members bigint;
  v_invitations bigint;
begin
  if old.data_scope is distinct from 'departments' or new.data_scope = 'departments' then
    return new;
  end if;
  if current_user = 'authenticated' and new.tenant_id is distinct from private.current_tenant_id() then
    return new;  -- another organization's row: the restrictive tenant_isolation policy rejects it
  end if;
  perform private.lock_tenant_roles(new.tenant_id);
  select count(*) into v_members
  from platform.role_assignments ra
  join platform.tenant_memberships m on m.tenant_id = ra.tenant_id and m.id = ra.membership_id
  where ra.tenant_id = new.tenant_id and ra.role_code = old.code and ra.scope_unit_id is not null
    and m.status <> 'revoked';
  select count(*) into v_invitations
  from platform.invitations i
  where i.tenant_id = new.tenant_id and i.primary_role = old.code and i.scope_unit_id is not null
    and i.status = 'pending';
  if v_members > 0 or v_invitations > 0 then
    raise exception 'the role is still given for units: % member(s), % pending invitation(s)', v_members, v_invitations
      using errcode = 'JR004';
  end if;
  return new;
end
$$;

comment on function private.check_custom_role_scope_units() is
  'SECURITY-RELEVANT (FR-IAM-08, EP-ORG; C-M1). A custom role given for units (members or pending invitations) keeps the data scope «A department» (JR004).';

revoke all on function private.check_custom_role_scope_units() from public;

create trigger custom_roles_scope_units before update of data_scope on platform.custom_roles
  for each row execute function private.check_custom_role_scope_units();

-- (a) As in 20261020090400, plus: the acceptance function drops a unit whose role is no longer
-- department-limited instead of failing.
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
    if current_user = 'invitation_guard' and tg_table_name = 'role_assignments' and tg_op = 'INSERT' then
      new.scope_unit_id := null;  -- (a) acceptance: the role is no longer limited to a department
      return new;
    end if;
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
  'SECURITY-RELEVANT (FR-IAM-08, EP-ORG). The unit of a role: department-limited custom roles only (acceptance drops a unit the role no longer takes); live and active when given by a member; fixed on invitations.';

revoke all on function private.check_role_scope_unit() from public;

-- (c) As in 20261020090400, counting only roles that are still department-limited.
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
  join platform.custom_roles cr on cr.tenant_id = ra.tenant_id and cr.code = ra.role_code
  where ra.tenant_id = new.tenant_id and ra.scope_unit_id = new.id and m.status <> 'revoked'
    and cr.data_scope = 'departments';
  select count(*) into v_invitations
  from platform.invitations i
  join platform.custom_roles cr on cr.tenant_id = i.tenant_id and cr.code = i.primary_role
  where i.tenant_id = new.tenant_id and i.scope_unit_id = new.id and i.status = 'pending'
    and cr.data_scope = 'departments';
  if v_roles > 0 or v_invitations > 0 then
    raise exception 'the unit is still the scope of % role assignment(s) and % pending invitation(s)', v_roles, v_invitations
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

comment on function private.check_department_role_scopes() is
  'SECURITY-RELEVANT (EP-ORG BR-ORG-c). A unit picked for a department-limited role (member or pending invitation; the role still department-limited) cannot be deleted.';

revoke all on function private.check_department_role_scopes() from public;
