-- The training plan of a planning cycle and its lines (WP-LD-02, T-M3-06; FR-PLN-05, FR-PLN-06, FR-IAM-08 R1 note;
-- business flow docs/business-flows/EP-PLN-planning-cycle.md §3 D10–14; proposal
-- docs/product/proposals/wp-ld-02-03-consolidation-approval.md, its five questions answered «A» on 14 Nov 2026;
-- approved screens docs/design/screens/m3-consolidation-approval/README.md). Class: T [std]. PII: none new (person ids
-- in the [std] and opened_by / edited_by stamps; the named people stay in tms.plan_need_people).
--
-- Tables
--   tms.training_plans        ONE plan per organization and cycle, opened once the needs are closed (after the
--                             deadline, or earlier with «Close needs now» once every department has submitted —
--                             Q1 = A). Status `draft` in this work package; `in_approval`, `approved`, `sent_back`
--                             and the version number (plan_version) are there for WP-LD-03 (approval, versions)
--   tms.plan_lines            a line of the plan: a training topic (or a course of the library), its quarter of
--                             the plan period (Q3 = A; FR-PLN-05 v3.8), people per session (min / max), cost per
--                             session and per person in the cycle's currency, and in the plan (default, Q2 = A) or
--                             left out with a reason. group_key is what the line was built from (`course:<id>` or
--                             `topic:<normalized topic>`); edited_at says L&D changed the line by hand, so a
--                             resubmitted need never joins it silently
--   tms.plan_line_needs       which line holds a submitted need — at most one (the application puts every submitted
--                             need in exactly one line). seats / named are what the department submitted (a
--                             snapshot taken here, so the plan's figures do not move while a department is
--                             returned for changes; refreshed once it resubmits and L&D adds its needs)
--   tms.plan_budget_reasons   the one-line reason for a department over its envelope (BR-PLN-f: warns, never blocks)
-- Who (policies; the server actions check the same first)
--   read    tms.training_plan.read / .manage organization-wide (L&D Manager, Training Coordinator), or a
--           department-limited custom role with them: the lines holding a need of its units, its units' budget
--           reasons (private.training_plan_units, migration 20261115100100)
--   write   tms.training_plan.manage organization-wide (L&D Manager), or department-limited: a line only when every
--           need in it belongs to its units, a reason only for its units. Opening the plan also needs
--           tms.plan_cycle.manage organization-wide (cycles stay the organization-wide L&D Manager's)
-- Rules (guards): a plan is opened for a CLOSED cycle only and starts as a draft; its lines, needs and reasons change
-- only while it is a draft (or sent back, WP-LD-03): frozen in approval, locked once approved (JK008); only needs of a
-- department whose needs are submitted enter the plan (JK009); a line holding needs cannot be deleted (move or merge
-- them first: the foreign key refuses it).
-- Which line a need is in is decided by the application; a line's departments are read through
-- private.plan_line_departments, a SECURITY DEFINER function owned by the new role training_plan_guard (NOLOGIN
-- NOINHERIT NOBYPASSRLS, as the other guards): the policies of tms.plan_lines and tms.plan_line_needs need the
-- departments of a line without reading tms.plan_line_needs under its own policies (that would recurse). It returns
-- the department ids of one line of the caller's organization, for signed-in members only. The same role answers
-- private.plan_cycle_consolidating (is a draft plan open for a cycle?), which the needs guards ask for a department
-- head who cannot read the plan (migration 20261115100400).
-- Custom SQLSTATEs: JK008 the plan cannot change in its state · JK009 not ready (needs not closed / not submitted).
-- Expand-first: new tables, a new unique constraint on tms.plan_needs, new functions and a new role.

-- ---------------------------------------------------------------------------------------------------
-- tms.training_plans
-- ---------------------------------------------------------------------------------------------------
create table tms.training_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant_id() references platform.tenants (id),
  cycle_id uuid not null,
  status text not null default 'draft'
    constraint training_plans_status_check check (status in ('draft', 'in_approval', 'approved', 'sent_back')),
  -- The plan's version (WP-LD-03: approved = version 1, «Revise plan» opens version 2).
  plan_version integer not null default 1 constraint training_plans_plan_version_check check (plan_version >= 1),
  opened_at timestamptz not null default now(),
  opened_by uuid,
  -- The needs were closed before their deadline («Close needs now», every department had submitted).
  needs_closed_early boolean not null default false,
  -- [std]
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  unique (tenant_id, id),
  constraint training_plans_cycle_key_uq unique (tenant_id, id, cycle_id),
  constraint training_plans_cycle_uq unique (tenant_id, cycle_id),
  foreign key (tenant_id, cycle_id) references tms.plan_cycles (tenant_id, id)
);
comment on table tms.training_plans is
  'The training plan of a planning cycle (EP-PLN D; WP-LD-02): one per organization and cycle, built from the submitted needs. Owner: tms. Class: T [std].';

