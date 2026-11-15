-- Approving the training plan, its versions and each department's result (WP-LD-03, T-M3-07; FR-PLN-08, FR-WFL-01/02
-- R1 part, FR-MGR-05; business flow docs/business-flows/EP-PLN-planning-cycle.md §13 (agreed 12 Nov 2026) and §3 F;
-- proposal docs/product/proposals/wp-ld-02-03-consolidation-approval.md §2 B steps 8–13 and §3, its questions
-- answered «A»; approved screens docs/design/screens/m3-consolidation-approval/README.md 4–6b). Class: T [std]
-- (new columns of tms.training_plans) and T (three new insert-only tables). PII: person ids of who submitted and
-- decided; the send-back comment is free text for the L&D Manager (the audit log records its length only).
--
-- The journey (one state machine in private.training_plans_guard; the application asks the same first):
--   draft / sent_back ──submit──▶ in_approval (step hr) ──HR approves──▶ in_approval (step finance) ──Finance──▶ approved
--                                        │                     (only when Planning settings «Finance       │
--                                        └──── send back (comment) ◀──── confirms the plan» was on) ────────┘
--   approved ──revise──▶ draft, version N + 1 (version N stays, read only)
--   * submit: the organization-wide L&D Manager (tms.training_plan.manage organization-wide — cycles and submission
--     stay organization-wide, feedback #4) — refused (JK010, the reason after «: ») while a department may still
--     change its needs (needs_open), a resubmitted need is not in the plan yet (needs_not_added), a line in the plan
--     has no session size or cost (uncosted), or a department over its envelope has no reason (over_budget). The
--     Finance switch is read here: a plan keeps the steps it was submitted with.
--   * decide: the step's role — tms.training_plan.approve (HR Manager) for step hr, tms.training_plan.confirm
--     (Finance) for step finance; any holder may decide and the first decision settles the step: the application
--     writes `where status = 'in_approval' and approval_step = <step> and version = <seen>`, so a second decision
--     finds nothing to change. Nobody decides on a plan they submitted, and Finance is never the person who approved
--     it for HR (JK011). Sending back needs a comment (JK012).
--   * revise: the organization-wide L&D Manager opens the next version as a draft of the same lines.
-- Frozen in approval, locked once approved: the line, link and reason guards of 20261115100200 already refuse every
-- change unless the plan is a draft or sent back (JK008).
--
-- New tables (insert-only; written by the AFTER trigger private.training_plans_record, SECURITY DEFINER owned by
-- the new role plan_approval_guard — NOLOGIN NOINHERIT NOBYPASSRLS as the other guards; nobody writes them by a
-- statement):
--   tms.training_plan_events              the plan's history: submitted, approved (HR), confirmed (Finance), sent back
--                                         (with the comment), revised — who and when
--   tms.training_plan_versions            each approved version, as approved: its lines with their departments'
--                                         seats, the envelopes and the over-budget reasons (jsonb, read only)
--   tms.training_plan_department_results  the same, per department: what that department's head sees once the plan
--                                         is approved (Q4 = A) — its lines (with the seats of the departments a
--                                         shared line is split with), its left-out lines with their reasons, its
--                                         envelope and reason
-- Who reads (policies): the plan's readers organization-wide (L&D Manager, Training Coordinator, HR Manager,
-- Finance); a department-limited planner the events and its units' results; a department's effective head its
-- department's results (private.may_submit_plan_needs).
-- Custom SQLSTATEs: JK010 not ready to submit · JK011 one person never decides on their own submission · JK012 a send
-- back needs a comment.
-- Expand-first: new columns (nullable or with defaults), tables, functions and a role; the previous release reads
-- none of them and never changes a plan's state.

