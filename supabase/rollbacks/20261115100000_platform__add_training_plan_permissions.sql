-- Rollback of 20261115100000_platform__add_training_plan_permissions.sql. Custom roles holding them lose them
-- (the catalogue's foreign key from platform.custom_role_permissions).

delete from platform.custom_role_permissions where permission_code in ('tms.training_plan.read', 'tms.training_plan.manage');
delete from platform.ref_role_permissions where permission_code in ('tms.training_plan.read', 'tms.training_plan.manage');
delete from platform.ref_permissions where code in ('tms.training_plan.read', 'tms.training_plan.manage');