-- ---------------------------------------------------------------------------------------------------
-- tms.plan_lines
-- ---------------------------------------------------------------------------------------------------
create table tms.plan_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant_id() references platform.tenants (id),
  plan_id uuid not null,
  cycle_id uuid not null,
  -- What the line was built from: `course:<uuid>` or `topic:<normalized topic>` (rules.ts topicKey).
  group_key text not null constraint plan_lines_group_key_check check (char_length(group_key) between 1 and 600),
  title text not null
    constraint plan_lines_title_check check (
      title = btrim(title) and char_length(title) between 1 and 500 and private.has_visible_text(title)
      and title !~ '[‪-‮⁦-⁩]'),
  course_id uuid,
  -- FR-CAT-01 delivery types (the same list as tms.courses); null: not said.
  delivery_type text
    constraint plan_lines_delivery_type_check check (delivery_type in (
      'classroom', 'virtual', 'blended', 'hybrid', 'on_the_job', 'workshop', 'conference', 'exam', 'elearning')),
  -- The topic's category: an option value of the cycle's needs form (e.g. `technical`); null: none.
  category text constraint plan_lines_category_check check (category ~ '^[A-Za-z0-9_.-]{1,80}$'),
  -- When in the plan period (Q3 = A, FR-PLN-05 v3.8): the month is picked when sessions are scheduled.
  quarter smallint not null constraint plan_lines_quarter_check check (quarter between 1 and 4),
  min_per_session integer constraint plan_lines_min_per_session_check check (min_per_session between 1 and 10000),
  max_per_session integer constraint plan_lines_max_per_session_check check (max_per_session between 1 and 10000),
  -- In the cycle's currency (BR-PLN-i), up to three decimals; null: not costed yet.
  cost_per_session numeric(19,4)
    constraint plan_lines_cost_per_session_check check (
      cost_per_session >= 0 and cost_per_session <= 999999999999 and cost_per_session = round(cost_per_session, 3)),
  cost_per_person numeric(19,4)
    constraint plan_lines_cost_per_person_check check (
      cost_per_person >= 0 and cost_per_person <= 999999999999 and cost_per_person = round(cost_per_person, 3)),
  duration_hours numeric(6,2)
    constraint plan_lines_duration_hours_check check (duration_hours > 0 and duration_hours <= 9999.99),
  status text not null default 'in_plan' constraint plan_lines_status_check check (status in ('in_plan', 'left_out')),
  -- Why the line was left out (Q2 = A: required; the head reads it once the plan is approved, Q4 = A).
  left_out_reason text
    constraint plan_lines_left_out_reason_check check (
      left_out_reason = btrim(left_out_reason) and char_length(left_out_reason) between 1 and 500
      and private.has_visible_text(left_out_reason) and left_out_reason !~ '[‪-‮⁦-⁩]'),
  sort_order integer not null default 0 constraint plan_lines_sort_order_check check (sort_order >= 0),
  -- L&D changed the line by hand (stamped by the guard).
  edited_at timestamptz,
  edited_by uuid,
  -- [std]
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  unique (tenant_id, id),
  constraint plan_lines_plan_key_uq unique (tenant_id, id, plan_id, cycle_id),
  constraint plan_lines_sizes_check check (min_per_session is null or max_per_session is null or min_per_session <= max_per_session),
  constraint plan_lines_left_out_check check ((status = 'left_out') = (left_out_reason is not null)),
  foreign key (tenant_id, plan_id, cycle_id) references tms.training_plans (tenant_id, id, cycle_id) on delete cascade,
  foreign key (tenant_id, course_id) references tms.courses (tenant_id, id)
);
comment on table tms.plan_lines is
  'Lines of a training plan (EP-PLN D11–14; WP-LD-02): a topic or course, its quarter, session sizes and costs, in the plan or left out with a reason. Owner: tms. Class: T [std].';

