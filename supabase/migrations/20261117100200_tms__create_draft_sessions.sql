-- From the approved training plan to courses and draft sessions (WP-LD-04, T-M3-08; FR-PLN-09, FR-CAT-01 «create course
-- from plan line», FR-SCH-01 core, FR-IAM-08 R1 note; business flow docs/business-flows/EP-PLN-planning-cycle.md §3 F
-- step 21; proposal docs/product/proposals/wp-ld-04-plan-to-courses-and-draft-sessions.md, its three questions
-- answered «A» on 15 Nov 2026; approved screens docs/design/screens/m3-plan-to-sessions/README.md). Class: T [std].
-- PII: person ids of the planned participants (the people the heads named for the line's needs) and the [std] stamps.
--
-- Tables
--   tms.sessions              one row per session. In this work package every session is a DRAFT made from a line of
--                             an approved plan: its course (required), the MONTH it is planned for (first day of the
--                             month), an optional branch, seats and the estimated cost (the line's cost per session +
--                             seats × its cost per person, in the cycle's currency). It has no day, time, venue or
--                             instructor yet: those, the statuses after `draft`, the session code and sessions made
--                             without a plan come with scheduling (WP-LD-08), which widens the checks named below
--   tms.session_participants  the planned participants of a draft: people the heads named for the line's needs
--                             (tms.plan_need_people). A person is in at most one session of a line. Nobody is invited
--                             or enrolled (WP-LD-08 / WP-LD-09)
-- New columns of tms.plan_lines: how the line got its course after approval (course_origin `created` from the line /
-- `linked` from the library; null: named in the needs or set while the plan was built) and when / by whom
-- (course_set_at / course_set_by, stamped by the guard).
-- Who (policies; the server actions check the same first)
--   draft sessions and planned participants: tms.session.manage organization-wide (L&D Manager, Training Coordinator;
--   private.may_manage_sessions), or a custom role limited to «A department» with it: the sessions of lines holding a
--   need of its units (read) or only of its units (write), the participants of its units
--   (private.session_units, migration 20261117100100). Nobody else — employees, department heads, the HR Manager,
--   Finance — reads a draft (proposal §3: a draft promises nothing).
--   an approved line's course: the organization-wide L&D Manager (tms.training_plan.manage organization-wide) or a
--   holder of tms.course.manage (organization-only: the L&D Manager, the Training Coordinator — approved design
--   README «Create course» / «Link course»; policy plan_lines_course_update, approved plans only) changes EXACTLY
--   that on an approved plan (course_id and course_origin; the guard stamps the rest), an ACTIVE course of the
--   library, while the line has no draft — nothing else of a locked plan moves (JK008 as before), and on a plan that
--   is being built only its planners change its lines (the guard repeats the planning policy).
-- Rules (guards)
--   * a draft is made from a line IN THE PLAN of an APPROVED plan that has its course, and carries that course (JK013);
--     a line gets at most the sessions the plan works out for it — people ÷ maximum per session, rounded up (JK014);
--     the month lies in the cycle's planning period (JK015) — outside the line's quarter is allowed (Q3 = A: the
--     application marks it); a session never has fewer seats than planned participants (JK016)
--   * a draft keeps its line, plan, course and version; its delivery type is always its course's; month, branch (an
--     active branch of the organization) and seats change freely, whatever the plan's state (a revised plan leaves
--     its drafts as they are, Q «plan revised»: nothing is deleted automatically); a draft can be deleted freely
--   * a planned participant is a person named for a need of the session's line; it may move to another session of
--     the same line
--   * while a revised plan is edited, a line with draft sessions keeps its course, stays in the plan and is not
--     deleted, and a need with planned participants stays in its line (JK017: delete the drafts first, decided
--     15 Nov 2026); its seats and session size may change (the line then shows over / under drafted)
--   * a plan line with draft sessions is never deleted (JK017; the foreign key agrees)
-- Whether a line has drafts, or a need planned participants, is asked of private.plan_line_has_sessions /
-- private.plan_need_has_participants (SECURITY DEFINER, owner training_plan_guard): the L&D Manager who changes the
-- plan may hold no tms.session.manage and then reads no draft.
-- Locks: a draft's creation takes the organization's plan lock SHARED (private.training_plan_lock, migration
-- 20261116100200) before it reads the plan's state, as every change of what a plan is made of; every change of a
-- line's drafts or participants — and the course of an approved line — takes the line's own transaction lock
-- (after the plan lock) BEFORE it reads the line, so the course, the session count and the seats are checked against
-- what is committed.
-- Custom SQLSTATEs: JK013 not ready for draft sessions · JK014 the line's sessions are all drafted · JK015 the month is
-- outside the planning period · JK016 more planned participants than seats · JK017 the line has draft sessions (or the
-- need planned participants): delete them first.
-- Expand-first: new tables, nullable columns, new helpers and replaced guards that keep every earlier rule; the
-- previous release writes none of the new columns.

