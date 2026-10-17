-- Custom roles (FR-IAM-07, EP-ROLES; PO 17 Oct 2026, option B — business flow
-- docs/business-flows/EP-ROLES-roles-and-custom-roles.md). Class: T [std]. PII: none (role names and
-- descriptions written by the Organization Admin; ids).
--
--   platform.custom_roles             a role of one organization: generated code (custom_ + 12 hex), names
--                                     (Arabic, English — each unique in the organization, case-insensitive),
--                                     description, ONE data scope (own | team | departments | organization).
--   platform.custom_role_permissions  its permissions, from the catalogue only (platform.ref_permissions).
--
-- Rules, repeated here as defence in depth (the application checks them first, packages/platform-rbac
-- custom-roles.ts):
--   * only a member holding platform.role.manage organization-wide (the Organization Admin) creates,
--     changes or deletes custom roles; system jobs never do; platform operations (migrations, support) may;
--   * nobody gives a permission they do not hold organization-wide; platform.role.assign_privileged and
--     platform.role.manage are never part of a custom role; administrative permissions
--     (custom_role_use = organization_only) only in a role whose scope is the whole organization;
--   * a role still held by a member (not revoked), or named by a pending invitation, is not deleted (JR002,
--     with the numbers in the message); rows of revoked memberships go with the role.
-- A custom role with any high-risk permission is privileged (private.role_is_privileged): only the
-- Organization Admin gives it (migration 20261019090200).
--
-- Role codes everywhere (role_assignments.role_code, invitations.primary_role) now name a standard role OR
-- a custom role of the same organization:
--   * role_assignments: the foreign key to ref_roles is replaced by two generated columns —
--     standard_role_code → ref_roles(code), custom_role_code → custom_roles(tenant_id, code) — so every row
--     still points at an existing role and a custom role cannot be deleted while held;
--   * invitations: the foreign key on primary_role is dropped (historical invitations keep the codes of
--     former roles); the lifecycle guard checks new invitations (private.role_is_assignable, 090200).
--
-- Permission helpers (SECURITY INVOKER; the caller's row-level security applies — for `authenticated` the
-- current organization only; the guard roles read through their own policies, as for role_assignments):
--   private.member_permissions(tenant, user)         permission codes held ORGANIZATION-WIDE now: tenant-scope
--                                                    grants of standard roles, and custom-role permissions
--                                                    whose role covers the organization (or that are
--                                                    organization-wide by nature)
--   private.member_has_permission(tenant, user, p)   one of them
--   private.role_is_privileged(tenant, code)         standard: ref_roles.is_privileged; custom: any high-risk
--                                                    permission; unknown: true (fail closed)
--   private.roles_include_privileged(tenant, codes)
--   private.role_is_assignable(tenant, code)         a standard role, or a custom role of the organization
--   private.role_permission_codes(tenant, code)      the permissions a role grants (any scope)
--   private.member_may_give_roles(tenant, user, codes)
--                                                    platform.role.assign_privileged gives every role;
--                                                    otherwise platform.role.assign, no privileged role, and
--                                                    every permission of the roles held organization-wide

-- ---------------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------------
create table platform.custom_roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant_id() references platform.tenants (id),
  code text not null default ('custom_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))
    constraint custom_roles_code_check check (code ~ '^custom_[0-9a-f]{12}$'),
  name_en text not null
    constraint custom_roles_name_en_check check (name_en = btrim(name_en) and char_length(name_en) between 1 and 80),
  name_ar text not null
    constraint custom_roles_name_ar_check check (name_ar = btrim(name_ar) and char_length(name_ar) between 1 and 80),
  description text
    constraint custom_roles_description_check check (description is null or char_length(description) between 1 and 500),
  data_scope text not null
    constraint custom_roles_data_scope_check check (data_scope in ('own', 'team', 'departments', 'organization')),
  -- [std]
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, code)
);
comment on table platform.custom_roles is
  'Custom roles of an organization (FR-IAM-07, EP-ROLES). Owner: platform. Class: T [std].';

create unique index custom_roles_tenant_name_en_uq on platform.custom_roles (tenant_id, lower(name_en));
create unique index custom_roles_tenant_name_ar_uq on platform.custom_roles (tenant_id, lower(name_ar));

