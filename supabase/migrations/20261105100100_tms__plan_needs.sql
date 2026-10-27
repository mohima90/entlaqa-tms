-- Department training needs (WP-LD-01, T-M3-05; FR-PLN-03, FR-MGR-05, FR-PLN-06; business flow
-- docs/business-flows/EP-PLN-planning-cycle.md §3 C6–9 as amended by the PO on 27 Oct 2026 — decisions in
-- docs/product/proposals/step-10-needs-entry.md: seats are the plan's unit and names are optional; the head
-- sees the envelope; a late department stays with the L&D Manager). Class: T. PII: the people a head names
-- for a need (person ids of the head's own team).
--
-- Tables
--   tms.plan_needs             one training need of a department in a cycle: the topic (or a course of the
--                              library), how many seats, an optional estimated cost, and the needs section's
--                              other answers of the cycle's form (jsonb by field id, validated by the app)
--   tms.plan_need_people       the people the head named for a need — candidates for its seats
--   tms.plan_cycle_departments gains the submission state (submitted_at/by, returned_at/by + note), a deadline
--                              of its own (an extension for one department) and the department-level answers
--                              of the form's other sections
-- Who
--   the department's EFFECTIVE head — its own head, else the nearest head above (EP-ORG) — holding
--   tms.plan_needs.submit (the Department Head role, scope headed_departments; migration 20261105100000):
--   private.may_submit_plan_needs. The L&D Manager (tms.plan_cycle.manage) returns a submission and extends one
--   department; the L&D Manager and the Training Coordinator (tms.plan_cycle.read) read everything.
-- State of a department's form
--   not_started → draft (the first saved need or answer) → submitted (the head) → draft (recall, by the head,
--   before the effective deadline) | returned (the L&D Manager, with a note; the head changes and resubmits).
--   Late = not submitted after the effective deadline — derived (formStatus), never stored. Needs and answers
--   change only while the cycle is open, the department is not submitted and its effective deadline
--   (the later of the cycle's and its own) has not passed.
-- Expand-first: new tables and columns; the application reads them with this work package.

-- ---------------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------------

-- The department's effective head: its own head, else the nearest head above it (EP-ORG, agreed 17 Oct 2026;
-- the same rule as effectiveHead in modules/tms planning/rules.ts over listOrgStructure, which leaves deleted
-- units out — so does this walk: a deleted unit has no head and stops the search). At most 50 levels.
create or replace function private.plan_department_head(p_tenant_id uuid, p_department_id uuid)
returns uuid
language sql stable
set search_path = ''
as $$
  with recursive up as (
    select d.id, d.parent_id, d.head_person_id, 1 as depth
    from platform.departments d
    where d.tenant_id = p_tenant_id and d.id = p_department_id and d.deleted_at is null
    union all
    select d.id, d.parent_id, d.head_person_id, up.depth + 1
    from platform.departments d
    join up on d.tenant_id = p_tenant_id and d.id = up.parent_id
    where up.head_person_id is null and up.depth < 50 and d.deleted_at is null
  )
  select up.head_person_id from up where up.head_person_id is not null order by up.depth limit 1;
$$;

comment on function private.plan_department_head(uuid, uuid) is
  'The effective head of a department: its own head, else the nearest head above (EP-ORG). NULL: nobody.';

revoke all on function private.plan_department_head(uuid, uuid) from public;
grant execute on function private.plan_department_head(uuid, uuid) to authenticated;

-- Needs entry belongs to the planning feature (WP-ADM-06): an organization whose plan has no planning has no
-- needs entry either.
create or replace function private.permission_feature(p_permission text)
returns text
language sql immutable parallel safe
set search_path = ''
as $$
  select case
    when p_permission like 'tms.plan\_cycle.%' or p_permission like 'tms.plan\_needs.%' then 'planning'
    when p_permission like 'tms.needs\_form.%' then 'needs_forms'
    when p_permission like 'tms.course.%' or p_permission like 'tms.course\_cost.%' then 'courses'
  end;
$$;

-- May the signed-in member enter the department's needs? The member holds tms.plan_needs.submit through a
-- role assignment in force (the Department Head role carries it for the headed departments — any scope, not
-- only organization-wide as private.member_has_permission counts), the plan includes planning, AND the member
-- is the department's effective head, in the claims' organization.
create or replace function private.may_submit_plan_needs(p_tenant_id uuid, p_department_id uuid)
returns boolean
language sql stable
set search_path = ''
as $$
  select private.request_claims() ->> 'role' = 'authenticated'
         and private.request_person_id() is not null
         and p_tenant_id = private.current_tenant_id()
         and exists (
           select 1
           from platform.role_assignments ra
           join platform.tenant_memberships m on m.tenant_id = ra.tenant_id and m.id = ra.membership_id
           join platform.ref_role_permissions rp on rp.role_code = ra.role_code
           where ra.tenant_id = p_tenant_id and m.user_id = private.request_user_id() and m.status = 'active'
             and rp.permission_code = 'tms.plan_needs.submit'
             and (ra.valid_from is null or ra.valid_from <= now())
             and (ra.valid_until is null or ra.valid_until > now()))
         and coalesce(private.tenant_plan_features(p_tenant_id) @> array['planning'], true)
         and private.plan_department_head(p_tenant_id, p_department_id) = private.request_person_id();
$$;

comment on function private.may_submit_plan_needs(uuid, uuid) is
  'SECURITY-RELEVANT (WP-LD-01). The signed-in member holds tms.plan_needs.submit and is the department''s effective head.';

revoke all on function private.may_submit_plan_needs(uuid, uuid) from public;
grant execute on function private.may_submit_plan_needs(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- tms.plan_cycle_departments: the submission state
-- ---------------------------------------------------------------------------------------------------
alter table tms.plan_cycle_departments
  add column deadline_on date,
  add column submitted_at timestamptz,
  add column submitted_by uuid,
  add column returned_at timestamptz,
  add column returned_by uuid,
  add column return_note text
    constraint plan_cycle_departments_return_note_check check (
      return_note is null or (char_length(return_note) <= 500 and return_note !~ '[‪-‮⁦-⁩]')),
  add column answers jsonb not null default '{}'::jsonb
    constraint plan_cycle_departments_answers_check check (
      jsonb_typeof(answers) = 'object' and pg_column_size(answers) <= 65536);

comment on column tms.plan_cycle_departments.deadline_on is
  'An extension for this department only (WP-LD-01, Q3): the effective deadline is the later of the cycle''s and this.';
comment on column tms.plan_cycle_departments.submitted_at is 'When the head submitted the department''s needs (NULL: not submitted now).';
comment on column tms.plan_cycle_departments.returned_at is 'When the L&D Manager returned the submission for changes.';
comment on column tms.plan_cycle_departments.return_note is 'What the L&D Manager asked the head to change (shown to the head).';
comment on column tms.plan_cycle_departments.answers is
  'Department-level answers of the cycle''s needs form — the sections other than the needs section — {sectionId: [{fieldId: answer}]} (validated by the app).';

-- The effective deadline of a department: the later of the cycle's and its own.
create or replace function private.plan_department_deadline(p_tenant_id uuid, p_cycle_id uuid, p_department_id uuid)
returns date
language sql stable
set search_path = ''
as $$
  select greatest(c.deadline_on, coalesce(d.deadline_on, c.deadline_on))
  from tms.plan_cycles c
  join tms.plan_cycle_departments d on d.tenant_id = c.tenant_id and d.cycle_id = c.id
  where c.tenant_id = p_tenant_id and c.id = p_cycle_id and d.department_id = p_department_id;
$$;

revoke all on function private.plan_department_deadline(uuid, uuid, uuid) from public;
grant execute on function private.plan_department_deadline(uuid, uuid, uuid) to authenticated;

-- Needs entry is open: the cycle is open and the department's effective deadline has not passed.
create or replace function private.plan_needs_entry_open(p_tenant_id uuid, p_cycle_id uuid, p_department_id uuid)
returns boolean
language sql stable
set search_path = ''
as $$
  select exists (
    select 1 from tms.plan_cycles c
    where c.tenant_id = p_tenant_id and c.id = p_cycle_id and c.status = 'open'
      and private.plan_cycle_today(p_tenant_id) <= private.plan_department_deadline(p_tenant_id, p_cycle_id, p_department_id));
$$;

revoke all on function private.plan_needs_entry_open(uuid, uuid, uuid) from public;
grant execute on function private.plan_needs_entry_open(uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- tms.plan_needs
-- ---------------------------------------------------------------------------------------------------
create table tms.plan_needs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant_id() references platform.tenants (id),
  cycle_id uuid not null,
  department_id uuid not null,
  -- The training topic (the form's system field) — a course's title when a course of the library was picked.
  topic text not null
    constraint plan_needs_topic_check check (
      char_length(topic) between 1 and 500 and topic ~ '[^\s​-‏ ﻿]'
      and topic !~ '[‪-‮⁦-⁩]'),
  course_id uuid,
  -- Seats: how many people need it (the plan's unit — PO decision Q1, 27 Oct 2026); named people are candidates.
  people_count integer not null
    constraint plan_needs_people_count_check check (people_count between 1 and 100000),
  -- In the cycle's currency (money: data model §1.6); NULL: not estimated.
  estimated_cost numeric(19,4)
    constraint plan_needs_estimated_cost_check check (
      estimated_cost is null or (estimated_cost >= 0 and estimated_cost <= 999999999999)),
  -- The needs section's other answers, by field id (the system fields live in the columns above).
  answers jsonb not null default '{}'::jsonb
    constraint plan_needs_answers_check check (jsonb_typeof(answers) = 'object' and pg_column_size(answers) <= 65536),
  sort_order integer not null default 0 constraint plan_needs_sort_order_check check (sort_order >= 0),
  -- [std]
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  unique (tenant_id, id),
  constraint plan_needs_department_uq unique (tenant_id, id, department_id),
  foreign key (tenant_id, cycle_id, department_id)
    references tms.plan_cycle_departments (tenant_id, cycle_id, department_id) on delete cascade,
  foreign key (tenant_id, course_id) references tms.courses (tenant_id, id)
);
comment on table tms.plan_needs is
  'Training needs a department''s head entered for a planning cycle (EP-PLN C7; WP-LD-01). Owner: tms. Class: T [std].';

create index plan_needs_department_idx on tms.plan_needs (tenant_id, cycle_id, department_id, sort_order, created_at);
create index plan_needs_course_idx on tms.plan_needs (tenant_id, course_id) where course_id is not null;

create table tms.plan_need_people (
  tenant_id uuid not null default private.current_tenant_id() references platform.tenants (id),
  need_id uuid not null,
  department_id uuid not null,
  person_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, need_id, person_id),
  foreign key (tenant_id, need_id, department_id) references tms.plan_needs (tenant_id, id, department_id) on delete cascade,
  foreign key (tenant_id, person_id) references platform.persons (tenant_id, id)
);
comment on table tms.plan_need_people is
  'The people a head named for a training need — candidates for its seats (WP-LD-01). Owner: tms. Class: T. PII: person ids.';

create index plan_need_people_person_idx on tms.plan_need_people (tenant_id, person_id);

-- ---------------------------------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------------------------------

-- The department row: set-up while the cycle is a draft (as before), then only the submission columns move,
-- each by the actor the business flow names. The stamped columns (submitted_*, returned_*) are set here only.
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
  v_deadline := greatest(v_cycle.deadline_on, coalesce(old.deadline_on, v_cycle.deadline_on));
  v_manager := private.may_manage_plan_cycles(new.tenant_id);
  v_head := private.may_submit_plan_needs(new.tenant_id, new.department_id);

  -- An extension for this department (the L&D Manager; business flow §6, PO decision Q3).
  if new.deadline_on is distinct from old.deadline_on then
    if not v_manager then
      raise exception 'only the L&D Manager extends a department''s deadline' using errcode = 'JK001';
    end if;
    if v_cycle.status <> 'open' then
      raise exception 'the planning cycle is not open' using errcode = 'JK005';
    end if;
    if new.deadline_on is null or new.deadline_on <= v_deadline or new.deadline_on < v_today
       or new.deadline_on > v_cycle.period_end_on then
      raise exception 'a department''s deadline can only move later, not before today, within the planning period'
        using errcode = 'JK004';
    end if;
    v_deadline := new.deadline_on;
  end if;

  if new.status is distinct from old.status then
    if v_cycle.status <> 'open' then
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
      new.returned_at := now();
      new.returned_by := private.request_person_id();
      new.submitted_at := null;
      new.submitted_by := null;
    elsif old.status = 'submitted' and new.status = 'draft' then
      -- Recall (business flow C8): the head, before the effective deadline.
      if not v_head then
        raise exception 'only the department''s head recalls its submission' using errcode = 'JK001';
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
      if v_today > v_deadline then
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
    if v_cycle.status <> 'open' or v_today > v_deadline or new.status = 'submitted' then
      raise exception 'the department''s needs can no longer change' using errcode = 'JK005';
    end if;
    if new.status = 'not_started' then
      new.status := 'draft';
    end if;
  end if;
  return new;
end
$$;

comment on function private.plan_cycle_department_guard() is
  'SECURITY-RELEVANT (EP-PLN, WP-LD-01). Set-up of a cycle''s departments in draft; then the submission state: submit / recall by the head, return and a department deadline by the L&D Manager.';

revoke all on function private.plan_cycle_department_guard() from public;

drop trigger plan_cycle_departments_guard on tms.plan_cycle_departments;
create trigger plan_cycle_departments_guard before insert or update or delete on tms.plan_cycle_departments
  for each row execute function private.plan_cycle_department_guard();

-- A need: entry open, the department not submitted; the first need moves the department to draft.
create or replace function private.plan_needs_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_row record := case when tg_op = 'DELETE' then old else new end;
  v_status text;
begin
  -- Only the department's effective head (the policies say the same; said here first so a refusal reads as
  -- «not allowed», not as a state problem — also when the head's first need would open the draft).
  if not private.may_submit_plan_needs(v_row.tenant_id, v_row.department_id) then
    raise insufficient_privilege using message = 'only the department''s head enters its needs';
  end if;
  if tg_op = 'UPDATE' and (new.cycle_id is distinct from old.cycle_id or new.department_id is distinct from old.department_id) then
    raise exception 'a need cannot move to another department or cycle' using errcode = 'JK001';
  end if;
  if not private.plan_needs_entry_open(v_row.tenant_id, v_row.cycle_id, v_row.department_id) then
    raise exception 'needs entry is closed: the planning cycle is not open or the deadline has passed' using errcode = 'JK005';
  end if;
  select d.status into v_status from tms.plan_cycle_departments d
  where d.tenant_id = v_row.tenant_id and d.cycle_id = v_row.cycle_id and d.department_id = v_row.department_id;
  if v_status = 'submitted' then
    raise exception 'the department''s needs are submitted: recall the submission to change them' using errcode = 'JK005';
  end if;
  if tg_op = 'INSERT' then
    if (select count(*) from tms.plan_needs n
        where n.tenant_id = new.tenant_id and n.cycle_id = new.cycle_id and n.department_id = new.department_id) >= 200 then
      raise exception 'a department enters at most 200 training needs in a cycle' using errcode = 'JK007';
    end if;
    if v_status = 'not_started' then
      update tms.plan_cycle_departments d set status = 'draft'
      where d.tenant_id = new.tenant_id and d.cycle_id = new.cycle_id and d.department_id = new.department_id;
    end if;
  end if;
  return v_row;
end
$$;

comment on function private.plan_needs_guard() is
  'SECURITY-RELEVANT (WP-LD-01). Needs change only while entry is open and the department is not submitted; the first need starts the draft.';

revoke all on function private.plan_needs_guard() from public;

create trigger plan_needs_guard before insert or update or delete on tms.plan_needs
  for each row execute function private.plan_needs_guard();
create trigger plan_needs_stamp_row before insert or update on tms.plan_needs
  for each row execute function private.stamp_row();

-- Named people change with their need: same openness, at most 500 names per need.
create or replace function private.plan_need_people_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_row record := case when tg_op = 'DELETE' then old else new end;
  v_need tms.plan_needs%rowtype;
begin
  select * into v_need from tms.plan_needs n where n.tenant_id = v_row.tenant_id and n.id = v_row.need_id;
  if v_need.id is null then
    -- Unknown, or another organization's: the policies and the composite foreign key refuse the row.
    return v_row;
  end if;
  if not private.may_submit_plan_needs(v_need.tenant_id, v_need.department_id) then
    raise insufficient_privilege using message = 'only the department''s head names people for its needs';
  end if;
  if not private.plan_needs_entry_open(v_need.tenant_id, v_need.cycle_id, v_need.department_id)
     or exists (select 1 from tms.plan_cycle_departments d
                where d.tenant_id = v_need.tenant_id and d.cycle_id = v_need.cycle_id
                  and d.department_id = v_need.department_id and d.status = 'submitted') then
    raise exception 'the department''s needs can no longer change' using errcode = 'JK005';
  end if;
  if tg_op = 'INSERT' and (select count(*) from tms.plan_need_people p
                           where p.tenant_id = new.tenant_id and p.need_id = new.need_id) >= 500 then
    raise exception 'a training need names at most 500 people' using errcode = 'JK007';
  end if;
  return v_row;
end
$$;

revoke all on function private.plan_need_people_guard() from public;

create trigger plan_need_people_guard before insert or update or delete on tms.plan_need_people
  for each row execute function private.plan_need_people_guard();

-- An open cycle closes once every deadline has passed — the cycle's and any department's extension.
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
      -- WP-LD-01 (PO decision Q3, 27 Oct 2026): also every department's own extension must have passed.
      if old.deadline_on >= v_today or new.deadline_on is distinct from old.deadline_on
         or exists (select 1 from tms.plan_cycle_departments d
                    where d.tenant_id = new.tenant_id and d.cycle_id = new.id and d.deadline_on >= v_today) then
        raise exception 'an open planning cycle closes once every deadline has passed' using errcode = 'JK001';
      end if;
      new.closed_at := now();
      return new;
    end if;
    raise exception 'an open planning cycle can only be extended or closed' using errcode = 'JK001';
  end if;

  raise exception 'this planning cycle can no longer change' using errcode = 'JK001';
end
$$;

-- ---------------------------------------------------------------------------------------------------
-- Row-level security and grants
-- ---------------------------------------------------------------------------------------------------

-- Heads read the cycles and departments they enter needs for (S-L3 kept for everyone else).
drop policy plan_cycles_read on tms.plan_cycles;
create policy plan_cycles_read on tms.plan_cycles for select to authenticated
  using ((select private.may_read_plan_cycles((select private.current_tenant_id())))
         or exists (select 1 from tms.plan_cycle_departments d
                    where d.tenant_id = tms.plan_cycles.tenant_id and d.cycle_id = tms.plan_cycles.id
                      and private.may_submit_plan_needs(d.tenant_id, d.department_id)));

drop policy plan_cycle_departments_read on tms.plan_cycle_departments;
create policy plan_cycle_departments_read on tms.plan_cycle_departments for select to authenticated
  using ((select private.may_read_plan_cycles((select private.current_tenant_id())))
         or private.may_submit_plan_needs(tenant_id, department_id));
create policy plan_cycle_departments_head_update on tms.plan_cycle_departments for update to authenticated
  using (private.may_submit_plan_needs(tenant_id, department_id))
  with check (private.may_submit_plan_needs(tenant_id, department_id));
grant update (status, answers, return_note, deadline_on) on tms.plan_cycle_departments to authenticated;

alter table tms.plan_needs enable row level security;
alter table tms.plan_needs force row level security;
create policy tenant_isolation on tms.plan_needs
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
create policy plan_needs_read on tms.plan_needs for select to authenticated
  using ((select private.may_read_plan_cycles((select private.current_tenant_id())))
         or private.may_submit_plan_needs(tenant_id, department_id));
create policy plan_needs_insert on tms.plan_needs for insert to authenticated
  with check (private.may_submit_plan_needs(tenant_id, department_id));
create policy plan_needs_update on tms.plan_needs for update to authenticated
  using (private.may_submit_plan_needs(tenant_id, department_id))
  with check (private.may_submit_plan_needs(tenant_id, department_id));
create policy plan_needs_delete on tms.plan_needs for delete to authenticated
  using (private.may_submit_plan_needs(tenant_id, department_id));
grant select, delete on tms.plan_needs to authenticated;
grant insert (tenant_id, cycle_id, department_id, topic, course_id, people_count, estimated_cost, answers, sort_order)
  on tms.plan_needs to authenticated;
grant update (topic, course_id, people_count, estimated_cost, answers, sort_order) on tms.plan_needs to authenticated;

alter table tms.plan_need_people enable row level security;
alter table tms.plan_need_people force row level security;
create policy tenant_isolation on tms.plan_need_people
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
create policy plan_need_people_read on tms.plan_need_people for select to authenticated
  using ((select private.may_read_plan_cycles((select private.current_tenant_id())))
         or private.may_submit_plan_needs(tenant_id, department_id));
create policy plan_need_people_insert on tms.plan_need_people for insert to authenticated
  with check (private.may_submit_plan_needs(tenant_id, department_id));
create policy plan_need_people_delete on tms.plan_need_people for delete to authenticated
  using (private.may_submit_plan_needs(tenant_id, department_id));
grant select, delete on tms.plan_need_people to authenticated;
grant insert (tenant_id, need_id, department_id, person_id) on tms.plan_need_people to authenticated;
