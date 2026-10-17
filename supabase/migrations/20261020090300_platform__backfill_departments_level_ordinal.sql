-- Data backfill for platform.departments.level_ordinal (FR-ADM-05, EP-ORG; separate from the schema change,
-- migration-conventions.md §2): every existing unit, deleted ones included, gets its level = its depth in the
-- tree. The organizations' levels already cover every existing depth (20261020090100). Rows written since
-- 20261020090200 already have theirs (recomputed here the same way). Under a lock that blocks writes to the
-- table meanwhile; the [std] stamps and the level trigger are off for this update only (the value is the
-- database's own; no person changed the units), so versions and "updated" times stay as they were.

lock table platform.departments in share row exclusive mode;

alter table platform.departments disable trigger departments_stamp_row;
alter table platform.departments disable trigger departments_tree_levels;
alter table platform.departments disable trigger departments_tree_levels_cascade;

with recursive tree (tenant_id, id, depth) as (
  select d.tenant_id, d.id, 1 from platform.departments d where d.parent_id is null
  union all
  select c.tenant_id, c.id, t.depth + 1 from tree t
  join platform.departments c on c.tenant_id = t.tenant_id and c.parent_id = t.id
  where t.depth < 10
)
update platform.departments d
set level_ordinal = t.depth
from tree t
where t.tenant_id = d.tenant_id and t.id = d.id and d.level_ordinal is distinct from t.depth;

alter table platform.departments enable trigger departments_stamp_row;
alter table platform.departments enable trigger departments_tree_levels;
alter table platform.departments enable trigger departments_tree_levels_cascade;
