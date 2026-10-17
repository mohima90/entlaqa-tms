-- Planning cycles (EP-PLN steps B4–B5 and C9; FR-PLN-02, FR-WFL-01/02 R1 part; BACKLOG T-M3-04). The yearly
-- training-needs campaign of BRD Appendix C ("TNA campaign": Draft → Open → Closed → Consolidated → Archived).
-- ADR 0002 §6 pattern. Class: T [std]. PII: approver_person_id, launched_by (person references only); the
-- instructions are written by the L&D Manager for department heads (no personal data expected).
--
--   tms.plan_cycles             the cycle: names (AR/EN), planning period, deadline for department forms,
--                               instructions (AR/EN), reminder days, the organization's currency (copied from
--                               General settings when the cycle is created — BR-PLN-i, one currency in R1),
--                               status and when / by whom it was launched and closed.
--   tms.plan_cycle_scope        what the L&D Manager picked: departments (any level; a unit includes everything
--                               under it) and/or branches (their departments).
--   tms.plan_cycle_departments  one row per department in scope = one needs form (BR-PLN-a: the form belongs to
--                               the department, not to its head); its optional budget envelope (Q2) in the
--                               cycle's currency; its form status (not_started · draft · submitted · returned;
--                               «Late» is shown when the deadline has passed without a submission). The
--                               application computes the rows from the scope and the structure (platform service)
--                               while the cycle is a draft and once more at launch.
--   tms.plan_cycle_steps        the cycle's approval chain, copied from the planning settings: the built-in
--                               Department Heads step (at most one) and named person steps (Finance, management…).
--
-- State model enforced here (private.plan_cycles_guard), the application checks first with clear messages:
--   draft  → editable and deletable freely (with its scope, departments and steps);
--   draft  → open      «Launch»: the deadline is today or later (organization's time zone), at least one
--                      department in scope, at least one person step, every person step names an active
--                      member, and no other cycle of the organization is open (Q1: one open cycle at a time,
--                      also a unique index);
--   open   → open      only the deadline changes, and only to a later date (extend; not after the period end,
--                      not once it has passed);
--   open   → closed    once the deadline has passed (the application closes due cycles — e.g. before another
--                      launch; until then an open cycle past its deadline is shown as Closed);
--   closed and later   no change in this release (consolidation, T-M3-06, adds its transitions).
-- BR-PLN-g: one person cannot be the approver of two steps of the same chain (unique index).
-- Writes need tms.plan_cycle.manage organization-wide (the L&D Manager); reads are within the organization
-- (pages and actions require tms.plan_cycle.read / .manage — ADR 0003 §4). Every launch and change is audited
-- by the server actions (BR-PLN-j).
-- Custom SQLSTATEs: JK001 not allowed in the cycle's state · JK002 another cycle is open · JK003 not ready to
-- launch (message ends with the reason) · JK004 deadline change refused.

-- "Today" for the organization: its time zone (General settings), else its headquarters branch's, else
-- Asia/Riyadh (same order as packages/platform-db ORG_TIME_ZONE).
create or replace function private.plan_cycle_today(p_tenant_id uuid)
returns date
language sql stable
set search_path = ''
as $$
  select (now() at time zone coalesce(
    (select s.timezone from platform.tenant_settings s where s.tenant_id = p_tenant_id),
    (select b.timezone from platform.branches b
     where b.tenant_id = p_tenant_id and b.is_headquarters and b.deleted_at is null
     order by b.created_at limit 1),
    'Asia/Riyadh'))::date;
$$;

comment on function private.plan_cycle_today(uuid) is
  'The calendar day now in the organization''s time zone (EP-PLN deadlines).';

revoke all on function private.plan_cycle_today(uuid) from public;
grant execute on function private.plan_cycle_today(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- tms.plan_cycles
-- ---------------------------------------------------------------------------------------------------
create table tms.plan_cycles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant_id() references platform.tenants (id),
  name_ar text not null
    constraint plan_cycles_name_ar_check check (
      name_ar = btrim(name_ar) and char_length(name_ar) between 1 and 120 and private.has_visible_text(name_ar)),
  name_en text not null
    constraint plan_cycles_name_en_check check (
      name_en = btrim(name_en) and char_length(name_en) between 1 and 120 and private.has_visible_text(name_en)),
  period_start_on date not null,
  period_end_on date not null,
  deadline_on date not null,
  instructions_ar text
    constraint plan_cycles_instructions_ar_check check (
      instructions_ar is null or (char_length(instructions_ar) between 1 and 4000 and private.has_visible_text(instructions_ar))),
  instructions_en text
    constraint plan_cycles_instructions_en_check check (
      instructions_en is null or (char_length(instructions_en) between 1 and 4000 and private.has_visible_text(instructions_en))),
  reminder_days smallint[] not null default '{7,2}'
    constraint plan_cycles_reminder_days_check check (private.plan_reminder_days_valid(reminder_days)),
  -- Set from General settings on insert (private.plan_cycles_guard); never changed afterwards.
  currency char(3) not null default 'SAR'
    constraint plan_cycles_currency_check check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'draft'
    constraint plan_cycles_status_check check (status in ('draft', 'open', 'closed', 'consolidated', 'archived')),
  launched_at timestamptz,
  launched_by uuid,
  closed_at timestamptz,
  -- [std]
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  unique (tenant_id, id),
  -- A planning period of at most two years; the deadline for department forms falls before its end.
  constraint plan_cycles_period_check check (
    period_end_on > period_start_on and period_end_on <= period_start_on + 731),
  constraint plan_cycles_deadline_check check (deadline_on <= period_end_on),
  constraint plan_cycles_launched_check check ((status = 'draft') = (launched_at is null)),
  constraint plan_cycles_closed_check check ((status in ('draft', 'open')) = (closed_at is null)),
  foreign key (tenant_id, launched_by) references platform.persons (tenant_id, id)
);
comment on table tms.plan_cycles is
  'Planning cycles (TNA campaigns) of an organization (EP-PLN, FR-PLN-02; BRD Appendix C). Owner: tms. Class: T [std].';

-- Q1 (PO, 17 Oct 2026): one open cycle at a time per organization.
create unique index plan_cycles_one_open_uq on tms.plan_cycles (tenant_id) where status = 'open';
create index plan_cycles_tenant_status_idx on tms.plan_cycles (tenant_id, status, created_at desc);
create index plan_cycles_tenant_launched_by_idx on tms.plan_cycles (tenant_id, launched_by)
  where launched_by is not null;

-- ---------------------------------------------------------------------------------------------------
-- tms.plan_cycle_scope
-- ---------------------------------------------------------------------------------------------------
create table tms.plan_cycle_scope (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant_id() references platform.tenants (id),
  cycle_id uuid not null,
  department_id uuid,
  branch_id uuid,
  -- [std]
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  unique (tenant_id, id),
  constraint plan_cycle_scope_target_check check (num_nonnulls(department_id, branch_id) = 1),
  foreign key (tenant_id, cycle_id) references tms.plan_cycles (tenant_id, id) on delete cascade,
  foreign key (tenant_id, department_id) references platform.departments (tenant_id, id),
  foreign key (tenant_id, branch_id) references platform.branches (tenant_id, id)
);
comment on table tms.plan_cycle_scope is
  'Departments and branches picked as a planning cycle''s scope (EP-PLN B4). Owner: tms. Class: T [std].';

create unique index plan_cycle_scope_department_uq on tms.plan_cycle_scope (tenant_id, cycle_id, department_id)
  where department_id is not null;
create unique index plan_cycle_scope_branch_uq on tms.plan_cycle_scope (tenant_id, cycle_id, branch_id)
  where branch_id is not null;
create index plan_cycle_scope_tenant_cycle_idx on tms.plan_cycle_scope (tenant_id, cycle_id);
create index plan_cycle_scope_tenant_department_idx on tms.plan_cycle_scope (tenant_id, department_id)
  where department_id is not null;
create index plan_cycle_scope_tenant_branch_idx on tms.plan_cycle_scope (tenant_id, branch_id)
  where branch_id is not null;

-- ---------------------------------------------------------------------------------------------------
-- tms.plan_cycle_departments
-- ---------------------------------------------------------------------------------------------------
create table tms.plan_cycle_departments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant_id() references platform.tenants (id),
  cycle_id uuid not null,
  department_id uuid not null,
  -- Optional budget envelope (Q2) in the cycle's currency (money: data model §1.6).
  budget_amount numeric(19,4)
    constraint plan_cycle_departments_budget_amount_check check (
      budget_amount is null or (budget_amount >= 0 and budget_amount <= 999999999999)),
  status text not null default 'not_started'
    constraint plan_cycle_departments_status_check check (status in ('not_started', 'draft', 'submitted', 'returned')),
  -- [std]
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  unique (tenant_id, id),
  constraint plan_cycle_departments_department_uq unique (tenant_id, cycle_id, department_id),
  foreign key (tenant_id, cycle_id) references tms.plan_cycles (tenant_id, id) on delete cascade,
  foreign key (tenant_id, department_id) references platform.departments (tenant_id, id)
);
comment on table tms.plan_cycle_departments is
  'Departments in a planning cycle''s scope: one needs form each, with its budget envelope (EP-PLN B4, C9; BR-PLN-a). Owner: tms. Class: T [std].';

