-- The level of each unit of the structure (FR-ADM-05, BRD v3.2; T-M3-02; business flow
-- docs/business-flows/EP-ORG-organization-structure.md, BR-ORG-a). Class: T. PII: none.
--
--   platform.departments.level_ordinal  the unit's level (platform.structure_levels.ordinal) = its depth in the
--                                       tree (1 = a top unit). Always computed by the database from the unit's
--                                       ancestors — never taken from the request — on insert, on a move (parent
--                                       changes), on a restore, and when it is rewritten (a move of an ancestor
--                                       cascades to the units below, AFTER trigger). Existing rows:
--                                       20261020090300 (nullable until then; expand-first: the running
--                                       application never writes it).
-- Rules (every writer, platform operations included; the application checks them first):
--   * a live unit sits directly under a unit of the level above (true by construction: level = depth), and never
--     below the organization's last level — a move or a restore counts the levels below the moved unit too
--     (JO001, "a unit cannot sit below the last level"); so the last level has no units under it;
--   * a level that a live unit uses cannot be removed (platform.structure_levels guard, 20261020090000).
-- Serialised with the level changes and every other hierarchy change of the organization: the advisory lock of
-- private.check_tree ('platform.departments:' || tenant), READ COMMITTED.
-- SECURITY INVOKER (the caller's row-level security: its own organization's rows; read policies are
-- organization-wide — if they are ever narrowed, move this to a definer function like private.check_tree).

alter table platform.departments
  add column level_ordinal smallint
    constraint departments_level_ordinal_check check (level_ordinal between 1 and 10);
comment on column platform.departments.level_ordinal is
  'The unit''s level (platform.structure_levels.ordinal) = its depth in the tree. Computed by the database (private.set_department_level); never written by the application.';

create index departments_tenant_level_idx on platform.departments (tenant_id, level_ordinal)
  where deleted_at is null;

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
  'SECURITY-RELEVANT (FR-ADM-05, EP-ORG BR-ORG-a). A unit''s level = its depth; never below the organization''s last level (moves count the subtree). Serialised per organization.';

revoke all on function private.set_department_level() from public;

-- A move changes the level of every unit below: rewrite the children's level (each recomputes its own from
-- its ancestors, then cascades to its children).
create or replace function private.cascade_department_level()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update platform.departments c
  set level_ordinal = new.level_ordinal + 1
  where c.tenant_id = new.tenant_id and c.parent_id = new.id
    and c.level_ordinal is distinct from new.level_ordinal + 1;
  return null;
end
$$;

comment on function private.cascade_department_level() is
  'Moves the level of the units below a unit whose level changed (FR-ADM-05, EP-ORG BR-ORG-e).';

revoke all on function private.cascade_department_level() from public;

-- Triggers fire in name order: after departments_tree (cycles, at most 10 levels), before the references check.
create trigger departments_tree_levels before insert or update on platform.departments
  for each row execute function private.set_department_level();
-- (Not `update of level_ordinal`: a move sets the level in the BEFORE trigger, not in the statement.)
create trigger departments_tree_levels_cascade after update on platform.departments
  for each row when (old.level_ordinal is distinct from new.level_ordinal)
  execute function private.cascade_department_level();
