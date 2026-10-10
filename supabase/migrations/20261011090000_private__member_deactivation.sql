-- Deactivate / reactivate a member (FR-IAM-05, T-M2-09; approved screen 4; TM-0003 FR-IAM-05 row,
-- T-IAM-21/38/39/40). Records are kept: the person becomes inactive (persons.status, deactivated_at) and
-- the membership `suspended`; roles, placement and history stay.
--
--   Deactivation (request path, defineAction `platform.user.deactivate`) runs as `authenticated`: the
--   existing guards already allow it — membership active → suspended (transition trigger), only an
--   Organization Admin or HR Manager, a privileged member only by an Organization Admin, never oneself
--   (private.check_membership_change_actor), never the last active Organization Admin
--   (private.check_last_admin_membership); the person record by the same people
--   (private.check_person_writer). This migration adds:
--     * a privileged member (privileged role in force or future-dated: private.membership_is_privileged,
--       the reactivation test) is deactivated only with an authenticator code (AAL2 — PO decision D-IAM-01,
--       review M4): private.check_privileged_deactivation, owner membership_guard;
--     * end of the member's sign-in sessions IN THIS ORGANIZATION (tenant-scoped, never global: T-IAM-40):
--       when a membership leaves `active`, that tenant's platform.session_context rows of the user are
--       removed. private.current_tenant_id() already refuses the old claims at the next statement (no
--       active membership), and while the login belongs nowhere Auth issues no token at all (access-token
--       hook, 20261011090100). The Auth sessions themselves are NOT ended: a refused refresh is rolled back,
--       so its refresh token is never revoked — after a reactivation, a refresh token from before the
--       deactivation works again, its session has no organization selected and can pick this one in the
--       organization chooser without a new sign-in (residual N2, T-IAM-39). Planned closure: with T-M2-10's
--       Auth-session deletion, deactivation also ends the login's Auth sessions when no other active
--       membership remains. A concurrent organization switch cannot leave a session_context row behind:
--       switch and deactivation take the same per-membership advisory lock (shared / exclusive, review L3);
--     * one lock order for the people responsibilities that deactivation reassigns (direct reports and
--       department heads, T-M2-02 decision): setting a department head now takes the same per-tenant
--       lock as setting a direct manager (`platform.person_employment:<tenant>`), and the deactivation
--       takes it before anything else (private.lock_person_employment), so a concurrent "make X head /
--       manager" either commits before (and is reassigned) or waits and then finds X inactive.
--       Global order of the per-tenant advisory locks: departments → branches → person_employment →
--       role_assignments (private.lock_tenant_roles).
--   Reactivation (membership suspended → active) is refused to request-path code by the transition
--   trigger (T-IAM-21): it goes through private.reactivate_membership(), a checked SECURITY DEFINER
--   function owned by the NOLOGIN role membership_guard (pattern of tenant_guard / invitation_guard /
--   account_mail_guard): app_server with verified user claims of the organization, an Organization Admin
--   or HR Manager, a privileged member only by an Organization Admin with an authenticator code (AAL2 —
--   PO decision D-IAM-01: restoring a privileged member gives privileged roles back), never oneself, and
--   only after the person was made active again (by the same request, under the person write guard).
--   Roles are kept as they were (screen 4 says nothing about them; documented in the screens README).
-- Errors (SQLSTATE → @jadarat/platform-db): JM001 no membership here · JM002 not deactivated ·
-- JM003 authenticator code needed (reactivation or deactivation of a privileged member) · JM004 the
-- person is still inactive · 42501 wrong caller or actor.

-- ---------------------------------------------------------------------------------------------------
-- Role membership_guard (attribute policy as in 20260930120000)
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'membership_guard') then
    create role membership_guard nologin noinherit nobypassrls;
  end if;
end
$$;

do $$
declare
  r record;
