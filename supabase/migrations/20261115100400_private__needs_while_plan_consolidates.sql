-- Needs while the training plan is consolidated, and «Close needs now» (WP-LD-02, T-M3-06; FR-PLN-05; business flow
-- docs/business-flows/EP-PLN-planning-cycle.md §3 D10, D14 and §6 (b); proposal
-- docs/product/proposals/wp-ld-02-03-consolidation-approval.md, Q1 = A, 14 Nov 2026). Class: state rules (functions
-- only; no table, column or data change). PII: none.
--
--   private.plan_cycles_guard            an open cycle also closes BEFORE its deadline when the L&D Manager
--                                        (tms.plan_cycle.manage) closes it and every department in scope has
--                                        submitted («Close needs now»; the departments' rows are locked first, so a
--                                        head's recall in flight is not missed). Otherwise as 20261112110000.
--   private.plan_cycle_department_guard  while a draft training plan is open for the closed cycle
--                                        (private.plan_cycle_consolidating, migration 20261115100200) the L&D Manager
--                                        may return a submitted department for changes — with a note AND a deadline
--                                        of its own, today or later — or reopen a department with such a deadline;
--                                        its head changes and resubmits until that deadline; a recall is no longer
--                                        possible. Otherwise as 20261105100100.
--   private.plan_needs_entry_open        needs entry is also open for such a department until its own deadline
--                                        (never for a submitted one).
-- What a resubmitted department changed reaches the plan when L&D adds it (the application; nothing moves on its own).
-- Expand-first: the previous release never opens a plan, so nothing it does changes.

create or replace function private.plan_cycles_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_today date := private.plan_cycle_today(new.tenant_id);
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'a planning cycle starts as a draft' using errcode = 'JK001';
    end if;
    -- BR-PLN-i: the organization's currency (General settings), one currency in R1.
    new.currency := coalesce((select s.currency_code from platform.tenant_settings s where s.tenant_id = new.tenant_id),
                             'SAR');
    new.launched_at := null;
    new.launched_by := null;
    new.closed_at := null;
    -- T-M3-10: a new cycle starts with the organization's default needs form unless one is chosen.
    if new.needs_form_id is null then
      new.needs_form_id := (select f.id from tms.needs_forms f where f.tenant_id = new.tenant_id and f.is_default);
    end if;
    return new;
  end if;

  if new.tenant_id is distinct from old.tenant_id or new.currency is distinct from old.currency then
    raise exception 'the organization and currency of a planning cycle cannot change' using errcode = 'JK001';
  end if;

  if old.status = 'draft' then
    if new.status = 'draft' then
      return new;
    end if;
    if new.status <> 'open' then
      raise exception 'a draft planning cycle can only be launched' using errcode = 'JK001';
    end if;
    -- Launch (business flow B5).
    if new.deadline_on < v_today then
      raise exception 'planning cycle not ready to launch: deadline_past' using errcode = 'JK003';
    end if;
    if new.needs_form_id is null then
      raise exception 'planning cycle not ready to launch: no_needs_form' using errcode = 'JK003';
    end if;
    if not exists (select 1 from tms.plan_cycle_departments d where d.tenant_id = new.tenant_id and d.cycle_id = new.id) then
      raise exception 'planning cycle not ready to launch: no_departments' using errcode = 'JK003';
    end if;
    if exists (select 1 from tms.plan_cycles c
               where c.tenant_id = new.tenant_id and c.status = 'open' and c.id <> new.id) then
      raise exception 'another planning cycle of the organization is open' using errcode = 'JK002';
    end if;
    -- T-M3-10: the cycle's needs form is locked for good in the launch's transaction (its sections and fields
    -- stay as the department heads saw them; duplicate it to change it). Unknown to the caller → not ready.
    if not private.lock_needs_form(new.needs_form_id) then
      raise exception 'planning cycle not ready to launch: no_needs_form' using errcode = 'JK003';
    end if;
    new.launched_at := now();
    new.launched_by := private.request_person_id();
    return new;
  end if;

  if old.status = 'open' then
    if (new.name_ar, new.name_en, new.period_start_on, new.period_end_on, new.instructions_ar, new.instructions_en,
        new.reminder_days, new.needs_form_id)
       is distinct from
       (old.name_ar, old.name_en, old.period_start_on, old.period_end_on, old.instructions_ar, old.instructions_en,
        old.reminder_days, old.needs_form_id) then
      raise exception 'only the deadline of an open planning cycle can change' using errcode = 'JK001';
    end if;
    if new.status = 'open' then
      if new.deadline_on is distinct from old.deadline_on then
        -- C-7 (business flow §6 (a)): also after the deadline has passed, while the cycle is still open in
        -- the database (shown as Closed by date, not closed yet); it is then Open again until the new date.
        if new.deadline_on <= old.deadline_on then
          raise exception 'the deadline of an open planning cycle can only move later' using errcode = 'JK004';
        end if;
        if new.deadline_on < v_today then
          raise exception 'the new deadline of a planning cycle is today or later' using errcode = 'JK004';
        end if;
      end if;
      return new;
    end if;
    if new.status = 'closed' then
      if new.deadline_on is distinct from old.deadline_on then
        raise exception 'an open planning cycle closes once every deadline has passed' using errcode = 'JK001';
      end if;
      -- WP-LD-01 (PO decision Q3, 27 Oct 2026): also every department's own extension must have passed.
      if old.deadline_on < v_today
         and not exists (select 1 from tms.plan_cycle_departments d
                         where d.tenant_id = new.tenant_id and d.cycle_id = new.id and d.deadline_on >= v_today) then
        new.closed_at := now();
        return new;
      end if;
      -- «Close needs now» (WP-LD-02, PO decision Q1 = A, 14 Nov 2026): the L&D Manager closes the needs before the
      -- deadline once every department in scope has submitted. The departments' rows are locked first, so a head's
      -- recall still in flight is waited for and then seen (each statement below reads anew) — and a recall that
      -- comes later waits for this close and then finds the needs closed.
      if private.may_manage_plan_cycles(new.tenant_id) then
        perform 1 from tms.plan_cycle_departments d where d.tenant_id = new.tenant_id and d.cycle_id = new.id
          for update;
        if exists (select 1 from tms.plan_cycle_departments d where d.tenant_id = new.tenant_id and d.cycle_id = new.id)
           and not exists (select 1 from tms.plan_cycle_departments d
                           where d.tenant_id = new.tenant_id and d.cycle_id = new.id and d.status <> 'submitted') then
          new.closed_at := now();
          return new;
        end if;
      end if;
      raise exception 'an open planning cycle closes once every deadline has passed, or earlier once every department has submitted'
        using errcode = 'JK001';
    end if;
    raise exception 'an open planning cycle can only be extended or closed' using errcode = 'JK001';
  end if;

  raise exception 'this planning cycle can no longer change' using errcode = 'JK001';
end
$$;

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

create or replace function private.plan_needs_entry_open(p_tenant_id uuid, p_cycle_id uuid, p_department_id uuid)
returns boolean
language sql stable
set search_path = ''
as $$
  select exists (
    select 1 from tms.plan_cycles c
    where c.tenant_id = p_tenant_id and c.id = p_cycle_id and c.status = 'open'
      and private.plan_cycle_today(p_tenant_id) <= private.plan_department_deadline(p_tenant_id, p_cycle_id, p_department_id))
  or exists (
    -- WP-LD-02: a department returned for changes, or reopened, while the plan is consolidated — until its own deadline.
    -- A submitted department is not open (no recall once the needs are closed), whatever its deadline: an extension
    -- given before «Close needs now» does not reopen it.
    select 1 from tms.plan_cycles c
    join tms.plan_cycle_departments d on d.tenant_id = c.tenant_id and d.cycle_id = c.id
    where c.tenant_id = p_tenant_id and c.id = p_cycle_id and c.status = 'closed'
      and d.department_id = p_department_id and d.status <> 'submitted'
      and d.deadline_on >= private.plan_cycle_today(p_tenant_id)
      and private.plan_cycle_consolidating(p_tenant_id, p_cycle_id));
$$;
