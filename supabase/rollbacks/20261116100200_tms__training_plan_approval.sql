-- Rollback of 20261116100200_tms__training_plan_approval.sql: the history, versions and departments' results go
-- (with their data), the plan's approval columns go and its guard is the one of 20261115100200 again (a plan's
-- state no longer moves). A plan in approval or approved stays in that state, frozen. The cluster-wide role
-- plan_approval_guard is kept (roles are not per database; a later migration re-checks its attributes).

drop trigger training_plans_record on tms.training_plans;
drop table tms.training_plan_department_results;
drop table tms.training_plan_versions;
drop table tms.training_plan_events;
drop function private.training_plans_record();
drop function private.training_plan_version_lines(uuid, uuid);

drop policy training_plans_update on tms.training_plans;
revoke update (status, send_back_comment) on tms.training_plans from authenticated;

drop policy plan_lines_plan_approval_guard_read on tms.plan_lines;
drop policy plan_line_needs_plan_approval_guard_read on tms.plan_line_needs;
drop policy plan_budget_reasons_plan_approval_guard_read on tms.plan_budget_reasons;
drop policy plan_cycle_departments_plan_approval_guard_read on tms.plan_cycle_departments;
drop policy plan_cycles_plan_approval_guard_read on tms.plan_cycles;
revoke select (tenant_id, id, plan_id, title, course_id, delivery_type, category, quarter, min_per_session,
               max_per_session, cost_per_session, cost_per_person, duration_hours, status, left_out_reason, sort_order)
  on tms.plan_lines from plan_approval_guard;
revoke select (tenant_id, plan_id, line_id, department_id, seats, named) on tms.plan_line_needs from plan_approval_guard;
revoke select (tenant_id, plan_id, department_id, reason) on tms.plan_budget_reasons from plan_approval_guard;
revoke select (tenant_id, cycle_id, department_id, budget_amount) on tms.plan_cycle_departments from plan_approval_guard;
revoke select (tenant_id, id, currency) on tms.plan_cycles from plan_approval_guard;
revoke usage on schema private, tms from plan_approval_guard;

create or replace function private.training_plans_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_cycle tms.plan_cycles%rowtype;
  v_today date;
begin
  if tg_op = 'INSERT' then
    select * into v_cycle from tms.plan_cycles c where c.tenant_id = new.tenant_id and c.id = new.cycle_id;
    if v_cycle.id is null then
      return new;
    end if;
    if v_cycle.status <> 'closed' then
      raise exception 'the training plan is built once the needs of the cycle are closed' using errcode = 'JK009';
    end if;
    v_today := private.plan_cycle_today(new.tenant_id);
    new.status := 'draft';
    new.plan_version := 1;
    new.opened_at := now();
    new.opened_by := private.request_person_id();
    new.needs_closed_early := v_cycle.deadline_on >= v_today
      or exists (select 1 from tms.plan_cycle_departments d
                 where d.tenant_id = new.tenant_id and d.cycle_id = new.cycle_id and d.deadline_on >= v_today);
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'a training plan is kept' using errcode = 'JK001';
  end if;
  if (new.tenant_id, new.cycle_id, new.status, new.plan_version, new.opened_at, new.opened_by, new.needs_closed_early)
     is distinct from
     (old.tenant_id, old.cycle_id, old.status, old.plan_version, old.opened_at, old.opened_by, old.needs_closed_early) then
    raise exception 'the state of a training plan changes through its approval only' using errcode = 'JK001';
  end if;
  return new;
end
$$;

drop function private.training_plan_submit_problem(uuid, uuid, uuid);
drop function private.may_decide_training_plan(uuid, text);

alter table tms.training_plans
  drop constraint training_plans_approval_step_state_check,
  drop column approval_step,
  drop column finance_step,
  drop column submitted_at,
  drop column submitted_by,
  drop column hr_decided_at,
  drop column hr_decided_by,
  drop column decided_at,
  drop column decided_by,
  drop column send_back_comment,
  drop column approved_at,
  drop column approved_by;
