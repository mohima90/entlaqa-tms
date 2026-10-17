-- Rollback of 20261020090000_platform__create_structure_levels.sql.
drop trigger tenants_structure_levels on platform.tenants;
drop function private.create_structure_levels();
drop table platform.structure_levels;
drop function private.check_structure_level();
drop function private.actor_may_manage_structure(uuid);