create table platform.custom_role_permissions (
  tenant_id uuid not null default private.current_tenant_id() references platform.tenants (id),
  custom_role_id uuid not null,
  permission_code text not null references platform.ref_permissions (code),
  created_at timestamptz not null default now(),
  created_by uuid,
  primary key (tenant_id, custom_role_id, permission_code),
  foreign key (tenant_id, custom_role_id) references platform.custom_roles (tenant_id, id) on delete cascade
);
comment on table platform.custom_role_permissions is
  'Permissions of a custom role (FR-IAM-07, EP-ROLES). Owner: platform. Class: T.';

create index custom_role_permissions_permission_idx on platform.custom_role_permissions (permission_code);

-- ---------------------------------------------------------------------------------------------------
-- Role codes: standard or custom
-- ---------------------------------------------------------------------------------------------------
alter table platform.role_assignments drop constraint role_assignments_role_code_fkey;
alter table platform.role_assignments
  add column standard_role_code text
    generated always as (case when role_code like 'custom\_%' then null else role_code end) stored,
  add column custom_role_code text
    generated always as (case when role_code like 'custom\_%' then role_code end) stored;
alter table platform.role_assignments
  add constraint role_assignments_standard_role_code_fkey
    foreign key (standard_role_code) references platform.ref_roles (code),
  add constraint role_assignments_custom_role_code_fkey
    foreign key (tenant_id, custom_role_code) references platform.custom_roles (tenant_id, code);
create index role_assignments_tenant_custom_role_idx on platform.role_assignments (tenant_id, custom_role_code)
  where custom_role_code is not null;
comment on column platform.role_assignments.role_code is
  'A standard role (ref_roles) or a custom role of the organization (custom_roles.code), through the generated standard_role_code / custom_role_code foreign keys (EP-ROLES).';

alter table platform.invitations drop constraint invitations_primary_role_fkey;
create index invitations_tenant_pending_role_idx on platform.invitations (tenant_id, primary_role)
  where status = 'pending';

-- ---------------------------------------------------------------------------------------------------
-- Permission helpers
-- ---------------------------------------------------------------------------------------------------
create or replace function private.member_permissions(p_tenant_id uuid, p_user_id uuid)
returns text[]
language sql stable
set search_path = ''
as $$
  select coalesce(array_agg(distinct x.code order by x.code), '{}')
  from (
    select rp.permission_code as code
    from platform.role_assignments ra
    join platform.tenant_memberships m on m.tenant_id = ra.tenant_id and m.id = ra.membership_id
    join platform.ref_role_permissions rp on rp.role_code = ra.role_code and rp.scope = 'tenant'
    where ra.tenant_id = p_tenant_id and m.user_id = p_user_id and m.status = 'active'
      and (ra.valid_from is null or ra.valid_from <= now())
      and (ra.valid_until is null or ra.valid_until > now())
    union all
    select crp.permission_code
    from platform.role_assignments ra
    join platform.tenant_memberships m on m.tenant_id = ra.tenant_id and m.id = ra.membership_id
    join platform.custom_roles cr on cr.tenant_id = ra.tenant_id and cr.code = ra.role_code
    join platform.custom_role_permissions crp on crp.tenant_id = cr.tenant_id and crp.custom_role_id = cr.id
    join platform.ref_permissions p on p.code = crp.permission_code
    where ra.tenant_id = p_tenant_id and m.user_id = p_user_id and m.status = 'active'
      and (ra.valid_from is null or ra.valid_from <= now())
      and (ra.valid_until is null or ra.valid_until > now())
      and (p.custom_role_use = 'organization'
           or (cr.data_scope = 'organization' and p.custom_role_use in ('scoped', 'organization_only')))
  ) x;
$$;

comment on function private.member_permissions(uuid, uuid) is
  'SECURITY-RELEVANT (EP-ROLES, ADR 0003 §5). Permissions the user holds organization-wide now in the organization (standard and custom roles).';

create or replace function private.member_has_permission(p_tenant_id uuid, p_user_id uuid, p_permission text)
returns boolean
language sql stable
set search_path = ''
as $$
  select p_user_id is not null and p_permission = any (private.member_permissions(p_tenant_id, p_user_id));
$$;

