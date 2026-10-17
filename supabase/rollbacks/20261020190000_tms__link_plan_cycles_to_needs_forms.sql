-- Rollback of 20261020190000_tms__link_plan_cycles_to_needs_forms.sql: the guard of 20261020150200 again.
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
        if old.deadline_on < v_today then
          raise exception 'the deadline of this planning cycle has passed' using errcode = 'JK004';
        end if;
        if new.deadline_on <= old.deadline_on then
          raise exception 'the deadline of an open planning cycle can only move later' using errcode = 'JK004';
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

comment on function private.plan_cycles_guard() is
  'SECURITY-RELEVANT (EP-PLN). State model of a planning cycle: draft edits, launch checks, deadline extension, closing.';

revoke all on function private.plan_cycles_guard() from public;

comment on column tms.plan_cycles.needs_form_id is null;
alter table tms.plan_cycles drop constraint plan_cycles_needs_form_fkey;
drop index tms.plan_cycles_tenant_needs_form_idx;
