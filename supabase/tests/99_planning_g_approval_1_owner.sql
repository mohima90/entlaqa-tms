-- db-test: run-as=owner
-- Approving the training plan (WP-LD-03, T-M3-07; FR-PLN-08, FR-WFL-01/02 R1 part, FR-IAM-07; migrations
-- 20261116100000…100200): the Finance role and the decision permissions in the catalogue, the role
-- plan_approval_guard, then one journey — submitted (refused while not ready), sent back by the HR Manager with a
-- comment, resubmitted with «Finance confirms the plan» on, approved by the HR Manager, confirmed by Finance, locked
-- as version 1 with each department's result, revised into version 2 — with who may do what: the L&D Manager
-- (submits, revises), every HR Manager (the HR step; the first decision settles it), Finance (its step only, after
-- HR), and never the submitter; the Training Coordinator, an Employee, the Department Head, a department-limited L&D
-- Manager and another organization decide nothing; the head reads its department's result once approved.
-- Fixtures: 00_helpers_and_fixtures.sql (uAB: HR Manager of A; cycle ae…01, form a7…01), 99_planning_a_fixtures
-- (uL, uT, uE), 99_planning_d_needs_0 (uH heads SAL a3…04), 99_people_0 (uM1 …c04); added here (rolled back): uR (a
-- second HR Manager, …e0a5) and uF (Finance, …e0a6). Users act through session_user app_server, as withUserTx does.
\set ON_ERROR_STOP on

-- ---- catalogue, grants, the guard role ----------------------------------------------------------------
do $$
declare
  v_list text;
