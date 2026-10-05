-- Roles held by a member of an organization (FR-IAM-07, BR-IAM-1, T-M2-03): one primary role plus any
-- additional roles; effective permissions are the union (computed in code from
-- packages/platform-rbac/src/system-roles.ts — ADR 0003 §3). Data scopes are fixed per system role in
-- R1 (configurable scopes and their targets are R2, FR-IAM-08). Class: T [std]. PII: none (ids).
--
-- The application checks who may give which role (platform.role.assign / assign_privileged, ADR 0003
-- §5). The database repeats the essential rules as defence in depth (TM-0003 T-IAM-35/38):
--   * nobody changes the roles of their own membership;
--   * privileged roles (ref_roles.is_privileged) only by an active Organization Admin (tenant_admin);
--     other roles only by an Organization Admin or an HR Manager (PO decision 5 Oct 2026);
--   * an organization that has an active Organization Admin always keeps at least one.
-- Platform operations (no user claims: provisioning, migrations, system jobs) are not subject to the
-- actor rules; they are audited separately.

create table platform.role_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant_id() references platform.tenants (id),
  membership_id uuid not null,
  role_code text not null references platform.ref_roles (code),
  is_primary boolean not null default false,
  valid_from timestamptz,
  valid_until timestamptz,
  -- [std]
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, membership_id, role_code),
  constraint role_assignments_validity_check check (valid_until is null or valid_from is null or valid_until > valid_from),
  foreign key (tenant_id, membership_id) references platform.tenant_memberships (tenant_id, id) on delete cascade
);
comment on table platform.role_assignments is
  'Roles of a member (FR-IAM-07, BR-IAM-1). Owner: platform. Class: T [std].';

-- BR-IAM-1: exactly one primary role per member (at most one here; the service requires one).
create unique index role_assignments_tenant_primary_uq on platform.role_assignments (tenant_id, membership_id)
  where is_primary;
create index role_assignments_tenant_role_idx on platform.role_assignments (tenant_id, role_code);

-- The actor's active roles in a tenant (helper for the guard below). SECURITY INVOKER: the caller can
-- read its own tenant's assignments and memberships.
create or replace function private.actor_role_codes(p_tenant_id uuid, p_user_id uuid)
returns text[]
language sql stable
set search_path = ''
as $$
  select coalesce(array_agg(ra.role_code), '{}')
  from platform.role_assignments ra
  join platform.tenant_memberships m on m.tenant_id = ra.tenant_id and m.id = ra.membership_id
  where ra.tenant_id = p_tenant_id and m.user_id = p_user_id and m.status = 'active'
    and (ra.valid_from is null or ra.valid_from <= now())
    and (ra.valid_until is null or ra.valid_until > now());
$$;

revoke all on function private.actor_role_codes(uuid, uuid) from public;
grant execute on function private.actor_role_codes(uuid, uuid) to authenticated;

create or replace function private.check_role_assignment_actor()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_row platform.role_assignments := case when tg_op = 'DELETE' then old else new end;
  v_user uuid := private.request_user_id();
  v_actor_roles text[];
  v_privileged boolean;
  v_status text;
begin
  -- Serialise role changes per tenant (the last-admin rule below reads other rows).
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('platform.role_assignments:' || v_row.tenant_id::text, 0));

  if tg_op = 'INSERT' then
    select m.status into v_status from platform.tenant_memberships m
    where m.tenant_id = v_row.tenant_id and m.id = v_row.membership_id;
    if v_status = 'revoked' then
      raise exception 'roles cannot be given to a revoked membership' using errcode = 'check_violation';
    end if;
  end if;

  if private.request_claims() ->> 'role' is distinct from 'authenticated' or v_user is null then
    return v_row;  -- platform operation (provisioning, migrations, system jobs)
  end if;
  if v_row.tenant_id is distinct from private.current_tenant_id() then
    return v_row;  -- another tenant's row: row-level security rejects it
  end if;

  if exists (select 1 from platform.tenant_memberships m
             where m.tenant_id = v_row.tenant_id and m.id = v_row.membership_id and m.user_id = v_user) then
    raise exception 'members cannot change their own roles' using errcode = 'insufficient_privilege';
  end if;

  v_actor_roles := private.actor_role_codes(v_row.tenant_id, v_user);
  select r.is_privileged into v_privileged from platform.ref_roles r where r.code = v_row.role_code;
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

