-- db-test: run-as=owner
-- The training plan (WP-LD-02, T-M3-06; FR-PLN-05, FR-PLN-06, FR-IAM-08; migrations 20261115100000…100400): the
-- catalogue rows and grants, the role training_plan_guard and its two functions, then one journey — the needs
-- closed early («Close needs now», Q1 = A), the plan opened, lines built and changed — with who may do what:
-- the L&D Manager (everything), a department-limited L&D Manager (the lines whose every need is in its unit), the
-- Training Coordinator (reads), an Employee and another organization (nothing); the guards (only submitted needs,
-- frozen once in approval, a line with needs is not deleted). Users act through session_user app_server, as
-- withUserTx does. Fixtures: 00_helpers_and_fixtures.sql (cycle ae…01 with TD and TD-PRG, form a7…01),
-- 99_planning_a_fixtures_owner.sql (uL, uT, uE; open cycle ae…02 past its deadline),
-- 99_planning_d_needs_0_fixtures_owner.sql (uH heads SAL a3…04; uE works in SAL), 99_people_0_fixtures_owner.sql
-- (uM1 …c04: a custom role limited to a unit — here given the training-plan permissions for SAL). Every block is
-- rolled back.
\set ON_ERROR_STOP on

-- ---- catalogue, grants, the guard role ----------------------------------------------------------------
do $$
declare
  v_list text;
begin
  perform tests.assert_eq(
    (select string_agg(code || ':' || risk || ':' || custom_role_use || ':' || privileged::text, ',' order by code)
     from platform.ref_permissions where code like 'tms.training\_plan.%'),
    'tms.training_plan.manage:medium:scoped:false,tms.training_plan.read:low:scoped:false',
    'the training-plan permissions: scoped in a custom role, not privileged');
  perform tests.assert_eq(
    (select string_agg(role_code || ':' || permission_code || ':' || scope, ',' order by role_code, permission_code)
     from platform.ref_role_permissions where permission_code like 'tms.training\_plan.%'),
    'training_coordinator:tms.training_plan.read:tenant,training_manager:tms.training_plan.manage:tenant,training_manager:tms.training_plan.read:tenant',
    'the L&D Manager builds the plan, the Training Coordinator reads it, nobody else');
  perform tests.assert_eq(private.permission_feature('tms.training_plan.manage'), 'planning',
    'the training plan belongs to the planning feature');
  perform tests.assert(not private.role_is_privileged('a0000000-0000-4000-8000-000000000001', 'training_coordinator'),
    'the Training Coordinator stays a role that is not privileged');

  -- training_plan_guard: as the other guards.
  perform tests.assert(not (select rolbypassrls or rolcanlogin or rolsuper or rolinherit or rolcreaterole or rolcreatedb
                            from pg_roles where rolname = 'training_plan_guard'),
    'training_plan_guard must be NOLOGIN NOINHERIT and not BYPASSRLS / superuser / createrole / createdb');
  perform tests.assert(not exists (select 1 from pg_auth_members m join pg_roles u on u.oid = m.member
                                   where m.roleid = 'training_plan_guard'::regrole and (m.inherit_option or m.set_option)
                                     and not u.rolsuper and u.rolname <> current_user),
    'nobody acts as training_plan_guard');
  perform tests.assert(not has_schema_privilege('training_plan_guard', 'private', 'CREATE')
                       and not has_schema_privilege('training_plan_guard', 'tms', 'CREATE')
                       and not exists (select 1 from pg_class c where c.relowner = 'training_plan_guard'::regrole),
    'training_plan_guard creates and owns no relations');
  select string_agg(format('%s%s', p.oid::regprocedure, case when p.prosecdef then ' (definer)' else '' end), ', '
                    order by p.oid::regprocedure::text)
    into v_list
  from pg_proc p where p.proowner = 'training_plan_guard'::regrole;
  perform tests.assert_eq(v_list,
    'private.plan_cycle_consolidating(uuid,uuid) (definer), private.plan_line_departments(uuid) (definer)',
    'training_plan_guard owns two functions');
  perform tests.assert(not has_table_privilege('training_plan_guard', 'tms.plan_line_needs', 'SELECT')
                       and has_column_privilege('training_plan_guard', 'tms.plan_line_needs', 'department_id', 'SELECT')
                       and not has_column_privilege('training_plan_guard', 'tms.plan_line_needs', 'need_id', 'SELECT')
                       and not has_column_privilege('training_plan_guard', 'tms.training_plans', 'opened_by', 'SELECT')
                       and not has_table_privilege('training_plan_guard', 'tms.plan_needs', 'SELECT')
                       and not has_table_privilege('training_plan_guard', 'platform.persons', 'SELECT'),
    'training_plan_guard reads a line''s departments and a plan''s cycle and status — nothing else');
  perform tests.assert(not has_function_privilege('anon', 'private.plan_line_departments(uuid)', 'EXECUTE')
                       and not has_function_privilege('anon', 'private.plan_cycle_consolidating(uuid, uuid)', 'EXECUTE'),
    'anonymous callers cannot ask');

  -- Grants: only the columns the application writes; the stamps and snapshots are the database's.
  perform tests.assert(not has_column_privilege('authenticated', 'tms.training_plans', 'status', 'UPDATE')
                       and not has_table_privilege('authenticated', 'tms.training_plans', 'DELETE')
                       and not has_column_privilege('authenticated', 'tms.training_plans', 'opened_by', 'INSERT'),
    'training_plans: opened by the database, its state moves with the approval (WP-LD-03)');
  perform tests.assert(not has_column_privilege('authenticated', 'tms.plan_lines', 'edited_at', 'UPDATE')
                       and not has_column_privilege('authenticated', 'tms.plan_lines', 'group_key', 'UPDATE')
                       and not has_column_privilege('authenticated', 'tms.plan_lines', 'plan_id', 'UPDATE'),
    'plan_lines: what a line was built from, its plan and its edit stamp never change from a statement');
  perform tests.assert(not has_column_privilege('authenticated', 'tms.plan_line_needs', 'seats', 'INSERT')
                       and not has_column_privilege('authenticated', 'tms.plan_line_needs', 'seats', 'UPDATE')
                       and not has_column_privilege('authenticated', 'tms.plan_line_needs', 'need_id', 'UPDATE'),
    'plan_line_needs: the seats are taken from the need; a need moves from line to line only');
