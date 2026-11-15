-- db-test: run-as=owner
-- From the approved plan to courses and draft sessions (WP-LD-04, T-M3-08; FR-PLN-09, FR-CAT-01, FR-SCH-01 core,
-- FR-IAM-08; migrations 20261117100000…100200): the catalogue row and grants, the helpers, then one journey — a plan
-- with three lines (Excel: Sales + Training & Development, 30 people at most 15 → 2 sessions; Negotiation: Sales
-- only; Public speaking: left out) approved; the L&D Manager gives approved lines their course (nothing else moves);
-- draft sessions made, changed, filled with the people named for the line and deleted — with who may do what: the
-- L&D Manager and the Training Coordinator (everything), a department-limited planner (the lines whose every
-- department is in its unit; reads its unit's people), and NOBODY else — an Employee, the Department Head, the HR
-- Manager and another organization see no draft. The guards: an approved plan's line in the plan with its course
-- (JK013), at most the plan's session count (JK014), a month in the planning period (JK015), never fewer seats than
-- planned participants (JK016), a person named for the line, once per line; a revised plan keeps its drafts — and
-- while it is edited a line with drafts keeps its course and its place, a need with planned people its line (JK017).
-- Review fixes (15 Nov 2026): M1 whether a line has drafts is asked of a SECURITY DEFINER helper (an org-wide planner
-- without tms.session.manage reads none, and is still refused); M3 the revised plan's rules; M4 the Training
-- Coordinator (tms.course.manage) links a course, a department-limited planner never; an archived course is refused;
-- L2 the sessions' key is the lines' own; L3 a draft's delivery type is its course's; L4 an active branch only.
-- Fixtures: 00_helpers_and_fixtures.sql (uA heads TD; uAB: HR Manager of A; cycle ae…01; courses LEAD-101 a71…01,
-- OLD-001 a71…02 archived, B's b71…01), 99_planning_a_fixtures (uL, uT, uE), 99_planning_d_needs_0 (uH heads SAL
-- a3…04; uE works in SAL), 99_people_0 (uM1 …c04). Users act through session_user app_server, as withUserTx does.
\set ON_ERROR_STOP on

-- ---- catalogue, grants, helpers ----------------------------------------------------------------------
do $$
declare
  v_list text;
begin
  perform tests.assert_eq(
    (select code || ':' || risk || ':' || custom_role_use || ':' || privileged::text from platform.ref_permissions
     where code = 'tms.session.manage'),
    'tms.session.manage:medium:scoped:false', 'the draft-session permission: scoped in a custom role, not privileged');
  perform tests.assert_eq(
    (select string_agg(role_code || ':' || scope, ',' order by role_code collate "C")
     from platform.ref_role_permissions where permission_code = 'tms.session.manage'),
    'training_coordinator:tenant,training_manager:tenant',
    'only the L&D team holds it (proposal §3: only the L&D Manager and the Training Coordinator see drafts)');
  perform tests.assert(private.permission_feature('tms.session.manage') is null,
    'drafts belong to no plan feature (they exist only where an approved plan does)');
  perform tests.assert(not private.role_is_privileged('a0000000-0000-4000-8000-000000000001', 'training_coordinator'),
    'the Training Coordinator stays a role that is not privileged');
  perform tests.assert(private.may_manage_sessions('a0000000-0000-4000-8000-000000000001') is false
                       and private.session_units('a0000000-0000-4000-8000-000000000001') = '{}'::uuid[],
    'without claims: a plain «no», never null');

  select string_agg(format('%s%s', p.oid::regprocedure, case when p.prosecdef then ' (definer)' else '' end), ', '
                    order by p.oid::regprocedure::text collate "C")
    into v_list
  from pg_proc p
  where p.oid in ('private.may_manage_sessions(uuid)'::regprocedure, 'private.session_units(uuid)'::regprocedure,
                  'private.training_plan_locked_status(uuid, uuid)'::regprocedure,
                  'private.plan_line_sessions_lock(uuid)'::regprocedure, 'private.sessions_guard()'::regprocedure,
                  'private.session_participants_guard()'::regprocedure, 'private.plan_lines_guard()'::regprocedure,
                  'private.plan_line_needs_guard()'::regprocedure, 'private.may_manage_courses(uuid)'::regprocedure,
                  'private.plan_line_sessions_exist(uuid, uuid)'::regprocedure,
                  'private.plan_need_participants_exist(uuid, uuid, uuid)'::regprocedure);
  perform tests.assert_eq(v_list,
    'private.may_manage_courses(uuid), private.may_manage_sessions(uuid), private.plan_line_needs_guard(), private.plan_line_sessions_exist(uuid,uuid), private.plan_line_sessions_lock(uuid), private.plan_lines_guard(), private.plan_need_participants_exist(uuid,uuid,uuid), private.session_participants_guard(), private.session_units(uuid), private.sessions_guard(), private.training_plan_locked_status(uuid,uuid)',
    'every new helper and guard runs as its caller (no SECURITY DEFINER)');
  -- Review M1: whether a line has drafts (a need planned people) is answered for callers who read no draft.
  select string_agg(format('%s:%s:%s', p.oid::regprocedure, pg_get_userbyid(p.proowner), p.prosecdef::text), ', '
                    order by p.oid::regprocedure::text collate "C")
    into v_list
  from pg_proc p
  where p.oid in ('private.plan_line_has_sessions(uuid)'::regprocedure,
                  'private.plan_need_has_participants(uuid, uuid)'::regprocedure);
  perform tests.assert_eq(v_list,
    'private.plan_line_has_sessions(uuid):training_plan_guard:true, private.plan_need_has_participants(uuid,uuid):training_plan_guard:true',
    'the two questions are SECURITY DEFINER, owned by training_plan_guard');
  perform tests.assert(not has_function_privilege('anon', 'private.plan_line_has_sessions(uuid)', 'EXECUTE')
                       and not has_function_privilege('anon', 'private.plan_need_has_participants(uuid, uuid)', 'EXECUTE')
                       and not has_function_privilege('anon', 'private.may_manage_courses(uuid)', 'EXECUTE')
                       and private.plan_line_has_sessions(gen_random_uuid()) is false
                       and private.plan_need_has_participants(gen_random_uuid(), gen_random_uuid()) is false
                       and private.may_manage_courses('a0000000-0000-4000-8000-000000000001') is false,
    'anonymous callers cannot ask; without claims: a plain «no»');
  perform tests.assert(has_column_privilege('training_plan_guard', 'tms.sessions', 'plan_line_id', 'SELECT')
                       and not has_column_privilege('training_plan_guard', 'tms.sessions', 'seats', 'SELECT')
                       and not has_column_privilege('training_plan_guard', 'tms.session_participants', 'person_id', 'SELECT')
                       and not has_table_privilege('training_plan_guard', 'tms.sessions', 'UPDATE'),
    'training_plan_guard reads the drafts'' line and need ids only — never who is planned');
  -- Review L2: the sessions point at the lines' own key (no second, identical unique index).
  perform tests.assert(not exists (select 1 from pg_constraint where conname = 'plan_lines_line_key_uq')
                       and (select c.conindid::regclass::text from pg_constraint c
                            where c.conrelid = 'tms.sessions'::regclass and c.contype = 'f'
                              and c.confrelid = 'tms.plan_lines'::regclass) = 'tms.plan_lines_plan_key_uq',
    'the sessions'' foreign key uses plan_lines_plan_key_uq');
  perform tests.assert((select count(*) from pg_policy where polrelid = 'tms.plan_lines'::regclass
                          and polname = 'plan_lines_course_update' and polcmd = 'w') = 1,
    'the course of an approved line: an update policy of its own for course managers');
  perform tests.assert(not has_function_privilege('anon', 'private.may_manage_sessions(uuid)', 'EXECUTE')
                       and not has_function_privilege('anon', 'private.session_units(uuid)', 'EXECUTE')
                       and not has_function_privilege('authenticated', 'private.sessions_guard()', 'EXECUTE')
                       and not has_function_privilege('authenticated', 'private.session_participants_guard()', 'EXECUTE'),
    'anonymous callers cannot ask; the guards are triggers only');
  perform tests.assert((select provolatile = 'v' from pg_proc where oid = 'private.training_plan_locked_status(uuid, uuid)'::regprocedure)
                       and position('training_plan_lock' in pg_get_functiondef('private.training_plan_locked_status(uuid, uuid)'::regprocedure)) > 0
                       and position('training_plan_locked_status' in pg_get_functiondef('private.plan_lines_guard()'::regprocedure)) > 0
                       and position('training_plan_locked_status' in pg_get_functiondef('private.sessions_guard()'::regprocedure)) > 0,
    'an approved line''s course and a new draft read the plan''s state after the organization''s plan lock');

  -- Grants: the application's columns only; the stamps, the estimate and where a draft comes from are the database's.
  perform tests.assert(has_column_privilege('authenticated', 'tms.sessions', 'month', 'UPDATE')
                       and has_column_privilege('authenticated', 'tms.sessions', 'branch_id', 'UPDATE')
                       and has_column_privilege('authenticated', 'tms.sessions', 'seats', 'UPDATE')
                       and not has_column_privilege('authenticated', 'tms.sessions', 'status', 'UPDATE')
                       and not has_column_privilege('authenticated', 'tms.sessions', 'course_id', 'UPDATE')
                       and not has_column_privilege('authenticated', 'tms.sessions', 'plan_line_id', 'UPDATE')
                       and not has_column_privilege('authenticated', 'tms.sessions', 'estimated_cost', 'UPDATE')
                       and not has_column_privilege('authenticated', 'tms.sessions', 'estimated_cost', 'INSERT')
                       and not has_column_privilege('authenticated', 'tms.sessions', 'plan_version', 'INSERT')
                       and not has_column_privilege('authenticated', 'tms.sessions', 'status', 'INSERT')
                       and not has_column_privilege('authenticated', 'tms.sessions', 'cost_currency', 'INSERT'),
    'sessions: a statement names the line, course, month, branch and seats — nothing else');
  perform tests.assert(has_column_privilege('authenticated', 'tms.session_participants', 'session_id', 'UPDATE')
                       and not has_column_privilege('authenticated', 'tms.session_participants', 'person_id', 'UPDATE')
                       and not has_column_privilege('authenticated', 'tms.session_participants', 'department_id', 'INSERT')
                       and not has_column_privilege('authenticated', 'tms.session_participants', 'department_id', 'UPDATE'),
    'session_participants: a person is added, moved to another session or removed; the department is the need''s');
  perform tests.assert(has_column_privilege('authenticated', 'tms.plan_lines', 'course_origin', 'UPDATE')
                       and not has_column_privilege('authenticated', 'tms.plan_lines', 'course_set_by', 'UPDATE')
                       and not has_column_privilege('authenticated', 'tms.plan_lines', 'course_set_at', 'UPDATE'),
    'plan_lines: the course''s origin is named, its stamps are the database''s');
  perform tests.assert((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'tms.sessions'::regclass)
                       and (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'tms.session_participants'::regclass),
    'row-level security, forced');
end $$;

-- ---- the journey --------------------------------------------------------------------------------------
begin;
-- uM1: a department-limited planner for SAL (a custom role limited to «A department»): reads the plan of its unit and
-- drafts its sessions.
insert into platform.custom_roles (id, tenant_id, code, name_en, name_ar, description, data_scope) values
  ('a6000000-0000-4000-8000-0000000000f2', 'a0000000-0000-4000-8000-000000000001', 'custom_a000000f0002',
   'Sessions – Sales', 'الجلسات – المبيعات', null, 'departments');
insert into platform.custom_role_permissions (tenant_id, custom_role_id, permission_code) values
  ('a0000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-0000000000f2', 'tms.training_plan.read'),
  ('a0000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-0000000000f2', 'tms.session.manage');
update platform.role_assignments ra set role_code = 'custom_a000000f0002', scope_unit_id = 'a3000000-0000-4000-8000-000000000004'
from platform.tenant_memberships m
where m.id = ra.membership_id and m.tenant_id = 'a0000000-0000-4000-8000-000000000001'
  and m.user_id = '00000000-0000-4000-8000-000000000c04';

-- uS3 (…c03): an organization-wide custom role that builds the plan (tms.training_plan.manage) but holds neither
-- tms.session.manage nor tms.course.manage (review M1). uM2 (…c05): a custom role limited to SAL that builds the plan
-- of its unit (review M4: a department-limited planner gives no approved line a course).
insert into platform.custom_roles (id, tenant_id, code, name_en, name_ar, description, data_scope) values
  ('a6000000-0000-4000-8000-0000000000f3', 'a0000000-0000-4000-8000-000000000001', 'custom_a000000f0003',
   'Plan builder', 'معد الخطة', null, 'organization'),
  ('a6000000-0000-4000-8000-0000000000f4', 'a0000000-0000-4000-8000-000000000001', 'custom_a000000f0004',
   'Plan builder – Sales', 'معد الخطة – المبيعات', null, 'departments');
insert into platform.custom_role_permissions (tenant_id, custom_role_id, permission_code) values
  ('a0000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-0000000000f3', 'tms.training_plan.read'),
  ('a0000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-0000000000f3', 'tms.training_plan.manage'),
  ('a0000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-0000000000f4', 'tms.training_plan.read'),
  ('a0000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-0000000000f4', 'tms.training_plan.manage');
update platform.role_assignments ra set role_code = 'custom_a000000f0003', scope_unit_id = null
from platform.tenant_memberships m
where m.id = ra.membership_id and m.tenant_id = 'a0000000-0000-4000-8000-000000000001'
  and m.user_id = '00000000-0000-4000-8000-000000000c03';
update platform.role_assignments ra set role_code = 'custom_a000000f0004', scope_unit_id = 'a3000000-0000-4000-8000-000000000004'
from platform.tenant_memberships m
where m.id = ra.membership_id and m.tenant_id = 'a0000000-0000-4000-8000-000000000001'
  and m.user_id = '00000000-0000-4000-8000-000000000c05';
-- A second active course (a workshop: review L3) and a branch that is no longer used (review L4).
insert into tms.courses (id, tenant_id, code, title_en, title_ar, category_id, delivery_type, duration_hours,
    duration_days, min_participants, max_participants, est_cost_per_session, est_cost_per_participant) values
  ('a7100000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'NEG-201', 'Negotiation lab',
   'مختبر التفاوض', null, 'workshop', 6, null, 2, 12, null, null);
insert into platform.branches (id, tenant_id, code, name_ar, name_en, is_headquarters, status) values
  ('a2000000-0000-4000-8000-000000000009', 'a0000000-0000-4000-8000-000000000001', 'OLD', 'فرع مغلق', 'Closed', false,
   'inactive');

create function tests.hs_claims(p_who text) returns jsonb language sql immutable as $f$
  select case p_who
    when 'uL' then tests.user_claims('00000000-0000-4000-8000-00000000e0a1', '10000000-0000-4000-8000-00000000e0a1',
                                     'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a1')
    when 'uT' then tests.user_claims('00000000-0000-4000-8000-00000000e0a2', '10000000-0000-4000-8000-00000000e0a2',
                                     'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a2')
    when 'uE' then tests.user_claims('00000000-0000-4000-8000-00000000e0a3', '10000000-0000-4000-8000-00000000e0a3',
                                     'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a3')
    when 'uH' then tests.user_claims('00000000-0000-4000-8000-00000000e0a4', '10000000-0000-4000-8000-00000000e0a4',
                                     'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a4')
    when 'uM1' then tests.user_claims('00000000-0000-4000-8000-000000000c04', '10000000-0000-4000-8000-000000000c41',
                                      'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000c04')
    when 'uS3' then tests.user_claims('00000000-0000-4000-8000-000000000c03', '10000000-0000-4000-8000-000000000c31',
                                      'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000c03')
    when 'uM2' then tests.user_claims('00000000-0000-4000-8000-000000000c05', '10000000-0000-4000-8000-000000000c51',
                                      'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000c05')
    when 'uA' then tests.ua_claims()
    when 'uAB' then tests.uab_claims()
    -- uAB acting in tenant B (its L&D Manager there).
    when 'B' then tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-00000000e0b1',
                                    'b0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-0000000000ab')
  end $f$;
