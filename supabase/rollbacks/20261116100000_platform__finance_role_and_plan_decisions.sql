-- Rollback of 20261116100000_platform__finance_role_and_plan_decisions.sql. Members holding the Finance role lose
-- it and pending invitations giving it go (the catalogue's foreign keys); the HR Manager no longer reads or approves
-- the plan.

delete from platform.role_assignments where role_code = 'finance';
delete from platform.invitations where primary_role = 'finance';
delete from platform.ref_role_permissions
  where role_code = 'finance'
     or permission_code in ('tms.training_plan.approve', 'tms.training_plan.confirm')
     or (role_code = 'hr_manager' and permission_code = 'tms.training_plan.read');
delete from platform.ref_permissions where code in ('tms.training_plan.approve', 'tms.training_plan.confirm');
delete from platform.ref_roles where code = 'finance';