create index plan_cycle_departments_tenant_department_idx on tms.plan_cycle_departments (tenant_id, department_id);

-- ---------------------------------------------------------------------------------------------------
-- tms.plan_cycle_steps
-- ---------------------------------------------------------------------------------------------------
create table tms.plan_cycle_steps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant_id() references platform.tenants (id),
  cycle_id uuid not null,
  position smallint not null
    constraint plan_cycle_steps_position_check check (position between 1 and 10),
  kind text not null
    constraint plan_cycle_steps_kind_check check (kind in ('department_heads', 'person')),
  name_ar text not null
    constraint plan_cycle_steps_name_ar_check check (
      name_ar = btrim(name_ar) and char_length(name_ar) between 1 and 80 and private.has_visible_text(name_ar)),
  name_en text not null
    constraint plan_cycle_steps_name_en_check check (
      name_en = btrim(name_en) and char_length(name_en) between 1 and 80 and private.has_visible_text(name_en)),
  approver_person_id uuid,
  -- [std]
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  unique (tenant_id, id),
  constraint plan_cycle_steps_position_uq unique (tenant_id, cycle_id, position),
  constraint plan_cycle_steps_approver_check check (kind = 'person' or approver_person_id is null),
  foreign key (tenant_id, cycle_id) references tms.plan_cycles (tenant_id, id) on delete cascade,
  foreign key (tenant_id, approver_person_id) references platform.persons (tenant_id, id)
);
comment on table tms.plan_cycle_steps is
  'Approval chain of a planning cycle (EP-PLN B4; FR-PLN-08, FR-WFL-01/02 R1 part). Owner: tms. Class: T [std].';