-- ---------------------------------------------------------------------------------------------------
-- tms.plan_lines: the course an approved line gets
-- ---------------------------------------------------------------------------------------------------
alter table tms.plan_lines
  add column course_origin text constraint plan_lines_course_origin_check check (course_origin in ('created', 'linked')),
  add column course_set_at timestamptz,
  add column course_set_by uuid;

comment on column tms.plan_lines.course_origin is
  'How an approved line got its course (WP-LD-04): created from the line, or linked from the library; null: named in the needs, or set while the plan was built.';

-- ---------------------------------------------------------------------------------------------------
-- tms.sessions
-- ---------------------------------------------------------------------------------------------------
create table tms.sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant_id() references platform.tenants (id),
  -- WP-LD-08 adds the statuses after `draft` (BRD Appendix C).
  status text not null default 'draft' constraint sessions_status_check check (status in ('draft')),
  -- Where it comes from: a line of a training plan, as approved in plan_version (WP-LD-08 may allow sessions without
  -- a plan by dropping sessions_from_plan_check).
  plan_id uuid,
  cycle_id uuid,
  plan_line_id uuid,
  plan_version integer constraint sessions_plan_version_check check (plan_version >= 1),
  course_id uuid not null,
  -- FR-CAT-01 delivery types (the same list as tms.courses); the course's when the session was made.
  delivery_type text not null
    constraint sessions_delivery_type_check check (delivery_type in (
      'classroom', 'virtual', 'blended', 'hybrid', 'on_the_job', 'workshop', 'conference', 'exam', 'elearning')),
  -- The month a draft is planned for: the first day of that month (Q1 = A spreads the line's sessions over its quarter).
  month date constraint sessions_month_check check (month = date_trunc('month', month)::date),
  branch_id uuid,
  seats integer not null constraint sessions_seats_check check (seats between 1 and 10000),
  -- The line's cost per session + seats × its cost per person (set by the guard), in the cycle's currency.
  estimated_cost numeric(24,4) constraint sessions_estimated_cost_check check (estimated_cost >= 0),
  cost_currency char(3) constraint sessions_cost_currency_check check (cost_currency ~ '^[A-Z]{3}$'),
  -- [std]
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  unique (tenant_id, id),
  constraint sessions_line_key_uq unique (tenant_id, id, plan_line_id),
  constraint sessions_from_plan_check check (
    plan_id is not null and cycle_id is not null and plan_line_id is not null and plan_version is not null),
  constraint sessions_draft_month_check check (status <> 'draft' or month is not null),
  -- plan_lines_plan_key_uq (migration 20261115100200).
  foreign key (tenant_id, plan_line_id, plan_id, cycle_id) references tms.plan_lines (tenant_id, id, plan_id, cycle_id),
  foreign key (tenant_id, course_id) references tms.courses (tenant_id, id),
  foreign key (tenant_id, branch_id) references platform.branches (tenant_id, id)
);
comment on table tms.sessions is
  'Training sessions (FR-SCH-01; WP-LD-04): drafts made from the lines of an approved training plan — course, month, branch, seats, estimated cost. Owner: tms. Class: T [std].';

create index sessions_line_idx on tms.sessions (tenant_id, plan_line_id, month, created_at);
create index sessions_month_idx on tms.sessions (tenant_id, month);
create index sessions_plan_idx on tms.sessions (tenant_id, plan_id);
create index sessions_course_idx on tms.sessions (tenant_id, course_id);
create index sessions_branch_idx on tms.sessions (tenant_id, branch_id) where branch_id is not null;

