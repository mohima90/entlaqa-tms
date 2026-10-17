-- db-test: run-as=app_server
-- Planning cycles (EP-PLN, T-M3-04; FR-PLN-02, FR-WFL-01/02 R1 part): permissions, tenant isolation as an L&D
-- Manager (cross-tenant inserts and composite foreign keys), constraints, BR-PLN-g, the state model (launch
-- checks, one open cycle — Q1, extend, close, draft-only children) and draft deletion. Fixtures:
-- 00_helpers_and_fixtures.sql and 99_planning_a_fixtures_owner.sql. Each block is rolled back.
\set ON_ERROR_STOP on

-- ---- who may manage -------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000e0a1', '10000000-0000-4000-8000-00000000e0a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a1'));
do $$
begin
  perform tests.assert(private.may_manage_plan_cycles('a0000000-0000-4000-8000-000000000001'), 'the L&D Manager manages cycles');
  perform tests.assert(not private.may_manage_plan_cycles('b0000000-0000-4000-8000-000000000001'),
    'never in another organization');
end $$;
rollback;

begin;
set local role authenticated;
-- uAB: HR Manager in A (no planning permission), L&D Manager in B.
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000ab'));
do $$
begin
  perform tests.assert(not private.may_manage_plan_cycles('a0000000-0000-4000-8000-000000000001'),
    'an HR Manager does not manage cycles');
  perform tests.assert_rls_violation($q$insert into tms.plan_cycles (name_ar, name_en, period_start_on, period_end_on, deadline_on) values ('خطة', 'Plan', current_date, current_date + 300, current_date + 10)$q$,
    'HR Manager: no new cycle');
end $$;
rollback;

begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-00000000e0b1',
  'b0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-0000000000ab'));
do $$
begin
  perform tests.assert(private.may_manage_plan_cycles('b0000000-0000-4000-8000-000000000001'),
    'the same person manages cycles where they are the L&D Manager (B)');
  perform tests.assert_eq((select count(*) from tms.plan_cycles), 1::bigint, 'B sees only its own cycle');
  perform tests.assert_eq(tests.rows_affected($q$update tms.plan_cycles set name_en = 'Plan B 2'$q$), 1::bigint,
    'B''s L&D Manager edits B''s draft');
  perform tests.assert_eq(tests.rows_affected($q$update tms.plan_cycles set name_en = 'x' where id = 'ae000000-0000-4000-8000-000000000001'$q$),
    0::bigint, 'never tenant A''s cycle');
end $$;
rollback;

-- ---- Training Coordinator: reads, never writes ----------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000e0a2', '10000000-0000-4000-8000-00000000e0a2',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a2'));
do $$
begin
  perform tests.assert(not private.may_manage_plan_cycles('a0000000-0000-4000-8000-000000000001'),
    'the Training Coordinator does not manage cycles');
  perform tests.assert_eq((select count(*) from tms.plan_cycles), 2::bigint, 'the coordinator reads A''s cycles');
  perform tests.assert_eq((select count(*) from tms.plan_cycle_departments), 2::bigint, 'and their departments');
  perform tests.assert_rls_violation($q$insert into tms.plan_cycles (name_ar, name_en, period_start_on, period_end_on, deadline_on) values ('خطة', 'Plan', current_date, current_date + 300, current_date + 10)$q$,
    'coordinator: no new cycle');
  perform tests.assert_eq(tests.rows_affected($q$update tms.plan_cycles set name_en = 'x'$q$), 0::bigint, 'coordinator: no edit');
  perform tests.assert_eq(tests.rows_affected($q$delete from tms.plan_cycles$q$), 0::bigint, 'coordinator: no delete');
  perform tests.assert_eq(tests.rows_affected($q$update tms.plan_cycle_departments set budget_amount = 1$q$), 0::bigint,
    'coordinator: no budget change');
  perform tests.assert_rls_violation($q$insert into tms.plan_cycle_steps (cycle_id, position, kind, name_ar, name_en) values ('ae000000-0000-4000-8000-000000000001', 3, 'person', 'س', 'S')$q$,
    'coordinator: no step');
  perform tests.assert_eq(tests.rows_affected($q$update tms.planning_settings set reminder_days = '{3}'$q$), 0::bigint,
    'coordinator: no settings change');
  perform tests.assert_eq(tests.rows_affected($q$delete from tms.planning_default_steps$q$), 0::bigint,
    'coordinator: no default chain change');