-- plpgsql: a caller that reads no custom roles (provisioning as platform_admin_guard, standard codes only)
-- never touches the custom-role tables.
create or replace function private.role_is_privileged(p_tenant_id uuid, p_role_code text)
returns boolean
language plpgsql stable
set search_path = ''
as $$
declare
  v_found boolean;
  v_privileged boolean;
begin
  if p_role_code like 'custom\_%' then
    select true, exists (select 1 from platform.custom_role_permissions crp
                         join platform.ref_permissions p on p.code = crp.permission_code
                         where crp.tenant_id = cr.tenant_id and crp.custom_role_id = cr.id and p.risk = 'high')
      into v_found, v_privileged
    from platform.custom_roles cr where cr.tenant_id = p_tenant_id and cr.code = p_role_code;
    return coalesce(v_privileged, true) or not coalesce(v_found, false);
  end if;
  return coalesce((select r.is_privileged from platform.ref_roles r where r.code = p_role_code), true);
end
$$;

create or replace function private.roles_include_privileged(p_tenant_id uuid, p_roles text[])
returns boolean
language sql stable
set search_path = ''
as $$
  select exists (select 1 from unnest(p_roles) r where private.role_is_privileged(p_tenant_id, r));
$$;

create or replace function private.role_is_assignable(p_tenant_id uuid, p_role_code text)
returns boolean
language plpgsql stable
set search_path = ''
as $$
begin
  if p_role_code like 'custom\_%' then
    return exists (select 1 from platform.custom_roles cr where cr.tenant_id = p_tenant_id and cr.code = p_role_code);
  end if;
  return exists (select 1 from platform.ref_roles r where r.code = p_role_code);
end
$$;

create or replace function private.role_permission_codes(p_tenant_id uuid, p_role_code text)
returns text[]
language plpgsql stable
set search_path = ''
as $$
begin
  if p_role_code like 'custom\_%' then
    return coalesce((select array_agg(crp.permission_code order by crp.permission_code)
                     from platform.custom_roles cr
                     join platform.custom_role_permissions crp
                       on crp.tenant_id = cr.tenant_id and crp.custom_role_id = cr.id
                     where cr.tenant_id = p_tenant_id and cr.code = p_role_code), '{}');
  end if;
  return coalesce((select array_agg(rp.permission_code order by rp.permission_code)
                   from platform.ref_role_permissions rp where rp.role_code = p_role_code), '{}');
end
$$;

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

revoke all on function private.member_permissions(uuid, uuid) from public;
revoke all on function private.member_has_permission(uuid, uuid, text) from public;
revoke all on function private.role_is_privileged(uuid, text) from public;
revoke all on function private.roles_include_privileged(uuid, text[]) from public;
revoke all on function private.role_is_assignable(uuid, text) from public;
revoke all on function private.role_permission_codes(uuid, text) from public;
revoke all on function private.member_may_give_roles(uuid, uuid, text[]) from public;
grant execute on function private.member_permissions(uuid, uuid),
                          private.member_has_permission(uuid, uuid, text),
                          private.role_is_privileged(uuid, text),
                          private.roles_include_privileged(uuid, text[]),
                          private.role_is_assignable(uuid, text),
                          private.role_permission_codes(uuid, text),
                          private.member_may_give_roles(uuid, uuid, text[])
  to authenticated;