-- ---------------------------------------------------------------------------------------------------
-- tms.session_participants
-- ---------------------------------------------------------------------------------------------------
create table tms.session_participants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant_id() references platform.tenants (id),
  session_id uuid not null,
  plan_line_id uuid not null,
  -- The need the person was named for (of the session's line) and its department (set by the guard).
  need_id uuid not null,
  department_id uuid not null,
  person_id uuid not null,
  -- [std]
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  unique (tenant_id, id),
  -- A person is in at most one session of a line.
  constraint session_participants_line_person_uq unique (tenant_id, plan_line_id, person_id),
  -- Moves stay within the line (the session's line is part of the key).
  foreign key (tenant_id, session_id, plan_line_id) references tms.sessions (tenant_id, id, plan_line_id)
    on delete cascade,
  -- Someone the head named for the need; a name the head removes leaves the draft too.
  foreign key (tenant_id, need_id, person_id) references tms.plan_need_people (tenant_id, need_id, person_id)
    on delete cascade,
  foreign key (tenant_id, person_id) references platform.persons (tenant_id, id)
);
comment on table tms.session_participants is
  'The planned participants of a draft session (WP-LD-04): people named for the needs of its plan line, at most one session of a line each. Nobody is invited. Owner: tms. Class: T [std]. PII: person ids.';

create index session_participants_session_idx on tms.session_participants (tenant_id, session_id);
create index session_participants_need_idx on tms.session_participants (tenant_id, need_id, person_id);
create index session_participants_person_idx on tms.session_participants (tenant_id, person_id);

-- ---------------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------------

-- The state of a plan of the caller's organization after the organization's plan lock (SHARED): a submit, decision
-- or revision in flight is waited for, and the state is read afterwards (VOLATILE: each statement reads anew). Fails
-- closed: a plan the caller's organization does not have is refused.
create or replace function private.training_plan_locked_status(p_tenant_id uuid, p_plan_id uuid)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_status text;
begin
  perform private.training_plan_lock(p_tenant_id, false);
  if current_user = 'authenticated' then
    v_status := private.training_plan_status(p_tenant_id, p_plan_id);
  else
    select p.status into v_status from tms.training_plans p where p.tenant_id = p_tenant_id and p.id = p_plan_id;
  end if;
  if v_status is null then
    raise insufficient_privilege using message = 'the training plan is not known';
  end if;
  return v_status;
end
$$;

comment on function private.training_plan_locked_status(uuid, uuid) is
  'SECURITY-RELEVANT (WP-LD-04). The state of a training plan of the caller''s organization, read after the organization''s plan lock (shared); refused when unknown.';

revoke all on function private.training_plan_locked_status(uuid, uuid) from public;
grant execute on function private.training_plan_locked_status(uuid, uuid) to authenticated;

-- The transaction lock of one plan line's drafts (their count, seats and participants).
create or replace function private.plan_line_sessions_lock(p_line_id uuid)
returns void
language sql
volatile
set search_path = ''
as $$
  select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tms.sessions:' || p_line_id::text, 0));
$$;

revoke all on function private.plan_line_sessions_lock(uuid) from public;
grant execute on function private.plan_line_sessions_lock(uuid) to authenticated;

-- The signed-in member holds tms.course.manage (organization-only: the L&D Manager, the Training Coordinator, or a
-- custom role with it) — who may also give an approved line its course (approved design README). Never null.
create or replace function private.may_manage_courses(p_tenant_id uuid)
returns boolean
language sql stable
set search_path = ''
as $$
  select coalesce(private.request_claims() ->> 'role' = 'authenticated'
                  and private.member_has_permission(p_tenant_id, private.request_user_id(), 'tms.course.manage'),
                  false);
$$;

comment on function private.may_manage_courses(uuid) is
  'SECURITY-RELEVANT (WP-LD-04). The signed-in member holds tms.course.manage (organization-wide by definition): may give an approved plan line its course.';

revoke all on function private.may_manage_courses(uuid) from public;
grant execute on function private.may_manage_courses(uuid) to authenticated;

-- training_plan_guard (migration 20261115100200) also answers whether a line has drafts and a need planned
-- participants — for the plan's guards and the application, also when the caller reads no draft (it may hold
-- tms.training_plan.manage without tms.session.manage). It reads the ids only, never who is planned.
grant select (tenant_id, plan_line_id) on tms.sessions to training_plan_guard;
grant select (tenant_id, plan_line_id, need_id) on tms.session_participants to training_plan_guard;
create policy sessions_training_plan_guard_read on tms.sessions for select
  to training_plan_guard using (true);
create policy session_participants_training_plan_guard_read on tms.session_participants for select
  to training_plan_guard using (true);

-- Does a line of the caller's organization have draft sessions (signed-in members only; false otherwise)?
create or replace function private.plan_line_has_sessions(p_line_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.request_claims() ->> 'role' = 'authenticated'
                  and exists (select 1 from tms.sessions s
                              where s.tenant_id = private.current_tenant_id() and s.plan_line_id = p_line_id),
                  false);
$$;

comment on function private.plan_line_has_sessions(uuid) is
  'SECURITY-RELEVANT (WP-LD-04). A plan line of the caller''s organization has draft sessions (signed-in members only), whether or not the caller reads them — for the plan''s guards and the application. Owner training_plan_guard.';

-- Are people of a need planned in the drafts of a line of the caller's organization (signed-in members only)?
create or replace function private.plan_need_has_participants(p_need_id uuid, p_line_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.request_claims() ->> 'role' = 'authenticated'
                  and exists (select 1 from tms.session_participants p
                              where p.tenant_id = private.current_tenant_id() and p.need_id = p_need_id
                                and p.plan_line_id = p_line_id),
                  false);