end $$;

-- ---- the journey --------------------------------------------------------------------------------------
begin;
-- uM1: a department-limited L&D Manager for SAL (a custom role limited to «A department», platform operation).
insert into platform.custom_roles (id, tenant_id, code, name_en, name_ar, description, data_scope) values
  ('a6000000-0000-4000-8000-0000000000f1', 'a0000000-0000-4000-8000-000000000001', 'custom_a000000f0001',
   'L&D – Sales', 'التعلم والتطوير – المبيعات', null, 'departments');
insert into platform.custom_role_permissions (tenant_id, custom_role_id, permission_code) values
  ('a0000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-0000000000f1', 'tms.training_plan.read'),
  ('a0000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-0000000000f1', 'tms.training_plan.manage');
update platform.role_assignments ra set role_code = 'custom_a000000f0001', scope_unit_id = 'a3000000-0000-4000-8000-000000000004'
from platform.tenant_memberships m
where m.id = ra.membership_id and m.tenant_id = 'a0000000-0000-4000-8000-000000000001'
  and m.user_id = '00000000-0000-4000-8000-000000000c04';
-- Rows by name, read as the caller (row-level security applies): the application's columns never take an id.
create function tests.tp_need(p_topic text) returns uuid language sql stable
  as $f$ select id from tms.plan_needs where cycle_id = 'ae000000-0000-4000-8000-000000000001' and topic = p_topic $f$;
create function tests.tp_line(p_title text) returns uuid language sql stable
  as $f$ select id from tms.plan_lines where title = p_title $f$;
create function tests.tp_plan() returns uuid language sql stable
  as $f$ select id from tms.training_plans where cycle_id = 'ae000000-0000-4000-8000-000000000001' $f$;

set local session authorization app_server;
set local role authenticated;

-- uL launches ae…01 with SAL added to TD and TD-PRG.
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000e0a1', '10000000-0000-4000-8000-00000000e0a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a1'));
do $$
declare
  c constant uuid := 'ae000000-0000-4000-8000-000000000001';
  sal constant uuid := 'a3000000-0000-4000-8000-000000000004';