begin
  perform tests.assert((select is_privileged from platform.ref_roles where code = 'finance'),
    'Finance is a ready-made role only the Organization Admin gives');
  perform tests.assert(private.role_is_privileged('a0000000-0000-4000-8000-000000000001', 'finance'),
    'the database guard treats it as privileged');
  perform tests.assert_eq(
    (select string_agg(code || ':' || risk || ':' || custom_role_use || ':' || privileged::text, ',' order by code)
     from platform.ref_permissions where code in ('tms.training_plan.approve', 'tms.training_plan.confirm')),
    'tms.training_plan.approve:medium:none:false,tms.training_plan.confirm:medium:none:false',
    'the decisions go by role: no custom role can hold them');
  perform tests.assert_eq(
    (select string_agg(role_code || ':' || permission_code || ':' || scope, ',' order by role_code, permission_code)
     from platform.ref_role_permissions where role_code in ('finance', 'hr_manager') and permission_code like 'tms.%'
       and permission_code not like 'tms.course%'),
    'finance:tms.training_plan.confirm:tenant,finance:tms.training_plan.read:tenant,hr_manager:tms.training_plan.approve:tenant,hr_manager:tms.training_plan.read:tenant',
    'the HR Manager approves, Finance confirms; both read the plan and its budgets');
  perform tests.assert_eq(
    (select string_agg(permission_code || ':' || scope, ',' order by permission_code)
     from platform.ref_role_permissions where role_code = 'finance' and permission_code like 'platform.%'),
    'platform.org.read:tenant,platform.user.read:own', 'Finance sees the departments and its own record');
  perform tests.assert_eq(private.permission_feature('tms.training_plan.confirm'), 'planning',
    'the decisions belong to the planning feature');
  perform tests.assert(has_column_privilege('authenticated', 'tms.planning_settings', 'finance_confirms', 'UPDATE'),
    'the L&D Manager switches the Finance step (policies of the settings)');

  perform tests.assert(not (select rolbypassrls or rolcanlogin or rolsuper or rolinherit or rolcreaterole or rolcreatedb
                            from pg_roles where rolname = 'plan_approval_guard'),
    'plan_approval_guard must be NOLOGIN NOINHERIT and not BYPASSRLS / superuser / createrole / createdb');
  perform tests.assert(not exists (select 1 from pg_auth_members m join pg_roles u on u.oid = m.member
                                   where m.roleid = 'plan_approval_guard'::regrole and (m.inherit_option or m.set_option)
                                     and not u.rolsuper and u.rolname <> current_user),
    'nobody acts as plan_approval_guard');
  perform tests.assert(not has_schema_privilege('plan_approval_guard', 'private', 'CREATE')
                       and not has_schema_privilege('plan_approval_guard', 'tms', 'CREATE'),
    'plan_approval_guard creates nothing');
  perform tests.assert_eq((select string_agg(c.oid::regclass::text || ':' || c.relkind::text, ',') from pg_class c
                           where c.relowner = 'plan_approval_guard'::regrole),
    'private.training_plan_departments:v', 'it owns one view: the envelopes for the approvers (review M1)');
  perform tests.assert((select 'security_barrier=true' = any (reloptions) from pg_class
                        where oid = 'private.training_plan_departments'::regclass)
                       and has_table_privilege('authenticated', 'private.training_plan_departments', 'SELECT')
                       and not has_table_privilege('authenticated', 'private.training_plan_departments', 'INSERT, UPDATE, DELETE')
                       and not exists (select 1 from pg_attribute a
                                       where a.attrelid = 'private.training_plan_departments'::regclass
                                         and a.attname in ('answers', 'return_note', 'submitted_by', 'returned_by')),
    'a security-barrier view, read only, without the answers, the return note or who submitted');
  perform tests.assert(not has_column_privilege('plan_approval_guard', 'tms.plan_cycle_departments', 'answers', 'SELECT')
                       and not has_column_privilege('plan_approval_guard', 'tms.plan_cycle_departments', 'return_note', 'SELECT'),
    'its owner cannot read the answers or the return note either');
  -- Review H1: the plan's editability and the state machine share one lock; the state is read after it.
  perform tests.assert((select provolatile = 'v' from pg_proc where oid = 'private.training_plan_editable(uuid, uuid)'::regprocedure)
                       and position('training_plan_lock' in pg_get_functiondef('private.training_plan_editable(uuid, uuid)'::regprocedure)) > 0
                       and position('training_plan_lock' in pg_get_functiondef('private.training_plans_guard()'::regprocedure)) > 0
                       and position('training_plan_lock' in pg_get_functiondef('private.plan_cycle_department_guard()'::regprocedure)) > 0,
    'the plan''s changes and its changes of state take the organization''s plan lock (review H1)');
  -- Review L4: never null.
  perform tests.assert(private.may_decide_training_plan('a0000000-0000-4000-8000-000000000001', 'hr') is false
                       and private.may_decide_training_plan('a0000000-0000-4000-8000-000000000001', 'unknown') is false,
    'may_decide_training_plan answers false, never null, without claims or for an unknown step');
  select string_agg(format('%s%s', p.oid::regprocedure, case when p.prosecdef then ' (definer)' else '' end), ', '
                    order by p.oid::regprocedure::text)
    into v_list
  from pg_proc p where p.proowner = 'plan_approval_guard'::regrole;
  perform tests.assert_eq(v_list,
    'private.training_plan_version_lines(uuid,uuid), private.training_plans_record() (definer)',
    'plan_approval_guard owns the trigger and its helper');
  perform tests.assert(not has_function_privilege('authenticated', 'private.training_plan_version_lines(uuid, uuid)', 'EXECUTE')
                       and not has_function_privilege('authenticated', 'private.training_plans_record()', 'EXECUTE'),
    'nobody calls them: a trigger only');
  perform tests.assert(not has_table_privilege('plan_approval_guard', 'tms.plan_needs', 'SELECT')
                       and not has_table_privilege('plan_approval_guard', 'tms.plan_need_people', 'SELECT')
                       and not has_table_privilege('plan_approval_guard', 'platform.persons', 'SELECT')
                       and not has_column_privilege('plan_approval_guard', 'tms.training_plans', 'status', 'UPDATE')
                       and not has_column_privilege('plan_approval_guard', 'tms.plan_lines', 'title', 'UPDATE'),
    'plan_approval_guard reads what a version is made of and writes the approval tables — nothing else');

  -- Grants: a statement names the new state and a send-back comment; the rest is the database's.
  perform tests.assert(has_column_privilege('authenticated', 'tms.training_plans', 'status', 'UPDATE')
                       and has_column_privilege('authenticated', 'tms.training_plans', 'send_back_comment', 'UPDATE')
                       and not has_column_privilege('authenticated', 'tms.training_plans', 'approval_step', 'UPDATE')
                       and not has_column_privilege('authenticated', 'tms.training_plans', 'finance_step', 'UPDATE')
                       and not has_column_privilege('authenticated', 'tms.training_plans', 'approved_by', 'UPDATE'),
    'training_plans: the state through the guard only');
  perform tests.assert(not has_table_privilege('authenticated', 'tms.training_plan_events', 'INSERT')
                       and not has_table_privilege('authenticated', 'tms.training_plan_versions', 'INSERT')
                       and not has_table_privilege('authenticated', 'tms.training_plan_department_results', 'INSERT')
                       and not has_table_privilege('authenticated', 'tms.training_plan_versions', 'UPDATE')
                       and not has_table_privilege('authenticated', 'tms.training_plan_events', 'DELETE'),
    'the history, versions and results are written by the database only, and never changed');
end $$;

-- ---- the journey --------------------------------------------------------------------------------------
begin;
-- uR (a second HR Manager) and uF (Finance) in A.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000e0a5', 'ur@a.test'),
  ('00000000-0000-4000-8000-00000000e0a6', 'uf@a.test');
insert into auth.sessions (id, user_id, not_after) values
  ('10000000-0000-4000-8000-00000000e0a5', '00000000-0000-4000-8000-00000000e0a5', null),
  ('10000000-0000-4000-8000-00000000e0a6', '00000000-0000-4000-8000-00000000e0a6', null);
insert into platform.persons (id, tenant_id, display_name_ar, display_name_en, email) values
  ('a1000000-0000-4000-8000-00000000e0a5', 'a0000000-0000-4000-8000-000000000001', 'مدير موارد', 'HR Two', 'ur@a.test'),
  ('a1000000-0000-4000-8000-00000000e0a6', 'a0000000-0000-4000-8000-000000000001', 'المالية', 'Finance One', 'uf@a.test');
