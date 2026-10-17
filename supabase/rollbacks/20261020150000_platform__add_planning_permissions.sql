-- Rollback of 20261020150000_platform__add_planning_permissions.sql. Custom roles holding a planning
-- permission lose it (rows of platform.custom_role_permissions reference the catalogue).
delete from platform.custom_role_permissions where permission_code in ('tms.plan_cycle.read', 'tms.plan_cycle.manage');
delete from platform.ref_role_permissions where permission_code in ('tms.plan_cycle.read', 'tms.plan_cycle.manage');
delete from platform.ref_permissions where code in ('tms.plan_cycle.read', 'tms.plan_cycle.manage');