create index plan_lines_plan_idx on tms.plan_lines (tenant_id, plan_id, sort_order, created_at);
create index plan_lines_course_idx on tms.plan_lines (tenant_id, course_id) where course_id is not null;

-- ---------------------------------------------------------------------------------------------------
-- tms.plan_line_needs
-- ---------------------------------------------------------------------------------------------------
-- The composite key the links point at: a need of THIS cycle and department.
alter table tms.plan_needs add constraint plan_needs_cycle_department_uq unique (tenant_id, id, cycle_id, department_id);

create table tms.plan_line_needs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant_id() references platform.tenants (id),
  plan_id uuid not null,
  cycle_id uuid not null,
  line_id uuid not null,
  need_id uuid not null,
  department_id uuid not null,
  -- What the department submitted (set by the guard from the need: seats and named people).
  seats integer not null default 1 constraint plan_line_needs_seats_check check (seats between 1 and 100000),
  named integer not null default 0 constraint plan_line_needs_named_check check (named between 0 and 100000),
  -- [std]
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  unique (tenant_id, id),
  -- A need is in at most one line.
  constraint plan_line_needs_need_uq unique (tenant_id, need_id),
  foreign key (tenant_id, line_id, plan_id, cycle_id) references tms.plan_lines (tenant_id, id, plan_id, cycle_id),
  foreign key (tenant_id, need_id, cycle_id, department_id)
    references tms.plan_needs (tenant_id, id, cycle_id, department_id) on delete cascade
);
comment on table tms.plan_line_needs is
  'Which plan line holds a submitted need (WP-LD-02), with the seats and named people the department submitted. Owner: tms. Class: T [std].';

create index plan_line_needs_line_idx on tms.plan_line_needs (tenant_id, line_id);
create index plan_line_needs_plan_department_idx on tms.plan_line_needs (tenant_id, plan_id, department_id);
create index plan_line_needs_need_key_idx on tms.plan_line_needs (tenant_id, need_id, cycle_id, department_id);

-- ---------------------------------------------------------------------------------------------------
-- tms.plan_budget_reasons
-- ---------------------------------------------------------------------------------------------------
create table tms.plan_budget_reasons (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant_id() references platform.tenants (id),
  plan_id uuid not null,
  cycle_id uuid not null,
  department_id uuid not null,
  reason text not null
    constraint plan_budget_reasons_reason_check check (
      reason = btrim(reason) and char_length(reason) between 1 and 300 and private.has_visible_text(reason)
      and reason !~ '[‪-‮⁦-⁩]'),
  -- [std]
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  unique (tenant_id, id),
  constraint plan_budget_reasons_department_uq unique (tenant_id, plan_id, department_id),
  foreign key (tenant_id, plan_id, cycle_id) references tms.training_plans (tenant_id, id, cycle_id) on delete cascade,
  foreign key (tenant_id, cycle_id, department_id) references tms.plan_cycle_departments (tenant_id, cycle_id, department_id)
);
comment on table tms.plan_budget_reasons is
  'Why a department is over its budget envelope in the training plan (BR-PLN-f, WP-LD-02): one line, shown to the approvers. Owner: tms. Class: T [std].';

create index plan_budget_reasons_department_idx on tms.plan_budget_reasons (tenant_id, cycle_id, department_id);

-- ---------------------------------------------------------------------------------------------------
-- training_plan_guard: the departments of a line, and whether a cycle is being consolidated
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'training_plan_guard') then
    create role training_plan_guard nologin noinherit nobypassrls;
  end if;
end
$$;

do $$
declare
  r record;