insert into platform.tenant_memberships (tenant_id, user_id, person_id, status) values
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000e0a5', 'a1000000-0000-4000-8000-00000000e0a5', 'active'),
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000e0a6', 'a1000000-0000-4000-8000-00000000e0a6', 'active');
insert into platform.session_context (session_id, user_id, active_tenant_id) values
  ('10000000-0000-4000-8000-00000000e0a5', '00000000-0000-4000-8000-00000000e0a5', 'a0000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-00000000e0a6', '00000000-0000-4000-8000-00000000e0a6', 'a0000000-0000-4000-8000-000000000001');
insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary)
select m.tenant_id, m.id, r.role_code, true
from (values ('00000000-0000-4000-8000-00000000e0a5'::uuid, 'hr_manager'),
             ('00000000-0000-4000-8000-00000000e0a6', 'finance')) as r (user_id, role_code)
join platform.tenant_memberships m on m.tenant_id = 'a0000000-0000-4000-8000-000000000001' and m.user_id = r.user_id;
-- uM1: a department-limited L&D Manager for SAL (a custom role limited to «A department»).
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

create function tests.ga_claims(p_who text) returns jsonb language sql immutable as $f$
  select case p_who
    when 'uL' then tests.user_claims('00000000-0000-4000-8000-00000000e0a1', '10000000-0000-4000-8000-00000000e0a1',
                                     'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a1')
    when 'uT' then tests.user_claims('00000000-0000-4000-8000-00000000e0a2', '10000000-0000-4000-8000-00000000e0a2',
                                     'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a2')
    when 'uE' then tests.user_claims('00000000-0000-4000-8000-00000000e0a3', '10000000-0000-4000-8000-00000000e0a3',
                                     'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a3')
    when 'uH' then tests.user_claims('00000000-0000-4000-8000-00000000e0a4', '10000000-0000-4000-8000-00000000e0a4',
                                     'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a4')
    when 'uR' then tests.user_claims('00000000-0000-4000-8000-00000000e0a5', '10000000-0000-4000-8000-00000000e0a5',
                                     'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a5')
    when 'uF' then tests.user_claims('00000000-0000-4000-8000-00000000e0a6', '10000000-0000-4000-8000-00000000e0a6',
                                     'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a6')
    when 'uM1' then tests.user_claims('00000000-0000-4000-8000-000000000c04', '10000000-0000-4000-8000-000000000c41',
                                      'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000c04')
    when 'uAB' then tests.uab_claims()
    -- uAB acting in tenant B (its L&D Manager there).
    when 'B' then tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-00000000e0b1',
                                    'b0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-0000000000ab')
  end $f$;
create function tests.ga_need(p_topic text) returns uuid language sql stable
  as $f$ select id from tms.plan_needs where cycle_id = 'ae000000-0000-4000-8000-000000000001' and topic = p_topic $f$;
create function tests.ga_line(p_title text) returns uuid language sql stable
  as $f$ select id from tms.plan_lines where title = p_title $f$;
create function tests.ga_plan() returns uuid language sql stable
  as $f$ select id from tms.training_plans where cycle_id = 'ae000000-0000-4000-8000-000000000001' $f$;
-- The approval as the application writes it: the state it saw, the version it saw.
create function tests.ga_decide(p_status text, p_step text, p_comment text default null) returns bigint
  language plpgsql as $f$
declare
  v_count bigint;
begin
  update tms.training_plans set status = p_status, send_back_comment = p_comment
  where id = current_setting('tests.ga_plan')::uuid and status = 'in_approval' and approval_step = p_step
    and version = current_setting('tests.ga_version')::integer;
  get diagnostics v_count = row_count;
  return v_count;
end $f$;
grant execute on function tests.ga_decide(text, text, text) to authenticated;

set local session authorization app_server;
set local role authenticated;

-- uL launches ae…01 with SAL (envelope 7,000); uH submits two needs; uL closes them now and opens the plan.
select tests.set_claims(tests.ga_claims('uL'));
do $$
declare
  c constant uuid := 'ae000000-0000-4000-8000-000000000001';
  sal constant uuid := 'a3000000-0000-4000-8000-000000000004';
begin
  update tms.plan_cycles set status = 'closed' where id = 'ae000000-0000-4000-8000-000000000002';
  delete from tms.plan_cycle_scope where cycle_id = c;
  delete from tms.plan_cycle_departments where cycle_id = c;
  insert into tms.plan_cycle_scope (cycle_id, department_id) values (c, sal);
  insert into tms.plan_cycle_departments (cycle_id, department_id, budget_amount) values (c, sal, 7000);
  update tms.plan_cycles set needs_form_id = 'a7000000-0000-4000-8000-000000000001' where id = c;
  update tms.plan_cycles set status = 'open' where id = c;
