-- Levels of an organization's structure (FR-ADM-05, BRD v3.2; T-M3-02; business flow
-- docs/business-flows/EP-ORG-organization-structure.md, agreed by the PO 17 Oct 2026: "each tenant customizes
-- their own hierarchy"). ADR 0002 §6 pattern. Class: T [std]. PII: none (level names written by HR).
--
--   platform.structure_levels  the ordered levels of ONE organization: ordinal 1..10 (1 = top), an English and
--                              an Arabic name (each unique in the organization, case-insensitive). A unit of the
--                              structure (platform.departments) at depth n belongs to level n: it always sits
--                              directly under a unit of the level above (no skipping) and the last level has no
--                              units under it (enforced on platform.departments by 20261020090200).
--
-- Rules (BR-ORG-a/b; the application checks them first, packages/platform-rbac iam/structure.ts):
--   * a new organization starts with ONE level, Department / «إدارة» (trigger on platform.tenants; existing
--     organizations: 20261020090100);
--   * a level is added at the bottom only (ordinal = last + 1, at most 10);
--   * a level is renamed at any time (names only: its place never changes);
--   * only the LAST level is removed, never the only one, and only when no live unit sits at it (JO002, with
--     the number of units in the message);
--   * writes need platform.org.manage organization-wide (the HR Manager; PO 11 Oct 2026, T-M2-19) — checked by
--     the actions (defineAction) and repeated here in the write policies (defence in depth). System jobs never
--     change levels. Platform operations (provisioning, migrations) are not subject to the permission.
-- Level changes are serialised with every hierarchy change of the organization: the same transaction-level
-- advisory lock as private.check_tree on platform.departments ('platform.departments:' || tenant), so a unit
-- can never be placed at a level that is being removed (READ COMMITTED, as the application uses).
-- Audit: the actions write platform.org.level_added / level_renamed / level_removed (before/after names).

create table platform.structure_levels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant_id() references platform.tenants (id),
  ordinal smallint not null,
  name_en text not null,
  name_ar text not null,
  -- [std]
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  unique (tenant_id, id),
  unique (tenant_id, ordinal),
  constraint structure_levels_ordinal_check check (ordinal between 1 and 10),
  constraint structure_levels_name_en_check check (
    name_en = btrim(name_en) and char_length(name_en) between 1 and 60 and private.has_visible_text(name_en)),
  constraint structure_levels_name_ar_check check (
    name_ar = btrim(name_ar) and char_length(name_ar) between 1 and 60 and private.has_visible_text(name_ar))
);
comment on table platform.structure_levels is
  'Ordered levels of an organization''s structure (FR-ADM-05, EP-ORG). Owner: platform. Class: T [std].';
comment on column platform.structure_levels.ordinal is
  '1 = the top level; a unit at depth n of the tree belongs to level n (platform.departments.level_ordinal).';

create unique index structure_levels_tenant_name_en_uq on platform.structure_levels (tenant_id, lower(name_en));
create unique index structure_levels_tenant_name_ar_uq on platform.structure_levels (tenant_id, lower(name_ar));

-- Who may change the levels: platform.org.manage organization-wide, signed-in member (user claims).
create or replace function private.actor_may_manage_structure(p_tenant_id uuid)
returns boolean
language sql stable
set search_path = ''
as $$
  select private.request_claims() ->> 'role' = 'authenticated'
         and private.member_has_permission(p_tenant_id, private.request_user_id(), 'platform.org.manage');
$$;

comment on function private.actor_may_manage_structure(uuid) is
  'SECURITY-RELEVANT (FR-ADM-05, EP-ORG). A signed-in member holding platform.org.manage organization-wide (the HR Manager).';

revoke all on function private.actor_may_manage_structure(uuid) from public;
grant execute on function private.actor_may_manage_structure(uuid) to authenticated;

-- The level rules (every writer, platform operations included) and the [std] stamps.
create or replace function private.check_structure_level()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_row platform.structure_levels := case when tg_op = 'DELETE' then old else new end;
  v_last smallint;
  v_used bigint;
  v_person uuid;