-- ---------------------------------------------------------------------------------------------------
-- tms.training_plans: where the approval stands
-- ---------------------------------------------------------------------------------------------------
alter table tms.training_plans
  add column approval_step text constraint training_plans_approval_step_check check (approval_step in ('hr', 'finance')),
  -- Finance was asked for the current submission (the switch as it was when the plan was submitted).
  add column finance_step boolean not null default false,
  add column submitted_at timestamptz,
  add column submitted_by uuid,
  add column hr_decided_at timestamptz,
  add column hr_decided_by uuid,
  add column decided_at timestamptz,
  add column decided_by uuid,
  -- The approver's one comment for the whole plan when it is sent back (Q5 = A); shown to the L&D Manager.
  add column send_back_comment text
    constraint training_plans_send_back_comment_check check (
      send_back_comment = btrim(send_back_comment) and char_length(send_back_comment) between 1 and 2000
      and private.has_visible_text(send_back_comment) and send_back_comment !~ '[‪-‮⁦-⁩]'),
  add column approved_at timestamptz,
  add column approved_by uuid,
  add constraint training_plans_approval_step_state_check check ((status = 'in_approval') = (approval_step is not null));

comment on column tms.training_plans.approval_step is
  'The step the plan waits for while in approval: hr (the HR Manager role) or finance (the Finance role).';

-- ---------------------------------------------------------------------------------------------------
-- New tables
-- ---------------------------------------------------------------------------------------------------
create table tms.training_plan_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants (id),
  plan_id uuid not null,
  cycle_id uuid not null,
  plan_version integer not null constraint training_plan_events_plan_version_check check (plan_version >= 1),
  kind text not null
    constraint training_plan_events_kind_check check (kind in ('submitted', 'approved', 'confirmed', 'sent_back', 'revised')),
  -- The step decided (approved: hr; confirmed: finance; sent back: either).
  step text constraint training_plan_events_step_check check (step in ('hr', 'finance')),
  actor_person_id uuid,
  comment text constraint training_plan_events_comment_check check (char_length(comment) between 1 and 2000),
  -- The moment of the step itself (clock time: several steps of one transaction keep their order).
  occurred_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, plan_id, cycle_id) references tms.training_plans (tenant_id, id, cycle_id) on delete cascade
);
comment on table tms.training_plan_events is
  'History of a training plan''s approval (WP-LD-03): submitted, approved, confirmed, sent back, revised. Insert-only (private.training_plans_record). Owner: tms. Class: T.';
create index training_plan_events_plan_idx on tms.training_plan_events (tenant_id, plan_id, occurred_at);

create table tms.training_plan_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants (id),
  plan_id uuid not null,
  cycle_id uuid not null,
  plan_version integer not null constraint training_plan_versions_plan_version_check check (plan_version >= 1),
  approved_at timestamptz not null,
  approved_by uuid,
  -- {currency, lines: [{id, title, courseId, deliveryType, category, quarter, minPerSession, maxPerSession,
  --  costPerSession, costPerPerson, durationHours, status, leftOutReason, sortOrder, departments: [{departmentId,
  --  seats, named}]}], departments: [{departmentId, envelope, reason}]}
  snapshot jsonb not null constraint training_plan_versions_snapshot_check check (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint training_plan_versions_uq unique (tenant_id, plan_id, plan_version),
  foreign key (tenant_id, plan_id, cycle_id) references tms.training_plans (tenant_id, id, cycle_id) on delete cascade
);
comment on table tms.training_plan_versions is
  'Each approved version of a training plan, as approved (WP-LD-03; FR-PLN-08 locked and versioned). Insert-only. Owner: tms. Class: T.';

