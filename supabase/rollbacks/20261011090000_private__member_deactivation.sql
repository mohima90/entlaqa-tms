-- Rollback of 20261011090000_private__member_deactivation.sql. The cluster-wide role membership_guard is
-- kept (other databases may use it); its privileges in this database are removed. Deactivated members stay
-- deactivated (persons inactive, memberships suspended): without the function they can be reactivated
-- only as a platform operation.
drop function private.reactivate_membership(uuid);

drop trigger tenant_memberships_end_sessions on platform.tenant_memberships;
drop function private.end_member_sessions();

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