end $$;
select tests.set_claims(tests.ga_claims('uH'));
insert into tms.plan_needs (cycle_id, department_id, topic, people_count) values
  ('ae000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000004', 'Excel', 20),
  ('ae000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000004', 'Negotiation', 6);
update tms.plan_cycle_departments set status = 'submitted'
  where cycle_id = 'ae000000-0000-4000-8000-000000000001' and department_id = 'a3000000-0000-4000-8000-000000000004';
select tests.set_claims(tests.ga_claims('uL'));
do $$
declare
  c constant uuid := 'ae000000-0000-4000-8000-000000000001';
  sal constant uuid := 'a3000000-0000-4000-8000-000000000004';
  p uuid;
begin
  update tms.plan_cycles set status = 'closed' where id = c;
  insert into tms.training_plans (cycle_id) values (c) returning id into p;
  perform set_config('tests.ga_plan', p::text, true);
  insert into tms.plan_lines (plan_id, cycle_id, group_key, title, quarter) values
    (p, c, 'topic:excel', 'Excel', 1),
    (p, c, 'topic:negotiation', 'Negotiation', 2);
  insert into tms.plan_line_needs (plan_id, cycle_id, line_id, need_id, department_id) values
    (p, c, tests.ga_line('Excel'), tests.ga_need('Excel'), sal);
  perform tests.assert((select approval_step is null and not finance_step and submitted_by is null
                        from tms.training_plans where id = p), 'a new plan waits for nobody');

  -- Not ready: a need not in the plan, a line without a cost, a department over its envelope without a reason.
  perform tests.assert_fails_state_like(format($q$update tms.training_plans set status = 'in_approval' where id = %L$q$, p),
    'JK010', '%needs_not_added%', 'a submitted need is not in the plan yet');
  insert into tms.plan_line_needs (plan_id, cycle_id, line_id, need_id, department_id) values
    (p, c, tests.ga_line('Negotiation'), tests.ga_need('Negotiation'), sal);
  perform tests.assert_fails_state_like(format($q$update tms.training_plans set status = 'in_approval' where id = %L$q$, p),
    'JK010', '%uncosted%', 'a line in the plan without a cost');
  update tms.plan_lines set min_per_session = 5, max_per_session = 20, cost_per_session = 5000 where id = tests.ga_line('Excel');
  update tms.plan_lines set max_per_session = 10, cost_per_session = 3000 where id = tests.ga_line('Negotiation');
  perform tests.assert_fails_state_like(format($q$update tms.training_plans set status = 'in_approval' where id = %L$q$, p),
    'JK010', '%over_budget%', 'SAL is over its envelope (8,000 of 7,000) without a reason');
  perform tests.assert(private.training_plan_submit_problem('a0000000-0000-4000-8000-000000000001', p, c) = 'over_budget',
    'the reason the application is told');
  insert into tms.plan_budget_reasons (plan_id, cycle_id, department_id, reason) values (p, c, sal, 'Two new branches open in Q2');
  perform tests.assert(private.training_plan_submit_problem('a0000000-0000-4000-8000-000000000001', p, c) is null,
    'ready now');
  perform set_config('tests.ga_version', (select version::text from tms.training_plans where id = p), true);
end $$;

-- Nobody but the organization-wide L&D Manager submits.
select tests.set_claims(tests.ga_claims('uT'));
do $$
begin
  perform tests.assert_eq(tests.rows_affected(format($q$update tms.training_plans set status = 'in_approval' where id = %L$q$, current_setting('tests.ga_plan'))),
    0::bigint, 'the Training Coordinator does not submit');
end $$;
select tests.set_claims(tests.ga_claims('uM1'));
do $$
begin
  perform tests.assert_eq(tests.rows_affected(format($q$update tms.training_plans set status = 'in_approval' where id = %L$q$, current_setting('tests.ga_plan'))),
    0::bigint, 'a department-limited L&D Manager does not submit (one plan per organization)');
end $$;
select tests.set_claims(tests.ga_claims('uAB'));
do $$
begin
  perform tests.assert_fails(format($q$update tms.training_plans set status = 'in_approval' where id = %L$q$, current_setting('tests.ga_plan')),
    array['42501'], 'the HR Manager does not submit');
end $$;

-- uL submits: frozen, the HR step; the Finance switch is off.
select tests.set_claims(tests.ga_claims('uL'));
do $$
declare
  p constant uuid := current_setting('tests.ga_plan')::uuid;