create table tms.training_plan_department_results (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants (id),
  plan_id uuid not null,
  cycle_id uuid not null,
  plan_version integer not null constraint training_plan_department_results_plan_version_check check (plan_version >= 1),
  department_id uuid not null,
  approved_at timestamptz not null,
  -- {currency, envelope, reason, lines: [... as in the version snapshot, the lines with a need of the department]}
  result jsonb not null constraint training_plan_department_results_result_check check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint training_plan_department_results_uq unique (tenant_id, plan_id, plan_version, department_id),
  foreign key (tenant_id, plan_id, cycle_id) references tms.training_plans (tenant_id, id, cycle_id) on delete cascade,
  foreign key (tenant_id, cycle_id, department_id) references tms.plan_cycle_departments (tenant_id, cycle_id, department_id)
);
comment on table tms.training_plan_department_results is
  'A department''s part of an approved training plan version — what its head sees (WP-LD-03; FR-MGR-05, Q4 = A). Insert-only. Owner: tms. Class: T.';
create index training_plan_department_results_department_idx
  on tms.training_plan_department_results (tenant_id, cycle_id, department_id, plan_version);

-- ---------------------------------------------------------------------------------------------------
-- Who may move a plan's state (SECURITY INVOKER: the caller's own roles)
-- ---------------------------------------------------------------------------------------------------
create or replace function private.may_decide_training_plan(p_tenant_id uuid, p_step text)
returns boolean
language sql stable
set search_path = ''
as $$
  select private.request_claims() ->> 'role' = 'authenticated'
         and p_tenant_id = private.current_tenant_id()
         and private.member_has_permission(p_tenant_id, private.request_user_id(),
               case p_step when 'hr' then 'tms.training_plan.approve'
                           when 'finance' then 'tms.training_plan.confirm' end);
$$;

comment on function private.may_decide_training_plan(uuid, text) is
  'SECURITY-RELEVANT (WP-LD-03). The signed-in member holds the permission of the approval step (hr: tms.training_plan.approve — the HR Manager; finance: tms.training_plan.confirm — Finance).';

revoke all on function private.may_decide_training_plan(uuid, text) from public;
grant execute on function private.may_decide_training_plan(uuid, text) to authenticated;

-- Why the plan cannot be submitted now (null: it can). The caller is the organization-wide L&D Manager, who reads
-- every row it looks at. A department's estimated cost is checked with its exact share of each line (cost × its
-- seats ÷ the line's seats); the application splits a shared line in the currency's smallest unit, which differs
-- from the exact share by less than one unit per line — the database allows that much (one major unit per line).
create or replace function private.training_plan_submit_problem(p_tenant_id uuid, p_plan_id uuid, p_cycle_id uuid)
returns text
language sql stable
set search_path = ''
as $$
  select case
    -- A department returned for changes or reopened may still change its needs (its own deadline is today or later).
    when exists (select 1 from tms.plan_cycle_departments d
                 where d.tenant_id = p_tenant_id and d.cycle_id = p_cycle_id and d.status <> 'submitted'
                   and d.deadline_on >= private.plan_cycle_today(p_tenant_id)) then 'needs_open'
    -- A submitted need not in a line, or changed since it was added (seats, named people, topic or course).
    when exists (select 1 from tms.plan_needs n
                 join tms.plan_cycle_departments d
                   on d.tenant_id = n.tenant_id and d.cycle_id = n.cycle_id and d.department_id = n.department_id
                 left join tms.plan_line_needs x on x.tenant_id = n.tenant_id and x.need_id = n.id
                 where n.tenant_id = p_tenant_id and n.cycle_id = p_cycle_id and d.status = 'submitted'
                   and (x.id is null or x.seats <> n.people_count or x.topic is distinct from n.topic
                        or x.course_id is distinct from n.course_id
                        or x.named <> (select count(*) from tms.plan_need_people pp
                                       where pp.tenant_id = n.tenant_id and pp.need_id = n.id))) then 'needs_not_added'
    when exists (select 1 from tms.plan_lines l
                 where l.tenant_id = p_tenant_id and l.plan_id = p_plan_id and l.status = 'in_plan'
                   and (l.max_per_session is null or l.cost_per_session is null)) then 'uncosted'
    when exists (
      with line_people as (
        select l.id, l.max_per_session, l.cost_per_session, coalesce(l.cost_per_person, 0) as cost_per_person,
               sum(x.seats) as people
        from tms.plan_lines l
        join tms.plan_line_needs x on x.tenant_id = l.tenant_id and x.line_id = l.id
        where l.tenant_id = p_tenant_id and l.plan_id = p_plan_id and l.status = 'in_plan'
        group by l.id, l.max_per_session, l.cost_per_session, l.cost_per_person
      ),
      line_cost as (
        select id, people,
               ceil(people::numeric / max_per_session) * cost_per_session + people * cost_per_person as cost
        from line_people where people > 0
      ),
      department_cost as (
        select x.department_id, sum(c.cost * x.seats / c.people) as cost, count(distinct c.id) as lines
        from line_cost c
        join tms.plan_line_needs x on x.tenant_id = p_tenant_id and x.line_id = c.id
        group by x.department_id
      )
      select 1 from department_cost c
      join tms.plan_cycle_departments d
        on d.tenant_id = p_tenant_id and d.cycle_id = p_cycle_id and d.department_id = c.department_id
      where d.budget_amount is not null and c.cost > d.budget_amount + c.lines
        and not exists (select 1 from tms.plan_budget_reasons r
                        where r.tenant_id = p_tenant_id and r.plan_id = p_plan_id and r.department_id = c.department_id))
      then 'over_budget'
  end;