create function tests.hs_need(p_department uuid, p_topic text) returns uuid language sql stable
  as $f$ select id from tms.plan_needs where cycle_id = 'ae000000-0000-4000-8000-000000000001'
                                         and department_id = p_department and topic = p_topic $f$;
create function tests.hs_line(p_title text) returns uuid language sql stable
  as $f$ select id from tms.plan_lines where title = p_title $f$;
create function tests.hs_plan() returns uuid language sql stable
  as $f$ select id from tms.training_plans where cycle_id = 'ae000000-0000-4000-8000-000000000001' $f$;
-- The first day of the n-th month of the planning period (n = 0: its first month).
create function tests.hs_month(p_n integer) returns date language sql stable
  as $f$ select (date_trunc('month', period_start_on) + make_interval(months => p_n))::date
           from tms.plan_cycles where id = 'ae000000-0000-4000-8000-000000000001' $f$;
-- A draft as the application writes it.
create function tests.hs_draft(p_line text, p_course uuid, p_month date, p_seats integer) returns uuid
  language plpgsql as $f$
declare
  v_id uuid;
begin
  insert into tms.sessions (plan_id, cycle_id, plan_line_id, course_id, delivery_type, month, branch_id, seats)
  values (tests.hs_plan(), 'ae000000-0000-4000-8000-000000000001', tests.hs_line(p_line), p_course, 'classroom',
          p_month, 'a2000000-0000-4000-8000-000000000001', p_seats)
  returning id into v_id;
  return v_id;
