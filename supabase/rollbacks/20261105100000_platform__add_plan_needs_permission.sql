-- Rollback of 20261105100000_platform__add_plan_needs_permission.sql.

delete from platform.ref_role_permissions where permission_code = 'tms.plan_needs.submit';
delete from platform.ref_permissions where code = 'tms.plan_needs.submit';