$$;

comment on function private.plan_need_has_participants(uuid, uuid) is
  'SECURITY-RELEVANT (WP-LD-04). People named for a need are planned participants of the drafts of a line of the caller''s organization (signed-in members only), whether or not the caller reads them. Owner training_plan_guard.';

grant create on schema private to training_plan_guard;
alter function private.plan_line_has_sessions(uuid) owner to training_plan_guard;
alter function private.plan_need_has_participants(uuid, uuid) owner to training_plan_guard;
revoke create on schema private from training_plan_guard;
revoke all on function private.plan_line_has_sessions(uuid) from public;
revoke all on function private.plan_need_has_participants(uuid, uuid) from public;
grant execute on function private.plan_line_has_sessions(uuid) to authenticated;
grant execute on function private.plan_need_has_participants(uuid, uuid) to authenticated;

-- The same questions inside a guard: through the helpers for a signed-in member (who may read no draft), directly
-- for the database's own roles (migrations, tests as owner). SECURITY INVOKER.
create or replace function private.plan_line_sessions_exist(p_tenant_id uuid, p_line_id uuid)
returns boolean
language plpgsql
volatile
set search_path = ''
as $$
begin
  if current_user = 'authenticated' then
    return private.plan_line_has_sessions(p_line_id);
  end if;
  return exists (select 1 from tms.sessions s where s.tenant_id = p_tenant_id and s.plan_line_id = p_line_id);
end
$$;

create or replace function private.plan_need_participants_exist(p_tenant_id uuid, p_need_id uuid, p_line_id uuid)
returns boolean
language plpgsql
volatile
set search_path = ''
as $$
begin
  if current_user = 'authenticated' then
    return private.plan_need_has_participants(p_need_id, p_line_id);
  end if;
  return exists (select 1 from tms.session_participants p
                 where p.tenant_id = p_tenant_id and p.need_id = p_need_id and p.plan_line_id = p_line_id);
end
$$;