begin
  update tms.plan_cycles set status = 'closed' where id = 'ae000000-0000-4000-8000-000000000002';
  insert into tms.plan_cycle_scope (cycle_id, department_id) values (c, sal);
  insert into tms.plan_cycle_departments (cycle_id, department_id, budget_amount) values (c, sal, 30000);
  update tms.plan_cycles set needs_form_id = 'a7000000-0000-4000-8000-000000000001' where id = c;
  update tms.plan_cycles set status = 'open' where id = c;
  perform tests.assert_fails($q$insert into tms.training_plans (cycle_id) values ('ae000000-0000-4000-8000-000000000001')$q$,
    array['JK009'], 'no plan while the needs are open');
end $$;

-- uH: SAL's needs (20 seats of Excel with one name, 5 of Leadership), submitted.
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000e0a4', '10000000-0000-4000-8000-00000000e0a4',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a4'));
do $$
declare
  c constant uuid := 'ae000000-0000-4000-8000-000000000001';
  sal constant uuid := 'a3000000-0000-4000-8000-000000000004';
begin
  insert into tms.plan_needs (cycle_id, department_id, topic, people_count) values
    (c, sal, 'Excel – advanced formulas', 20),
    (c, sal, 'Leadership', 5);
  insert into tms.plan_need_people (need_id, department_id, person_id)
    values (tests.tp_need('Excel – advanced formulas'), sal, 'a1000000-0000-4000-8000-00000000e0a3');
  update tms.plan_cycle_departments set status = 'submitted' where cycle_id = c and department_id = sal;
end $$;

-- uA heads TD (and TD-PRG below it): TD submits; TD-PRG has not yet.
select tests.set_claims(tests.ua_claims());
do $$
declare
  c constant uuid := 'ae000000-0000-4000-8000-000000000001';
begin
  insert into tms.plan_needs (cycle_id, department_id, topic, people_count) values
    (c, 'a3000000-0000-4000-8000-000000000001', 'excel advanced formulas!', 15),
    (c, 'a3000000-0000-4000-8000-000000000002', 'Instructional design', 4);
  update tms.plan_cycle_departments set status = 'submitted' where cycle_id = c and department_id = 'a3000000-0000-4000-8000-000000000001';
end $$;

-- «Close needs now» waits for every department; uM1 never closes a cycle.
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000e0a1', '10000000-0000-4000-8000-00000000e0a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a1'));
do $$
begin
  perform tests.assert_fails($q$update tms.plan_cycles set status = 'closed' where id = 'ae000000-0000-4000-8000-000000000001'$q$,
    array['JK001'], 'the needs close early only once every department has submitted');
end $$;
select tests.set_claims(tests.ua_claims());
update tms.plan_cycle_departments set status = 'submitted'
  where cycle_id = 'ae000000-0000-4000-8000-000000000001' and department_id = 'a3000000-0000-4000-8000-000000000002';
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c04', '10000000-0000-4000-8000-000000000c41',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000c04'));
do $$
begin
  perform tests.assert_eq(tests.rows_affected($q$update tms.plan_cycles set status = 'closed' where id = 'ae000000-0000-4000-8000-000000000001'$q$),
    0::bigint, 'a department-limited L&D Manager closes no cycle (cycles stay organization-wide)');
end $$;

-- uL closes the needs now and opens the plan with three lines.
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000e0a1', '10000000-0000-4000-8000-00000000e0a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a1'));
do $$
declare
  c constant uuid := 'ae000000-0000-4000-8000-000000000001';
  p uuid;