-- The guard roles get only what their reviewed functions call (20261019090200):
--   invitation_guard   the inviter rule of a link and of acceptance (may still give the invitation's roles)
--   membership_guard   reactivation (platform.user.deactivate; privileged members)
--   tenant_guard       resetting an authenticator app, the people-management rule (privileged members)
--   rate_limit_guard   unlocking a sign-in (platform.user.unlock_sign_in)
--   platform_admin_guard  the console's invitation of an Organization Admin (the lifecycle guard checks the role)
grant execute on function private.member_permissions(uuid, uuid), private.member_has_permission(uuid, uuid, text)
  to invitation_guard, membership_guard, tenant_guard, rate_limit_guard;
grant execute on function private.role_is_privileged(uuid, text)
  to invitation_guard, membership_guard, tenant_guard;
grant execute on function private.roles_include_privileged(uuid, text[]), private.role_permission_codes(uuid, text),
                          private.member_may_give_roles(uuid, uuid, text[])
  to invitation_guard;
grant execute on function private.role_is_assignable(uuid, text) to platform_admin_guard;

-- ---------------------------------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------------------------------
-- The actor of a custom-role change: a signed-in member holding platform.role.manage organization-wide.
-- Platform operations (no user claims) pass; rows of another organization are left to row-level security.
create or replace function private.check_custom_role_actor(p_tenant_id uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_kind text := private.request_claims() ->> 'role';
  v_user uuid := private.request_user_id();
begin
  if current_user <> 'authenticated' then
    return false;  -- platform operation: no actor rules
  end if;
  if p_tenant_id is distinct from private.current_tenant_id() then
    return false;  -- the restrictive tenant_isolation policy rejects it
  end if;
  if v_kind = 'system' then
    raise exception 'system jobs cannot change roles' using errcode = 'insufficient_privilege';
  end if;
  if v_kind is distinct from 'authenticated' or v_user is null then
    raise exception 'unexpected claims for a role change' using errcode = 'insufficient_privilege';
  end if;
  perform private.lock_tenant_roles(p_tenant_id);
  if not private.member_has_permission(p_tenant_id, v_user, 'platform.role.manage') then
    raise exception 'only an Organization Admin can create, change or delete roles'
      using errcode = 'insufficient_privilege';
  end if;
  return true;
end
$$;

revoke all on function private.check_custom_role_actor(uuid) from public;
grant execute on function private.check_custom_role_actor(uuid) to authenticated;

create or replace function private.check_custom_role()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_row platform.custom_roles := case when tg_op = 'DELETE' then old else new end;
  v_members bigint;
  v_invitations bigint;
begin
  if tg_op = 'UPDATE' and (new.id, new.tenant_id, new.code) is distinct from (old.id, old.tenant_id, old.code) then
    raise exception 'the code of a role cannot change' using errcode = 'check_violation';
  end if;
  perform private.check_custom_role_actor(v_row.tenant_id);
  if tg_op = 'INSERT' and current_user = 'authenticated' then
    -- The code is always the database's own (never chosen by the request).
    new.code := 'custom_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  end if;
  if tg_op = 'UPDATE' and new.data_scope <> 'organization' and new.data_scope is distinct from old.data_scope
     and exists (select 1 from platform.custom_role_permissions crp
                 join platform.ref_permissions p on p.code = crp.permission_code
                 where crp.tenant_id = new.tenant_id and crp.custom_role_id = new.id
                   and p.custom_role_use = 'organization_only') then
    raise exception 'administrative permissions need the whole organization as the role''s scope'
      using errcode = 'JR003';
  end if;
  if tg_op = 'DELETE' then
    select count(*) into v_members from platform.role_assignments ra
    join platform.tenant_memberships m on m.tenant_id = ra.tenant_id and m.id = ra.membership_id
    where ra.tenant_id = old.tenant_id and ra.role_code = old.code and m.status <> 'revoked';
    select count(*) into v_invitations from platform.invitations i
    where i.tenant_id = old.tenant_id and i.status = 'pending'
      and (i.primary_role = old.code or old.code = any (i.additional_roles));
    if v_members > 0 or v_invitations > 0 then
      raise exception 'the role is still held: % member(s), % pending invitation(s)', v_members, v_invitations
        using errcode = 'JR002';
    end if;
    -- A revoked membership holds nothing any more: its leftover row goes with the role (history: audit log).
    delete from platform.role_assignments ra
    using platform.tenant_memberships m
    where m.tenant_id = ra.tenant_id and m.id = ra.membership_id
      and ra.tenant_id = old.tenant_id and ra.role_code = old.code and m.status = 'revoked';
    return old;
  end if;
  return new;
end
$$;

comment on function private.check_custom_role() is
  'SECURITY-RELEVANT (FR-IAM-07, EP-ROLES). Who may create, change or delete custom roles; no delete while held.';

revoke all on function private.check_custom_role() from public;

create or replace function private.check_custom_role_permission()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_row platform.custom_role_permissions := case when tg_op = 'DELETE' then old else new end;
  v_use text;
  v_scope text;
begin
  -- Removing a permission never gives anything; a deleted role takes its permissions with it (cascade).
  if not private.check_custom_role_actor(v_row.tenant_id) then
    return v_row;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  select p.custom_role_use into v_use from platform.ref_permissions p where p.code = new.permission_code;
  if v_use is null or v_use = 'none' then
    raise exception 'permission % cannot be part of a custom role', new.permission_code
      using errcode = 'insufficient_privilege';
  end if;
  if not private.member_has_permission(new.tenant_id, private.request_user_id(), new.permission_code) then
    raise exception 'nobody can give a permission they do not hold (%)', new.permission_code
      using errcode = 'insufficient_privilege';
  end if;
  select cr.data_scope into v_scope from platform.custom_roles cr
  where cr.tenant_id = new.tenant_id and cr.id = new.custom_role_id;
  if v_use = 'organization_only' and v_scope is distinct from 'organization' then
    raise exception 'administrative permissions need the whole organization as the role''s scope'
      using errcode = 'JR003';
  end if;
  new.created_at := now();
  new.created_by := private.request_person_id();
  return new;
end
$$;

comment on function private.check_custom_role_permission() is
  'SECURITY-RELEVANT (FR-IAM-07, EP-ROLES). Permissions of custom roles: catalogue only, held by the actor, administrative ones organization-wide only.';

revoke all on function private.check_custom_role_permission() from public;

create trigger custom_roles_guard before insert or update or delete on platform.custom_roles
  for each row execute function private.check_custom_role();
create trigger custom_roles_stamp_row before insert or update on platform.custom_roles
  for each row execute function private.stamp_row();
create trigger custom_role_permissions_guard before insert or delete on platform.custom_role_permissions
  for each row execute function private.check_custom_role_permission();

-- ---------------------------------------------------------------------------------------------------
-- Row-level security and grants
-- ---------------------------------------------------------------------------------------------------
alter table platform.custom_roles enable row level security;
alter table platform.custom_roles force row level security;
create policy tenant_isolation on platform.custom_roles
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
-- Who may write is the guard's decision (platform.role.manage); everyone in the organization reads the
-- roles (names on the team list, the roles page needs platform.role.read in the application).
create policy custom_roles_read on platform.custom_roles for select to authenticated using (true);
create policy custom_roles_insert on platform.custom_roles for insert to authenticated with check (true);
create policy custom_roles_update on platform.custom_roles for update to authenticated using (true) with check (true);
create policy custom_roles_delete on platform.custom_roles for delete to authenticated using (true);
create policy custom_roles_guard_read on platform.custom_roles for select
  to invitation_guard, membership_guard, tenant_guard using (true);
-- The sign-in lock functions act for the caller's organization only (pattern of role_assignments).
create policy custom_roles_rate_limit_guard_read on platform.custom_roles for select to rate_limit_guard
  using (tenant_id = (select private.current_tenant_id()));
revoke all on platform.custom_roles from public, anon;
grant select, delete on platform.custom_roles to authenticated;
grant insert (id, tenant_id, name_en, name_ar, description, data_scope) on platform.custom_roles to authenticated;
grant update (name_en, name_ar, description, data_scope) on platform.custom_roles to authenticated;
grant select (tenant_id, id, code, data_scope) on platform.custom_roles
  to invitation_guard, membership_guard, tenant_guard, rate_limit_guard;

alter table platform.custom_role_permissions enable row level security;
alter table platform.custom_role_permissions force row level security;
create policy tenant_isolation on platform.custom_role_permissions
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
create policy custom_role_permissions_read on platform.custom_role_permissions for select to authenticated using (true);
create policy custom_role_permissions_insert on platform.custom_role_permissions for insert to authenticated with check (true);
create policy custom_role_permissions_delete on platform.custom_role_permissions for delete to authenticated using (true);
create policy custom_role_permissions_guard_read on platform.custom_role_permissions for select
  to invitation_guard, membership_guard, tenant_guard using (true);
-- The sign-in lock functions act for the caller's organization only (pattern of role_assignments).
create policy custom_role_permissions_rate_limit_guard_read on platform.custom_role_permissions for select to rate_limit_guard
  using (tenant_id = (select private.current_tenant_id()));
revoke all on platform.custom_role_permissions from public, anon;
grant select, delete on platform.custom_role_permissions to authenticated;
grant insert (tenant_id, custom_role_id, permission_code) on platform.custom_role_permissions to authenticated;
grant select (tenant_id, custom_role_id, permission_code) on platform.custom_role_permissions
  to invitation_guard, membership_guard, tenant_guard, rate_limit_guard;