end $f$;
grant execute on function tests.hs_draft(text, uuid, date, integer) to authenticated;

set local session authorization app_server;
set local role authenticated;

-- uL launches ae…01 for SAL and TD (no envelopes); the heads enter and submit their needs (uH names uE and himself).
select tests.set_claims(tests.hs_claims('uL'));
do $$
declare
  c constant uuid := 'ae000000-0000-4000-8000-000000000001';
begin
  update tms.plan_cycles set status = 'closed' where id = 'ae000000-0000-4000-8000-000000000002';
  delete from tms.plan_cycle_scope where cycle_id = c;
  delete from tms.plan_cycle_departments where cycle_id = c;
  insert into tms.plan_cycle_scope (cycle_id, department_id) values
    (c, 'a3000000-0000-4000-8000-000000000004'), (c, 'a3000000-0000-4000-8000-000000000001');
  insert into tms.plan_cycle_departments (cycle_id, department_id) values
    (c, 'a3000000-0000-4000-8000-000000000004'), (c, 'a3000000-0000-4000-8000-000000000001');
  update tms.plan_cycles set needs_form_id = 'a7000000-0000-4000-8000-000000000001' where id = c;
  update tms.plan_cycles set status = 'open' where id = c;
end $$;
select tests.set_claims(tests.hs_claims('uH'));
insert into tms.plan_needs (cycle_id, department_id, topic, people_count) values
  ('ae000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000004', 'Excel', 20),
  ('ae000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000004', 'Negotiation', 6),
  ('ae000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000004', 'Public speaking', 4);
