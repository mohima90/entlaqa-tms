-- Rollback of 20261115100200_tms__create_training_plans.sql: the plan's tables go (with their data), with their
-- guards and helpers. The cluster-wide role training_plan_guard is kept (roles are not per database; a later
-- migration re-checks its attributes).

drop table tms.plan_budget_reasons;
drop table tms.plan_line_needs;
drop table tms.plan_lines;
drop table tms.training_plans;

drop function private.plan_budget_reasons_guard();
drop function private.plan_line_needs_guard();
drop function private.plan_lines_guard();
drop function private.training_plan_editable(uuid, uuid);
drop function private.training_plans_guard();
drop function private.training_plan_status(uuid, uuid);
drop function private.plan_cycle_consolidating(uuid, uuid);
drop function private.plan_line_departments(uuid);

revoke execute on function private.current_tenant_id() from training_plan_guard;
revoke execute on function private.request_claims() from training_plan_guard;
revoke usage on schema private, tms from training_plan_guard;

alter table tms.plan_needs drop constraint plan_needs_cycle_department_uq;