$$;

comment on function private.training_plan_submit_problem(uuid, uuid, uuid) is
  'SECURITY-RELEVANT (WP-LD-03). Why a training plan cannot be submitted for approval now (needs_open, needs_not_added, uncosted, over_budget), or null.';

revoke all on function private.training_plan_submit_problem(uuid, uuid, uuid) from public;
grant execute on function private.training_plan_submit_problem(uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- The state machine (replaces the guard of 20261115100200: opening is unchanged)
-- ---------------------------------------------------------------------------------------------------
create or replace function private.training_plans_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_cycle tms.plan_cycles%rowtype;
  v_today date;
  v_person uuid;
  v_problem text;
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
    new.approval_step := null;
    new.finance_step := false;
    new.submitted_at := null;
    new.submitted_by := null;
    new.hr_decided_at := null;
    new.hr_decided_by := null;
    new.decided_at := null;
    new.decided_by := null;
    new.send_back_comment := null;
    new.approved_at := null;
    new.approved_by := null;
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'a training plan is kept' using errcode = 'JK001';
  end if;
  if (new.tenant_id, new.cycle_id, new.opened_at, new.opened_by, new.needs_closed_early, new.plan_version)
     is distinct from
     (old.tenant_id, old.cycle_id, old.opened_at, old.opened_by, old.needs_closed_early, old.plan_version) then
    raise exception 'a training plan keeps its cycle, opening and version' using errcode = 'JK001';
  end if;

  -- Where the approval stands is the database's: never taken from a statement.
  new.approval_step := old.approval_step;
  new.finance_step := old.finance_step;
  new.submitted_at := old.submitted_at;
  new.submitted_by := old.submitted_by;
  new.hr_decided_at := old.hr_decided_at;
  new.hr_decided_by := old.hr_decided_by;
  new.decided_at := old.decided_at;
  new.decided_by := old.decided_by;
  new.approved_at := old.approved_at;
  new.approved_by := old.approved_by;
  if new.status is not distinct from old.status then
    new.send_back_comment := old.send_back_comment;
    return new;
  end if;
  if private.request_claims() ->> 'role' is distinct from 'authenticated' then
    raise exception 'the state of a training plan changes through its approval only' using errcode = 'JK001';
  end if;
  v_person := private.request_person_id();

  -- Submit for approval (step 8): the organization-wide L&D Manager; the plan is frozen from now on.
  if old.status in ('draft', 'sent_back') and new.status = 'in_approval' then
    if not private.may_manage_training_plan(new.tenant_id) then
      raise insufficient_privilege using message = 'the organization-wide L&D Manager submits the training plan';
    end if;
    -- Line changes already in flight finish first (their guards saw a draft); later ones see the plan frozen.
    perform 1 from tms.plan_lines l where l.tenant_id = new.tenant_id and l.plan_id = new.id for update;
    v_problem := private.training_plan_submit_problem(new.tenant_id, new.id, new.cycle_id);
    if v_problem is not null then
      raise exception 'the training plan cannot be submitted: %', v_problem using errcode = 'JK010';
    end if;
    new.approval_step := 'hr';
    new.finance_step := coalesce((select s.finance_confirms from tms.planning_settings s where s.tenant_id = new.tenant_id),
                                 false);
    new.submitted_at := now();
    new.submitted_by := v_person;
    new.hr_decided_at := null;
    new.hr_decided_by := null;
    new.decided_at := null;
    new.decided_by := null;
    new.send_back_comment := null;
    return new;
  end if;

  -- A decision (steps 9, 10, 12): the step's role; the application names the step it saw in its WHERE, so the
  -- second of two decisions changes nothing.
  if old.status = 'in_approval' and new.status in ('approved', 'sent_back') then
    if not private.may_decide_training_plan(new.tenant_id, old.approval_step) then
      raise insufficient_privilege using message = case old.approval_step
        when 'hr' then 'the HR Manager approves the training plan' else 'Finance confirms the training plan' end;
    end if;
    if v_person is null or v_person = old.submitted_by
       or (old.approval_step = 'finance' and v_person = old.hr_decided_by) then
      raise exception 'nobody decides on a training plan they submitted or already approved' using errcode = 'JK011';
    end if;
    if new.status = 'sent_back' then
      if new.send_back_comment is null or not private.has_visible_text(new.send_back_comment) then
        raise exception 'sending the training plan back needs a comment' using errcode = 'JK012';
      end if;
      new.approval_step := null;
      new.decided_at := now();
      new.decided_by := v_person;
      return new;
    end if;
    new.send_back_comment := null;
    if old.approval_step = 'hr' then
      new.hr_decided_at := now();
      new.hr_decided_by := v_person;
      if old.finance_step then
        -- Finance confirms next (only when the switch was on at submission).
        new.status := 'in_approval';
        new.approval_step := 'finance';
        return new;
      end if;
    end if;
    new.approval_step := null;
    new.decided_at := now();
    new.decided_by := v_person;
    new.approved_at := now();
    new.approved_by := v_person;
    return new;
  end if;

  -- Revise (step 13): the next version as a draft of the same lines; the approved version stays as approved.
  if old.status = 'approved' and new.status = 'draft' then
    if not private.may_manage_training_plan(new.tenant_id) then
      raise insufficient_privilege using message = 'the organization-wide L&D Manager revises the training plan';
    end if;
    new.plan_version := old.plan_version + 1;
    new.approval_step := null;
    new.finance_step := false;
    new.submitted_at := null;
    new.submitted_by := null;
    new.hr_decided_at := null;
    new.hr_decided_by := null;
    new.decided_at := null;
    new.decided_by := null;
    new.send_back_comment := null;
    return new;
  end if;

  raise exception 'this change of a training plan''s state is not allowed' using errcode = 'JK001';
end
$$;

comment on function private.training_plans_guard() is
  'SECURITY-RELEVANT (WP-LD-02, WP-LD-03). A training plan is opened for a closed cycle as a draft; it is submitted by the organization-wide L&D Manager once ready, decided by the step''s role (never by its submitter; the first decision settles the step) and revised into a new version — the database stamps every step.';

-- ---------------------------------------------------------------------------------------------------
-- plan_approval_guard: the history, the versions and the departments' results
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'plan_approval_guard') then
    create role plan_approval_guard nologin noinherit nobypassrls;
  end if;
