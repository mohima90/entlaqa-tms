-- The structure's levels are set once; a moved unit keeps its level (WP-HR-01; FR-ADM-05; business flows
-- EP-ORG BR-ORG-b — changed after agreement by the PO 24 Oct 2026 — and EP-ORG-structure-completion.md BR-ORG-i).
-- Class: T. PII: none.
--
--   * Levels locked: as soon as any person is placed in a unit of the organization (a person_employment row with
--     a unit, whoever the person), members add or remove no level (JO004). Renaming stays allowed. (Reordering
--     was never possible: a level's place never changes, 20261020090000.) Platform operations are not concerned.
--   * A unit moves only under a unit of the same level as its current parent, or stays at the top: its level,
--     and so the level of every unit under it, never changes (JO003). To change a unit's level, the HR Manager
--     creates a unit at the other level, moves the people and deactivates the old one.
-- Both are serialised with every hierarchy change (the advisory lock 'platform.departments:' || tenant, which
-- placing a person in a unit takes too: private.check_person_employment).
-- Expand-first: the running application already refuses these before the database (structure.ts) — the levels
-- card hides add / remove once people are placed, and the move dialog offers parents of the right level only.

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

  -- Levels are set once (PO, 24 Oct 2026): no level added or removed once people are placed in units. Members'
  -- changes only: a new organization's first level (the console's platform_admin_guard) and platform operations
  -- are not concerned.
  -- (Nested: the query is planned only for members — platform_admin_guard cannot read placements.)
  if tg_op in ('INSERT', 'DELETE') and current_user = 'authenticated' then
    if exists (select 1 from platform.person_employment e
               where e.tenant_id = v_row.tenant_id and e.department_id is not null) then
      raise exception 'the levels are locked: people are placed in units (rename a level instead)'
        using errcode = 'JO004';
    end if;
  end if;

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
  'SECURITY-RELEVANT (FR-ADM-05, EP-ORG). Levels: added at the bottom, renamed only, the last one removed only when unused; none added or removed once people are placed (JO004, PO 24 Oct 2026); [std] stamps. Serialised with the tree (advisory lock).';

create or replace function private.set_department_level()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_restoring boolean := tg_op = 'UPDATE' and old.deleted_at is not null and new.deleted_at is null;
  v_moving boolean := tg_op = 'UPDATE' and new.parent_id is distinct from old.parent_id;
  v_depth integer := 1;
  v_below integer := 0;
  v_levels integer;
begin
  if not (tg_op = 'INSERT' or v_moving or v_restoring or new.level_ordinal is distinct from old.level_ordinal) then
    return new;  -- names, code, branch, head, status, order: the level stays
  end if;
  if current_user = 'authenticated' and new.tenant_id is distinct from private.current_tenant_id() then
    return new;  -- another organization's row: the restrictive tenant_isolation policy rejects it
  end if;
  if new.parent_id = new.id then
    return new;  -- its own parent: departments_parent_check rejects it (clearer error, tested by name)
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('platform.departments:' || new.tenant_id::text, 0));

  -- Depth = 1 + the number of ancestors (cycles are refused before, by departments_tree).
  if new.parent_id is not null then
    with recursive ancestors (id, parent_id, n) as (
      select d.id, d.parent_id, 1 from platform.departments d
      where d.tenant_id = new.tenant_id and d.id = new.parent_id
      union all
      select d.id, d.parent_id, a.n + 1 from ancestors a
      join platform.departments d on d.tenant_id = new.tenant_id and d.id = a.parent_id
      where a.n < 20
    )
    select coalesce(max(n), 0) + 1 into v_depth from ancestors;
  end if;
  new.level_ordinal := least(v_depth, 11);  -- > 10 is refused by departments_level_ordinal_check

  -- A moved live unit keeps its level (BR-ORG-i, PO 24 Oct 2026): the new parent is at its old parent's level.
  if v_moving and old.deleted_at is null and new.deleted_at is null and old.level_ordinal is not null
     and new.level_ordinal is distinct from old.level_ordinal then
    raise exception 'a unit keeps its level when it moves (level %)', old.level_ordinal using errcode = 'JO003';
  end if;

  if new.deleted_at is not null then
    return new;  -- deleted units keep a level but use none (a restore checks again)
  end if;
  select count(*) into v_levels from platform.structure_levels l where l.tenant_id = new.tenant_id;
  -- The live units under a moved unit move with it (a restored unit has none: no live unit under a deleted one).
  if v_moving then
    with recursive descendants (id, n) as (
      select c.id, 1 from platform.departments c
      where c.tenant_id = new.tenant_id and c.parent_id = new.id and c.deleted_at is null
      union all
      select c.id, s.n + 1 from descendants s
      join platform.departments c on c.tenant_id = new.tenant_id and c.parent_id = s.id and c.deleted_at is null
      where s.n < 20
    )
    select coalesce(max(n), 0) into v_below from descendants;
  end if;
  if v_depth + v_below > v_levels then
    raise exception 'a unit cannot sit below the organization''s last level (level %)', v_levels
      using errcode = 'JO001';
  end if;
  return new;
end
$$;

comment on function private.set_department_level() is
  'SECURITY-RELEVANT (FR-ADM-05, EP-ORG BR-ORG-a, BR-ORG-i). A unit''s level = its depth; never below the organization''s last level (moves count the subtree); a moved live unit keeps its level (JO003). Serialised per organization.';