begin
  perform tests.assert_eq(tests.rows_affected(format($q$update tms.training_plans set status = 'in_approval', send_back_comment = 'ignored' where id = %L$q$, p)),
    1::bigint, 'the L&D Manager submits');
  perform tests.assert((select status = 'in_approval' and approval_step = 'hr' and not finance_step
                               and submitted_by = 'a1000000-0000-4000-8000-00000000e0a1'::uuid and submitted_at is not null
                               and send_back_comment is null
                        from tms.training_plans where id = p),
    'in approval, waiting for the HR Manager, stamped by the database');
  perform tests.assert_eq((select string_agg(kind || ':' || coalesce(step, '-') || ':' || actor_person_id::text, ',')
                           from tms.training_plan_events where plan_id = p),
    'submitted:-:a1000000-0000-4000-8000-00000000e0a1', 'the history says who submitted');
  perform tests.assert_fails($q$update tms.plan_lines set quarter = 4 where id = tests.ga_line('Excel')$q$,
    array['JK008'], 'frozen while it waits');
  perform tests.assert_fails(format($q$update tms.training_plans set status = 'draft' where id = %L$q$, p),
    array['JK001'], 'not taken back by a statement');
  perform tests.assert_fails(format($q$update tms.training_plans set status = 'approved' where id = %L$q$, p),
    array['42501'], 'and the L&D Manager decides nothing');
  perform set_config('tests.ga_version', (select version::text from tms.training_plans where id = p), true);
end $$;

-- Who may not decide.
select tests.set_claims(tests.ga_claims('uF'));
do $$
begin
  perform tests.assert_fails($q$select tests.ga_decide('approved', 'hr')$q$, array['42501'],
    'Finance never decides before the HR Manager');
end $$;
select tests.set_claims(tests.ga_claims('uT'));
do $$
begin
  perform tests.assert_eq(tests.ga_decide('approved', 'hr'), 0::bigint, 'the Training Coordinator decides nothing');
end $$;
select tests.set_claims(tests.ga_claims('uE'));
do $$
begin
  perform tests.assert_eq(tests.ga_decide('approved', 'hr'), 0::bigint, 'an Employee decides nothing');
  perform tests.assert_eq((select count(*) from tms.training_plan_events), 0::bigint, 'nor reads the history');
end $$;
select tests.set_claims(tests.ga_claims('uH'));
do $$
begin
  perform tests.assert_eq(tests.ga_decide('approved', 'hr'), 0::bigint, 'the Department Head is not asked again');
end $$;
select tests.set_claims(tests.ga_claims('uM1'));
do $$
begin
  perform tests.assert_eq(tests.ga_decide('approved', 'hr'), 0::bigint, 'a department-limited L&D Manager decides nothing');
end $$;
select tests.set_claims(tests.ga_claims('B'));
do $$
begin
  perform tests.assert_eq(tests.ga_decide('approved', 'hr'), 0::bigint, 'another organization decides nothing');
  perform tests.assert_eq((select count(*) from tms.training_plans) + (select count(*) from tms.training_plan_events),
    0::bigint, 'and sees nothing');
end $$;

-- The HR Manager sends it back: a comment is needed; the first decision settles the step.
select tests.set_claims(tests.ga_claims('uAB'));
do $$
declare
  p constant uuid := current_setting('tests.ga_plan')::uuid;
begin
  perform tests.assert_eq((select count(*) from tms.plan_lines where plan_id = p), 2::bigint, 'the HR Manager reads the lines');
  perform tests.assert_eq((select count(*) from tms.plan_budget_reasons where plan_id = p), 1::bigint, 'and the reasons');
  perform tests.assert_eq((select string_agg(x.seats::text, ',' order by x.seats) from tms.plan_line_needs x where x.plan_id = p),
    '6,20', 'and each line''s seats by department');
  -- Review M1: the plan, never the departments' raw needs.
  perform tests.assert_eq((select count(*) from tms.plan_needs) + (select count(*) from tms.plan_need_people)
                          + (select count(*) from tms.plan_cycle_departments), 0::bigint,
    'the HR Manager reads no need, no named person and no department''s answers or return note');
  perform tests.assert_eq((select string_agg(department_id::text || ':' || (budget_amount = 7000)::text || ':' || status, ',')
                           from private.training_plan_departments where cycle_id = 'ae000000-0000-4000-8000-000000000001'),
    'a3000000-0000-4000-8000-000000000004:true:submitted', 'it reads the envelopes the plan is checked against');
  -- Review L1: a statement that moves nothing is not the approver's.
  perform tests.assert_fails(format($q$update tms.training_plans set status = status where id = %L$q$, p), array['42501'],
    'the HR Manager does not touch the plan without deciding');
  perform tests.assert_eq((select version::text from tms.training_plans where id = p), current_setting('tests.ga_version'),
    'its version is unchanged');
  perform tests.assert_fails($q$select tests.ga_decide('sent_back', 'hr')$q$, array['JK012'], 'sending back needs a comment');
  perform tests.assert_fails($q$select tests.ga_decide('sent_back', 'hr', '   ')$q$, array['JK012', '23514'],
    'a comment with visible text');
  perform tests.assert_eq(tests.ga_decide('sent_back', 'hr', 'Please bring Sales under its budget.'), 1::bigint,
    'the HR Manager sends the plan back');
  perform tests.assert((select status = 'sent_back' and approval_step is null
                               and decided_by = 'a1000000-0000-4000-8000-0000000000ab'::uuid
                               and send_back_comment = 'Please bring Sales under its budget.'
                        from tms.training_plans where id = p),
    'a draft again, with the comment for the L&D Manager');