end
$$;

do $$
declare
  r record;
begin
  select rolname, rolcanlogin, rolinherit, rolsuper, rolbypassrls, rolreplication, rolcreatedb, rolcreaterole
    into r from pg_roles where rolname = 'plan_approval_guard';
  if r.rolsuper or r.rolbypassrls or r.rolreplication then
    raise exception 'role plan_approval_guard must be NOSUPERUSER NOBYPASSRLS NOREPLICATION; fix it as a superuser first';
  end if;
  if r.rolinherit or r.rolcreatedb or r.rolcreaterole or r.rolcanlogin then
    alter role plan_approval_guard nologin noinherit nocreatedb nocreaterole;
  end if;
  if exists (select 1 from pg_auth_members m join pg_roles g on g.oid = m.roleid join pg_roles u on u.oid = m.member
             where g.rolname = 'plan_approval_guard' and (m.inherit_option or m.set_option)
               and not u.rolsuper and u.rolname <> current_user) then
    raise exception 'role plan_approval_guard must have no members besides the migration role';
  end if;
end
$$;

grant plan_approval_guard to current_user;
grant usage on schema private, tms to plan_approval_guard;
-- What a version is made of (the trigger reads the plan that just changed, of its own organization).
grant select (tenant_id, id, plan_id, title, course_id, delivery_type, category, quarter, min_per_session,
              max_per_session, cost_per_session, cost_per_person, duration_hours, status, left_out_reason, sort_order)
  on tms.plan_lines to plan_approval_guard;