-- An organization that had an active Organization Admin keeps at least one (T-IAM-38). Checked after
-- removing or limiting a tenant_admin assignment and after a membership stops being active.
create or replace function private.tenant_has_admin(p_tenant_id uuid)
returns boolean
language sql stable
set search_path = ''
as $$
  select exists (
    select 1
    from platform.role_assignments ra
    join platform.tenant_memberships m on m.tenant_id = ra.tenant_id and m.id = ra.membership_id
    where ra.tenant_id = p_tenant_id and ra.role_code = 'tenant_admin' and m.status = 'active'
      and (ra.valid_from is null or ra.valid_from <= now())
      and (ra.valid_until is null or ra.valid_until > now()));
$$;

revoke all on function private.tenant_has_admin(uuid) from public;
grant execute on function private.tenant_has_admin(uuid) to authenticated;

create or replace function private.check_last_admin_assignment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- A membership deleted as a whole (platform operation, e.g. an Auth user deleted) takes its roles
  -- with it (cascade); only removing or limiting the ROLE of a remaining member is checked here.
  if old.role_code = 'tenant_admin'
     and exists (select 1 from platform.tenant_memberships m where m.tenant_id = old.tenant_id and m.id = old.membership_id)
     and not private.tenant_has_admin(old.tenant_id) then
    raise exception 'the organization must keep at least one active Organization Admin'
      using errcode = 'check_violation';
  end if;
  return null;
end
$$;

revoke all on function private.check_last_admin_assignment() from public;

create or replace function private.check_last_admin_membership()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'active' and new.status <> 'active'
     and exists (select 1 from platform.role_assignments ra
                 where ra.tenant_id = new.tenant_id and ra.membership_id = new.id and ra.role_code = 'tenant_admin') then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('platform.role_assignments:' || new.tenant_id::text, 0));
    if not private.tenant_has_admin(new.tenant_id) then
      raise exception 'the organization must keep at least one active Organization Admin'
        using errcode = 'check_violation';
    end if;
  end if;
  return null;
end
$$;

revoke all on function private.check_last_admin_membership() from public;

create trigger role_assignments_guard before insert or update or delete on platform.role_assignments
  for each row execute function private.check_role_assignment_actor();
create trigger role_assignments_stamp_row before insert or update on platform.role_assignments
  for each row execute function private.stamp_row();
create trigger role_assignments_keep_admin after update or delete on platform.role_assignments
  for each row execute function private.check_last_admin_assignment();
create trigger tenant_memberships_keep_admin after update of status on platform.tenant_memberships
  for each row execute function private.check_last_admin_membership();

alter table platform.role_assignments enable row level security;
alter table platform.role_assignments force row level security;

create policy tenant_isolation on platform.role_assignments
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
-- Fine-grained permissions (platform.role.*) are enforced server-side by defineAction (ADR 0003 §4).
create policy role_assignments_read on platform.role_assignments for select to authenticated using (true);
create policy role_assignments_insert on platform.role_assignments for insert to authenticated with check (true);
create policy role_assignments_update on platform.role_assignments for update to authenticated using (true) with check (true);
create policy role_assignments_delete on platform.role_assignments for delete to authenticated using (true);

-- Removing a role is a hard delete (audited by the action, BR-IAM-3). Only the primary flag and the
-- validity window can change; the member and the role of a row are immutable.
revoke all on platform.role_assignments from public, anon;
grant select, insert, delete on platform.role_assignments to authenticated;
grant update (is_primary, valid_from, valid_until) on platform.role_assignments to authenticated;