end $$;
rollback;

-- ---- L&D Manager of A: cross-tenant inserts and composite foreign keys -----------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000e0a1', '10000000-0000-4000-8000-00000000e0a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a1'));
do $$
declare
  v_id uuid;
begin
  perform tests.assert_eq((select count(*) from tms.plan_cycles where tenant_id <> 'a0000000-0000-4000-8000-000000000001'),
    0::bigint, 'A''s L&D Manager sees no other organization''s cycle');
  perform tests.assert_rls_violation($q$insert into tms.plan_cycles (tenant_id, name_ar, name_en, period_start_on, period_end_on, deadline_on) values ('b0000000-0000-4000-8000-000000000001', 'دخيل', 'Intruder', current_date, current_date + 300, current_date + 10)$q$,
    'plan_cycles: never for tenant B');
  insert into tms.plan_cycles (name_ar, name_en, period_start_on, period_end_on, deadline_on)
    values ('خطة جديدة', 'New plan', current_date + 30, current_date + 395, current_date + 20) returning id into v_id;
  perform tests.assert_eq((select tenant_id from tms.plan_cycles where id = v_id), 'a0000000-0000-4000-8000-000000000001'::uuid,
    'the organization comes from the claims');
  perform tests.assert_eq((select currency from tms.plan_cycles where id = v_id), 'AED'::char(3),
    'BR-PLN-i: the currency comes from General settings');
  perform tests.assert_eq((select status from tms.plan_cycles where id = v_id), 'draft', 'a new cycle is a draft');
  perform tests.assert_eq((select created_by from tms.plan_cycles where id = v_id), 'a1000000-0000-4000-8000-00000000e0a1'::uuid,
    'who created it comes from the claims');

  -- Scope, departments and steps: never another organization's cycle, department, branch or person.
  perform tests.assert_rls_violation(format($q$insert into tms.plan_cycle_scope (tenant_id, cycle_id, department_id) values ('b0000000-0000-4000-8000-000000000001', %L, 'a3000000-0000-4000-8000-000000000001')$q$, v_id),
    'plan_cycle_scope: never for tenant B');
  perform tests.assert_fails($q$insert into tms.plan_cycle_scope (cycle_id, department_id) values ('be000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001')$q$,
    array['23503'], 'plan_cycle_scope: composite FK rejects tenant B''s cycle');
  perform tests.assert_fails(format($q$insert into tms.plan_cycle_scope (cycle_id, department_id) values (%L, 'b3000000-0000-4000-8000-000000000001')$q$, v_id),
    array['23503'], 'plan_cycle_scope: composite FK rejects tenant B''s department');
  perform tests.assert_fails(format($q$insert into tms.plan_cycle_scope (cycle_id, branch_id) values (%L, 'b2000000-0000-4000-8000-000000000001')$q$, v_id),
    array['23503'], 'plan_cycle_scope: composite FK rejects tenant B''s branch');
  perform tests.assert_fails(format($q$insert into tms.plan_cycle_departments (cycle_id, department_id) values (%L, 'b3000000-0000-4000-8000-000000000001')$q$, v_id),
    array['23503'], 'plan_cycle_departments: composite FK rejects tenant B''s department');
  perform tests.assert_fails(format($q$insert into tms.plan_cycle_steps (cycle_id, position, kind, name_ar, name_en, approver_person_id) values (%L, 1, 'person', 'س', 'S', 'b1000000-0000-4000-8000-0000000000b1')$q$, v_id),
    array['23503'], 'plan_cycle_steps: composite FK rejects tenant B''s person');
  perform tests.assert_fails($q$insert into tms.planning_default_steps (position, kind, name_ar, name_en, approver_person_id) values (7, 'person', 'س', 'S', 'b1000000-0000-4000-8000-0000000000b1')$q$,
    array['23503'], 'planning_default_steps: composite FK rejects tenant B''s person');
  perform tests.assert_eq(tests.rows_affected($q$update tms.plan_cycle_departments set budget_amount = 5 where tenant_id = 'b0000000-0000-4000-8000-000000000001'$q$),
    0::bigint, 'plan_cycle_departments: tenant B rows filtered');
  perform tests.assert_eq(tests.rows_affected($q$delete from tms.plan_cycle_steps where cycle_id = 'be000000-0000-4000-8000-000000000001'$q$),
    0::bigint, 'plan_cycle_steps: tenant B rows filtered');