begin
  select rolname, rolcanlogin, rolinherit, rolsuper, rolbypassrls, rolreplication, rolcreatedb, rolcreaterole
    into r from pg_roles where rolname = 'membership_guard';
  if r.rolsuper or r.rolbypassrls or r.rolreplication then
    raise exception 'role membership_guard must be NOSUPERUSER NOBYPASSRLS NOREPLICATION; fix it as a superuser first';
  end if;
  if r.rolinherit or r.rolcreatedb or r.rolcreaterole or r.rolcanlogin then
    alter role membership_guard nologin noinherit nocreatedb nocreaterole;
  end if;
  if exists (select 1 from pg_auth_members m join pg_roles g on g.oid = m.roleid join pg_roles u on u.oid = m.member
             where g.rolname = 'membership_guard' and (m.inherit_option or m.set_option)
               and not u.rolsuper and u.rolname <> current_user) then
    raise exception 'role membership_guard must have no members besides the migration role';
  end if;
end
$$;

-- The migration role must be able to hand function ownership to membership_guard.
grant membership_guard to current_user;
grant usage on schema platform, private to membership_guard;

-- ---------------------------------------------------------------------------------------------------
-- Lock order of the people responsibilities (direct managers, department heads)
-- ---------------------------------------------------------------------------------------------------
-- The per-tenant lock that private.check_person_employment takes for a new direct manager. Deactivation
-- takes it first (then private.lock_tenant_roles), so the people it reassigns cannot change under it.
create or replace function private.lock_person_employment(p_tenant_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_tenant_id is null then
    raise exception 'no organization to lock' using errcode = 'insufficient_privilege';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('platform.person_employment:' || p_tenant_id::text, 0));
end
$$;

comment on function private.lock_person_employment(uuid) is
  'Per-tenant lock of the people responsibilities (direct managers, department heads); taken before private.lock_tenant_roles (T-M2-09).';

revoke all on function private.lock_person_employment(uuid) from public;
grant execute on function private.lock_person_employment(uuid) to authenticated;

-- As in 20261004120200, plus: a new, changed or restored head takes the person_employment lock (after the
-- branches lock: departments → branches → person_employment), so it is serialised with deactivation.
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
     and (tg_op = 'INSERT' or v_restoring or new.head_person_id is distinct from old.head_person_id) then
    -- Same lock as a new direct manager and as a deactivation (T-M2-09): the head's status is read after
    -- any deactivation of that person has committed.
    perform private.lock_person_employment(new.tenant_id);
    if not exists (select 1 from platform.persons p
                   where p.tenant_id = new.tenant_id and p.id = new.head_person_id and p.status = 'active') then
      raise exception 'the head of department % must be an active person', new.id using errcode = 'check_violation';
    end if;
  end if;
  return new;
end
$$;

revoke all on function private.check_department_refs() from public;

-- ---------------------------------------------------------------------------------------------------
-- End of the member's sign-in sessions in this organization
-- ---------------------------------------------------------------------------------------------------
create policy session_context_membership_guard_read on platform.session_context for select
  to membership_guard using (true);
create policy session_context_membership_guard_delete on platform.session_context for delete
  to membership_guard using (true);
grant select (session_id, user_id, active_tenant_id) on platform.session_context to membership_guard;
grant delete on platform.session_context to membership_guard;

-- A membership that leaves `active` (deactivated, revoked; any writer, platform operations included):
-- the sessions of that user acting in that organization lose their organization. Other organizations of
-- the same login are untouched (T-IAM-40), and so is the Auth session itself.
create or replace function private.end_member_sessions()
returns trigger
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  if old.status = 'active' and new.status <> 'active' then
    -- Waits for an organization switch of this membership in flight (it holds the lock shared until it
    -- commits); the DELETE below is a later statement, so it sees that switch's row (READ COMMITTED).
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'platform.membership:' || new.tenant_id::text || ':' || new.user_id::text, 0));
    delete from platform.session_context c
    where c.active_tenant_id = new.tenant_id and c.user_id = new.user_id;
  end if;
  return null;
end
$$;

comment on function private.end_member_sessions() is
  'SECURITY-RELEVANT (FR-IAM-05, T-IAM-39/40). Trigger: a membership leaving active ends that organization''s sign-in sessions of the user (session_context rows). membership_guard.';

revoke all on function private.end_member_sessions() from public;

create trigger tenant_memberships_end_sessions after update of status on platform.tenant_memberships
  for each row execute function private.end_member_sessions();