grant select (tenant_id, plan_id, line_id, department_id, seats, named) on tms.plan_line_needs to plan_approval_guard;
grant select (tenant_id, plan_id, department_id, reason) on tms.plan_budget_reasons to plan_approval_guard;
grant select (tenant_id, cycle_id, department_id, budget_amount) on tms.plan_cycle_departments to plan_approval_guard;
grant select (tenant_id, id, currency) on tms.plan_cycles to plan_approval_guard;
create policy plan_lines_plan_approval_guard_read on tms.plan_lines for select to plan_approval_guard using (true);
create policy plan_line_needs_plan_approval_guard_read on tms.plan_line_needs for select to plan_approval_guard
  using (true);
create policy plan_budget_reasons_plan_approval_guard_read on tms.plan_budget_reasons for select
  to plan_approval_guard using (true);
create policy plan_cycle_departments_plan_approval_guard_read on tms.plan_cycle_departments for select
  to plan_approval_guard using (true);
create policy plan_cycles_plan_approval_guard_read on tms.plan_cycles for select to plan_approval_guard using (true);
-- … and what it writes.
grant insert (tenant_id, plan_id, cycle_id, plan_version, kind, step, actor_person_id, comment)
  on tms.training_plan_events to plan_approval_guard;
grant insert (tenant_id, plan_id, cycle_id, plan_version, approved_at, approved_by, snapshot)
  on tms.training_plan_versions to plan_approval_guard;
grant insert (tenant_id, plan_id, cycle_id, plan_version, department_id, approved_at, result)
  on tms.training_plan_department_results to plan_approval_guard;