end $$;
rollback;

-- ---- constraints and BR-PLN-g ---------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000e0a1', '10000000-0000-4000-8000-00000000e0a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a1'));
do $$
declare
  c constant uuid := 'ae000000-0000-4000-8000-000000000001';
begin
  perform tests.assert_check_constraint($q$update tms.plan_cycles set reminder_days = '{7,7}' where id = 'ae000000-0000-4000-8000-000000000001'$q$,
    'plan_cycles_reminder_days_check', 'reminder days are distinct');
  perform tests.assert_check_constraint($q$update tms.plan_cycles set reminder_days = '{0}' where id = 'ae000000-0000-4000-8000-000000000001'$q$,
    'plan_cycles_reminder_days_check', 'reminder days are at least 1');
  perform tests.assert_check_constraint($q$update tms.plan_cycles set reminder_days = '{91}' where id = 'ae000000-0000-4000-8000-000000000001'$q$,
    'plan_cycles_reminder_days_check', 'reminder days are at most 90');
  perform tests.assert_check_constraint($q$update tms.plan_cycles set reminder_days = '{1,2,3,4,5,6}' where id = 'ae000000-0000-4000-8000-000000000001'$q$,
    'plan_cycles_reminder_days_check', 'at most five reminders');
  perform tests.assert_eq(tests.rows_affected($q$update tms.plan_cycles set reminder_days = '{}' where id = 'ae000000-0000-4000-8000-000000000001'$q$),
    1::bigint, 'no reminders is allowed');
  perform tests.assert_check_constraint($q$update tms.plan_cycles set period_end_on = period_start_on where id = 'ae000000-0000-4000-8000-000000000001'$q$,
    'plan_cycles_period_check', 'the period ends after it starts');
  perform tests.assert_check_constraint($q$update tms.plan_cycles set period_end_on = period_start_on + 800 where id = 'ae000000-0000-4000-8000-000000000001'$q$,
    'plan_cycles_period_check', 'a period of at most two years');
  perform tests.assert_check_constraint($q$update tms.plan_cycles set deadline_on = period_end_on + 1 where id = 'ae000000-0000-4000-8000-000000000001'$q$,
    'plan_cycles_deadline_check', 'the deadline falls before the end of the period');
  perform tests.assert_check_constraint($q$update tms.plan_cycles set name_en = ' ' where id = 'ae000000-0000-4000-8000-000000000001'$q$,
    'plan_cycles_name_en_check', 'a name has visible text');
  perform tests.assert_check_constraint($q$update tms.plan_cycles set name_ar = repeat('خ', 121) where id = 'ae000000-0000-4000-8000-000000000001'$q$,
    'plan_cycles_name_ar_check', 'a name has at most 120 characters');
  perform tests.assert_check_constraint($q$update tms.plan_cycles set instructions_en = repeat('x', 4001) where id = 'ae000000-0000-4000-8000-000000000001'$q$,
    'plan_cycles_instructions_en_check', 'instructions have at most 4000 characters');
  perform tests.assert_fails($q$update tms.plan_cycles set status = 'archived' where id = 'ae000000-0000-4000-8000-000000000001'$q$,
    array['JK001'], 'a draft can only be launched');
  perform tests.assert_check_constraint($q$update tms.plan_cycle_departments set budget_amount = -1 where department_id = 'a3000000-0000-4000-8000-000000000001'$q$,
    'plan_cycle_departments_budget_amount_check', 'an envelope is not negative');
  perform tests.assert_eq(tests.rows_affected($q$update tms.plan_cycle_departments set budget_amount = null where department_id = 'a3000000-0000-4000-8000-000000000001'$q$),
    1::bigint, 'Q2: the envelope is optional');
  perform tests.assert_check_constraint(format($q$insert into tms.plan_cycle_scope (cycle_id) values (%L)$q$, c),
    'plan_cycle_scope_target_check', 'a scope row names a department or a branch');
  perform tests.assert_check_constraint(format($q$insert into tms.plan_cycle_scope (cycle_id, department_id, branch_id) values (%L, 'a3000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000002')$q$, c),
    'plan_cycle_scope_target_check', 'not both');
  perform tests.assert_fails(format($q$insert into tms.plan_cycle_scope (cycle_id, department_id) values (%L, 'a3000000-0000-4000-8000-000000000001')$q$, c),
    array['23505'], 'a department is picked once');
  perform tests.assert_fails(format($q$insert into tms.plan_cycle_departments (cycle_id, department_id) values (%L, 'a3000000-0000-4000-8000-000000000001')$q$, c),
    array['23505'], 'one form per department (BR-PLN-a)');
  perform tests.assert_check_constraint(format($q$insert into tms.plan_cycle_steps (cycle_id, position, kind, name_ar, name_en, approver_person_id) values (%L, 3, 'department_heads', 'ر', 'H', 'a1000000-0000-4000-8000-00000000e0a3')$q$, c),
    'plan_cycle_steps_approver_check', 'the Department Heads step names nobody');
  perform tests.assert_fails(format($q$insert into tms.plan_cycle_steps (cycle_id, position, kind, name_ar, name_en) values (%L, 3, 'department_heads', 'ر', 'H')$q$, c),
    array['23505'], 'at most one Department Heads step');
  perform tests.assert_fails(format($q$insert into tms.plan_cycle_steps (cycle_id, position, kind, name_ar, name_en, approver_person_id) values (%L, 3, 'person', 'إدارة', 'Management', 'a1000000-0000-4000-8000-0000000000ab')$q$, c),
    array['23505'], 'BR-PLN-g: one person approves at most one step of the chain');
  perform tests.assert_fails(format($q$insert into tms.plan_cycle_steps (cycle_id, position, kind, name_ar, name_en, approver_person_id) values (%L, 2, 'person', 'إدارة', 'Management', 'a1000000-0000-4000-8000-00000000e0a3')$q$, c),
    array['23505'], 'one step per position');
  perform tests.assert_check_constraint(format($q$insert into tms.plan_cycle_steps (cycle_id, position, kind, name_ar, name_en) values (%L, 11, 'person', 'إدارة', 'Management')$q$, c),
    'plan_cycle_steps_position_check', 'at most ten steps');
  perform tests.assert_eq(tests.rows_affected(format($q$insert into tms.plan_cycle_steps (cycle_id, position, kind, name_ar, name_en, approver_person_id) values (%L, 3, 'person', 'اعتماد الإدارة', 'Management approval', 'a1000000-0000-4000-8000-00000000e0a3')$q$, c)),
    1::bigint, 'another person approves another step');
  -- The same rules for the settings.
  perform tests.assert_check_constraint($q$update tms.planning_settings set reminder_days = '{2,2}'$q$,
    'planning_settings_reminder_days_check', 'settings: reminder days are distinct');
  perform tests.assert_eq(tests.rows_affected($q$update tms.planning_settings set reminder_days = '{14,7,2}'$q$),
    1::bigint, 'settings: the L&D Manager changes the default reminders');
  perform tests.assert_fails($q$insert into tms.planning_default_steps (position, kind, name_ar, name_en) values (3, 'department_heads', 'ر', 'H')$q$,
    array['23505'], 'settings: at most one Department Heads step');
  perform tests.assert_eq(tests.rows_affected($q$update tms.planning_default_steps set approver_person_id = 'a1000000-0000-4000-8000-00000000e0a3' where position = 2$q$),
    1::bigint, 'settings: a default approver may be named');
  perform tests.assert_fails($q$insert into tms.planning_default_steps (position, kind, name_ar, name_en, approver_person_id) values (3, 'person', 'إدارة', 'Management', 'a1000000-0000-4000-8000-00000000e0a3')$q$,
    array['23505'], 'settings: BR-PLN-g, one person approves at most one step');
  perform tests.assert_check_constraint($q$update tms.planning_default_steps set approver_person_id = 'a1000000-0000-4000-8000-00000000e0a3' where position = 1$q$,
    'planning_default_steps_approver_check', 'settings: the Department Heads step names nobody');
  -- The chain is replaced as a whole.
  perform tests.assert_eq(tests.rows_affected($q$delete from tms.planning_default_steps$q$), 2::bigint, 'settings: chain removed');
  perform tests.assert_eq(tests.rows_affected($q$insert into tms.planning_default_steps (position, kind, name_ar, name_en) values (1, 'person', 'اعتماد المالية', 'Finance approval'), (2, 'department_heads', 'رؤساء الأقسام', 'Department Heads')$q$),
    2::bigint, 'settings: chain saved in a new order');