begin
  perform tests.assert_eq(tests.rows_affected(format($q$update tms.plan_cycles set status = 'closed' where id = %L$q$, c)),
    1::bigint, '«Close needs now» once every department has submitted');
  perform tests.assert_privilege_denied(format($q$insert into tms.training_plans (cycle_id, status) values (%L, 'approved')$q$, c),
    'a plan''s state is the database''s');
  insert into tms.training_plans (cycle_id) values (c) returning id into p;
  perform tests.assert((select status = 'draft' and plan_version = 1 and needs_closed_early
                               and opened_by = 'a1000000-0000-4000-8000-00000000e0a1'::uuid
                        from tms.training_plans where id = p),
    'a plan starts as a draft, version 1, stamped — whatever the statement said; closed early is recorded');
  perform tests.assert_fails(format($q$insert into tms.training_plans (cycle_id) values (%L)$q$, c),
    array['23505'], 'one plan per cycle');
  perform tests.assert_fails($q$insert into tms.training_plans (cycle_id) values ('be000000-0000-4000-8000-000000000001')$q$,
    array['23503', '42501'], 'never a plan of another organization''s cycle');
  perform tests.assert_privilege_denied(format($q$update tms.training_plans set status = 'approved' where id = %L$q$, p),
    'the plan''s state is not changed by a statement (WP-LD-03)');
  perform tests.assert_privilege_denied(format($q$delete from tms.training_plans where id = %L$q$, p), 'a plan is kept');

  insert into tms.plan_lines (plan_id, cycle_id, group_key, title, quarter, edited_at) values
    (p, c, 'topic:excel advanced formulas', 'Excel – advanced formulas', 2, null),
    (p, c, 'topic:leadership', 'Leadership', 1, null),
    (p, c, 'topic:instructional design', 'Instructional design', 3, null);
  insert into tms.plan_line_needs (plan_id, cycle_id, line_id, need_id, department_id) values
    (p, c, tests.tp_line('Excel – advanced formulas'), tests.tp_need('Excel – advanced formulas'), 'a3000000-0000-4000-8000-000000000004'),
    (p, c, tests.tp_line('Excel – advanced formulas'), tests.tp_need('excel advanced formulas!'), 'a3000000-0000-4000-8000-000000000001'),
    (p, c, tests.tp_line('Leadership'), tests.tp_need('Leadership'), 'a3000000-0000-4000-8000-000000000004'),
    (p, c, tests.tp_line('Instructional design'), tests.tp_need('Instructional design'), 'a3000000-0000-4000-8000-000000000002');
  -- For the other organization's checks below (it cannot read these ids).
  perform set_config('tests.tp_plan', p::text, true);
  perform set_config('tests.tp_excel_line', tests.tp_line('Excel – advanced formulas')::text, true);
  perform tests.assert_eq(
    (select string_agg(seats || '/' || named, ',' order by seats desc) from tms.plan_line_needs where plan_id = p),
    '20/1,15/0,5/0,4/0', 'the seats and named people are what each department submitted');
  perform tests.assert_eq(private.plan_line_departments(tests.tp_line('Excel – advanced formulas')),
    array['a3000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000004']::uuid[],
    'a line''s departments');
  perform tests.assert(private.plan_cycle_consolidating('a0000000-0000-4000-8000-000000000001', c), 'the cycle is consolidated');
  perform tests.assert(not private.plan_cycle_consolidating('b0000000-0000-4000-8000-000000000001', 'be000000-0000-4000-8000-000000000001'),
    'never another organization''s');

  -- Composite keys and tenant isolation.
  perform tests.assert_fails(format($q$insert into tms.plan_line_needs (plan_id, cycle_id, line_id, need_id, department_id) values (%L, %L, tests.tp_line('Leadership'), tests.tp_need('Excel – advanced formulas'), 'a3000000-0000-4000-8000-000000000004')$q$, p, c),
    array['23505'], 'a need is in one line only');
  perform tests.assert_fails(format($q$insert into tms.plan_line_needs (plan_id, cycle_id, line_id, need_id, department_id) values (%L, %L, tests.tp_line('Leadership'), tests.tp_need('excel advanced formulas!'), 'a3000000-0000-4000-8000-000000000004')$q$, p, c),
    array['23503', '23505'], 'a need cannot claim another department');
  perform tests.assert_fails(format($q$insert into tms.plan_lines (tenant_id, plan_id, cycle_id, group_key, title, quarter) values ('b0000000-0000-4000-8000-000000000001', %L, %L, 'topic:x', 'Intruder', 1)$q$, p, c),
    array['42501'], 'never a line with another organization''s tenant_id');
  perform tests.assert_fails(format($q$insert into tms.plan_lines (plan_id, cycle_id, group_key, title, quarter, course_id) values (%L, %L, 'course:x', 'B course', 1, 'b7100000-0000-4000-8000-000000000001')$q$, p, c),
    array['23503'], 'never another organization''s course');
  perform tests.assert_fails(format($q$insert into tms.plan_lines (plan_id, cycle_id, group_key, title, quarter) values (%L, %L, 'topic:x', 'Q5', 5)$q$, p, c),
    array['23514'], 'a quarter is 1 to 4');
  perform tests.assert_fails(format($q$update tms.plan_lines set min_per_session = 30, max_per_session = 20 where id = tests.tp_line('Excel – advanced formulas')$q$),
    array['23514'], 'the minimum is not above the maximum');
  perform tests.assert_fails($q$update tms.plan_lines set cost_per_session = 1.0005 where id = tests.tp_line('Excel – advanced formulas')$q$,
    array['23514'], 'amounts have at most three decimals');
  perform tests.assert_fails($q$update tms.plan_lines set status = 'left_out' where id = tests.tp_line('Instructional design')$q$,
    array['23514'], 'leaving a line out needs a reason');
  perform tests.assert_fails($q$delete from tms.plan_lines where id = tests.tp_line('Instructional design')$q$,
    array['23503'], 'a line holding needs is not deleted');

  -- L&D's changes are stamped as edits; a line built from the needs is not.
  perform tests.assert((select edited_at is null from tms.plan_lines where id = tests.tp_line('Excel – advanced formulas')),
    'a line built from the needs is not an edit');
  update tms.plan_lines set min_per_session = 8, max_per_session = 20, cost_per_session = 5000
    where id = tests.tp_line('Excel – advanced formulas');
  perform tests.assert((select edited_at is not null and edited_by = 'a1000000-0000-4000-8000-00000000e0a1'::uuid and version = 2
                        from tms.plan_lines where id = tests.tp_line('Excel – advanced formulas')),
    'L&D''s change is stamped');
  perform tests.assert_fails($q$update tms.plan_lines set status = 'left_out', left_out_reason = '   ' where id = tests.tp_line('Instructional design')$q$,
    array['23514'], 'the reason has visible text');
  update tms.plan_lines set status = 'left_out', left_out_reason = 'Covered by the e-learning library'
    where id = tests.tp_line('Instructional design');
  insert into tms.plan_budget_reasons (plan_id, cycle_id, department_id, reason)
    values (p, c, 'a3000000-0000-4000-8000-000000000001', 'Two extra sessions requested by the CEO');
  perform tests.assert_fails(format($q$insert into tms.plan_budget_reasons (plan_id, cycle_id, department_id, reason) values (%L, %L, 'a3000000-0000-4000-8000-000000000003', 'Not in the cycle')$q$, p, c),
    array['23503'], 'a reason only for a department of the cycle');