end $$;
select tests.set_claims(tests.ga_claims('uR'));
do $$
begin
  perform tests.assert_eq(tests.ga_decide('approved', 'hr'), 0::bigint,
    'a second HR Manager''s decision changes nothing once the first settled the step');
  perform tests.assert_fails(format($q$update tms.training_plans set status = 'approved' where id = %L$q$, current_setting('tests.ga_plan')),
    array['JK001'], 'not even without the application''s conditions');
end $$;

-- uL changes a line, switches «Finance confirms the plan» on and submits again.
select tests.set_claims(tests.ga_claims('uL'));
do $$
declare
  p constant uuid := current_setting('tests.ga_plan')::uuid;
begin
  perform tests.assert_eq((select string_agg(kind || ':' || coalesce(step, '-') || ':' || coalesce(comment, '-'), ',' order by occurred_at)
                           from tms.training_plan_events where plan_id = p),
    'submitted:-:-,sent_back:hr:Please bring Sales under its budget.', 'the history keeps the comment');
  update tms.plan_lines set cost_per_session = 2500 where id = tests.ga_line('Negotiation');
  insert into tms.planning_settings (finance_confirms) values (true)
    on conflict (tenant_id) do update set finance_confirms = excluded.finance_confirms;
  perform tests.assert_eq(tests.rows_affected(format($q$update tms.training_plans set status = 'in_approval' where id = %L$q$, p)),
    1::bigint, 'submitted again');
  perform tests.assert((select approval_step = 'hr' and finance_step and send_back_comment is null and decided_by is null
                        from tms.training_plans where id = p),
    'the same steps again, Finance included now');
  perform set_config('tests.ga_version', (select version::text from tms.training_plans where id = p), true);
end $$;

-- Nobody decides on a plan they submitted: uL as an HR Manager for a moment (a platform operation).
select tests.set_claims(null);
reset role;
reset session authorization;
update platform.role_assignments ra set role_code = 'hr_manager'
from platform.tenant_memberships m
where m.id = ra.membership_id and m.user_id = '00000000-0000-4000-8000-00000000e0a1' and m.tenant_id = 'a0000000-0000-4000-8000-000000000001';
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(tests.ga_claims('uL'));
do $$
begin
  perform tests.assert_fails($q$select tests.ga_decide('approved', 'hr')$q$, array['JK011'],
    'the submitter never approves their own plan');
end $$;
select tests.set_claims(null);
reset role;
reset session authorization;
update platform.role_assignments ra set role_code = 'training_manager'
from platform.tenant_memberships m
where m.id = ra.membership_id and m.user_id = '00000000-0000-4000-8000-00000000e0a1' and m.tenant_id = 'a0000000-0000-4000-8000-000000000001';
set local session authorization app_server;
set local role authenticated;

-- uR approves for HR: Finance is asked next.
select tests.set_claims(tests.ga_claims('uR'));
do $$
declare
  p constant uuid := current_setting('tests.ga_plan')::uuid;
begin
  perform tests.assert_eq(tests.ga_decide('approved', 'hr'), 1::bigint, 'any HR Manager approves');
  perform tests.assert((select status = 'in_approval' and approval_step = 'finance'
                               and hr_decided_by = 'a1000000-0000-4000-8000-00000000e0a5'::uuid and approved_at is null
                        from tms.training_plans where id = p),
    'waiting for Finance now');
  perform tests.assert_eq((select count(*) from tms.training_plan_versions), 0::bigint, 'no version until it is approved');
  perform set_config('tests.ga_version', (select version::text from tms.training_plans where id = p), true);
end $$;
select tests.set_claims(tests.ga_claims('uAB'));
do $$
begin
  perform tests.assert_fails($q$select tests.ga_decide('approved', 'finance')$q$, array['42501'],
    'the HR Manager does not confirm for Finance');
end $$;
-- uR as Finance for a moment: who approved for HR never confirms too.
select tests.set_claims(null);
reset role;
reset session authorization;
update platform.role_assignments ra set role_code = 'finance'
from platform.tenant_memberships m
where m.id = ra.membership_id and m.user_id = '00000000-0000-4000-8000-00000000e0a5' and m.tenant_id = 'a0000000-0000-4000-8000-000000000001';
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(tests.ga_claims('uR'));
do $$
begin
  perform tests.assert_fails($q$select tests.ga_decide('approved', 'finance')$q$, array['JK011'],
    'who approved for HR never confirms for Finance');
end $$;
select tests.set_claims(null);
reset role;
reset session authorization;
update platform.role_assignments ra set role_code = 'hr_manager'
from platform.tenant_memberships m
where m.id = ra.membership_id and m.user_id = '00000000-0000-4000-8000-00000000e0a5' and m.tenant_id = 'a0000000-0000-4000-8000-000000000001';
set local session authorization app_server;
set local role authenticated;

-- uF confirms: approved, version 1 locked, each department's result kept.
select tests.set_claims(tests.ga_claims('uF'));
do $$
declare
  p constant uuid := current_setting('tests.ga_plan')::uuid;
  v_result jsonb;
