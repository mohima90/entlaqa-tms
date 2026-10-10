-- Rollback of 20261011090000_private__member_deactivation.sql. The cluster-wide role membership_guard is
-- kept (other databases may use it); its privileges in this database are removed. Deactivated members stay
-- deactivated (persons inactive, memberships suspended): without the function they can be reactivated
-- only as a platform operation.
drop function private.reactivate_membership(uuid);

drop trigger tenant_memberships_privileged_deactivation on platform.tenant_memberships;
drop function private.check_privileged_deactivation();

drop trigger tenant_memberships_end_sessions on platform.tenant_memberships;
drop function private.end_member_sessions();

-- As in 20260930120100 (no advisory lock).
create or replace function private.switch_active_tenant(p_tenant_id uuid)
returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_claims jsonb := private.request_claims();
  v_user uuid;
  v_session uuid;
begin
  if session_user <> 'app_server' or v_claims is null or coalesce(v_claims ->> 'role', '') <> 'authenticated' then
    return false;
  end if;
  v_user := private.try_uuid(v_claims ->> 'sub');
  v_session := private.try_uuid(v_claims ->> 'session_id');
  if not private.user_session_is_valid(v_user, v_session)
     or not private.has_active_membership(v_user, p_tenant_id) then
    return false;
  end if;

  insert into platform.session_context as c (session_id, user_id, active_tenant_id, updated_at)
  values (v_session, v_user, p_tenant_id, now())
  on conflict (session_id) do update
    set active_tenant_id = excluded.active_tenant_id,
        updated_at = excluded.updated_at
    where c.user_id = excluded.user_id;
  return found;
end
$$;

-- As in 20261004120200 (no person_employment lock for department heads).
create or replace function private.check_department_refs()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_restoring boolean := tg_op = 'UPDATE' and old.deleted_at is not null and new.deleted_at is null;
begin
  if new.deleted_at is not null then
    return new;
  end if;
  if new.branch_id is not null
     and (tg_op = 'INSERT' or v_restoring or new.branch_id is distinct from old.branch_id) then
    -- Same lock as a branch soft delete (private.check_tree on platform.branches), so a department
    -- cannot be added to a branch that is being deleted concurrently (READ COMMITTED: the query
    -- below sees the delete once the lock is granted).
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('platform.branches:' || new.tenant_id::text, 0));
    if exists (select 1 from platform.branches b
               where b.tenant_id = new.tenant_id and b.id = new.branch_id and b.deleted_at is not null) then
      raise exception 'department % cannot belong to a deleted branch', new.id using errcode = 'check_violation';
    end if;
  end if;
  if new.head_person_id is not null
     and (tg_op = 'INSERT' or v_restoring or new.head_person_id is distinct from old.head_person_id)
     and not exists (select 1 from platform.persons p
                     where p.tenant_id = new.tenant_id and p.id = new.head_person_id and p.status = 'active') then
    raise exception 'the head of department % must be an active person', new.id using errcode = 'check_violation';
  end if;
  return new;
end
$$;

revoke all on function private.check_department_refs() from public;

drop function private.lock_person_employment(uuid);

revoke execute on function private.try_uuid(text) from membership_guard;
revoke execute on function private.request_claims() from membership_guard;
revoke execute on function private.request_user_id() from membership_guard;
revoke execute on function private.current_tenant_id() from membership_guard;
revoke execute on function private.lock_tenant_roles(uuid) from membership_guard;
revoke execute on function private.actor_role_codes(uuid, uuid) from membership_guard;
revoke execute on function private.membership_is_privileged(uuid, uuid) from membership_guard;

drop policy persons_membership_guard_read on platform.persons;
revoke all on platform.persons from membership_guard;
drop policy ref_roles_membership_guard_read on platform.ref_roles;
revoke all on platform.ref_roles from membership_guard;
drop policy role_assignments_membership_guard_read on platform.role_assignments;
revoke all on platform.role_assignments from membership_guard;
drop policy tenant_memberships_membership_guard_reactivate on platform.tenant_memberships;
drop policy tenant_memberships_membership_guard_read on platform.tenant_memberships;
revoke all on platform.tenant_memberships from membership_guard;
drop policy session_context_membership_guard_delete on platform.session_context;
drop policy session_context_membership_guard_read on platform.session_context;
revoke all on platform.session_context from membership_guard;

revoke usage on schema platform, private from membership_guard;
revoke membership_guard from current_user;