begin
  select rolname, rolcanlogin, rolinherit, rolsuper, rolbypassrls, rolreplication, rolcreatedb, rolcreaterole
    into r from pg_roles where rolname = 'training_plan_guard';
  if r.rolsuper or r.rolbypassrls or r.rolreplication then
    raise exception 'role training_plan_guard must be NOSUPERUSER NOBYPASSRLS NOREPLICATION; fix it as a superuser first';
  end if;
  if r.rolinherit or r.rolcreatedb or r.rolcreaterole or r.rolcanlogin then
    alter role training_plan_guard nologin noinherit nocreatedb nocreaterole;
  end if;
  if exists (select 1 from pg_auth_members m join pg_roles g on g.oid = m.roleid join pg_roles u on u.oid = m.member
             where g.rolname = 'training_plan_guard' and (m.inherit_option or m.set_option)
               and not u.rolsuper and u.rolname <> current_user) then
    raise exception 'role training_plan_guard must have no members besides the migration role';
  end if;
end
$$;

grant training_plan_guard to current_user;
grant usage on schema private, tms to training_plan_guard;
grant select (tenant_id, line_id, department_id) on tms.plan_line_needs to training_plan_guard;
grant select (tenant_id, cycle_id, status) on tms.training_plans to training_plan_guard;
create policy plan_line_needs_training_plan_guard_read on tms.plan_line_needs for select
  to training_plan_guard using (true);
create policy training_plans_training_plan_guard_read on tms.training_plans for select
  to training_plan_guard using (true);
grant execute on function private.request_claims() to training_plan_guard;
grant execute on function private.current_tenant_id() to training_plan_guard;

-- The departments with a need in a line of the caller's organization (signed-in members only).
create or replace function private.plan_line_departments(p_line_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct x.department_id), '{}'::uuid[])
  from tms.plan_line_needs x
  where private.request_claims() ->> 'role' = 'authenticated'
    and x.tenant_id = private.current_tenant_id() and x.line_id = p_line_id;
$$;

comment on function private.plan_line_departments(uuid) is
  'SECURITY-RELEVANT (WP-LD-02). The departments with a need in one plan line of the caller''s organization (signed-in members only) — for the policies of the plan''s tables. Owner training_plan_guard.';