begin
  perform tests.assert_eq((select count(*) from tms.plan_lines where plan_id = p), 2::bigint, 'Finance reads the plan');
  perform tests.assert_eq((select count(*) from tms.plan_needs) + (select count(*) from tms.plan_need_people)
                          + (select count(*) from tms.plan_cycle_departments), 0::bigint,
    'Finance reads no need, no named person and no department''s answers (review M1)');
  perform tests.assert_eq((select count(*) from private.training_plan_departments), 1::bigint, 'only the envelopes');
  perform tests.assert_fails(format($q$update tms.training_plans set send_back_comment = 'x' where id = %L$q$, p), array['42501'],
    'Finance does not touch the plan without deciding (review L1)');
  perform tests.assert_eq(tests.ga_decide('approved', 'finance'), 1::bigint, 'Finance confirms');
  perform tests.assert((select status = 'approved' and approval_step is null and plan_version = 1
                               and approved_by = 'a1000000-0000-4000-8000-00000000e0a6'::uuid and approved_at is not null
                        from tms.training_plans where id = p),
    'approved, version 1');
  perform tests.assert_eq((select string_agg(kind || ':' || coalesce(step, '-'), ',' order by occurred_at)
                           from tms.training_plan_events where plan_id = p),
    'submitted:-,sent_back:hr,submitted:-,approved:hr,confirmed:finance', 'every step in the history');
  perform tests.assert_eq((select jsonb_array_length(snapshot -> 'lines') || ':' || (snapshot ->> 'currency') || ':'
                                  || (snapshot -> 'departments' -> 0 ->> 'reason')
                           from tms.training_plan_versions where plan_id = p and plan_version = 1),
    '2:SAR:Two new branches open in Q2', 'version 1 as approved: its lines, currency and reasons');
  select result into v_result from tms.training_plan_department_results
    where plan_id = p and department_id = 'a3000000-0000-4000-8000-000000000004';
  perform tests.assert_eq(
    ((v_result ->> 'envelope')::numeric = 7000)::text || ':' || (v_result -> 'lines' -> 0 ->> 'title') || ':'
      || (v_result -> 'lines' -> 0 -> 'departments' -> 0 ->> 'seats') || ':' || jsonb_array_length(v_result -> 'lines'),
    'true:Excel:20:2', 'SAL''s result: its envelope and its lines with the seats');
  perform tests.assert_eq(tests.rows_affected($q$update tms.plan_lines set quarter = 4$q$), 0::bigint,
    'Finance changes no line');
  perform tests.assert_fails($q$insert into tms.training_plan_versions (tenant_id, plan_id, cycle_id, plan_version, approved_at, snapshot) values ('a0000000-0000-4000-8000-000000000001', tests.ga_plan(), 'ae000000-0000-4000-8000-000000000001', 9, now(), '{}')$q$,
    array['42501'], 'nobody writes a version by a statement');
  perform tests.assert_fails($q$insert into tms.training_plan_events (tenant_id, plan_id, cycle_id, plan_version, kind) values ('a0000000-0000-4000-8000-000000000001', tests.ga_plan(), 'ae000000-0000-4000-8000-000000000001', 1, 'approved')$q$,
    array['42501'], 'nor a step of the history');
end $$;

-- What each one reads once approved.
select tests.set_claims(tests.ga_claims('uH'));
do $$
begin
  perform tests.assert_eq((select string_agg(department_id::text || ':' || plan_version, ',') from tms.training_plan_department_results),
    'a3000000-0000-4000-8000-000000000004:1', 'the head of SAL reads SAL''s result (Q4 = A: once approved)');
  perform tests.assert_eq((select count(*) from tms.training_plan_versions) + (select count(*) from tms.training_plan_events)
                          + (select count(*) from tms.training_plans), 0::bigint,
    'but not the whole plan, its history or its state');
end $$;
select tests.set_claims(tests.ga_claims('uE'));
do $$
begin
  perform tests.assert_eq((select count(*) from tms.training_plan_department_results) + (select count(*) from tms.training_plan_versions),
    0::bigint, 'an Employee reads no result');
end $$;
select tests.set_claims(tests.ga_claims('uM1'));
do $$
begin
  perform tests.assert_eq((select count(*) from tms.training_plan_department_results), 1::bigint,
    'a department-limited L&D Manager reads its units'' results');
  perform tests.assert_eq((select count(*) from tms.training_plan_versions), 0::bigint, 'not the whole version');
  perform tests.assert(private.may_decide_training_plan('a0000000-0000-4000-8000-000000000001', 'hr') is not true,
    'and decides nothing');
end $$;
select tests.set_claims(tests.ga_claims('B'));
do $$
begin
  perform tests.assert_eq((select count(*) from tms.training_plan_department_results) + (select count(*) from tms.training_plan_versions)
                          + (select count(*) from tms.training_plan_events), 0::bigint,
    'another organization reads nothing of A''s approval');
  perform tests.assert(not private.may_decide_training_plan('a0000000-0000-4000-8000-000000000001', 'hr'),
    'and decides nothing for A');
