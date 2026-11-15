-- Rollback of 20261116100200_tms__training_plan_approval.sql: the history, versions and departments' results go
-- (with their data), the plan's approval columns go and its guard is the one of 20261115100200 again (a plan's
-- state no longer moves). A plan in approval or approved stays in that state, frozen. The cluster-wide role
-- plan_approval_guard is kept (roles are not per database; a later migration re-checks its attributes). The read
-- policies of the raw needs, the department guard, private.training_plan_editable and the guard's comment are those
-- of 20261115100200…100400 again.

-- Review M1: the approvers' view goes; the raw needs are read as 20261115100300 has it again.
drop view private.training_plan_departments;
revoke select (status, deadline_on, created_at, id) on tms.plan_cycle_departments from plan_approval_guard;

drop policy plan_cycle_departments_read on tms.plan_cycle_departments;
create policy plan_cycle_departments_read on tms.plan_cycle_departments for select to authenticated
  using ((select private.may_read_plan_cycles((select private.current_tenant_id())))
         or (select private.may_read_training_plan((select private.current_tenant_id())))
         or private.may_submit_plan_needs(tenant_id, department_id)
         or department_id = any ((select private.training_plan_units((select private.current_tenant_id()), false))::uuid[]));

drop policy plan_needs_read on tms.plan_needs;
create policy plan_needs_read on tms.plan_needs for select to authenticated
  using ((select private.may_read_plan_cycles((select private.current_tenant_id())))
         or (select private.may_read_training_plan((select private.current_tenant_id())))
         or private.may_submit_plan_needs(tenant_id, department_id)
         or department_id = any ((select private.training_plan_units((select private.current_tenant_id()), false))::uuid[]));

drop policy plan_need_people_read on tms.plan_need_people;
create policy plan_need_people_read on tms.plan_need_people for select to authenticated
  using ((select private.may_read_plan_cycles((select private.current_tenant_id())))
         or (select private.may_read_training_plan((select private.current_tenant_id())))
         or private.may_submit_plan_needs(tenant_id, department_id)
         or department_id = any ((select private.training_plan_units((select private.current_tenant_id()), false))::uuid[]));

-- Review H1: the department guard and the plan's editability as 20261115100400 / 20261115100200 have them.
create or replace function private.plan_cycle_department_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_row record := case when tg_op = 'DELETE' then old else new end;
  v_cycle tms.plan_cycles%rowtype;
  v_today date;
  v_deadline date;
  v_manager boolean;
  v_head boolean;
  v_consolidating boolean;
