-- Data backfill for platform.structure_levels (FR-ADM-05, EP-ORG; separate from the schema change,
-- migration-conventions.md §2): every existing organization gets the default level 1, Department / «إدارة»
-- (PO, 17 Oct 2026), plus as many levels as its deepest existing branch of the tree needs, so no existing unit
-- ends up below the last level (20261020090200 enforces the levels from now on). The extra levels get neutral
-- names, Level n / «المستوى n», that HR renames on Organization → Structure. Organizations created after
-- 20261020090000 already have level 1 (tenant trigger). Runs without user claims (platform operation), under
-- the organization's hierarchy lock (as the level guard takes it).

do $$
declare
  r record;
  v_depth integer;
  v_last integer;
  i integer;
begin
  for r in select t.id from platform.tenants t order by t.id loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('platform.departments:' || r.id::text, 0));
    with recursive tree (id, depth) as (
      select d.id, 1 from platform.departments d where d.tenant_id = r.id and d.parent_id is null
      union all
      select c.id, t.depth + 1 from tree t
      join platform.departments c on c.tenant_id = r.id and c.parent_id = t.id
      where t.depth < 10
    )
    select coalesce(max(depth), 1) into v_depth from tree;
    select coalesce(max(l.ordinal), 0) into v_last from platform.structure_levels l where l.tenant_id = r.id;
    -- One row at a time, in order: the guard adds each level below the last one.
    for i in (v_last + 1)..greatest(v_depth, 1) loop
      insert into platform.structure_levels (tenant_id, ordinal, name_en, name_ar)
      values (r.id, i,
              case when i = 1 then 'Department' else 'Level ' || i end,
              case when i = 1 then 'إدارة' else 'المستوى ' || i end);
    end loop;
  end loop;
end
$$;