insert into tms.plan_need_people (need_id, department_id, person_id) values
  (tests.hs_need('a3000000-0000-4000-8000-000000000004', 'Excel'), 'a3000000-0000-4000-8000-000000000004',
   'a1000000-0000-4000-8000-00000000e0a3'),
  (tests.hs_need('a3000000-0000-4000-8000-000000000004', 'Excel'), 'a3000000-0000-4000-8000-000000000004',
   'a1000000-0000-4000-8000-00000000e0a4'),
  (tests.hs_need('a3000000-0000-4000-8000-000000000004', 'Negotiation'), 'a3000000-0000-4000-8000-000000000004',
   'a1000000-0000-4000-8000-00000000e0a3');
update tms.plan_cycle_departments set status = 'submitted'
  where cycle_id = 'ae000000-0000-4000-8000-000000000001' and department_id = 'a3000000-0000-4000-8000-000000000004';
select tests.set_claims(tests.hs_claims('uA'));
insert into tms.plan_needs (cycle_id, department_id, topic, people_count) values
  ('ae000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'Excel', 10);
update tms.plan_cycle_departments set status = 'submitted'
  where cycle_id = 'ae000000-0000-4000-8000-000000000001' and department_id = 'a3000000-0000-4000-8000-000000000001';

-- uL closes the needs, builds the plan (three lines, one left out) and gives Excel a course while it is a draft.
select tests.set_claims(tests.hs_claims('uL'));
do $$
declare
  c constant uuid := 'ae000000-0000-4000-8000-000000000001';
  sal constant uuid := 'a3000000-0000-4000-8000-000000000004';
  td constant uuid := 'a3000000-0000-4000-8000-000000000001';
  p uuid;
begin
  update tms.plan_cycles set status = 'closed' where id = c;
  insert into tms.training_plans (cycle_id) values (c) returning id into p;
  insert into tms.plan_lines (plan_id, cycle_id, group_key, title, quarter, min_per_session, max_per_session,
                              cost_per_session, cost_per_person) values
    (p, c, 'topic:excel', 'Excel', 1, 5, 15, 3000, 100),
    (p, c, 'topic:negotiation', 'Negotiation', 2, 2, 10, 2000, null),
    (p, c, 'topic:public speaking', 'Public speaking', 3, 2, 10, 1000, null);
  insert into tms.plan_line_needs (plan_id, cycle_id, line_id, need_id, department_id) values
    (p, c, tests.hs_line('Excel'), tests.hs_need(sal, 'Excel'), sal),
    (p, c, tests.hs_line('Excel'), tests.hs_need(td, 'Excel'), td),
    (p, c, tests.hs_line('Negotiation'), tests.hs_need(sal, 'Negotiation'), sal),
    (p, c, tests.hs_line('Public speaking'), tests.hs_need(sal, 'Public speaking'), sal);
  update tms.plan_lines set status = 'left_out', left_out_reason = 'Next year' where id = tests.hs_line('Public speaking');
  update tms.plan_lines set course_id = 'a7100000-0000-4000-8000-000000000002' where id = tests.hs_line('Excel');
  perform tests.assert((select course_origin is null and course_set_by = 'a1000000-0000-4000-8000-00000000e0a1'::uuid
                        from tms.plan_lines where id = tests.hs_line('Excel')),
    'a course set while the plan is built has no origin (named in the needs or the plan''s own)');
  perform tests.assert_fails_state_like(
    format($q$select tests.hs_draft('Excel', %L, tests.hs_month(0), 15)$q$, 'a7100000-0000-4000-8000-000000000002'),
    'JK013', '%approved training plan%', 'no draft before the plan is approved');
  perform tests.assert_eq(tests.rows_affected(format($q$update tms.training_plans set status = 'in_approval' where id = %L$q$, p)),
    1::bigint, 'submitted');
end $$;
select tests.set_claims(tests.hs_claims('uAB'));
do $$
begin
  perform tests.assert_eq(tests.rows_affected(format(
    $q$update tms.training_plans set status = 'approved' where id = %L and status = 'in_approval' and approval_step = 'hr'$q$,
    tests.hs_plan())), 1::bigint, 'the HR Manager approves (version 1)');
end $$;

-- The course of an approved line: the organization-wide L&D Manager, that column only.
select tests.set_claims(tests.hs_claims('uL'));
do $$
declare
  v_before record;
begin
  select edited_at, version into v_before from tms.plan_lines where id = tests.hs_line('Excel');
  perform tests.assert_eq(tests.rows_affected(format(
    $q$update tms.plan_lines set course_id = %L, course_origin = 'created' where id = %L$q$,
    'a7100000-0000-4000-8000-000000000001', tests.hs_line('Excel'))), 1::bigint,
    'the L&D Manager gives the approved line Excel the course created from it');
  perform tests.assert((select course_id = 'a7100000-0000-4000-8000-000000000001'::uuid and course_origin = 'created'
                               and course_set_by = 'a1000000-0000-4000-8000-00000000e0a1'::uuid
                               and edited_at is not distinct from v_before.edited_at and version = v_before.version + 1
                        from tms.plan_lines where id = tests.hs_line('Excel')),
    'stamped by the database; the line is not «edited» (the approved plan did not change)');
  perform tests.assert_fails_state_like($q$update tms.plan_lines set course_id = 'a7100000-0000-4000-8000-000000000002' where id = tests.hs_line('Negotiation')$q$,
    'JK001', '%active course%', 'never an archived course');
  perform tests.assert_fails($q$update tms.plan_lines set course_id = 'a7100000-0000-4000-8000-000000000002', quarter = 4 where id = tests.hs_line('Excel')$q$,
    array['JK008'], 'nothing else of an approved line moves with its course');
  perform tests.assert_fails($q$update tms.plan_lines set quarter = 4 where id = tests.hs_line('Excel')$q$,
    array['JK008'], 'an approved line stays locked');
  perform tests.assert_fails($q$update tms.plan_lines set course_id = null where id = tests.hs_line('Excel')$q$,
    array['JK001'], 'a course is never taken away from an approved line');
  perform tests.assert_fails($q$update tms.plan_lines set course_id = 'a7100000-0000-4000-8000-000000000001' where id = tests.hs_line('Public speaking')$q$,
    array['JK001'], 'a line left out gets no course');
  perform tests.assert_fails($q$update tms.plan_lines set course_id = 'b7100000-0000-4000-8000-000000000001' where id = tests.hs_line('Negotiation')$q$,
    array['JK001', '23503'], 'never another organization''s course');
  perform tests.assert_fails($q$delete from tms.plan_lines where id = tests.hs_line('Excel')$q$,
    array['JK008', '23503'], 'an approved line is not deleted');
end $$;
-- Review M4: the Training Coordinator (tms.course.manage) links a course of the library to an approved line — that
-- only.
select tests.set_claims(tests.hs_claims('uT'));
do $$
begin
  perform tests.assert_eq(tests.rows_affected(format(
    $q$update tms.plan_lines set course_id = %L where id = %L$q$,
    'a7100000-0000-4000-8000-000000000003', tests.hs_line('Negotiation'))), 1::bigint,
    'the Training Coordinator links Negotiation to a course of the library');
  perform tests.assert((select course_origin = 'linked' and course_set_by = 'a1000000-0000-4000-8000-00000000e0a2'::uuid
                        from tms.plan_lines where id = tests.hs_line('Negotiation')),
    'linked, by default, stamped with its hand');
  perform tests.assert_fails($q$update tms.plan_lines set quarter = 4 where id = tests.hs_line('Negotiation')$q$,
    array['JK008'], 'nothing else of the approved line');
  perform tests.assert_fails_state_like($q$update tms.plan_lines set course_id = 'a7100000-0000-4000-8000-000000000002' where id = tests.hs_line('Negotiation')$q$,
    'JK001', '%active course%', 'nor an archived course');
end $$;
select tests.set_claims(tests.hs_claims('uM2'));
do $$
begin
  perform tests.assert_fails($q$update tms.plan_lines set course_id = 'a7100000-0000-4000-8000-000000000001' where id = tests.hs_line('Negotiation')$q$,
    array['42501'], 'a department-limited planner (tms.training_plan.manage for Sales) gives no approved line a course');
end $$;
select tests.set_claims(tests.hs_claims('uM1'));
do $$
begin
  perform tests.assert_eq((select string_agg(title, ',' order by title collate "C") from tms.plan_lines),
    'Excel,Negotiation,Public speaking', 'the department-limited planner reads the lines of its unit');
  perform tests.assert_eq(tests.rows_affected($q$update tms.plan_lines set course_id = 'a7100000-0000-4000-8000-000000000002'$q$),
    0::bigint, 'and changes none (it holds no tms.training_plan.manage)');
end $$;

-- Draft sessions: who may not.
select tests.set_claims(tests.hs_claims('uE'));
do $$
begin
  perform tests.assert_fails($q$select tests.hs_draft('Excel', 'a7100000-0000-4000-8000-000000000001', tests.hs_month(0), 15)$q$,
    array['42501'], 'an Employee drafts nothing');
end $$;
select tests.set_claims(tests.hs_claims('uH'));
do $$
begin
  perform tests.assert_fails($q$select tests.hs_draft('Excel', 'a7100000-0000-4000-8000-000000000001', tests.hs_month(0), 15)$q$,
    array['42501'], 'the Department Head drafts nothing');
end $$;
select tests.set_claims(tests.hs_claims('uAB'));
do $$
begin
  perform tests.assert_rls_violation($q$select tests.hs_draft('Excel', 'a7100000-0000-4000-8000-000000000001', tests.hs_month(0), 15)$q$,
    'the HR Manager drafts nothing (it reads the plan, not its drafts)');
end $$;

-- uL drafts: the guards.
select tests.set_claims(tests.hs_claims('uL'));
do $$
declare
  s1 uuid;
  s2 uuid;
begin
  perform tests.assert_fails_state_like($q$select tests.hs_draft('Excel', 'a7100000-0000-4000-8000-000000000002', tests.hs_month(0), 15)$q$,
    'JK013', '%course%', 'a line''s drafts are of its course');
  perform tests.assert_fails_state_like($q$select tests.hs_draft('Public speaking', 'a7100000-0000-4000-8000-000000000001', tests.hs_month(6), 4)$q$,
    'JK013', '%left out%', 'a line left out gets no draft');
  perform tests.assert_fails_state_like($q$select tests.hs_draft('Excel', 'a7100000-0000-4000-8000-000000000001', tests.hs_month(-1), 15)$q$,
    'JK015', '%planning period%', 'a month before the planning period');
  perform tests.assert_fails_state_like($q$select tests.hs_draft('Excel', 'a7100000-0000-4000-8000-000000000001', tests.hs_month(30), 15)$q$,
    'JK015', '%planning period%', 'a month after it');
  perform tests.assert_check_constraint(format($q$insert into tms.sessions (plan_id, cycle_id, plan_line_id, course_id, delivery_type, month, seats) values (tests.hs_plan(), 'ae000000-0000-4000-8000-000000000001', tests.hs_line('Excel'), 'a7100000-0000-4000-8000-000000000001', 'classroom', %L, 15)$q$, tests.hs_month(0) + 3),
    'sessions_month_check', 'a draft''s month is the first day of a month');
  perform tests.assert_privilege_denied(format($q$insert into tms.sessions (plan_id, cycle_id, plan_line_id, course_id, delivery_type, month, seats, estimated_cost) values (tests.hs_plan(), 'ae000000-0000-4000-8000-000000000001', tests.hs_line('Excel'), 'a7100000-0000-4000-8000-000000000001', 'classroom', %L, 15, 1)$q$, tests.hs_month(0)),
    'the estimate is the database''s');

  s1 := tests.hs_draft('Excel', 'a7100000-0000-4000-8000-000000000001', tests.hs_month(0), 15);
  -- A month outside the line's quarter (Q1) but in the period is allowed (Q3 = A: the application marks it).
  s2 := tests.hs_draft('Excel', 'a7100000-0000-4000-8000-000000000001', tests.hs_month(4), 15);
  perform set_config('tests.hs_s1', s1::text, true);
  perform set_config('tests.hs_excel', tests.hs_line('Excel')::text, true);
  perform set_config('tests.hs_s2', s2::text, true);
  perform tests.assert((select status = 'draft' and plan_version = 1 and estimated_cost = 4500 and cost_currency is not null
                               and cost_currency = (select currency from tms.plan_cycles where id = 'ae000000-0000-4000-8000-000000000001')
                               and created_by = 'a1000000-0000-4000-8000-00000000e0a1'::uuid
                        from tms.sessions where id = s1),
    'a draft of version 1; its estimate = 3,000 a session + 15 × 100 a person, in the cycle''s currency');
  perform tests.assert_fails_state_like($q$select tests.hs_draft('Excel', 'a7100000-0000-4000-8000-000000000001', tests.hs_month(1), 15)$q$,
    'JK014', '%2 of 2%', 'Excel has its two sessions (30 people, at most 15)');
  perform tests.assert_fails($q$update tms.sessions set course_id = 'a7100000-0000-4000-8000-000000000002'$q$,
    array['42501'], 'a draft keeps its course (not granted)');
  perform tests.assert_fails($q$update tms.sessions set status = 'draft'$q$, array['42501'], 'and its state');
  perform tests.assert_fails_state_like(format($q$update tms.plan_lines set course_id = 'a7100000-0000-4000-8000-000000000003' where id = %L$q$, tests.hs_line('Excel')),
    'JK017', '%delete its draft sessions first%', 'a line with drafts keeps its course');
end $$;
-- Review M1: an organization-wide planner without tms.session.manage reads no draft — and is still refused.
select tests.set_claims(tests.hs_claims('uS3'));
do $$
begin
  perform tests.assert_eq((select count(*) from tms.sessions), 0::bigint, 'uS3 reads no draft');
  perform tests.assert(private.plan_line_has_sessions(tests.hs_line('Excel'))
                       and not private.plan_line_has_sessions(tests.hs_line('Negotiation')),
    'but is told the line has some');
  perform tests.assert_fails_state_like(format($q$update tms.plan_lines set course_id = 'a7100000-0000-4000-8000-000000000003' where id = %L$q$, tests.hs_line('Excel')),
    'JK017', '%delete its draft sessions first%', 'and cannot change the course of a line with drafts');
end $$;
select tests.set_claims(tests.hs_claims('B'));
do $$
begin
  perform tests.assert(not private.plan_line_has_sessions(current_setting('tests.hs_excel')::uuid),
    'another organization is never told about A''s drafts');
end $$;

-- The Training Coordinator: reads, changes and fills the drafts.
select tests.set_claims(tests.hs_claims('uT'));
do $$
declare
  s1 constant uuid := current_setting('tests.hs_s1')::uuid;
  s2 constant uuid := current_setting('tests.hs_s2')::uuid;
  excel_sal uuid := tests.hs_need('a3000000-0000-4000-8000-000000000004', 'Excel');
begin
  perform tests.assert_eq((select count(*) from tms.sessions), 2::bigint, 'the Training Coordinator reads the drafts');
  perform tests.assert_eq(tests.rows_affected(format($q$update tms.sessions set month = %L, seats = 14, branch_id = 'a2000000-0000-4000-8000-000000000002' where id = %L$q$, tests.hs_month(1), s1)),
    1::bigint, 'and changes a draft''s month, branch and seats');
  perform tests.assert((select estimated_cost = 4400 and branch_id = 'a2000000-0000-4000-8000-000000000002'::uuid
                        from tms.sessions where id = s1), 'the estimate follows the seats');
  perform tests.assert_fails(format($q$update tms.sessions set branch_id = 'b2000000-0000-4000-8000-000000000001' where id = %L$q$, s1),
    array['JK001', '23503'], 'never another organization''s branch');
  perform tests.assert_fails_state_like(format($q$update tms.sessions set branch_id = 'a2000000-0000-4000-8000-000000000009' where id = %L$q$, s1),
    'JK001', '%active branch%', 'nor a branch no longer used');
  insert into tms.session_participants (session_id, plan_line_id, need_id, person_id) values
    (s1, tests.hs_line('Excel'), excel_sal, 'a1000000-0000-4000-8000-00000000e0a3'),
    (s1, tests.hs_line('Excel'), excel_sal, 'a1000000-0000-4000-8000-00000000e0a4');
  perform tests.assert_eq((select string_agg(department_id::text, ',') from tms.session_participants where person_id = 'a1000000-0000-4000-8000-00000000e0a3'),
    'a3000000-0000-4000-8000-000000000004', 'the department is the need''s');
  perform tests.assert_fails(format($q$insert into tms.session_participants (session_id, plan_line_id, need_id, person_id) values (%L, %L, %L, 'a1000000-0000-4000-8000-00000000e0a3')$q$, s2, tests.hs_line('Excel'), excel_sal),
    array['23505'], 'a person is in at most one session of a line');
  perform tests.assert_fails(format($q$insert into tms.session_participants (session_id, plan_line_id, need_id, person_id) values (%L, %L, %L, 'a1000000-0000-4000-8000-00000000e0a2')$q$, s2, tests.hs_line('Excel'), excel_sal),
    array['23503'], 'only people named for the need');
  perform tests.assert_fails_state_like(format($q$insert into tms.session_participants (session_id, plan_line_id, need_id, person_id) values (%L, %L, %L, 'a1000000-0000-4000-8000-00000000e0a3')$q$, s2, tests.hs_line('Excel'),
                                               tests.hs_need('a3000000-0000-4000-8000-000000000004', 'Negotiation')),
    'JK013', '%need of the session''s line%', 'of a need of the session''s own line');
  perform tests.assert_fails(format($q$insert into tms.session_participants (session_id, plan_line_id, need_id, person_id) values (%L, %L, %L, 'a1000000-0000-4000-8000-00000000e0a3')$q$, s1, tests.hs_line('Negotiation'),
                                    tests.hs_need('a3000000-0000-4000-8000-000000000004', 'Negotiation')),
    array['23503'], 'a session holds the people of its own line only (the key)');
  perform tests.assert_fails_state_like(format($q$update tms.sessions set seats = 1 where id = %L$q$, s1),
    'JK016', '%seats%', 'never fewer seats than planned participants');
  update tms.sessions set seats = 1 where id = s2;
  perform tests.assert_eq(tests.rows_affected(format($q$update tms.session_participants set session_id = %L where person_id = 'a1000000-0000-4000-8000-00000000e0a4'$q$, s2)),
    1::bigint, 'a person moves to another session of the line');
  perform tests.assert_fails_state_like(format($q$update tms.session_participants set session_id = %L where person_id = 'a1000000-0000-4000-8000-00000000e0a3'$q$, s2),
    'JK016', '%seats%', 'a move counts against the other session''s seats');
  update tms.sessions set seats = 15 where id = s2;
  perform tests.assert_eq(tests.rows_affected(format($q$update tms.session_participants set session_id = %L where person_id = 'a1000000-0000-4000-8000-00000000e0a3'$q$, s2)),
    1::bigint, 'once it has the seats');
  perform tests.assert_privilege_denied($q$update tms.session_participants set person_id = 'a1000000-0000-4000-8000-00000000e0a2'$q$,
    'a planned participant stays the same person');
end $$;

-- Nobody else sees a draft.
select tests.set_claims(tests.hs_claims('uE'));
do $$
begin
  perform tests.assert_eq((select count(*) from tms.sessions) + (select count(*) from tms.session_participants), 0::bigint,
    'an Employee — even a planned participant — sees no draft (nobody is invited yet)');
  perform tests.assert_eq(tests.rows_affected($q$update tms.sessions set seats = 2$q$)
                          + tests.rows_affected($q$delete from tms.sessions$q$), 0::bigint, 'nor changes one');
end $$;
select tests.set_claims(tests.hs_claims('uH'));
do $$
begin
  perform tests.assert_eq((select count(*) from tms.sessions) + (select count(*) from tms.session_participants), 0::bigint,
    'the Department Head sees no draft of its department');
  perform tests.assert_eq(tests.rows_affected($q$delete from tms.session_participants$q$), 0::bigint, 'nor removes anyone');
end $$;
select tests.set_claims(tests.hs_claims('uAB'));
do $$
begin
  perform tests.assert_eq((select count(*) from tms.sessions) + (select count(*) from tms.session_participants), 0::bigint,
    'the HR Manager sees no draft');
end $$;
select tests.set_claims(tests.hs_claims('uA'));
do $$
begin
  perform tests.assert_eq((select count(*) from tms.sessions) + (select count(*) from tms.session_participants), 0::bigint,
    'the Organization Admin (a set-up role) sees no draft');
end $$;
select tests.set_claims(tests.hs_claims('B'));
do $$
begin
  perform tests.assert_eq((select count(*) from tms.sessions) + (select count(*) from tms.session_participants), 0::bigint,
    'another organization''s L&D Manager sees none of A''s drafts');
  perform tests.assert_eq(tests.rows_affected($q$update tms.sessions set seats = 2$q$)
                          + tests.rows_affected($q$update tms.session_participants set session_id = session_id$q$)
                          + tests.rows_affected($q$delete from tms.session_participants$q$)
                          + tests.rows_affected($q$delete from tms.sessions$q$), 0::bigint, 'and changes none');
  perform tests.assert_fails($q$insert into tms.sessions (tenant_id, plan_id, cycle_id, plan_line_id, course_id, delivery_type, month, seats) values ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'a7100000-0000-4000-8000-000000000001', 'classroom', '2027-01-01', 5)$q$,
    array['42501'], 'never writes a draft into A');
  perform tests.assert_fails(format($q$insert into tms.sessions (plan_id, cycle_id, plan_line_id, course_id, delivery_type, month, seats) values ('00000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'b7100000-0000-4000-8000-000000000001', 'classroom', %L, 5)$q$, date_trunc('month', current_date)::date),
    array['42501', '23503'], 'nor a draft of a line it cannot read in its own organization');
end $$;

-- A department-limited planner (uM1, SAL): reads the drafts of lines with SAL, changes those of SAL-only lines.
select tests.set_claims(tests.hs_claims('uM1'));
do $$
declare
  s1 constant uuid := current_setting('tests.hs_s1')::uuid;
  n uuid;
begin
  perform tests.assert_eq((select count(*) from tms.sessions), 2::bigint,
    'it reads the drafts of Excel (Sales with Training & Development)');
  perform tests.assert_eq((select count(*) from tms.session_participants), 2::bigint, 'and its unit''s planned people');
  perform tests.assert_eq(tests.rows_affected(format($q$update tms.sessions set seats = 13 where id = %L$q$, s1)), 0::bigint,
    'but changes no draft of a line shared with another unit');
  perform tests.assert_eq(tests.rows_affected($q$delete from tms.session_participants$q$), 0::bigint, 'nor its people');
  perform tests.assert_fails($q$select tests.hs_draft('Excel', 'a7100000-0000-4000-8000-000000000001', tests.hs_month(2), 2)$q$,
    array['42501', 'JK014'], 'nor drafts one more');
  perform tests.assert_fails_state_like($q$select tests.hs_draft('Negotiation', 'a7100000-0000-4000-8000-000000000001', tests.hs_month(3), 6)$q$,
    'JK013', '%course%', 'a draft is of the line''s course');
  n := tests.hs_draft('Negotiation', 'a7100000-0000-4000-8000-000000000003', tests.hs_month(3), 6);
  perform tests.assert_eq((select delivery_type from tms.sessions where id = n), 'workshop',
    'its delivery type is the course''s, whatever the statement says (review L3)');
  perform tests.assert_eq(tests.rows_affected(format($q$update tms.sessions set seats = 7 where id = %L$q$, n)), 1::bigint,
    'it drafts and changes the sessions of a Sales-only line');
  insert into tms.session_participants (session_id, plan_line_id, need_id, person_id) values
    (n, tests.hs_line('Negotiation'), tests.hs_need('a3000000-0000-4000-8000-000000000004', 'Negotiation'),
     'a1000000-0000-4000-8000-00000000e0a3');
  perform tests.assert_eq(tests.rows_affected(format($q$delete from tms.sessions where id = %L$q$, n)), 1::bigint,
    'and deletes one (its people go with it)');
  perform tests.assert_eq((select count(*) from tms.session_participants where plan_line_id = tests.hs_line('Negotiation')),
    0::bigint, 'none left');
end $$;

-- A revised plan keeps its drafts: they still change, none is added until it is approved again.
select tests.set_claims(tests.hs_claims('uL'));
do $$
declare
  s1 constant uuid := current_setting('tests.hs_s1')::uuid;
  s2 constant uuid := current_setting('tests.hs_s2')::uuid;
begin
  perform tests.assert_eq(tests.rows_affected(format($q$update tms.training_plans set status = 'draft' where id = %L and status = 'approved'$q$, tests.hs_plan())),
    1::bigint, 'the L&D Manager revises the plan (version 2, a draft)');
  perform tests.assert_eq((select count(*) from tms.sessions), 2::bigint, 'the drafts stay');
  perform tests.assert_eq(tests.rows_affected(format($q$update tms.sessions set month = %L where id = %L$q$, tests.hs_month(2), s1)),
    1::bigint, 'and still change');
  update tms.plan_lines set max_per_session = 30 where id = tests.hs_line('Excel');
  perform tests.assert_fails_state_like($q$select tests.hs_draft('Negotiation', 'a7100000-0000-4000-8000-000000000003', tests.hs_month(3), 6)$q$,
    'JK013', '%approved training plan%', 'no new draft while the plan is revised');
  -- Review M3 (decided 15 Nov 2026): while the revised plan is edited, a line with drafts keeps its course and its
  -- place, and a need whose people are planned stays in its line — delete the drafts first. Sizes may change.
  perform tests.assert_fails_state_like(format($q$update tms.plan_lines set status = 'left_out', left_out_reason = 'Merged into another programme' where id = %L$q$, tests.hs_line('Excel')),
    'JK017', '%delete its draft sessions first%', 'the revised plan does not leave out a line with drafts');
  perform tests.assert_fails_state_like(format($q$update tms.plan_lines set course_id = 'a7100000-0000-4000-8000-000000000003' where id = %L$q$, tests.hs_line('Excel')),
    'JK017', '%delete its draft sessions first%', 'nor changes its course');
  perform tests.assert_fails_state_like($q$delete from tms.plan_lines where id = tests.hs_line('Excel')$q$,
    'JK017', '%delete its draft sessions first%', 'nor deletes it');
  perform tests.assert_fails_state_like(format($q$update tms.plan_line_needs set line_id = %L where need_id = %L$q$,
                                               tests.hs_line('Negotiation'), tests.hs_need('a3000000-0000-4000-8000-000000000004', 'Excel')),
    'JK017', '%delete those draft sessions first%', 'a need whose people are planned does not move to another line');
  perform tests.assert_fails_state_like(format($q$delete from tms.plan_line_needs where need_id = %L$q$,
                                               tests.hs_need('a3000000-0000-4000-8000-000000000004', 'Excel')),
    'JK017', '%delete those draft sessions first%', 'nor leaves its line');
  perform tests.assert_eq(tests.rows_affected(format($q$update tms.plan_line_needs set line_id = %L where need_id = %L$q$,
                                                     tests.hs_line('Negotiation'), tests.hs_need('a3000000-0000-4000-8000-000000000001', 'Excel'))),
    1::bigint, 'a need nobody of which is planned moves');
  perform tests.assert_eq(tests.rows_affected(format($q$update tms.plan_line_needs set line_id = %L where need_id = %L$q$,
                                                     tests.hs_line('Excel'), tests.hs_need('a3000000-0000-4000-8000-000000000001', 'Excel'))),
    1::bigint, 'and back');
  perform tests.assert_eq((select count(*) from tms.sessions where plan_line_id = tests.hs_line('Excel')), 2::bigint,
    'Excel keeps its drafts (nothing is deleted automatically)');
end $$;
select tests.set_claims(tests.hs_claims('uT'));
do $$
begin
  perform tests.assert_eq(tests.rows_affected($q$update tms.plan_lines set quarter = 4$q$)
                          + tests.rows_affected($q$update tms.plan_lines set course_id = 'a7100000-0000-4000-8000-000000000001'$q$),
    0::bigint, 'the Training Coordinator changes no line of a plan being revised');
end $$;
select tests.set_claims(tests.hs_claims('uL'));
do $$
declare
  s1 constant uuid := current_setting('tests.hs_s1')::uuid;
  s2 constant uuid := current_setting('tests.hs_s2')::uuid;
begin
  perform tests.assert_eq(tests.rows_affected(format($q$delete from tms.sessions where id in (%L, %L)$q$, s1, s2)), 2::bigint,
    'a draft is deleted freely');
  perform tests.assert_eq((select count(*) from tms.session_participants), 0::bigint, 'with its planned participants');
  perform tests.assert_eq(tests.rows_affected(format($q$update tms.plan_lines set status = 'left_out', left_out_reason = 'Merged into another programme' where id = %L$q$, tests.hs_line('Excel'))),
    1::bigint, 'once its drafts are deleted, the revised plan leaves Excel out');
end $$;
rollback;

\echo '99_planning_h_sessions_1_owner: ok'