end $$;

-- uM1 (limited to SAL): the lines with a need of SAL, their departments' seats, SAL's needs and envelope.
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c04', '10000000-0000-4000-8000-000000000c41',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000c04'));
do $$
declare
  p constant uuid := tests.tp_plan();
  c constant uuid := 'ae000000-0000-4000-8000-000000000001';
  sal constant uuid := 'a3000000-0000-4000-8000-000000000004';
begin
  perform tests.assert(not private.may_read_training_plan('a0000000-0000-4000-8000-000000000001'),
    'uM1 reads nothing organization-wide');
  perform tests.assert_eq(private.training_plan_units('a0000000-0000-4000-8000-000000000001', true), array[sal],
    'uM1 builds the plan of SAL (no unit below it)');
  perform tests.assert_eq((select count(*) from tms.training_plans), 1::bigint, 'uM1 sees the plan');
  perform tests.assert_eq((select string_agg(title, ',' order by title) from tms.plan_lines),
    'Excel – advanced formulas,Leadership', 'the lines with a need of SAL (not TD-PRG''s)');
  perform tests.assert_eq((select count(*) from tms.plan_line_needs), 3::bigint,
    'the seats of the lines it sees, the shared line''s other department included');
  perform tests.assert_eq((select count(*) from tms.plan_needs), 2::bigint, 'SAL''s needs only');
  perform tests.assert_eq((select count(*) from tms.plan_need_people), 1::bigint, 'and their names');
  perform tests.assert_eq((select string_agg(department_id::text, ',') from tms.plan_cycle_departments), sal::text,
    'SAL''s envelope only');
  perform tests.assert_eq((select string_agg(id::text, ',') from tms.plan_cycles), c::text, 'the cycle SAL takes part in');
  perform tests.assert_eq((select count(*) from tms.plan_budget_reasons), 0::bigint, 'no other department''s reason');

  -- Edits: a line of SAL only, never the shared one.
  perform tests.assert_eq(tests.rows_affected($q$update tms.plan_lines set cost_per_session = 1200, max_per_session = 10 where id = tests.tp_line('Leadership')$q$),
    1::bigint, 'uM1 costs a line whose every need is SAL''s');
  perform tests.assert_eq(tests.rows_affected($q$update tms.plan_lines set quarter = 4 where id = tests.tp_line('Excel – advanced formulas')$q$),
    0::bigint, 'never the line shared with TD');
  perform tests.assert_eq(tests.rows_affected($q$delete from tms.plan_line_needs where need_id = tests.tp_need('Excel – advanced formulas')$q$),
    0::bigint, 'nor takes SAL''s need out of the shared line');
  -- A need of SAL moved to a new line of its own.
  insert into tms.plan_lines (plan_id, cycle_id, group_key, title, quarter, edited_at)
    values (p, c, 'topic:leadership', 'Leadership for sales', 2, now());
  perform tests.assert_eq(tests.rows_affected($q$update tms.plan_line_needs set line_id = tests.tp_line('Leadership for sales') where need_id = tests.tp_need('Leadership')$q$),
    1::bigint, 'uM1 moves SAL''s need into its new line');
  perform tests.assert((select edited_at is not null from tms.plan_lines where id = tests.tp_line('Leadership for sales')),
    'a line L&D made is an edit');
  perform tests.assert_fails(format($q$insert into tms.plan_line_needs (plan_id, cycle_id, line_id, need_id, department_id) values (%L, %L, tests.tp_line('Leadership for sales'), tests.tp_need('Instructional design'), 'a3000000-0000-4000-8000-000000000002')$q$, p, c),
    array['42501', 'JK009', '23505'], 'never another department''s need');
  insert into tms.plan_budget_reasons (plan_id, cycle_id, department_id, reason) values (p, c, sal, 'New branch opening');
  perform tests.assert_fails(format($q$insert into tms.plan_budget_reasons (plan_id, cycle_id, department_id, reason) values (%L, %L, 'a3000000-0000-4000-8000-000000000002', 'Not mine')$q$, p, c),
    array['42501'], 'a reason for its units only');
  perform tests.assert_eq(tests.rows_affected($q$update tms.plan_budget_reasons set reason = 'x' where department_id = 'a3000000-0000-4000-8000-000000000001'$q$),
    0::bigint, 'never another department''s reason');
  perform tests.assert_fails($q$insert into tms.training_plans (cycle_id) values ('ae000000-0000-4000-8000-000000000002')$q$,
    array['42501'], 'opening a plan is the organization-wide L&D Manager''s');