create unique index plan_cycle_steps_department_heads_uq on tms.plan_cycle_steps (tenant_id, cycle_id)
  where kind = 'department_heads';
-- BR-PLN-g: one person cannot be the approver of two steps in the same chain.
create unique index plan_cycle_steps_approver_uq on tms.plan_cycle_steps (tenant_id, cycle_id, approver_person_id)
  where approver_person_id is not null;
create index plan_cycle_steps_tenant_approver_idx on tms.plan_cycle_steps (tenant_id, approver_person_id)
  where approver_person_id is not null;

-- ---------------------------------------------------------------------------------------------------
-- State guards (SECURITY INVOKER: the caller's row-level security applies)
-- ---------------------------------------------------------------------------------------------------
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
        new.reminder_days)
       is distinct from
       (old.name_ar, old.name_en, old.period_start_on, old.period_end_on, old.instructions_ar, old.instructions_en,
        old.reminder_days) then
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

-- Scope, departments and steps change only while the cycle is a draft (a cascade from deleting the draft
-- itself finds no cycle row any more and passes).
create or replace function private.plan_cycle_child_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_row record := case when tg_op = 'DELETE' then old else new end;
begin
  if exists (select 1 from tms.plan_cycles c
             where c.tenant_id = v_row.tenant_id and c.id = v_row.cycle_id and c.status <> 'draft') then
    raise exception 'the scope, budget and approval chain of a planning cycle change only while it is a draft'
      using errcode = 'JK001';
  end if;
  if tg_op = 'UPDATE' and new.cycle_id is distinct from old.cycle_id then
    raise exception 'a row cannot move to another planning cycle' using errcode = 'JK001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

comment on function private.plan_cycle_child_guard() is
  'SECURITY-RELEVANT (EP-PLN). Scope, budget envelopes and approval steps of a planning cycle change only in draft.';

revoke all on function private.plan_cycle_child_guard() from public;

-- Triggers fire in name order: *_guard before *_stamp_row.
create trigger plan_cycles_guard before insert or update on tms.plan_cycles
  for each row execute function private.plan_cycles_guard();
create trigger plan_cycles_stamp_row before insert or update on tms.plan_cycles
  for each row execute function private.stamp_row();

create trigger plan_cycle_scope_guard before insert or update or delete on tms.plan_cycle_scope
  for each row execute function private.plan_cycle_child_guard();
create trigger plan_cycle_scope_stamp_row before insert or update on tms.plan_cycle_scope
  for each row execute function private.stamp_row();

create trigger plan_cycle_departments_guard before insert or update or delete on tms.plan_cycle_departments
  for each row execute function private.plan_cycle_child_guard();
create trigger plan_cycle_departments_stamp_row before insert or update on tms.plan_cycle_departments
  for each row execute function private.stamp_row();