end $$;

-- Revise: the L&D Manager only; version 2 is a draft, version 1 stays.
select tests.set_claims(tests.ga_claims('uAB'));
do $$
begin
  perform tests.assert_fails(format($q$update tms.training_plans set status = 'draft' where id = %L$q$, current_setting('tests.ga_plan')),
    array['42501'], 'the HR Manager does not revise');
end $$;
select tests.set_claims(tests.ga_claims('uL'));
do $$
declare
  p constant uuid := current_setting('tests.ga_plan')::uuid;
begin
  perform tests.assert_fails($q$update tms.plan_lines set quarter = 4 where id = tests.ga_line('Excel')$q$,
    array['JK008'], 'locked once approved');
  perform tests.assert_eq(tests.rows_affected(format($q$update tms.training_plans set status = 'draft' where id = %L and status = 'approved'$q$, p)),
    1::bigint, 'the L&D Manager revises the plan');
  perform tests.assert((select status = 'draft' and plan_version = 2 and approval_step is null and submitted_by is null
                        from tms.training_plans where id = p),
    'version 2 is a draft');
  perform tests.assert_eq((select string_agg(plan_version::text, ',') from tms.training_plan_versions where plan_id = p), '1',
    'version 1 is kept as approved');
  perform tests.assert_eq((select kind || ':' || plan_version from tms.training_plan_events where plan_id = p order by occurred_at desc, kind limit 1),
    'revised:2', 'the history says so');
  update tms.plan_lines set quarter = 3 where id = tests.ga_line('Excel');
  perform tests.assert_eq((select (snapshot -> 'lines' -> 0 ->> 'quarter') from tms.training_plan_versions where plan_id = p),
    '1', 'a change in version 2 leaves version 1 as it was');
end $$;

-- Review M1: a person named for a need (written here as a platform operation) — read by the L&D Manager and the
-- head, never by the HR Manager or Finance; the envelopes' view answers nobody else.
select tests.set_claims(null);
reset role;
reset session authorization;
alter table tms.plan_need_people disable trigger user;
insert into tms.plan_need_people (tenant_id, need_id, department_id, person_id)
values ('a0000000-0000-4000-8000-000000000001', tests.ga_need('Excel'), 'a3000000-0000-4000-8000-000000000004',
        'a1000000-0000-4000-8000-00000000e0a3');
alter table tms.plan_need_people enable trigger user;
alter table tms.plan_cycle_departments disable trigger user;
update tms.plan_cycle_departments set answers = '{"why": "growth"}'
where cycle_id = 'ae000000-0000-4000-8000-000000000001';
alter table tms.plan_cycle_departments enable trigger user;
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(tests.ga_claims('uL'));
do $$
begin
  perform tests.assert_eq((select count(*) from tms.plan_need_people) || ':' || (select count(*) from tms.plan_needs)
                          || ':' || (select answers ->> 'why' from tms.plan_cycle_departments
                                     where cycle_id = 'ae000000-0000-4000-8000-000000000001'),
    '1:2:growth', 'the L&D Manager, who builds the plan, reads the needs, who is named and the answers');
end $$;
select tests.set_claims(tests.ga_claims('uH'));
do $$
begin
  perform tests.assert_eq((select count(*) from tms.plan_need_people), 1::bigint, 'so does the head of SAL');
  perform tests.assert_eq((select count(*) from private.training_plan_departments), 0::bigint,
    'who does not read the plan''s envelopes through the approvers'' view');
end $$;
select tests.set_claims(tests.ga_claims('uT'));
do $$
begin
  perform tests.assert_eq((select count(*) from tms.plan_need_people), 1::bigint,
    'and the Training Coordinator (a reader of the cycles, as before WP-LD-03)');
end $$;
select tests.set_claims(tests.ga_claims('uAB'));
do $$
begin
  perform tests.assert_eq((select count(*) from tms.plan_needs) + (select count(*) from tms.plan_need_people)
                          + (select count(*) from tms.plan_cycle_departments where answers ? 'why'), 0::bigint,
    'the HR Manager reads neither the needs, nor who is named, nor the answers');
end $$;
select tests.set_claims(tests.ga_claims('uF'));
do $$
begin
  perform tests.assert_eq((select count(*) from tms.plan_needs) + (select count(*) from tms.plan_need_people)
                          + (select count(*) from tms.plan_cycle_departments where answers ? 'why'), 0::bigint,
    'nor does Finance');
end $$;
select tests.set_claims(tests.ga_claims('uE'));
do $$
begin
  perform tests.assert_eq((select count(*) from private.training_plan_departments), 0::bigint,
    'an Employee reads no envelope');
end $$;
select tests.set_claims(tests.ga_claims('B'));
do $$
begin
  perform tests.assert_eq((select count(*) from private.training_plan_departments
                           where tenant_id = 'a0000000-0000-4000-8000-000000000001'), 0::bigint,
    'nor another organization''s L&D Manager (its own organization''s only)');
end $$;
rollback;

\echo '99_planning_g_approval_1_owner: ok'