begin
  if current_user = 'authenticated' and v_row.tenant_id is distinct from private.current_tenant_id() then
    return v_row;  -- another organization's row: the restrictive tenant_isolation policy rejects it
  end if;
  -- Same lock as the hierarchy changes of the organization's units (private.check_tree).
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('platform.departments:' || v_row.tenant_id::text, 0));
  -- Only user claims stamp a person (other roles, e.g. the console's platform_admin_guard, never ask).
  if current_user = 'authenticated' then
    v_person := private.request_person_id();
  end if;
  select max(l.ordinal) into v_last from platform.structure_levels l where l.tenant_id = v_row.tenant_id;

  if tg_op = 'INSERT' then
    if new.ordinal is distinct from coalesce(v_last, 0) + 1 then
      raise exception 'a level is added below the last level (level %)', coalesce(v_last, 0) + 1
        using errcode = 'check_violation', constraint = 'structure_levels_ordinal_check';
    end if;
    new.created_at := now();
    new.created_by := v_person;
    new.updated_at := new.created_at;
    new.updated_by := v_person;
    new.version := 1;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if (new.id, new.tenant_id, new.ordinal) is distinct from (old.id, old.tenant_id, old.ordinal) then
      raise exception 'the place of a level cannot change (rename it instead)' using errcode = 'check_violation';
    end if;
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.updated_at := now();
    new.updated_by := v_person;
    new.version := old.version + 1;
    return new;
  end if;

  -- DELETE: the last level only, never the only one, and only while no live unit sits at it. A unit's level is
  -- its depth in the tree (live units only: a live unit never sits under a deleted one, private.check_tree).
  if old.ordinal = 1 then
    raise exception 'an organization keeps at least one level' using errcode = 'check_violation';
  end if;
  if old.ordinal is distinct from v_last then
    raise exception 'only the last level can be removed' using errcode = 'check_violation';
  end if;
  with recursive tree (id, depth) as (
    select d.id, 1 from platform.departments d
    where d.tenant_id = old.tenant_id and d.parent_id is null and d.deleted_at is null
    union all
    select c.id, t.depth + 1 from tree t
    join platform.departments c on c.tenant_id = old.tenant_id and c.parent_id = t.id and c.deleted_at is null
    where t.depth < 20
  )
  select count(*) into v_used from tree where depth >= old.ordinal;
  if v_used > 0 then
    raise exception 'the level is still used by % unit(s)', v_used using errcode = 'JO002';
  end if;
  return old;
end
$$;

comment on function private.check_structure_level() is
  'SECURITY-RELEVANT (FR-ADM-05, EP-ORG). Levels: added at the bottom, renamed only, the last one removed only when unused; [std] stamps. Serialised with the tree (advisory lock).';

revoke all on function private.check_structure_level() from public;

create trigger structure_levels_guard before insert or update or delete on platform.structure_levels
  for each row execute function private.check_structure_level();

-- Every new organization starts with one level, Department / «إدارة» (PO, 17 Oct 2026). Provisioning is a
-- platform operation (scripts/sql/provision-tenant.sql) or the Super Admin console (platform_admin_guard).
create or replace function private.create_structure_levels()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into platform.structure_levels (tenant_id, ordinal, name_en, name_ar)
  values (new.id, 1, 'Department', 'إدارة');
  return new;
end
$$;

comment on function private.create_structure_levels() is
  'Creates the default structure level of a new organization: Department / إدارة (FR-ADM-05, EP-ORG).';

revoke all on function private.create_structure_levels() from public;

create trigger tenants_structure_levels after insert on platform.tenants
  for each row execute function private.create_structure_levels();

alter table platform.structure_levels enable row level security;
alter table platform.structure_levels force row level security;

create policy tenant_isolation on platform.structure_levels
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
-- Every member reads the levels (unit labels on pages that show the structure; platform.org.read in the app).
create policy structure_levels_read on platform.structure_levels for select to authenticated using (true);
-- Writes: platform.org.manage organization-wide (defence in depth; the actions check it first).
create policy structure_levels_insert on platform.structure_levels for insert to authenticated
  with check (private.actor_may_manage_structure(tenant_id));
create policy structure_levels_update on platform.structure_levels for update to authenticated
  using (private.actor_may_manage_structure(tenant_id))
  with check (private.actor_may_manage_structure(tenant_id));
create policy structure_levels_delete on platform.structure_levels for delete to authenticated
  using (private.actor_may_manage_structure(tenant_id));
-- The Super Admin console creates organizations (20261018100000): the tenant trigger adds level 1.
create policy structure_levels_platform_admin_guard_read on platform.structure_levels for select
  to platform_admin_guard using (true);
create policy structure_levels_platform_admin_guard_insert on platform.structure_levels for insert
  to platform_admin_guard with check (ordinal = 1);

revoke all on platform.structure_levels from public, anon;
grant select, delete on platform.structure_levels to authenticated;
grant insert (tenant_id, ordinal, name_en, name_ar) on platform.structure_levels to authenticated;
grant update (name_en, name_ar) on platform.structure_levels to authenticated;
grant select (tenant_id, ordinal) on platform.structure_levels to platform_admin_guard;
grant insert (tenant_id, ordinal, name_en, name_ar) on platform.structure_levels to platform_admin_guard;