-- As in 20260930120100, plus: the switch holds the membership's advisory lock SHARED from before its
-- membership check until it commits. A deactivation takes it EXCLUSIVE (private.end_member_sessions):
-- either the switch commits first and its session_context row is then removed, or the switch waits and
-- then finds the membership no longer active (review L3). A row lock (FOR SHARE) would need UPDATE
-- privileges and an update policy for tenant_guard; the advisory lock needs none.
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
  if not private.user_session_is_valid(v_user, v_session) or p_tenant_id is null then
    return false;
  end if;
  perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended(
    'platform.membership:' || p_tenant_id::text || ':' || v_user::text, 0));
  if not private.has_active_membership(v_user, p_tenant_id) then
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

-- ---------------------------------------------------------------------------------------------------
-- Deactivating a privileged member needs an authenticator code (review M4, D-IAM-01)
-- ---------------------------------------------------------------------------------------------------
-- Request path only (user claims): an active membership that leaves `active` while it holds a privileged
-- role — in force or future-dated, the same test as private.reactivate_membership — needs claims at
-- aal2. Who may do it at all stays with private.check_membership_change_actor (Organization Admin only;
-- that trigger, `tenant_memberships_guard`, fires first). Platform operations and jobs are not request-path
-- deactivations. SECURITY DEFINER (owner membership_guard) so the role test sees every role assignment of
-- the organization, whatever the caller may read.
create or replace function private.check_privileged_deactivation()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_claims jsonb := private.request_claims();
begin
  if old.status = 'active' and new.status <> 'active'
     and coalesce(v_claims ->> 'role', '') = 'authenticated'
     and private.membership_is_privileged(new.tenant_id, new.id)
     and (v_claims ->> 'aal') is distinct from 'aal2' then
    raise exception 'deactivating a member who holds a privileged role needs an authenticator code'
      using errcode = 'JM003';
  end if;
  return new;
end
$$;

comment on function private.check_privileged_deactivation() is
  'SECURITY-RELEVANT (FR-IAM-05, D-IAM-01, review M4). Trigger: a request-path deactivation of a member who holds a privileged role needs AAL2. membership_guard.';

revoke all on function private.check_privileged_deactivation() from public;

create trigger tenant_memberships_privileged_deactivation before update of status on platform.tenant_memberships
  for each row execute function private.check_privileged_deactivation();