begin
  select * into v_cycle from tms.plan_cycles c where c.tenant_id = v_row.tenant_id and c.id = v_row.cycle_id;
  if v_cycle.id is null then
    -- No such cycle, or not this organization's: the policies and the composite key refuse the row.
    return v_row;
  end if;
  if tg_op = 'UPDATE' and (new.cycle_id is distinct from old.cycle_id or new.department_id is distinct from old.department_id) then
    raise exception 'a row cannot move to another planning cycle' using errcode = 'JK001';
  end if;

  if v_cycle.status = 'draft' then
    -- Set-up is the L&D Manager's alone (review F1): the head's update policy reaches draft rows too, and the
    -- envelope must never be the head's to change. Platform operations (the owner, no claims) stay possible.
    if current_user = 'authenticated' and not private.may_manage_plan_cycles(v_row.tenant_id) then
      raise exception 'the scope, budget and approval chain of a planning cycle are set up by the L&D Manager'
        using errcode = 'JK001';
    end if;
    if tg_op <> 'DELETE' and (new.status <> 'not_started' or new.submitted_at is not null or new.submitted_by is not null
                              or new.returned_at is not null or new.returned_by is not null or new.return_note is not null
                              or new.deadline_on is not null or new.answers <> '{}'::jsonb) then
      raise exception 'a department''s needs form starts with the launch of the cycle' using errcode = 'JK001';
    end if;
    return v_row;
  end if;

  if tg_op <> 'UPDATE' then
    raise exception 'the scope, budget and approval chain of a planning cycle change only while it is a draft'
      using errcode = 'JK001';
  end if;
  if new.budget_amount is distinct from old.budget_amount then
    raise exception 'the scope, budget and approval chain of a planning cycle change only while it is a draft'
      using errcode = 'JK001';
  end if;

  -- Stamps are never taken from the statement.
  new.submitted_at := old.submitted_at;
  new.submitted_by := old.submitted_by;
  new.returned_at := old.returned_at;
  new.returned_by := old.returned_by;

  v_today := private.plan_cycle_today(new.tenant_id);
  -- The needs are closed and the training plan is being consolidated (WP-LD-02): the L&D Manager may still return a
  -- department for changes or reopen one, each with a deadline of its own — the only deadline that counts then.
  v_consolidating := v_cycle.status = 'closed' and private.plan_cycle_consolidating(new.tenant_id, new.cycle_id);
  v_deadline := case when v_consolidating then old.deadline_on
                     else greatest(v_cycle.deadline_on, coalesce(old.deadline_on, v_cycle.deadline_on)) end;
  v_manager := private.may_manage_plan_cycles(new.tenant_id);
  v_head := private.may_submit_plan_needs(new.tenant_id, new.department_id);

  -- An extension for this department (the L&D Manager; business flow §6, PO decision Q3).
  if new.deadline_on is distinct from old.deadline_on then
    if not v_manager then
      raise exception 'only the L&D Manager extends a department''s deadline' using errcode = 'JK001';
    end if;
    if v_consolidating then
      if new.deadline_on is null or new.deadline_on < v_today or new.deadline_on > v_cycle.period_end_on then
        raise exception 'a department reopened during consolidation gets a deadline from today, within the planning period'
          using errcode = 'JK004';
      end if;
    elsif v_cycle.status <> 'open' then
      raise exception 'the planning cycle is not open' using errcode = 'JK005';
    elsif new.deadline_on is null or new.deadline_on <= v_deadline or new.deadline_on < v_today
       or new.deadline_on > v_cycle.period_end_on then
      raise exception 'a department''s deadline can only move later, not before today, within the planning period'
        using errcode = 'JK004';
    end if;
    v_deadline := new.deadline_on;
  end if;

  if new.status is distinct from old.status then
    if v_cycle.status <> 'open' and not v_consolidating then
      raise exception 'the planning cycle is not open' using errcode = 'JK005';
    end if;
    if old.status = 'submitted' and new.status = 'returned' then
      -- The L&D Manager asks for changes (business flow D14).
      if not v_manager then
        raise exception 'only the L&D Manager returns a submission' using errcode = 'JK001';
      end if;
      if new.return_note is null or new.return_note !~ '[^\s​-‏ ﻿]' then
        raise exception 'returning a submission needs a note for the head' using errcode = 'JK006';
      end if;
      if v_consolidating and (v_deadline is null or v_deadline < v_today) then
        raise exception 'a department returned during consolidation needs its own deadline, today or later'
          using errcode = 'JK004';
      end if;
      new.returned_at := now();
      new.returned_by := private.request_person_id();
      new.submitted_at := null;
      new.submitted_by := null;
    elsif old.status = 'submitted' and new.status = 'draft' then
      -- Recall (business flow C8): the head, before the effective deadline.
      if not v_head then
        raise exception 'only the department''s head recalls its submission' using errcode = 'JK001';
      end if;
      if v_consolidating then
        raise exception 'the needs are closed: the L&D Manager returns a department for changes' using errcode = 'JK005';
      end if;
      if v_today > v_deadline then
        raise exception 'the deadline of this department has passed' using errcode = 'JK005';
      end if;
      new.submitted_at := null;
      new.submitted_by := null;
      new.return_note := old.return_note;
    elsif old.status in ('not_started', 'draft', 'returned') and new.status = 'submitted' then
      if not v_head then
        raise exception 'only the department''s head submits its needs' using errcode = 'JK001';
      end if;
      if v_deadline is null or v_today > v_deadline then
        raise exception 'the deadline of this department has passed' using errcode = 'JK005';
      end if;
      if not exists (select 1 from tms.plan_needs n
                     where n.tenant_id = new.tenant_id and n.cycle_id = new.cycle_id and n.department_id = new.department_id) then
        raise exception 'nothing to submit: add at least one training need' using errcode = 'JK006';
      end if;
      new.submitted_at := now();
      new.submitted_by := private.request_person_id();
      new.returned_at := null;
      new.returned_by := null;
      new.return_note := null;
    elsif old.status = 'not_started' and new.status = 'draft' then
      if not v_head then
        raise exception 'only the department''s head enters its needs' using errcode = 'JK001';
      end if;
      new.return_note := old.return_note;
    else
      raise exception 'this change of a department''s form status is not allowed' using errcode = 'JK001';
    end if;
  elsif new.return_note is distinct from old.return_note then
    raise exception 'the note belongs to the return of a submission' using errcode = 'JK001';
  end if;

  -- Department-level answers: the head, while entry is open and the department is not submitted.
  if new.answers is distinct from old.answers then
    if not v_head then
      raise exception 'only the department''s head enters its needs' using errcode = 'JK001';
    end if;
    if (v_cycle.status <> 'open' and not v_consolidating) or v_deadline is null or v_today > v_deadline
       or new.status = 'submitted' then
      raise exception 'the department''s needs can no longer change' using errcode = 'JK005';
    end if;
    if new.status = 'not_started' then
      new.status := 'draft';
    end if;
  end if;
  return new;
end
$$;

create or replace function private.training_plan_editable(p_tenant_id uuid, p_plan_id uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_status text;
begin
  if current_user = 'authenticated' then
    v_status := private.training_plan_status(p_tenant_id, p_plan_id);
  else
    select p.status into v_status from tms.training_plans p where p.tenant_id = p_tenant_id and p.id = p_plan_id;
  end if;
  if v_status is null then
    raise insufficient_privilege using message = 'the training plan is not known';
  end if;
  if v_status not in ('draft', 'sent_back') then
    raise exception 'the training plan is frozen while it waits for approval and locked once approved'
      using errcode = 'JK008';
  end if;
end
$$;
comment on function private.training_plan_editable(uuid, uuid) is null;

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

comment on function private.training_plans_guard() is
  'SECURITY-RELEVANT (WP-LD-02). A training plan is opened for a closed cycle as a draft; its state changes through its approval only (WP-LD-03).';

drop function private.training_plan_lock(uuid, boolean);
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