end $$;

-- uT (Training Coordinator): reads the whole plan, changes nothing.
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000e0a2', '10000000-0000-4000-8000-00000000e0a2',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a2'));
do $$
begin
  perform tests.assert_eq((select count(*) from tms.plan_lines), 4::bigint, 'the coordinator reads every line');
  perform tests.assert_eq((select count(*) from tms.plan_budget_reasons), 2::bigint, 'and the reasons');
  perform tests.assert_eq(tests.rows_affected($q$update tms.plan_lines set quarter = 4$q$), 0::bigint, 'changes no line');
  perform tests.assert_eq(tests.rows_affected($q$delete from tms.plan_line_needs$q$), 0::bigint, 'moves no need');
  perform tests.assert_fails($q$insert into tms.plan_lines (plan_id, cycle_id, group_key, title, quarter) values (tests.tp_plan(), 'ae000000-0000-4000-8000-000000000001', 'topic:x', 'Mine', 1)$q$,
    array['42501'], 'adds no line');
  perform tests.assert_fails($q$insert into tms.plan_budget_reasons (plan_id, cycle_id, department_id, reason) values (tests.tp_plan(), 'ae000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002', 'x')$q$,
    array['42501'], 'writes no reason');
end $$;

-- uE (Employee, named for a need), uH (the head of SAL) and uA (Organization Admin, head of TD): nothing of the plan.
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000e0a3', '10000000-0000-4000-8000-00000000e0a3',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a3'));
do $$
begin
  perform tests.assert_eq((select count(*) from tms.training_plans) + (select count(*) from tms.plan_lines)
                          + (select count(*) from tms.plan_line_needs) + (select count(*) from tms.plan_budget_reasons),
    0::bigint, 'an employee sees nothing of the plan');
  perform tests.assert_fails($q$insert into tms.plan_lines (plan_id, cycle_id, group_key, title, quarter) values (tests.tp_plan(), 'ae000000-0000-4000-8000-000000000001', 'topic:x', 'Mine', 1)$q$,
    array['42501'], 'and writes nothing');
