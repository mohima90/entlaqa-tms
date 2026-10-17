-- Rollback of 20261020090200_platform__add_departments_level_ordinal.sql.
drop trigger departments_tree_levels_cascade on platform.departments;
drop trigger departments_tree_levels on platform.departments;
drop function private.cascade_department_level();
drop function private.set_department_level();
drop index platform.departments_tenant_level_idx;
alter table platform.departments drop column level_ordinal;