-- Is a plan open for consolidation (draft or sent back) for the cycle, in the caller's organization?
create or replace function private.plan_cycle_consolidating(p_tenant_id uuid, p_cycle_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.request_claims() ->> 'role' = 'authenticated'
         and p_tenant_id = private.current_tenant_id()
         and exists (select 1 from tms.training_plans p
                     where p.tenant_id = p_tenant_id and p.cycle_id = p_cycle_id and p.status in ('draft', 'sent_back'));
$$;

comment on function private.plan_cycle_consolidating(uuid, uuid) is
  'SECURITY-RELEVANT (WP-LD-02). A training plan of the cycle is open for consolidation (draft or sent back) — asked by the needs guards for a department head who cannot read the plan. Owner training_plan_guard.';

-- The new owner needs CREATE on the schema for the change of owner (hosted: a non-superuser migration role), only
-- for these statements.
grant create on schema private to training_plan_guard;
alter function private.plan_line_departments(uuid) owner to training_plan_guard;
alter function private.plan_cycle_consolidating(uuid, uuid) owner to training_plan_guard;
revoke create on schema private from training_plan_guard;
revoke all on function private.plan_line_departments(uuid) from public;
revoke all on function private.plan_cycle_consolidating(uuid, uuid) from public;
grant execute on function private.plan_line_departments(uuid) to authenticated;
grant execute on function private.plan_cycle_consolidating(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------------------------------

-- The plan: opened for a closed cycle as a draft; its state moves with WP-LD-03 only.
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
      -- Unknown, or another organization's: the policies and the composite key refuse the row.
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
    -- Closed before every deadline had passed: «Close needs now» (Q1 = A).
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

revoke all on function private.training_plans_guard() from public;

create trigger training_plans_guard before insert or update or delete on tms.training_plans
  for each row execute function private.training_plans_guard();
create trigger training_plans_stamp_row before insert or update on tms.training_plans
  for each row execute function private.stamp_row();

-- The plan of a line, a link or a reason must be open for consolidation (draft or sent back).
create or replace function private.training_plan_editable(p_tenant_id uuid, p_plan_id uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_status text;
begin
  select p.status into v_status from tms.training_plans p where p.tenant_id = p_tenant_id and p.id = p_plan_id;
  if v_status is not null and v_status not in ('draft', 'sent_back') then
    raise exception 'the training plan is frozen while it waits for approval and locked once approved'
      using errcode = 'JK008';
  end if;
end
$$;

revoke all on function private.training_plan_editable(uuid, uuid) from public;
grant execute on function private.training_plan_editable(uuid, uuid) to authenticated;

create or replace function private.plan_lines_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_row record := case when tg_op = 'DELETE' then old else new end;
begin
  perform private.training_plan_editable(v_row.tenant_id, v_row.plan_id);
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if (new.plan_id, new.cycle_id, new.group_key) is distinct from (old.plan_id, old.cycle_id, old.group_key) then
      raise exception 'a plan line stays in its plan and keeps what it was built from' using errcode = 'JK001';
    end if;
    -- Every change of a line is L&D's hand.
    new.edited_at := now();
    new.edited_by := private.request_person_id();
  else
    -- A new line is L&D's when they made it (a need moved out); lines built from the needs are not.
    new.edited_at := case when new.edited_at is not null then now() end;
    new.edited_by := case when new.edited_at is not null then private.request_person_id() end;
  end if;
  return new;
end
$$;

comment on function private.plan_lines_guard() is
  'SECURITY-RELEVANT (WP-LD-02). Plan lines change only while the plan is a draft (or sent back); every change is stamped as L&D''s edit.';

revoke all on function private.plan_lines_guard() from public;

create trigger plan_lines_guard before insert or update or delete on tms.plan_lines
  for each row execute function private.plan_lines_guard();
create trigger plan_lines_stamp_row before insert or update on tms.plan_lines
  for each row execute function private.stamp_row();

create or replace function private.plan_line_needs_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_row record := case when tg_op = 'DELETE' then old else new end;
  v_status text;
begin
  perform private.training_plan_editable(v_row.tenant_id, v_row.plan_id);
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE'
     and (new.plan_id, new.cycle_id, new.need_id, new.department_id)
         is distinct from (old.plan_id, old.cycle_id, old.need_id, old.department_id) then
    raise exception 'a need''s place in the plan moves from line to line only' using errcode = 'JK001';
  end if;
  select d.status into v_status from tms.plan_cycle_departments d
  where d.tenant_id = new.tenant_id and d.cycle_id = new.cycle_id and d.department_id = new.department_id;
  if tg_op = 'INSERT' and v_status is distinct from 'submitted' then
    raise exception 'only the submitted needs of a department enter the training plan' using errcode = 'JK009';
  end if;
  if tg_op = 'UPDATE' and v_status is distinct from 'submitted' then
    -- A department returned for changes: its figures stay as submitted until it resubmits.
    new.seats := old.seats;
    new.named := old.named;
    return new;
  end if;
  -- The snapshot of what the department submitted (never taken from the statement).
  select n.people_count,
         (select count(*) from tms.plan_need_people p where p.tenant_id = n.tenant_id and p.need_id = n.id)
    into new.seats, new.named
  from tms.plan_needs n where n.tenant_id = new.tenant_id and n.id = new.need_id;
  if new.seats is null then
    raise insufficient_privilege using message = 'the need is not readable';
  end if;
  return new;
end
$$;

comment on function private.plan_line_needs_guard() is
  'SECURITY-RELEVANT (WP-LD-02). Only submitted needs enter the plan, while it is a draft; seats and named people are taken from the need.';

revoke all on function private.plan_line_needs_guard() from public;

create trigger plan_line_needs_guard before insert or update or delete on tms.plan_line_needs
  for each row execute function private.plan_line_needs_guard();
create trigger plan_line_needs_stamp_row before insert or update on tms.plan_line_needs
  for each row execute function private.stamp_row();

create or replace function private.plan_budget_reasons_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_row record := case when tg_op = 'DELETE' then old else new end;
begin
  perform private.training_plan_editable(v_row.tenant_id, v_row.plan_id);
  if tg_op = 'UPDATE'
     and (new.plan_id, new.cycle_id, new.department_id) is distinct from (old.plan_id, old.cycle_id, old.department_id) then
    raise exception 'a budget reason belongs to its department' using errcode = 'JK001';
  end if;
  return v_row;
end
$$;

revoke all on function private.plan_budget_reasons_guard() from public;

create trigger plan_budget_reasons_guard before insert or update or delete on tms.plan_budget_reasons
  for each row execute function private.plan_budget_reasons_guard();
create trigger plan_budget_reasons_stamp_row before insert or update on tms.plan_budget_reasons
  for each row execute function private.stamp_row();

-- ---------------------------------------------------------------------------------------------------
-- Row-level security and grants
-- ---------------------------------------------------------------------------------------------------
-- Organization-wide holders first (one init-plan per statement), then the department-limited branch.

alter table tms.training_plans enable row level security;
alter table tms.training_plans force row level security;
create policy tenant_isolation on tms.training_plans
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
create policy training_plans_read on tms.training_plans for select to authenticated
  using ((select private.may_read_training_plan((select private.current_tenant_id())))
         or cardinality((select private.training_plan_units((select private.current_tenant_id()), false))) > 0);
create policy training_plans_insert on tms.training_plans for insert to authenticated
  with check (private.may_manage_training_plan(tenant_id) and private.may_manage_plan_cycles(tenant_id));
grant select on tms.training_plans to authenticated;
grant insert (tenant_id, cycle_id) on tms.training_plans to authenticated;

alter table tms.plan_lines enable row level security;
alter table tms.plan_lines force row level security;
create policy tenant_isolation on tms.plan_lines
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
-- A department-limited planner reads a line holding a need of its units, and an empty line it made itself (a
-- line is empty only between its creation and its first need, or once its needs have moved; the application
-- removes empty lines).
create policy plan_lines_read on tms.plan_lines for select to authenticated
  using ((select private.may_read_training_plan((select private.current_tenant_id())))
         or private.plan_line_departments(id)
            && (select private.training_plan_units((select private.current_tenant_id()), false))
         or (created_by = (select private.request_person_id())
             and cardinality((select private.training_plan_units((select private.current_tenant_id()), false))) > 0
             and cardinality(private.plan_line_departments(id)) = 0));
-- … and creates a line for needs of its units (the needs are checked one by one when they move in).
create policy plan_lines_insert on tms.plan_lines for insert to authenticated
  with check ((select private.may_manage_training_plan((select private.current_tenant_id())))
              or cardinality((select private.training_plan_units((select private.current_tenant_id()), true))) > 0);
-- … and changes or removes a line only when every need in it is of its units (an empty line: its own).
create policy plan_lines_update on tms.plan_lines for update to authenticated
  using ((select private.may_manage_training_plan((select private.current_tenant_id())))
         or (private.plan_line_departments(id)
               <@ (select private.training_plan_units((select private.current_tenant_id()), true))
             and (cardinality(private.plan_line_departments(id)) > 0 or created_by = (select private.request_person_id()))
             and cardinality((select private.training_plan_units((select private.current_tenant_id()), true))) > 0))
  with check ((select private.may_manage_training_plan((select private.current_tenant_id())))
              or (private.plan_line_departments(id)
                    <@ (select private.training_plan_units((select private.current_tenant_id()), true))
                  and cardinality((select private.training_plan_units((select private.current_tenant_id()), true))) > 0));
create policy plan_lines_delete on tms.plan_lines for delete to authenticated
  using ((select private.may_manage_training_plan((select private.current_tenant_id())))
         or (private.plan_line_departments(id)
               <@ (select private.training_plan_units((select private.current_tenant_id()), true))
             and (cardinality(private.plan_line_departments(id)) > 0 or created_by = (select private.request_person_id()))
             and cardinality((select private.training_plan_units((select private.current_tenant_id()), true))) > 0));
grant select, delete on tms.plan_lines to authenticated;
grant insert (tenant_id, plan_id, cycle_id, group_key, title, course_id, delivery_type, category, quarter,
              min_per_session, max_per_session, cost_per_session, cost_per_person, duration_hours, status,
              left_out_reason, sort_order, edited_at)
  on tms.plan_lines to authenticated;
grant update (title, course_id, delivery_type, category, quarter, min_per_session, max_per_session, cost_per_session,
              cost_per_person, duration_hours, status, left_out_reason, sort_order)
  on tms.plan_lines to authenticated;

alter table tms.plan_line_needs enable row level security;
alter table tms.plan_line_needs force row level security;
create policy tenant_isolation on tms.plan_line_needs
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
-- Its units' needs, and the other departments' seats in a line it reads (not their needs themselves).
create policy plan_line_needs_read on tms.plan_line_needs for select to authenticated
  using ((select private.may_read_training_plan((select private.current_tenant_id())))
         or department_id = any ((select private.training_plan_units((select private.current_tenant_id()), false))::uuid[])
         or private.plan_line_departments(line_id)
            && (select private.training_plan_units((select private.current_tenant_id()), false)));
create policy plan_line_needs_insert on tms.plan_line_needs for insert to authenticated
  with check ((select private.may_manage_training_plan((select private.current_tenant_id())))
              or (department_id = any ((select private.training_plan_units((select private.current_tenant_id()), true))::uuid[])
                  and private.plan_line_departments(line_id)
                      <@ (select private.training_plan_units((select private.current_tenant_id()), true))));
create policy plan_line_needs_update on tms.plan_line_needs for update to authenticated
  using ((select private.may_manage_training_plan((select private.current_tenant_id())))
         or (department_id = any ((select private.training_plan_units((select private.current_tenant_id()), true))::uuid[])
             and private.plan_line_departments(line_id)
                 <@ (select private.training_plan_units((select private.current_tenant_id()), true))))
  with check ((select private.may_manage_training_plan((select private.current_tenant_id())))
              or (department_id = any ((select private.training_plan_units((select private.current_tenant_id()), true))::uuid[])
                  and private.plan_line_departments(line_id)
                      <@ (select private.training_plan_units((select private.current_tenant_id()), true))));
create policy plan_line_needs_delete on tms.plan_line_needs for delete to authenticated
  using ((select private.may_manage_training_plan((select private.current_tenant_id())))
         or (department_id = any ((select private.training_plan_units((select private.current_tenant_id()), true))::uuid[])
             and private.plan_line_departments(line_id)
                 <@ (select private.training_plan_units((select private.current_tenant_id()), true))));
grant select, delete on tms.plan_line_needs to authenticated;
grant insert (tenant_id, plan_id, cycle_id, line_id, need_id, department_id) on tms.plan_line_needs to authenticated;
grant update (line_id) on tms.plan_line_needs to authenticated;

alter table tms.plan_budget_reasons enable row level security;
alter table tms.plan_budget_reasons force row level security;
create policy tenant_isolation on tms.plan_budget_reasons
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
create policy plan_budget_reasons_read on tms.plan_budget_reasons for select to authenticated
  using ((select private.may_read_training_plan((select private.current_tenant_id())))
         or department_id = any ((select private.training_plan_units((select private.current_tenant_id()), false))::uuid[]));
create policy plan_budget_reasons_insert on tms.plan_budget_reasons for insert to authenticated
  with check ((select private.may_manage_training_plan((select private.current_tenant_id())))
              or department_id = any ((select private.training_plan_units((select private.current_tenant_id()), true))::uuid[]));
create policy plan_budget_reasons_update on tms.plan_budget_reasons for update to authenticated
  using ((select private.may_manage_training_plan((select private.current_tenant_id())))
         or department_id = any ((select private.training_plan_units((select private.current_tenant_id()), true))::uuid[]))
  with check ((select private.may_manage_training_plan((select private.current_tenant_id())))
              or department_id = any ((select private.training_plan_units((select private.current_tenant_id()), true))::uuid[]));
create policy plan_budget_reasons_delete on tms.plan_budget_reasons for delete to authenticated
  using ((select private.may_manage_training_plan((select private.current_tenant_id())))
         or department_id = any ((select private.training_plan_units((select private.current_tenant_id()), true))::uuid[]));
grant select, delete on tms.plan_budget_reasons to authenticated;
grant insert (tenant_id, plan_id, cycle_id, department_id, reason) on tms.plan_budget_reasons to authenticated;
grant update (reason) on tms.plan_budget_reasons to authenticated;
