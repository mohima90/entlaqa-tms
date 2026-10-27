-- Rollback of 20261105100100_tms__plan_needs.sql: the needs tables and the submission columns go (with their
-- data), the department guard and the read policies return to 20261020150200 / 20261020210300, and the cycle
-- guard closes a cycle on its own deadline again.

drop table tms.plan_need_people;
drop table tms.plan_needs;

drop policy plan_cycle_departments_head_update on tms.plan_cycle_departments;
revoke update (status, answers, return_note, deadline_on) on tms.plan_cycle_departments from authenticated;

drop policy plan_cycle_departments_read on tms.plan_cycle_departments;
create policy plan_cycle_departments_read on tms.plan_cycle_departments for select to authenticated
  using ((select private.may_read_plan_cycles((select private.current_tenant_id()))));
drop policy plan_cycles_read on tms.plan_cycles;
create policy plan_cycles_read on tms.plan_cycles for select to authenticated
  using ((select private.may_read_plan_cycles((select private.current_tenant_id()))));

drop trigger plan_cycle_departments_guard on tms.plan_cycle_departments;
create trigger plan_cycle_departments_guard before insert or update or delete on tms.plan_cycle_departments
  for each row execute function private.plan_cycle_child_guard();
drop function private.plan_cycle_department_guard();
drop function private.plan_need_people_guard();
drop function private.plan_needs_guard();

alter table tms.plan_cycle_departments
  drop column answers,
  drop column return_note,
  drop column returned_by,
  drop column returned_at,
  drop column submitted_by,
  drop column submitted_at,
  drop column deadline_on;

drop function private.plan_needs_entry_open(uuid, uuid, uuid);
drop function private.plan_department_deadline(uuid, uuid, uuid);
-- The feature map as before WP-LD-01 (migration 20261027100000).
create or replace function private.permission_feature(p_permission text)
returns text
language sql immutable parallel safe
set search_path = ''
as $$
  select case
    when p_permission like 'tms.plan\_cycle.%' then 'planning'
    when p_permission like 'tms.needs\_form.%' then 'needs_forms'
    when p_permission like 'tms.course.%' or p_permission like 'tms.course\_cost.%' then 'courses'
  end;
$$;

drop function private.may_submit_plan_needs(uuid, uuid);
drop function private.plan_department_head(uuid, uuid);

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
    if not exists (select 1 from tms.plan_cycle_steps s
                   where s.tenant_id = new.tenant_id and s.cycle_id = new.id and s.kind = 'person') then
      raise exception 'planning cycle not ready to launch: no_approver_step' using errcode = 'JK003';
    end if;
    if exists (select 1 from tms.plan_cycle_steps s
               where s.tenant_id = new.tenant_id and s.cycle_id = new.id and s.kind = 'person'
                 and s.approver_person_id is null) then
      raise exception 'planning cycle not ready to launch: approver_missing' using errcode = 'JK003';
    end if;
    if exists (select 1 from tms.plan_cycle_steps s
               where s.tenant_id = new.tenant_id and s.cycle_id = new.id and s.approver_person_id is not null
                 and not exists (select 1 from platform.tenant_memberships m
                                 join platform.persons p on p.tenant_id = m.tenant_id and p.id = m.person_id
                                 where m.tenant_id = s.tenant_id and m.person_id = s.approver_person_id
                                   and m.status = 'active' and p.status = 'active')) then
      raise exception 'planning cycle not ready to launch: approver_inactive' using errcode = 'JK003';
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
      if old.deadline_on >= v_today or new.deadline_on is distinct from old.deadline_on then
        raise exception 'an open planning cycle closes once its deadline has passed' using errcode = 'JK001';
      end if;
      new.closed_at := now();
      return new;
    end if;
    raise exception 'an open planning cycle can only be extended or closed' using errcode = 'JK001';
  end if;

  raise exception 'this planning cycle can no longer change' using errcode = 'JK001';
end
$$;