end $$;
rollback;

-- ---- launch checks (business flow B5) -------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000e0a1', '10000000-0000-4000-8000-00000000e0a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a1'));
do $$
declare
  v_id uuid;
  v_launch text;
begin
  -- The earlier cycle (ae…02) is still open although its deadline has passed: Q1 refuses a second open cycle…
  perform tests.assert_fails($q$update tms.plan_cycles set status = 'open' where id = 'ae000000-0000-4000-8000-000000000001'$q$,
    array['JK002'], 'Q1: one open cycle at a time');
  -- …until it is closed (allowed once its deadline has passed).
  perform tests.assert_eq(tests.rows_affected($q$update tms.plan_cycles set status = 'closed' where id = 'ae000000-0000-4000-8000-000000000002'$q$),
    1::bigint, 'an open cycle past its deadline closes');
  perform tests.assert((select closed_at is not null from tms.plan_cycles where id = 'ae000000-0000-4000-8000-000000000002'),
    'closing records when');
  perform tests.assert_fails($q$update tms.plan_cycles set status = 'open' where id = 'ae000000-0000-4000-8000-000000000002'$q$,
    array['JK001'], 'a closed cycle does not reopen in this release');
  perform tests.assert_fails($q$update tms.plan_cycles set deadline_on = current_date + 5 where id = 'ae000000-0000-4000-8000-000000000002'$q$,
    array['JK001'], 'a closed cycle no longer changes');

  -- A new draft, made ready step by step.
  insert into tms.plan_cycles (name_ar, name_en, period_start_on, period_end_on, deadline_on)
    values ('خطة', 'Plan', current_date - 10, current_date + 355, current_date - 1) returning id into v_id;
  v_launch := format($q$update tms.plan_cycles set status = 'open' where id = %L$q$, v_id);
  perform tests.assert_fails(v_launch, array['JK003'], 'not ready: the deadline has passed');
  update tms.plan_cycles set deadline_on = current_date where id = v_id;
  perform tests.assert_fails(v_launch, array['JK003'], 'not ready: no department in scope');
  insert into tms.plan_cycle_scope (cycle_id, department_id) values (v_id, 'a3000000-0000-4000-8000-000000000003');
  insert into tms.plan_cycle_departments (cycle_id, department_id, budget_amount) values (v_id, 'a3000000-0000-4000-8000-000000000003', 1200.50);
  perform tests.assert_fails(v_launch, array['JK003'], 'not ready: no approval step with a person');
  insert into tms.plan_cycle_steps (cycle_id, position, kind, name_ar, name_en)
    values (v_id, 1, 'department_heads', 'رؤساء الأقسام', 'Department Heads'),
           (v_id, 2, 'person', 'اعتماد المالية', 'Finance approval');
  perform tests.assert_fails(v_launch, array['JK003'], 'not ready: the Finance approver is not named');
  -- uSus (a1…a3) is a suspended member of A: not an approver.
  delete from tms.plan_cycle_steps where cycle_id = v_id and position = 2;
  insert into tms.plan_cycle_steps (cycle_id, position, kind, name_ar, name_en, approver_person_id)
    values (v_id, 2, 'person', 'اعتماد المالية', 'Finance approval', 'a1000000-0000-4000-8000-0000000000a3');
  perform tests.assert_fails(v_launch, array['JK003'], 'not ready: the approver is not an active member');
  delete from tms.plan_cycle_steps where cycle_id = v_id and position = 2;
  insert into tms.plan_cycle_steps (cycle_id, position, kind, name_ar, name_en, approver_person_id)
    values (v_id, 2, 'person', 'اعتماد المالية', 'Finance approval', 'a1000000-0000-4000-8000-00000000e0a3');

  perform tests.assert_eq(tests.rows_affected(v_launch), 1::bigint, 'launch: draft → open');
  perform tests.assert((select launched_at is not null and launched_by = 'a1000000-0000-4000-8000-00000000e0a1'::uuid
                        from tms.plan_cycles where id = v_id), 'launch records when and by whom');
  perform tests.assert_fails($q$update tms.plan_cycles set status = 'open' where id = 'ae000000-0000-4000-8000-000000000001'$q$,
    array['JK002'], 'Q1: a second cycle cannot open');

  -- Open: only a later deadline.
  perform tests.assert_fails(format($q$update tms.plan_cycles set name_en = 'Renamed' where id = %L$q$, v_id),
    array['JK001'], 'an open cycle keeps its names');
  perform tests.assert_fails(format($q$update tms.plan_cycles set reminder_days = '{1}' where id = %L$q$, v_id),
    array['JK001'], 'an open cycle keeps its reminders');
  perform tests.assert_fails(format($q$update tms.plan_cycles set deadline_on = current_date - 1 where id = %L$q$, v_id),
    array['JK004'], 'the deadline never moves earlier');
  perform tests.assert_check_constraint(format($q$update tms.plan_cycles set deadline_on = period_end_on + 1 where id = %L$q$, v_id),
    'plan_cycles_deadline_check', 'the deadline stays within the period');
  perform tests.assert_eq(tests.rows_affected(format($q$update tms.plan_cycles set deadline_on = current_date + 14 where id = %L$q$, v_id)),
    1::bigint, 'extend the deadline while open');
  perform tests.assert_fails(format($q$update tms.plan_cycles set status = 'closed' where id = %L$q$, v_id),
    array['JK001'], 'an open cycle does not close before its deadline');
  perform tests.assert_fails(format($q$update tms.plan_cycles set status = 'draft' where id = %L$q$, v_id),
    array['JK001'], 'an open cycle never goes back to draft');

  -- Children change only in draft.
  perform tests.assert_fails(format($q$update tms.plan_cycle_departments set budget_amount = 1 where cycle_id = %L$q$, v_id),
    array['JK001'], 'open: envelopes are fixed');
  perform tests.assert_fails(format($q$insert into tms.plan_cycle_scope (cycle_id, department_id) values (%L, 'a3000000-0000-4000-8000-000000000001')$q$, v_id),
    array['JK001'], 'open: the scope is fixed');
  perform tests.assert_fails(format($q$delete from tms.plan_cycle_steps where cycle_id = %L$q$, v_id),
    array['JK001'], 'open: the chain is fixed');
  perform tests.assert_eq(tests.rows_affected(format($q$delete from tms.plan_cycles where id = %L$q$, v_id)),
    0::bigint, 'open: the cycle is not deleted');
  perform tests.assert_eq((select count(*) from tms.plan_cycles where id = v_id), 1::bigint, 'it is still there');
end $$;
rollback;

-- ---- deleting a draft takes its scope, departments and steps with it ------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000e0a1', '10000000-0000-4000-8000-00000000e0a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a1'));
do $$
begin
  perform tests.assert_eq(tests.rows_affected($q$delete from tms.plan_cycles where id = 'ae000000-0000-4000-8000-000000000001'$q$),
    1::bigint, 'a draft is deleted');
  perform tests.assert_eq((select count(*) from tms.plan_cycle_scope where cycle_id = 'ae000000-0000-4000-8000-000000000001'),
    0::bigint, 'with its scope');
  perform tests.assert_eq((select count(*) from tms.plan_cycle_departments where cycle_id = 'ae000000-0000-4000-8000-000000000001'),
    0::bigint, 'with its departments');
  perform tests.assert_eq((select count(*) from tms.plan_cycle_steps where cycle_id = 'ae000000-0000-4000-8000-000000000001'),
    0::bigint, 'with its steps');
end $$;
rollback;

\echo '99_planning_b_app_server: ok'
