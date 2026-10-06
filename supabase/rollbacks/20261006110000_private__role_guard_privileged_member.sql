-- Rollback of 20261006110000_private__role_guard_privileged_member.sql: the guard as in 20261005100100.
create or replace function private.check_role_assignment_actor()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_row platform.role_assignments := case when tg_op = 'DELETE' then old else new end;
  v_kind text := private.request_claims() ->> 'role';
  v_user uuid := private.request_user_id();
  v_actor_roles text[];
  v_privileged boolean;
  v_status text;
begin
  perform private.lock_tenant_roles(v_row.tenant_id);

  if tg_op = 'INSERT' then
    select m.status into v_status from platform.tenant_memberships m
    where m.tenant_id = v_row.tenant_id and m.id = v_row.membership_id;
    if v_status = 'revoked' then
      raise exception 'roles cannot be given to a revoked membership' using errcode = 'check_violation';
    end if;
  end if;

  if current_user <> 'authenticated' then
    return v_row;  -- platform operation
  end if;
  -- Rows of another tenant: the restrictive tenant_isolation policy rejects them (tested per table in
  -- 20_isolation.sql and its exact form in 10_catalog.sql / verify-deployment.sql).
  if v_row.tenant_id is distinct from private.current_tenant_id() then
    return v_row;
  end if;

  select r.is_privileged into v_privileged from platform.ref_roles r where r.code = v_row.role_code;

  -- System jobs (sync from HR systems, LMS, …) handle outside data: they may never give or remove a
  -- privileged role.
  if v_kind = 'system' then
    if v_privileged then
      raise exception 'system jobs cannot give or remove the role %', v_row.role_code
        using errcode = 'insufficient_privilege';
    end if;
    return v_row;
  end if;
  if v_kind is distinct from 'authenticated' or v_user is null then
    raise exception 'unexpected claims for a role change' using errcode = 'insufficient_privilege';
  end if;

  if exists (select 1 from platform.tenant_memberships m
             where m.tenant_id = v_row.tenant_id and m.id = v_row.membership_id and m.user_id = v_user) then
    raise exception 'members cannot change their own roles' using errcode = 'insufficient_privilege';
  end if;

  v_actor_roles := private.actor_role_codes(v_row.tenant_id, v_user);
  if v_privileged and not ('tenant_admin' = any (v_actor_roles)) then
    raise exception 'only an Organization Admin can give or remove the role %', v_row.role_code
      using errcode = 'insufficient_privilege';
  end if;
  if not v_privileged and not (v_actor_roles && array['tenant_admin', 'hr_manager']) then
    raise exception 'only an Organization Admin or an HR Manager can give or remove roles'
      using errcode = 'insufficient_privilege';
  end if;
  return v_row;
end
$$;

comment on function private.check_role_assignment_actor() is
  'SECURITY-RELEVANT (ADR 0003 §5, TM-0003 T-IAM-35). Database guard for who may change which roles.';

revoke all on function private.check_role_assignment_actor() from public;
