-- Rollback of 20261116100000_platform__finance_role_and_plan_decisions.sql. Members holding the Finance role lose
-- it, invitations giving it go (the catalogue's foreign keys) or lose it as an additional role, and an import's
-- default role never names it; the HR Manager no longer reads or approves the plan.

delete from platform.role_assignments where role_code = 'finance';
delete from platform.invitations where primary_role = 'finance';
-- An invitation giving Finance besides its primary role keeps its other roles (review L5); additional roles have
-- no foreign key, so a Finance left there would fail at acceptance. (The lifecycle trigger is off for this update
-- only, as in the rollback of 20261019090100.)
alter table platform.invitations disable trigger invitations_check;
update platform.invitations set additional_roles = array_remove(additional_roles, 'finance')
where 'finance' = any (additional_roles);
alter table platform.invitations enable trigger invitations_check;
-- A user import's default role is never a privileged role (its guard refuses it), so none names Finance; should one
-- ever do, it falls back to Employee (learner) rather than name a role that no longer exists.
alter table platform.user_imports disable trigger user_imports_check;
update platform.user_imports set options = jsonb_set(options, '{defaultRole}', '"learner"')
where options ->> 'defaultRole' = 'finance';
alter table platform.user_imports enable trigger user_imports_check;
delete from platform.ref_role_permissions
  where role_code = 'finance'
     or permission_code in ('tms.training_plan.approve', 'tms.training_plan.confirm')
     or (role_code = 'hr_manager' and permission_code = 'tms.training_plan.read');
delete from platform.ref_permissions where code in ('tms.training_plan.approve', 'tms.training_plan.confirm');
delete from platform.ref_roles where code = 'finance';