-- A line as a version keeps it, with its departments' seats. SECURITY INVOKER, executable by its owner only: it runs
-- inside the trigger below, as plan_approval_guard.
create or replace function private.training_plan_version_lines(p_tenant_id uuid, p_plan_id uuid)
returns table (line_id uuid, department_ids uuid[], line jsonb)
language sql
stable
set search_path = ''
as $$
  select l.id,
         coalesce((select array_agg(distinct x.department_id) from tms.plan_line_needs x
                   where x.tenant_id = l.tenant_id and x.line_id = l.id), '{}'::uuid[]),
         jsonb_build_object(
           'id', l.id, 'title', l.title, 'courseId', l.course_id, 'deliveryType', l.delivery_type,
           'category', l.category, 'quarter', l.quarter, 'minPerSession', l.min_per_session,
           'maxPerSession', l.max_per_session, 'costPerSession', l.cost_per_session::text,
           'costPerPerson', l.cost_per_person::text, 'durationHours', l.duration_hours, 'status', l.status,
           'leftOutReason', l.left_out_reason, 'sortOrder', l.sort_order,
           'departments', coalesce((
             select jsonb_agg(jsonb_build_object('departmentId', s.department_id, 'seats', s.seats, 'named', s.named)
                              order by s.seats desc, s.department_id)
             from (select x.department_id, sum(x.seats)::integer as seats, sum(x.named)::integer as named
                   from tms.plan_line_needs x
                   where x.tenant_id = l.tenant_id and x.line_id = l.id
                   group by x.department_id) s), '[]'::jsonb))
  from tms.plan_lines l
  where l.tenant_id = p_tenant_id and l.plan_id = p_plan_id;
$$;

create or replace function private.training_plans_record()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_currency text;
  v_lines jsonb;
begin
  if new.status is not distinct from old.status and new.approval_step is not distinct from old.approval_step
     and new.plan_version = old.plan_version then
    return null;
  end if;
  v_kind := case
    when old.status <> 'in_approval' and new.status = 'in_approval' then 'submitted'
    when old.status = 'in_approval' and new.status = 'sent_back' then 'sent_back'
    when old.status = 'in_approval' and old.approval_step = 'hr' then 'approved'
    when old.status = 'in_approval' and old.approval_step = 'finance' then 'confirmed'
    when old.status = 'approved' and new.status = 'draft' then 'revised'
  end;
  if v_kind is null then
    return null;
  end if;
  insert into tms.training_plan_events (tenant_id, plan_id, cycle_id, plan_version, kind, step, actor_person_id, comment)
  values (new.tenant_id, new.id, new.cycle_id, new.plan_version, v_kind,
          case when v_kind in ('approved', 'confirmed', 'sent_back') then old.approval_step end,
          new.updated_by,
          case when v_kind = 'sent_back' then new.send_back_comment end);

  if new.status = 'approved' then
    select c.currency into v_currency from tms.plan_cycles c where c.tenant_id = new.tenant_id and c.id = new.cycle_id;
    select coalesce(jsonb_agg(v.line order by (v.line ->> 'sortOrder')::integer, v.line ->> 'title'), '[]'::jsonb)
      into v_lines
    from private.training_plan_version_lines(new.tenant_id, new.id) v;
    insert into tms.training_plan_versions (tenant_id, plan_id, cycle_id, plan_version, approved_at, approved_by, snapshot)
    select new.tenant_id, new.id, new.cycle_id, new.plan_version, new.approved_at, new.approved_by,
           jsonb_build_object(
             'currency', v_currency,
             'lines', v_lines,
             'departments', coalesce((
               select jsonb_agg(jsonb_build_object('departmentId', d.department_id,
                                                   'envelope', d.budget_amount::text,
                                                   'reason', r.reason) order by d.department_id)
               from tms.plan_cycle_departments d
               left join tms.plan_budget_reasons r
                 on r.tenant_id = d.tenant_id and r.plan_id = new.id and r.department_id = d.department_id
               where d.tenant_id = new.tenant_id and d.cycle_id = new.cycle_id), '[]'::jsonb));
    insert into tms.training_plan_department_results (tenant_id, plan_id, cycle_id, plan_version, department_id,
                                                     approved_at, result)
    select new.tenant_id, new.id, new.cycle_id, new.plan_version, d.department_id, new.approved_at,
           jsonb_build_object(
             'currency', v_currency,
             'envelope', d.budget_amount::text,
             'reason', r.reason,
             'lines', coalesce((
               select jsonb_agg(v.line order by (v.line ->> 'sortOrder')::integer, v.line ->> 'title')
               from private.training_plan_version_lines(new.tenant_id, new.id) v
               where d.department_id = any (v.department_ids)), '[]'::jsonb))
    from tms.plan_cycle_departments d
    left join tms.plan_budget_reasons r
      on r.tenant_id = d.tenant_id and r.plan_id = new.id and r.department_id = d.department_id
    where d.tenant_id = new.tenant_id and d.cycle_id = new.cycle_id;
  end if;
  return null;