-- ---------------------------------------------------------------------------------------------------
-- Reactivation (membership suspended → active)
-- ---------------------------------------------------------------------------------------------------
-- What the function reads and changes (explicit grants + policies `to membership_guard`; it filters every
-- read by the caller's organization itself: the tenant_isolation policies apply to `authenticated` only).
create policy tenant_memberships_membership_guard_read on platform.tenant_memberships for select
  to membership_guard using (true);
create policy tenant_memberships_membership_guard_reactivate on platform.tenant_memberships for update
  to membership_guard using (status = 'suspended') with check (status = 'active');
grant select (id, tenant_id, user_id, person_id, status) on platform.tenant_memberships to membership_guard;
grant update (status) on platform.tenant_memberships to membership_guard;

create policy role_assignments_membership_guard_read on platform.role_assignments for select
  to membership_guard using (true);
grant select (tenant_id, membership_id, role_code, valid_from, valid_until) on platform.role_assignments
  to membership_guard;
create policy ref_roles_membership_guard_read on platform.ref_roles for select to membership_guard using (true);
grant select (code, is_privileged) on platform.ref_roles to membership_guard;
create policy persons_membership_guard_read on platform.persons for select to membership_guard using (true);
grant select (tenant_id, id, status) on platform.persons to membership_guard;

-- Helpers the function and the membership triggers it fires call.
grant execute on function private.try_uuid(text) to membership_guard;
grant execute on function private.request_claims() to membership_guard;
grant execute on function private.request_user_id() to membership_guard;
grant execute on function private.current_tenant_id() to membership_guard;
grant execute on function private.lock_tenant_roles(uuid) to membership_guard;
grant execute on function private.actor_role_codes(uuid, uuid) to membership_guard;
grant execute on function private.membership_is_privileged(uuid, uuid) to membership_guard;

-- The signed-in caller (an Organization Admin or HR Manager of the session's organization) reactivates
-- the deactivated membership of a person of that organization. The person must already be active again:
-- the calling request sets persons.status itself, under the person write guard, so the record and the
-- membership come back together (and a person placed in a since-deleted unit is refused by
-- private.check_person_reactivation before this runs). Returns the membership id.
create or replace function private.reactivate_membership(p_person_id uuid)
returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_claims jsonb := private.request_claims();
  v_tenant uuid;
  v_actor uuid;
  v_roles text[];
  v_membership record;
begin
  if session_user <> 'app_server' or v_claims is null or coalesce(v_claims ->> 'role', '') <> 'authenticated' then
    raise exception 'reactivate_membership needs a signed-in member' using errcode = 'insufficient_privilege';
  end if;
  -- Validates the session, the caller's own ACTIVE membership and the session's organization.
  v_tenant := private.current_tenant_id();
  v_actor := private.request_user_id();
  if v_tenant is null or v_actor is null or p_person_id is null then
    raise exception 'reactivate_membership needs a signed-in member of an organization' using errcode = 'insufficient_privilege';
  end if;
  -- Serialised with every role and membership change of the organization (READ COMMITTED: the rows
  -- below are read after the lock is granted).
  perform private.lock_tenant_roles(v_tenant);

  select m.id, m.user_id, m.status into v_membership
  from platform.tenant_memberships m
  where m.tenant_id = v_tenant and m.person_id = p_person_id;
  if not found then
    raise exception 'the person has no membership in this organization' using errcode = 'JM001';
  end if;
  if v_membership.user_id = v_actor then
    raise exception 'members cannot change their own membership' using errcode = 'insufficient_privilege';
  end if;
  if v_membership.status <> 'suspended' then
    raise exception 'the membership is not deactivated' using errcode = 'JM002';
  end if;

  v_roles := private.actor_role_codes(v_tenant, v_actor);
  if not (v_roles && array['tenant_admin', 'hr_manager']) then
    raise exception 'only an Organization Admin or an HR Manager can reactivate members'
      using errcode = 'insufficient_privilege';
  end if;
  if private.membership_is_privileged(v_tenant, v_membership.id) then
    if not ('tenant_admin' = any (v_roles)) then
      raise exception 'only an Organization Admin can reactivate a member who holds a privileged role'
        using errcode = 'insufficient_privilege';
    end if;
    if (v_claims ->> 'aal') is distinct from 'aal2' then
      raise exception 'reactivating a member who holds a privileged role needs an authenticator code'
        using errcode = 'JM003';
    end if;
  end if;
  if not exists (select 1 from platform.persons p
                 where p.tenant_id = v_tenant and p.id = p_person_id and p.status = 'active') then
    raise exception 'the person must be active before the membership' using errcode = 'JM004';
  end if;

  update platform.tenant_memberships m set status = 'active'
  where m.id = v_membership.id and m.tenant_id = v_tenant and m.status = 'suspended';
  if not found then
    raise exception 'the membership is not deactivated' using errcode = 'JM002';
  end if;
  return v_membership.id;
end
$$;

comment on function private.reactivate_membership(uuid) is
  'SECURITY-RELEVANT (FR-IAM-05, TM-0003 T-IAM-21). The signed-in Organization Admin / HR Manager reactivates a deactivated membership of their organization (privileged members: Organization Admin with AAL2). app_server only; owner membership_guard.';

-- Ownership hand-over as in migration 20260930120100 (non-superuser migration role on hosted Supabase).
grant create on schema private to membership_guard;
alter function private.end_member_sessions() owner to membership_guard;
alter function private.check_privileged_deactivation() owner to membership_guard;
alter function private.reactivate_membership(uuid) owner to membership_guard;
revoke create on schema private from membership_guard;

revoke all on function private.reactivate_membership(uuid) from public;
-- Called inside `set local role authenticated` transactions (withUserTx); the function checks the LOGIN
-- role (session_user) and the claims itself.
grant execute on function private.reactivate_membership(uuid) to authenticated;