revoke all on function private.plan_line_sessions_exist(uuid, uuid) from public;
revoke all on function private.plan_need_participants_exist(uuid, uuid, uuid) from public;
grant execute on function private.plan_line_sessions_exist(uuid, uuid) to authenticated;
grant execute on function private.plan_need_participants_exist(uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- The plan's lines: as 20261115100200, the course of an approved line, and the drafts a revised plan keeps (WP-LD-04)
-- ---------------------------------------------------------------------------------------------------
create or replace function private.plan_lines_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_row record := case when tg_op = 'DELETE' then old else new end;
  v_fixed constant text[] := array['course_id', 'course_origin', 'course_set_at', 'course_set_by',
                                   'updated_at', 'updated_by', 'version'];
  v_status text;
  v_signed_in boolean := coalesce(private.request_claims() ->> 'role' = 'authenticated', false);
  v_departments uuid[];
  v_units uuid[];
begin
  -- An approved plan is locked — except the course of a line in the plan, which the organization-wide L&D Manager
  -- or a holder of tms.course.manage (the Training Coordinator) creates or links once the plan is approved
  -- (WP-LD-04). Nothing else of the line may move with it.
  if tg_op = 'UPDATE' then
    v_status := private.training_plan_locked_status(new.tenant_id, new.plan_id);
  end if;
  if v_status = 'approved' then
    if v_signed_in and not private.may_manage_training_plan(new.tenant_id)
       and not private.may_manage_courses(new.tenant_id) then
      raise insufficient_privilege
        using message = 'the organization-wide L&D Manager or a course manager gives an approved line its course';
    end if;
    if (to_jsonb(new) - v_fixed) is distinct from (to_jsonb(old) - v_fixed) then
      raise exception 'the training plan is frozen while it waits for approval and locked once approved'
        using errcode = 'JK008';
    end if;
    if new.course_id is not distinct from old.course_id then
      new.course_origin := old.course_origin;
      new.course_set_at := old.course_set_at;
      new.course_set_by := old.course_set_by;
      return new;
    end if;
    if new.course_id is null or old.status <> 'in_plan' then
      raise exception 'a line in the approved plan gets a course; it is never taken away' using errcode = 'JK001';
    end if;
    if not exists (select 1 from tms.courses c
                   where c.tenant_id = new.tenant_id and c.id = new.course_id and c.status = 'active') then
      raise exception 'an approved line gets an active course of the library' using errcode = 'JK001';
    end if;
    -- The line's drafts are counted after the line's lock: a draft being added waits, or is seen (review M2).
    perform private.plan_line_sessions_lock(new.id);
    if private.plan_line_sessions_exist(new.tenant_id, new.id) then
      raise exception 'a line with draft sessions keeps its course: delete its draft sessions first'
        using errcode = 'JK017';
    end if;
    new.course_origin := coalesce(new.course_origin, 'linked');
    new.course_set_at := now();
    new.course_set_by := private.request_person_id();
    -- The approved plan is not edited: edited_at stays (it says L&D changed the line while building the plan).
    return new;
  end if;

  perform private.training_plan_editable(v_row.tenant_id, v_row.plan_id);
  if tg_op = 'DELETE' then
    -- A revised plan keeps its drafts (decided 15 Nov 2026): their line stays until they are deleted.
    if private.plan_line_sessions_exist(old.tenant_id, old.id) then
      raise exception 'a line with draft sessions stays in the plan: delete its draft sessions first'
        using errcode = 'JK017';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    -- Only the plan's planners change a line of a plan being built: the course policy (tms.course.manage) reaches
    -- approved plans only — repeated here should the plan have been revised in the meantime (plan_lines_update).
    if v_signed_in and not private.may_manage_training_plan(new.tenant_id) then
      v_departments := private.plan_line_departments(old.id);
      v_units := private.training_plan_units(new.tenant_id, true);
      if not (v_departments <@ v_units and cardinality(v_units) > 0
              and (cardinality(v_departments) > 0 or old.created_by = private.request_person_id())) then
        raise insufficient_privilege using message = 'only the training plan''s planners change its lines';
      end if;
    end if;
    if (new.plan_id, new.cycle_id, new.group_key) is distinct from (old.plan_id, old.cycle_id, old.group_key) then
      raise exception 'a plan line stays in its plan and keeps what it was built from' using errcode = 'JK001';
    end if;
    -- A revised plan keeps its drafts (decided 15 Nov 2026): a line with drafts keeps its course and stays in the
    -- plan; its seats and session size may change (the line shows over / under drafted).
    if (new.course_id is distinct from old.course_id or (old.status = 'in_plan' and new.status <> 'in_plan'))
       and private.plan_line_sessions_exist(new.tenant_id, new.id) then
      raise exception 'a line with draft sessions keeps its course and stays in the plan: delete its draft sessions first'
        using errcode = 'JK017';
    end if;
    -- Every change of a line is L&D's hand.
    new.edited_at := now();
    new.edited_by := private.request_person_id();
    -- A course set while the plan is built is the plan's (no origin); the stamps say when it last changed.
    if new.course_id is distinct from old.course_id then
      new.course_origin := null;
      new.course_set_at := now();
      new.course_set_by := private.request_person_id();
    else
      new.course_origin := old.course_origin;
      new.course_set_at := old.course_set_at;
      new.course_set_by := old.course_set_by;
    end if;
  else
    -- A new line is L&D's when they made it (a need moved out); lines built from the needs are not.
    new.edited_at := case when new.edited_at is not null then now() end;
    new.edited_by := case when new.edited_at is not null then private.request_person_id() end;
    new.course_origin := null;
    new.course_set_at := null;
    new.course_set_by := null;
  end if;
  return new;
end
$$;

comment on function private.plan_lines_guard() is
  'SECURITY-RELEVANT (WP-LD-02, WP-LD-04). Plan lines change only while the plan is a draft (or sent back), by its planners, every change stamped as L&D''s edit, and a line with draft sessions keeps its course and its place; on an approved plan the organization-wide L&D Manager or a course manager only gives a line in the plan an active course, while it has no draft.';

-- The course of an approved line: also for a holder of tms.course.manage (the Training Coordinator) — the guard lets
-- only the course through.
create policy plan_lines_course_update on tms.plan_lines for update to authenticated
  using ((select private.may_manage_courses((select private.current_tenant_id())))
         and private.training_plan_status(tenant_id, plan_id) = 'approved')
  with check ((select private.may_manage_courses((select private.current_tenant_id())))
              and private.training_plan_status(tenant_id, plan_id) = 'approved');

-- ---------------------------------------------------------------------------------------------------
-- The plan's needs in lines: as 20261115100200, and a need with planned participants stays in its line (WP-LD-04)
-- ---------------------------------------------------------------------------------------------------
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
    -- Taken out of its line by a statement (to be placed elsewhere): not while its people are planned in the line's
    -- drafts. A need deleted with its department's needs goes with its named people (and their places: cascade).
    if pg_catalog.pg_trigger_depth() = 1
       and private.plan_need_participants_exist(old.tenant_id, old.need_id, old.line_id) then
      raise exception 'people of this need are planned in the line''s draft sessions: delete those draft sessions first'
        using errcode = 'JK017';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE'
     and (new.plan_id, new.cycle_id, new.need_id, new.department_id)
         is distinct from (old.plan_id, old.cycle_id, old.need_id, old.department_id) then
    raise exception 'a need''s place in the plan moves from line to line only' using errcode = 'JK001';
  end if;
  if tg_op = 'UPDATE' and new.line_id is distinct from old.line_id
     and private.plan_need_participants_exist(old.tenant_id, old.need_id, old.line_id) then
    raise exception 'people of this need are planned in the line''s draft sessions: delete those draft sessions first'
      using errcode = 'JK017';
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
    new.topic := old.topic;
    new.course_id := old.course_id;
    return new;
  end if;
  -- The snapshot of what the department submitted (never taken from the statement).
  select n.people_count,
         (select count(*) from tms.plan_need_people p where p.tenant_id = n.tenant_id and p.need_id = n.id),
         n.topic, n.course_id
    into new.seats, new.named, new.topic, new.course_id
  from tms.plan_needs n where n.tenant_id = new.tenant_id and n.id = new.need_id;
  if new.seats is null then
    raise insufficient_privilege using message = 'the need is not readable';
  end if;
  return new;
end
$$;

comment on function private.plan_line_needs_guard() is
  'SECURITY-RELEVANT (WP-LD-02, WP-LD-04). Only submitted needs enter the plan, while it is a draft; seats, named people, topic and course are taken from the need; a need whose people are planned in the line''s drafts stays in its line.';

grant update (course_origin) on tms.plan_lines to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Guards of the drafts
-- ---------------------------------------------------------------------------------------------------
create or replace function private.sessions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_line_plan uuid;
  v_line_cycle uuid;
  v_line_status text;
  v_line_course uuid;
  v_line_max integer;
  v_line_cost_per_session numeric;
  v_line_cost_per_person numeric;
  v_currency text;
  v_period_start date;
  v_period_end date;
  v_planned integer;
  v_drafted integer;
  v_people integer;
  v_plan_status text;
begin
  if tg_op = 'DELETE' then
    -- A draft promises nothing: it is deleted freely (its participants go with it).
    if old.status <> 'draft' then
      raise exception 'only a draft session is deleted' using errcode = 'JK001';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if (new.tenant_id, new.status, new.plan_id, new.cycle_id, new.plan_line_id, new.plan_version, new.course_id,
        new.delivery_type, new.cost_currency)
       is distinct from
       (old.tenant_id, old.status, old.plan_id, old.cycle_id, old.plan_line_id, old.plan_version, old.course_id,
        old.delivery_type, old.cost_currency) then
      raise exception 'a draft session keeps its line, plan, course and state' using errcode = 'JK001';
    end if;
    perform private.plan_line_sessions_lock(new.plan_line_id);
  else
    new.status := 'draft';
    -- The plan's state after the organization's plan lock (shared), then the line's own lock — in that order, as
    -- every writer of a line's drafts and of an approved line's course.
    v_plan_status := private.training_plan_locked_status(new.tenant_id, new.plan_id);
    perform private.plan_line_sessions_lock(new.plan_line_id);
  end if;

  -- The line as the caller reads it (row-level security: a line outside the caller's reach is not known), read
  -- after the line's lock: a course being linked at the same moment is waited for, then seen (review M2).
  select l.plan_id, l.cycle_id, l.status, l.course_id, l.max_per_session, l.cost_per_session,
         coalesce(l.cost_per_person, 0)
    into v_line_plan, v_line_cycle, v_line_status, v_line_course, v_line_max, v_line_cost_per_session,
         v_line_cost_per_person
  from tms.plan_lines l where l.tenant_id = new.tenant_id and l.id = new.plan_line_id;
  if v_line_plan is null or (v_line_plan, v_line_cycle) is distinct from (new.plan_id, new.cycle_id) then
    raise insufficient_privilege using message = 'the plan line is not known';
  end if;
  select c.currency, c.period_start_on, c.period_end_on into v_currency, v_period_start, v_period_end
  from tms.plan_cycles c where c.tenant_id = new.tenant_id and c.id = new.cycle_id;
  if v_currency is null then
    raise insufficient_privilege using message = 'the planning cycle is not known';
  end if;

  if tg_op = 'INSERT' then
    if v_plan_status <> 'approved' then
      raise exception 'draft sessions are made from the lines of an approved training plan' using errcode = 'JK013';
    end if;
    if v_line_status <> 'in_plan' then
      raise exception 'a line left out of the plan gets no sessions' using errcode = 'JK013';
    end if;
    if v_line_course is null or v_line_course <> new.course_id then
      raise exception 'a line''s sessions are of its course: give the line its course first' using errcode = 'JK013';
    end if;
    select p.plan_version into new.plan_version
    from tms.training_plans p where p.tenant_id = new.tenant_id and p.id = new.plan_id;
    if new.plan_version is null then
      raise insufficient_privilege using message = 'the training plan is not known';
    end if;
    -- At most the sessions the plan works out for the line (D12: people ÷ maximum per session, rounded up).
    select coalesce(sum(x.seats), 0) into v_people
    from tms.plan_line_needs x where x.tenant_id = new.tenant_id and x.line_id = new.plan_line_id;
    v_planned := case when v_line_max is null or v_line_max < 1 then 0
                      else ceil(v_people::numeric / v_line_max)::integer end;
    select count(*) into v_drafted
    from tms.sessions s where s.tenant_id = new.tenant_id and s.plan_line_id = new.plan_line_id;
    if v_drafted >= v_planned then
      raise exception 'the line''s sessions are all drafted (% of %)', v_drafted, v_planned using errcode = 'JK014';
    end if;
    -- Always the course's delivery type (never taken from the statement).
    new.delivery_type := (select c.delivery_type from tms.courses c
                          where c.tenant_id = new.tenant_id and c.id = new.course_id);
    if new.delivery_type is null then
      raise insufficient_privilege using message = 'the course is not known';
    end if;
    new.cost_currency := v_currency;
  end if;

  if new.branch_id is not null and (tg_op = 'INSERT' or new.branch_id is distinct from old.branch_id) then
    -- An active branch of the organization.
    if not exists (select 1 from platform.branches b
                   where b.tenant_id = new.tenant_id and b.id = new.branch_id and b.status = 'active'
                     and b.deleted_at is null) then
      raise exception 'a draft session''s branch is an active branch of the organization' using errcode = 'JK001';
    end if;
  end if;

  if tg_op = 'INSERT' or new.month is distinct from old.month then
    -- Within the planning period; outside the line's quarter is allowed (Q3 = A, marked by the application).
    if new.month is not null
       and (new.month < date_trunc('month', v_period_start)::date or new.month > v_period_end) then
      raise exception 'a draft session''s month lies in the planning period' using errcode = 'JK015';
    end if;
  end if;

  if tg_op = 'INSERT' or new.seats is distinct from old.seats then
    if tg_op = 'UPDATE' and new.seats < (select count(*) from tms.session_participants p
                                         where p.tenant_id = new.tenant_id and p.session_id = new.id) then
      raise exception 'a session has at least as many seats as planned participants' using errcode = 'JK016';
    end if;
    -- The estimate follows the line's costs (never taken from the statement).
    new.estimated_cost := case when v_line_cost_per_session is null then null
                               else v_line_cost_per_session + new.seats * v_line_cost_per_person end;
  else
    new.estimated_cost := old.estimated_cost;
  end if;
  return new;
end
$$;

comment on function private.sessions_guard() is
  'SECURITY-RELEVANT (WP-LD-04). A draft is made from a line in the plan of an approved plan, with its course (and its delivery type), up to the sessions the plan works out for the line, in the planning period, at an active branch; it keeps its line, plan and course; month, branch and seats change; it is deleted freely. The estimated cost is the database''s.';

revoke all on function private.sessions_guard() from public;

create trigger sessions_guard before insert or update or delete on tms.sessions
  for each row execute function private.sessions_guard();
create trigger sessions_stamp_row before insert or update on tms.sessions
  for each row execute function private.stamp_row();

create or replace function private.session_participants_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_seats integer;
  v_status text;
begin
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE'
     and (new.tenant_id, new.plan_line_id, new.need_id, new.department_id, new.person_id)
         is distinct from (old.tenant_id, old.plan_line_id, old.need_id, old.department_id, old.person_id) then
    raise exception 'a planned participant only moves to another session of the line' using errcode = 'JK001';
  end if;
  perform private.plan_line_sessions_lock(new.plan_line_id);
  if tg_op = 'INSERT' then
    -- Named for a need of the session's line (as the caller reads the line's needs); its department from there.
    select x.department_id into new.department_id
    from tms.plan_line_needs x
    where x.tenant_id = new.tenant_id and x.need_id = new.need_id and x.line_id = new.plan_line_id;
    if new.department_id is null then
      raise exception 'a planned participant is named for a need of the session''s line' using errcode = 'JK013';
    end if;
  end if;
  if tg_op = 'INSERT' or new.session_id is distinct from old.session_id then
    select s.seats, s.status into v_seats, v_status
    from tms.sessions s where s.tenant_id = new.tenant_id and s.id = new.session_id;
    if v_status is distinct from 'draft' then
      raise exception 'planned participants belong to a draft session' using errcode = 'JK013';
    end if;
    if (select count(*) from tms.session_participants p
        where p.tenant_id = new.tenant_id and p.session_id = new.session_id and p.id <> new.id) >= v_seats then
      raise exception 'a session has at least as many seats as planned participants' using errcode = 'JK016';
    end if;
  end if;
  return new;
end
$$;

comment on function private.session_participants_guard() is
  'SECURITY-RELEVANT (WP-LD-04). A planned participant is a person named for a need of the draft''s line, within its seats; it only moves to another session of the line.';

revoke all on function private.session_participants_guard() from public;

create trigger session_participants_guard before insert or update or delete on tms.session_participants
  for each row execute function private.session_participants_guard();
create trigger session_participants_stamp_row before insert or update on tms.session_participants
  for each row execute function private.stamp_row();

-- ---------------------------------------------------------------------------------------------------
-- Row-level security and grants
-- ---------------------------------------------------------------------------------------------------
-- Organization-wide holders first (one init-plan per statement), then the department-limited branch: the drafts of
-- lines holding a need of its units (read) or only of its units (write) — as the training plan's lines.

alter table tms.sessions enable row level security;
alter table tms.sessions force row level security;
create policy tenant_isolation on tms.sessions
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
create policy sessions_read on tms.sessions for select to authenticated
  using ((select private.may_manage_sessions((select private.current_tenant_id())))
         or private.plan_line_departments(plan_line_id)
            && (select private.session_units((select private.current_tenant_id()))));
create policy sessions_insert on tms.sessions for insert to authenticated
  with check ((select private.may_manage_sessions((select private.current_tenant_id())))
              or (private.plan_line_departments(plan_line_id) <@ (select private.session_units((select private.current_tenant_id())))
                  and cardinality(private.plan_line_departments(plan_line_id)) > 0));
create policy sessions_update on tms.sessions for update to authenticated
  using ((select private.may_manage_sessions((select private.current_tenant_id())))
         or (private.plan_line_departments(plan_line_id) <@ (select private.session_units((select private.current_tenant_id())))
             and cardinality(private.plan_line_departments(plan_line_id)) > 0))
  with check ((select private.may_manage_sessions((select private.current_tenant_id())))
              or (private.plan_line_departments(plan_line_id) <@ (select private.session_units((select private.current_tenant_id())))
                  and cardinality(private.plan_line_departments(plan_line_id)) > 0));
create policy sessions_delete on tms.sessions for delete to authenticated
  using ((select private.may_manage_sessions((select private.current_tenant_id())))
         or (private.plan_line_departments(plan_line_id) <@ (select private.session_units((select private.current_tenant_id())))
             and cardinality(private.plan_line_departments(plan_line_id)) > 0));
grant select, delete on tms.sessions to authenticated;
grant insert (tenant_id, plan_id, cycle_id, plan_line_id, course_id, delivery_type, month, branch_id, seats)
  on tms.sessions to authenticated;
grant update (month, branch_id, seats) on tms.sessions to authenticated;

alter table tms.session_participants enable row level security;
alter table tms.session_participants force row level security;
create policy tenant_isolation on tms.session_participants
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
-- A department-limited planner reads its units' people only (not who the other departments named).
create policy session_participants_read on tms.session_participants for select to authenticated
  using ((select private.may_manage_sessions((select private.current_tenant_id())))
         or department_id = any ((select private.session_units((select private.current_tenant_id())))::uuid[]));
create policy session_participants_insert on tms.session_participants for insert to authenticated
  with check ((select private.may_manage_sessions((select private.current_tenant_id())))
              or (private.plan_line_departments(plan_line_id) <@ (select private.session_units((select private.current_tenant_id())))
                  and cardinality(private.plan_line_departments(plan_line_id)) > 0));
create policy session_participants_update on tms.session_participants for update to authenticated
  using ((select private.may_manage_sessions((select private.current_tenant_id())))
         or (private.plan_line_departments(plan_line_id) <@ (select private.session_units((select private.current_tenant_id())))
             and cardinality(private.plan_line_departments(plan_line_id)) > 0))
  with check ((select private.may_manage_sessions((select private.current_tenant_id())))
              or (private.plan_line_departments(plan_line_id) <@ (select private.session_units((select private.current_tenant_id())))
                  and cardinality(private.plan_line_departments(plan_line_id)) > 0));
create policy session_participants_delete on tms.session_participants for delete to authenticated
  using ((select private.may_manage_sessions((select private.current_tenant_id())))
         or (private.plan_line_departments(plan_line_id) <@ (select private.session_units((select private.current_tenant_id())))
             and cardinality(private.plan_line_departments(plan_line_id)) > 0));
grant select, delete on tms.session_participants to authenticated;
grant insert (tenant_id, session_id, plan_line_id, need_id, person_id) on tms.session_participants to authenticated;
grant update (session_id) on tms.session_participants to authenticated;