end
$$;

comment on function private.training_plans_record() is
  'SECURITY-RELEVANT (WP-LD-03). After a training plan''s state changes: its history, and once approved the version as approved and each department''s result. Owner plan_approval_guard; a trigger only.';

grant create on schema private to plan_approval_guard;
alter function private.training_plan_version_lines(uuid, uuid) owner to plan_approval_guard;
alter function private.training_plans_record() owner to plan_approval_guard;
revoke create on schema private from plan_approval_guard;
revoke all on function private.training_plan_version_lines(uuid, uuid) from public;
revoke all on function private.training_plans_record() from public;

create trigger training_plans_record after update on tms.training_plans
  for each row execute function private.training_plans_record();

-- ---------------------------------------------------------------------------------------------------
-- Row-level security and grants
-- ---------------------------------------------------------------------------------------------------
-- The plan: its state moves through the guard above — the L&D Manager (submit, revise) or the step's role.
create policy training_plans_update on tms.training_plans for update to authenticated
  using ((select private.may_manage_training_plan((select private.current_tenant_id())))
         or (select private.may_decide_training_plan((select private.current_tenant_id()), 'hr'))
         or (select private.may_decide_training_plan((select private.current_tenant_id()), 'finance')))
  with check ((select private.may_manage_training_plan((select private.current_tenant_id())))
              or (select private.may_decide_training_plan((select private.current_tenant_id()), 'hr'))
              or (select private.may_decide_training_plan((select private.current_tenant_id()), 'finance')));
grant update (status, send_back_comment) on tms.training_plans to authenticated;

alter table tms.training_plan_events enable row level security;
alter table tms.training_plan_events force row level security;
create policy tenant_isolation on tms.training_plan_events
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
create policy training_plan_events_read on tms.training_plan_events for select to authenticated
  using ((select private.may_read_training_plan((select private.current_tenant_id())))
         or cardinality((select private.training_plan_units((select private.current_tenant_id()), false))) > 0);
create policy training_plan_events_plan_approval_guard_insert on tms.training_plan_events for insert
  to plan_approval_guard with check (true);
grant select on tms.training_plan_events to authenticated;

alter table tms.training_plan_versions enable row level security;
alter table tms.training_plan_versions force row level security;
create policy tenant_isolation on tms.training_plan_versions
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
-- The whole plan as approved: organization-wide readers only.
create policy training_plan_versions_read on tms.training_plan_versions for select to authenticated
  using ((select private.may_read_training_plan((select private.current_tenant_id()))));
create policy training_plan_versions_plan_approval_guard_insert on tms.training_plan_versions for insert
  to plan_approval_guard with check (true);
grant select on tms.training_plan_versions to authenticated;

alter table tms.training_plan_department_results enable row level security;
alter table tms.training_plan_department_results force row level security;
create policy tenant_isolation on tms.training_plan_department_results
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
-- A department's part: the plan's readers, a department-limited planner of the unit, the department's head.
create policy training_plan_department_results_read on tms.training_plan_department_results for select
  to authenticated
  using ((select private.may_read_training_plan((select private.current_tenant_id())))
         or department_id = any ((select private.training_plan_units((select private.current_tenant_id()), false))::uuid[])
         or private.may_submit_plan_needs(tenant_id, department_id));
create policy training_plan_department_results_plan_approval_guard_insert on tms.training_plan_department_results
  for insert to plan_approval_guard with check (true);
grant select on tms.training_plan_department_results to authenticated;