end $$;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000e0a4', '10000000-0000-4000-8000-00000000e0a4',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a4'));
do $$
begin
  perform tests.assert_eq((select count(*) from tms.training_plans) + (select count(*) from tms.plan_lines)
                          + (select count(*) from tms.plan_line_needs), 0::bigint,
    'a head learns the result once the plan is approved (Q4 = A, WP-LD-03), not before');
  perform tests.assert_fails($q$update tms.plan_cycle_departments set status = 'draft' where cycle_id = 'ae000000-0000-4000-8000-000000000001' and department_id = 'a3000000-0000-4000-8000-000000000004'$q$,
    array['JK005'], 'no recall once the needs are closed');
  perform tests.assert_fails($q$insert into tms.plan_needs (cycle_id, department_id, topic, people_count) values ('ae000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000004', 'Late', 1)$q$,
    array['JK005'], 'no need once the needs are closed');
end $$;
select tests.set_claims(tests.ua_claims());
do $$
begin
  perform tests.assert_eq((select count(*) from tms.plan_lines), 0::bigint, 'the Organization Admin sees no plan');
end $$;

-- Tenant B's L&D Manager: nothing of A's plan.
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-00000000e0b1',
  'b0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-0000000000ab'));
do $$
begin
  perform tests.assert_eq((select count(*) from tms.training_plans) + (select count(*) from tms.plan_lines)
                          + (select count(*) from tms.plan_line_needs) + (select count(*) from tms.plan_budget_reasons),
    0::bigint, 'B sees none of A''s plan');
  perform tests.assert_eq(tests.rows_affected($q$update tms.plan_lines set quarter = 4$q$), 0::bigint, 'nor changes it');
  perform tests.assert_eq(private.plan_line_departments(current_setting('tests.tp_excel_line')::uuid), '{}'::uuid[],
    'nor learns a line''s departments');
  perform tests.assert(not private.plan_cycle_consolidating('a0000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000001'),
    'nor whether A''s cycle is consolidated');
  perform tests.assert_fails(format($q$insert into tms.plan_lines (plan_id, cycle_id, group_key, title, quarter) values (%L, 'ae000000-0000-4000-8000-000000000001', 'topic:x', 'Intruder', 1)$q$, current_setting('tests.tp_plan')),
    array['23503', '42501'], 'nor adds a line to it');
end $$;

-- Frozen in approval (WP-LD-03 moves the state; written here as a platform operation): nothing changes.
reset role;
reset session authorization;
alter table tms.training_plans disable trigger training_plans_guard;
update tms.training_plans set status = 'in_approval' where id = tests.tp_plan();
alter table tms.training_plans enable trigger training_plans_guard;
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000e0a1', '10000000-0000-4000-8000-00000000e0a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a1'));
do $$
begin
  perform tests.assert_fails($q$update tms.plan_lines set quarter = 4 where id = tests.tp_line('Excel – advanced formulas')$q$,
    array['JK008'], 'no line changes while the plan waits for approval');
  perform tests.assert_fails($q$delete from tms.plan_line_needs where need_id = tests.tp_need('excel advanced formulas!')$q$,
    array['JK008'], 'no need moves');
  perform tests.assert_fails($q$update tms.plan_budget_reasons set reason = 'Changed' where department_id = 'a3000000-0000-4000-8000-000000000001'$q$,
    array['JK008'], 'no reason changes');
  perform tests.assert(not private.plan_cycle_consolidating('a0000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000001'),
    'a plan in approval is not being consolidated');
end $$;
rollback;

\echo '99_planning_f_plan_1_owner: ok'