create trigger plan_cycle_steps_guard before insert or update or delete on tms.plan_cycle_steps
  for each row execute function private.plan_cycle_child_guard();
create trigger plan_cycle_steps_stamp_row before insert or update on tms.plan_cycle_steps
  for each row execute function private.stamp_row();

-- ---------------------------------------------------------------------------------------------------
-- Row-level security and grants
-- ---------------------------------------------------------------------------------------------------
alter table tms.plan_cycles enable row level security;
alter table tms.plan_cycles force row level security;
create policy tenant_isolation on tms.plan_cycles
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
create policy plan_cycles_read on tms.plan_cycles for select to authenticated using (true);
create policy plan_cycles_insert on tms.plan_cycles for insert to authenticated
  with check (private.may_manage_plan_cycles(tenant_id));
create policy plan_cycles_update on tms.plan_cycles for update to authenticated
  using (private.may_manage_plan_cycles(tenant_id)) with check (private.may_manage_plan_cycles(tenant_id));
-- Only a draft is deleted (a launched cycle is the organization's record of the campaign).
create policy plan_cycles_delete on tms.plan_cycles for delete to authenticated
  using (status = 'draft' and private.may_manage_plan_cycles(tenant_id));
revoke all on tms.plan_cycles from public, anon;
grant select, delete on tms.plan_cycles to authenticated;
grant insert (tenant_id, name_ar, name_en, period_start_on, period_end_on, deadline_on, instructions_ar, instructions_en,
              reminder_days) on tms.plan_cycles to authenticated;
grant update (name_ar, name_en, period_start_on, period_end_on, deadline_on, instructions_ar, instructions_en,
              reminder_days, status) on tms.plan_cycles to authenticated;

alter table tms.plan_cycle_scope enable row level security;
alter table tms.plan_cycle_scope force row level security;
create policy tenant_isolation on tms.plan_cycle_scope
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
create policy plan_cycle_scope_read on tms.plan_cycle_scope for select to authenticated using (true);
create policy plan_cycle_scope_insert on tms.plan_cycle_scope for insert to authenticated
  with check (private.may_manage_plan_cycles(tenant_id));
create policy plan_cycle_scope_delete on tms.plan_cycle_scope for delete to authenticated
  using (private.may_manage_plan_cycles(tenant_id));
revoke all on tms.plan_cycle_scope from public, anon;
grant select, delete on tms.plan_cycle_scope to authenticated;
grant insert (tenant_id, cycle_id, department_id, branch_id) on tms.plan_cycle_scope to authenticated;

alter table tms.plan_cycle_departments enable row level security;
alter table tms.plan_cycle_departments force row level security;
create policy tenant_isolation on tms.plan_cycle_departments
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
create policy plan_cycle_departments_read on tms.plan_cycle_departments for select to authenticated using (true);
create policy plan_cycle_departments_insert on tms.plan_cycle_departments for insert to authenticated
  with check (private.may_manage_plan_cycles(tenant_id));
create policy plan_cycle_departments_update on tms.plan_cycle_departments for update to authenticated
  using (private.may_manage_plan_cycles(tenant_id)) with check (private.may_manage_plan_cycles(tenant_id));
create policy plan_cycle_departments_delete on tms.plan_cycle_departments for delete to authenticated
  using (private.may_manage_plan_cycles(tenant_id));
revoke all on tms.plan_cycle_departments from public, anon;
grant select, delete on tms.plan_cycle_departments to authenticated;
grant insert (tenant_id, cycle_id, department_id, budget_amount) on tms.plan_cycle_departments to authenticated;
-- The form status is written by the needs form (T-M3-05), which adds its own grant.
grant update (budget_amount) on tms.plan_cycle_departments to authenticated;

alter table tms.plan_cycle_steps enable row level security;
alter table tms.plan_cycle_steps force row level security;
create policy tenant_isolation on tms.plan_cycle_steps
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
create policy plan_cycle_steps_read on tms.plan_cycle_steps for select to authenticated using (true);
create policy plan_cycle_steps_insert on tms.plan_cycle_steps for insert to authenticated
  with check (private.may_manage_plan_cycles(tenant_id));
create policy plan_cycle_steps_delete on tms.plan_cycle_steps for delete to authenticated
  using (private.may_manage_plan_cycles(tenant_id));
-- The chain is saved as a whole (delete + insert in one transaction).
revoke all on tms.plan_cycle_steps from public, anon;
grant select, delete on tms.plan_cycle_steps to authenticated;
grant insert (tenant_id, cycle_id, position, kind, name_ar, name_en, approver_person_id) on tms.plan_cycle_steps to authenticated;
