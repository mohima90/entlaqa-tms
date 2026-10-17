-- Planning cycles use the needs forms library (T-M3-04 × T-M3-10; FR-PLN-02, FR-PLN-03; business flow
-- docs/business-flows/EP-PLN-planning-cycle.md §12). Class: T (constraint and guard on tms.plan_cycles).
-- PII: none. Expand-first: the application that does not know about forms keeps working (a new cycle gets the
-- default form here; the launch locks it here).
--
--   * tms.plan_cycles.needs_form_id → tms.needs_forms (composite with the organization, like every tms
--     reference): a cycle never points at another organization's form, and a form a cycle uses (draft or
--     launched) cannot be deleted (23503 plan_cycles_needs_form_fkey);
--   * a new cycle without a chosen form gets the organization's default form (private.plan_cycles_guard on
--     insert);
--   * launch (draft → open) needs a form (JK003 «no_needs_form») and locks it in the same transaction
--     (private.lock_needs_form, migration 20261020180200) — the database path, so no writer can launch
--     without the lock.

create index plan_cycles_tenant_needs_form_idx on tms.plan_cycles (tenant_id, needs_form_id)
  where needs_form_id is not null;

alter table tms.plan_cycles
  add constraint plan_cycles_needs_form_fkey
  foreign key (tenant_id, needs_form_id) references tms.needs_forms (tenant_id, id);

comment on column tms.plan_cycles.needs_form_id is
  'The needs form department heads fill in (tms.needs_forms; the organization''s default when none is chosen); locked at launch.';

-- State guard of 20261020150200 with the needs form: default on insert, required and locked at launch.
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
  'SECURITY-RELEVANT (EP-PLN, T-M3-10). State model of a planning cycle: draft edits (default needs form on insert), launch checks and the needs form''s lock, deadline extension, closing.';

revoke all on function private.plan_cycles_guard() from public;
