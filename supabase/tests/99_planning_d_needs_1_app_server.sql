-- db-test: run-as=app_server
-- Department needs (WP-LD-01, T-M3-05; FR-PLN-03, FR-MGR-05, FR-PLN-06; migration 20261105100100): who enters
-- needs (the effective head with the Department Head role), tenant isolation and composite keys, and the
-- submission state (a refusal of someone who is not the head is 42501, from the guard or the policies) — draft on the first need, submit, recall, return with a note, resubmit, an extension for one
-- department — each by the actor the business flow names. Fixtures: 00_helpers_and_fixtures.sql (cycle ae…01,
-- form a7…01), 99_planning_a_fixtures_owner.sql (uL, uT, uE; open cycle ae…02 past its deadline) and
-- 99_planning_d_needs_0_fixtures_owner.sql (uH heads SAL; uE works in SAL). Each block is rolled back.
\set ON_ERROR_STOP on

-- ---- who may enter needs --------------------------------------------------------------------------
begin;
set local role authenticated;
-- uH: Department Head, heads SAL.
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000e0a4', '10000000-0000-4000-8000-00000000e0a4',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a4'));
do $$
declare
  a constant uuid := 'a0000000-0000-4000-8000-000000000001';
begin
  perform tests.assert(private.may_submit_plan_needs(a, 'a3000000-0000-4000-8000-000000000004'), 'uH enters SAL''s needs');
  perform tests.assert(not private.may_submit_plan_needs(a, 'a3000000-0000-4000-8000-000000000001'),
    'uH never enters TD''s needs (another head)');
  perform tests.assert(not private.may_submit_plan_needs('b0000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000001'),
    'never in another organization');
  perform tests.assert_eq(private.plan_department_head(a, 'a3000000-0000-4000-8000-000000000002'),
    'a1000000-0000-4000-8000-0000000000a1'::uuid, 'a unit without its own head belongs to the nearest head above (TD-PRG → uA)');
  perform tests.assert_eq(private.plan_department_head(a, 'a3000000-0000-4000-8000-000000000003'),
    'a1000000-0000-4000-8000-000000000c08'::uuid, 'OPS: its own head (set by 99_people_0), a root unit');
end $$;
-- uA: heads TD in the structure, but the Organization Admin holds no Department Head role.
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
do $$
begin
  perform tests.assert(not private.may_submit_plan_needs('a0000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001'),
    'a head without the Department Head role enters nothing (deny by default)');
end $$;
-- uL: the L&D Manager reads and manages cycles, enters no needs.
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000e0a1', '10000000-0000-4000-8000-00000000e0a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a1'));
do $$
begin
  perform tests.assert(not private.may_submit_plan_needs('a0000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000004'),
    'the L&D Manager enters no department''s needs');
end $$;
rollback;

-- ---- the journey: launch, enter, submit, recall, return, resubmit, extend ---------------------------
begin;
set local role authenticated;
-- uL launches ae…01 with SAL (budget 60,000) in scope.
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000e0a1', '10000000-0000-4000-8000-00000000e0a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a1'));
do $$
declare
  c constant uuid := 'ae000000-0000-4000-8000-000000000001';
  sal constant uuid := 'a3000000-0000-4000-8000-000000000004';
begin
  update tms.plan_cycles set status = 'closed' where id = 'ae000000-0000-4000-8000-000000000002';
  insert into tms.plan_cycle_scope (cycle_id, department_id) values (c, sal);
  insert into tms.plan_cycle_departments (cycle_id, department_id, budget_amount) values (c, sal, 60000);
end $$;
-- uH sees the draft's row but changes nothing of the set-up (review F1): the envelope is the L&D Manager's.
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000e0a4', '10000000-0000-4000-8000-00000000e0a4',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a4'));
do $$
begin
  perform tests.assert_fails($q$update tms.plan_cycle_departments set budget_amount = 1 where cycle_id = 'ae000000-0000-4000-8000-000000000001' and department_id = 'a3000000-0000-4000-8000-000000000004'$q$,
    array['JK001'], 'a head never changes their envelope (draft cycle)');
  perform tests.assert_fails($q$update tms.plan_cycle_departments set status = 'draft' where cycle_id = 'ae000000-0000-4000-8000-000000000001' and department_id = 'a3000000-0000-4000-8000-000000000004'$q$,
    array['JK001'], 'nor starts entering before the launch');
end $$;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000e0a1', '10000000-0000-4000-8000-00000000e0a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a1'));
do $$
declare
  c constant uuid := 'ae000000-0000-4000-8000-000000000001';
  sal constant uuid := 'a3000000-0000-4000-8000-000000000004';
begin
  -- The submission columns start with the launch: a draft keeps them empty.
  perform tests.assert_fails(format($q$update tms.plan_cycle_departments set status = 'draft' where cycle_id = %L and department_id = %L$q$, c, sal),
    array['JK001'], 'a department''s form starts with the launch');
  update tms.plan_cycles set needs_form_id = 'a7000000-0000-4000-8000-000000000001' where id = c;
  perform tests.assert_eq(tests.rows_affected(format($q$update tms.plan_cycles set status = 'open' where id = %L$q$, c)),
    1::bigint, 'the L&D Manager launches the cycle');
  perform tests.assert_fails(format($q$update tms.plan_cycle_departments set budget_amount = 1 where cycle_id = %L and department_id = %L$q$, c, sal),
    array['JK001'], 'the envelope no longer changes once the cycle is open');
  perform tests.assert_fails(format($q$update tms.plan_cycle_departments set status = 'submitted' where cycle_id = %L and department_id = %L$q$, c, sal),
    array['JK001'], 'the L&D Manager never submits on a head''s behalf');
  perform tests.assert_fails(format($q$insert into tms.plan_needs (cycle_id, department_id, topic, people_count) values (%L, %L, 'Intruder', 1)$q$, c, sal),
    array['42501'], 'the L&D Manager enters no need');
end $$;

-- uH enters SAL's needs.
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000e0a4', '10000000-0000-4000-8000-00000000e0a4',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a4'));
do $$
declare
  c constant uuid := 'ae000000-0000-4000-8000-000000000001';
  sal constant uuid := 'a3000000-0000-4000-8000-000000000004';
  td constant uuid := 'a3000000-0000-4000-8000-000000000001';
  v_need uuid;
begin
  perform tests.assert_eq((select count(*) from tms.plan_cycles), 1::bigint, 'the head sees the open cycle (not the closed one of the past)');
  perform tests.assert_eq((select string_agg(department_id::text, ',') from tms.plan_cycle_departments), sal::text,
    'the head sees their own department''s row only');
  perform tests.assert_eq((select status from tms.plan_cycle_departments where cycle_id = c and department_id = sal),
    'not_started', 'nothing entered yet');

  insert into tms.plan_needs (cycle_id, department_id, topic, people_count, estimated_cost, answers)
    values (c, sal, 'Customer service by phone', 5, 15000, '{"priority": "critical"}'::jsonb) returning id into v_need;
  perform tests.assert_eq((select status from tms.plan_cycle_departments where cycle_id = c and department_id = sal),
    'draft', 'the first need moves the department to draft');
  perform tests.assert_eq((select created_by from tms.plan_needs where id = v_need), 'a1000000-0000-4000-8000-00000000e0a4'::uuid,
    'the need is stamped with the head');

  -- Named people: a person of the organization; never another organization's, never another tenant_id.
  insert into tms.plan_need_people (need_id, department_id, person_id) values (v_need, sal, 'a1000000-0000-4000-8000-00000000e0a3');
  perform tests.assert_fails(format($q$insert into tms.plan_need_people (need_id, department_id, person_id) values (%L, %L, 'b1000000-0000-4000-8000-0000000000b1')$q$, v_need, sal),
    array['23503'], 'a person of another organization is refused by the composite key');
  perform tests.assert_fails(format($q$insert into tms.plan_need_people (tenant_id, need_id, department_id, person_id) values ('b0000000-0000-4000-8000-000000000001', %L, %L, 'b1000000-0000-4000-8000-0000000000b1')$q$, v_need, sal),
    array['42501'], 'a name with another organization''s tenant_id is refused by RLS');
  perform tests.assert_fails(format($q$insert into tms.plan_need_people (need_id, department_id, person_id) values (%L, %L, 'a1000000-0000-4000-8000-0000000000ab')$q$, v_need, td),
    array['23503', '42501'], 'a name cannot claim another department');

  -- Another department's need, another organization's row: refused.
  perform tests.assert_fails(format($q$insert into tms.plan_needs (cycle_id, department_id, topic, people_count) values (%L, %L, 'Not mine', 1)$q$, c, td),
    array['42501'], 'the head enters nothing for TD');
  perform tests.assert_fails(format($q$insert into tms.plan_needs (tenant_id, cycle_id, department_id, topic, people_count) values ('b0000000-0000-4000-8000-000000000001', 'be000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000001', 'Intruder', 1)$q$),
    array['42501'], 'never another organization''s need');
  perform tests.assert_fails(format($q$insert into tms.plan_needs (cycle_id, department_id, topic, people_count) values (%L, %L, '   ', 1)$q$, c, sal),
    array['23514'], 'a topic needs visible text');
  perform tests.assert_fails(format($q$insert into tms.plan_needs (cycle_id, department_id, topic, people_count) values (%L, %L, 'Zero', 0)$q$, c, sal),
    array['23514'], 'at least one seat');
  perform tests.assert_fails(format($q$insert into tms.plan_needs (cycle_id, department_id, topic, people_count, course_id) values (%L, %L, 'B course', 1, 'b7100000-0000-4000-8000-000000000001')$q$, c, sal),
    array['23503'], 'a course of another organization is refused by the composite key');

  update tms.plan_needs set topic = 'Customer service by phone (advanced)', people_count = 6 where id = v_need;
  perform tests.assert_eq((select version from tms.plan_needs where id = v_need), 2, 'an edit bumps the version');

  -- Submit: locks the set; nothing changes until a recall.
  perform tests.assert_eq(tests.rows_affected(format($q$update tms.plan_cycle_departments set status = 'submitted' where cycle_id = %L and department_id = %L$q$, c, sal)),
    1::bigint, 'the head submits');
  perform tests.assert_fails(format($q$update tms.plan_cycle_departments set budget_amount = 1 where cycle_id = %L and department_id = %L$q$, c, sal),
    array['JK001'], 'a head never changes their envelope (open cycle)');
  perform tests.assert((select submitted_at is not null and submitted_by = 'a1000000-0000-4000-8000-00000000e0a4'::uuid
                        from tms.plan_cycle_departments where cycle_id = c and department_id = sal),
    'the submission is stamped by the database');
  perform tests.assert_fails(format($q$insert into tms.plan_needs (cycle_id, department_id, topic, people_count) values (%L, %L, 'Late one', 1)$q$, c, sal),
    array['JK005'], 'no new need after submitting');
  perform tests.assert_fails(format($q$update tms.plan_needs set people_count = 9 where id = %L$q$, v_need),
    array['JK005'], 'no change after submitting');
  perform tests.assert_fails(format($q$delete from tms.plan_need_people where need_id = %L$q$, v_need),
    array['JK005'], 'names stay after submitting');
  perform tests.assert_fails(format($q$update tms.plan_cycle_departments set answers = '{"x": []}' where cycle_id = %L and department_id = %L$q$, c, sal),
    array['JK005'], 'department answers stay after submitting');

  -- Recall (before the deadline): back to draft, the stamps cleared, entry open again.
  perform tests.assert_eq(tests.rows_affected(format($q$update tms.plan_cycle_departments set status = 'draft' where cycle_id = %L and department_id = %L$q$, c, sal)),
    1::bigint, 'the head recalls');
  perform tests.assert((select submitted_at is null and submitted_by is null from tms.plan_cycle_departments where cycle_id = c and department_id = sal),
    'a recall clears the submission stamps');
  insert into tms.plan_needs (cycle_id, department_id, topic, people_count) values (c, sal, 'Excel', 2);
  perform tests.assert_fails(format($q$update tms.plan_cycle_departments set status = 'returned' where cycle_id = %L and department_id = %L$q$, c, sal),
    array['JK001'], 'a head never returns their own form');
  perform tests.assert_fails(format($q$update tms.plan_cycle_departments set deadline_on = current_date + 90 where cycle_id = %L and department_id = %L$q$, c, sal),
    array['JK001'], 'a head never extends their own deadline');
  update tms.plan_cycle_departments set status = 'submitted' where cycle_id = c and department_id = sal;
end $$;

-- uE (Employee, named for a need) sees and enters nothing.
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000e0a3', '10000000-0000-4000-8000-00000000e0a3',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a3'));
do $$
begin
  perform tests.assert_eq((select count(*) from tms.plan_needs), 0::bigint, 'an employee sees no need');
  perform tests.assert_eq((select count(*) from tms.plan_need_people), 0::bigint, 'nor the names');
  perform tests.assert_eq((select count(*) from tms.plan_cycle_departments), 0::bigint, 'nor the departments'' forms');
  perform tests.assert_fails($q$insert into tms.plan_needs (cycle_id, department_id, topic, people_count) values ('ae000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000004', 'Intruder', 1)$q$,
    array['42501'], 'an employee enters no need');
end $$;

-- uT (Training Coordinator) reads everything, changes nothing.
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000e0a2', '10000000-0000-4000-8000-00000000e0a2',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a2'));
do $$
begin
  perform tests.assert_eq((select count(*) from tms.plan_needs), 2::bigint, 'the coordinator reads the needs');
  perform tests.assert_eq((select count(*) from tms.plan_need_people), 1::bigint, 'and the names');
  perform tests.assert_eq(tests.rows_affected($q$update tms.plan_cycle_departments set status = 'returned', return_note = 'x' where cycle_id = 'ae000000-0000-4000-8000-000000000001'$q$),
    0::bigint, 'the coordinator returns nothing (no row to update)');
  perform tests.assert_fails($q$insert into tms.plan_needs (cycle_id, department_id, topic, people_count) values ('ae000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000004', 'Intruder', 1)$q$,
    array['42501'], 'the coordinator enters no need');
end $$;

-- uL returns the submission with a note and extends SAL's deadline.
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000e0a1', '10000000-0000-4000-8000-00000000e0a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a1'));
do $$
declare
  c constant uuid := 'ae000000-0000-4000-8000-000000000001';
  sal constant uuid := 'a3000000-0000-4000-8000-000000000004';
  v_deadline date := (select deadline_on from tms.plan_cycles where id = c);
  v_period_end date := (select period_end_on from tms.plan_cycles where id = c);
begin
  perform tests.assert_fails(format($q$update tms.plan_cycle_departments set status = 'returned' where cycle_id = %L and department_id = %L$q$, c, sal),
    array['JK006'], 'returning needs a note for the head');
  perform tests.assert_fails(format($q$update tms.plan_cycle_departments set status = 'draft' where cycle_id = %L and department_id = %L$q$, c, sal),
    array['JK001'], 'the L&D Manager never recalls for the head');
  perform tests.assert_eq(tests.rows_affected(format($q$update tms.plan_cycle_departments set status = 'returned', return_note = 'Please add the dates' where cycle_id = %L and department_id = %L$q$, c, sal)),
    1::bigint, 'the L&D Manager returns the submission');
  perform tests.assert((select returned_at is not null and returned_by = 'a1000000-0000-4000-8000-00000000e0a1'::uuid and submitted_at is null
                        from tms.plan_cycle_departments where cycle_id = c and department_id = sal),
    'the return is stamped and the submission cleared');
  perform tests.assert_fails(format($q$update tms.plan_cycle_departments set return_note = 'changed my mind' where cycle_id = %L and department_id = %L$q$, c, sal),
    array['JK001'], 'the note is written with the return only');
  -- An extension for SAL: later than the cycle's deadline, not before today, within the period.
  perform tests.assert_fails(format($q$update tms.plan_cycle_departments set deadline_on = %L where cycle_id = %L and department_id = %L$q$, v_deadline, c, sal),
    array['JK004'], 'a department''s deadline moves later than the cycle''s');
  perform tests.assert_fails(format($q$update tms.plan_cycle_departments set deadline_on = %L where cycle_id = %L and department_id = %L$q$, v_period_end + 1, c, sal),
    array['JK004'], 'and stays within the planning period');
  perform tests.assert_eq(tests.rows_affected(format($q$update tms.plan_cycle_departments set deadline_on = %L where cycle_id = %L and department_id = %L$q$, v_deadline + 5, c, sal)),
    1::bigint, 'the L&D Manager extends one department');
  perform tests.assert_fails(format($q$update tms.plan_cycle_departments set deadline_on = %L where cycle_id = %L and department_id = %L$q$, v_deadline + 3, c, sal),
    array['JK004'], 'an extension never moves back');
  perform tests.assert_eq(private.plan_department_deadline('a0000000-0000-4000-8000-000000000001', c, sal), v_deadline + 5,
    'the effective deadline is the department''s');
  perform tests.assert_eq(private.plan_department_deadline('a0000000-0000-4000-8000-000000000001', c, 'a3000000-0000-4000-8000-000000000001'),
    v_deadline, 'TD keeps the cycle''s');
  perform tests.assert_fails(format($q$update tms.plan_cycle_departments set answers = '{"x": []}' where cycle_id = %L and department_id = %L$q$, c, sal),
    array['JK001'], 'the L&D Manager writes no answers for the head');
end $$;

-- uH changes and resubmits after the return.
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000e0a4', '10000000-0000-4000-8000-00000000e0a4',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a4'));
do $$
declare
  c constant uuid := 'ae000000-0000-4000-8000-000000000001';
  sal constant uuid := 'a3000000-0000-4000-8000-000000000004';
begin
  perform tests.assert_eq((select return_note from tms.plan_cycle_departments where cycle_id = c and department_id = sal),
    'Please add the dates', 'the head reads the note');
  update tms.plan_needs set answers = '{"quarter": "q1"}'::jsonb where cycle_id = c and department_id = sal and topic = 'Excel';
  update tms.plan_cycle_departments set answers = '{"s1": [{"f1": "General comment"}]}'::jsonb where cycle_id = c and department_id = sal;
  perform tests.assert_eq((select status from tms.plan_cycle_departments where cycle_id = c and department_id = sal),
    'returned', 'department answers keep the returned state');
  perform tests.assert_eq(tests.rows_affected(format($q$update tms.plan_cycle_departments set status = 'submitted' where cycle_id = %L and department_id = %L$q$, c, sal)),
    1::bigint, 'the head resubmits');
  perform tests.assert((select return_note is null and returned_at is null and submitted_at is not null
                        from tms.plan_cycle_departments where cycle_id = c and department_id = sal),
    'a resubmission clears the return');
end $$;

-- Tenant B's L&D Manager sees nothing of it.
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-00000000e0b1',
  'b0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-0000000000ab'));
do $$
begin
  perform tests.assert_eq((select count(*) from tms.plan_needs), 0::bigint, 'B sees none of A''s needs');
  perform tests.assert_eq((select count(*) from tms.plan_need_people), 0::bigint, 'nor its names');
end $$;
rollback;

-- ---- nothing to submit; a department of a draft cycle --------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000e0a1', '10000000-0000-4000-8000-00000000e0a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a1'));
do $$
declare
  c constant uuid := 'ae000000-0000-4000-8000-000000000001';
  sal constant uuid := 'a3000000-0000-4000-8000-000000000004';
begin
  update tms.plan_cycles set status = 'closed' where id = 'ae000000-0000-4000-8000-000000000002';
  insert into tms.plan_cycle_scope (cycle_id, department_id) values (c, sal);
  insert into tms.plan_cycle_departments (cycle_id, department_id) values (c, sal);
  update tms.plan_cycles set needs_form_id = 'a7000000-0000-4000-8000-000000000001' where id = c;
  update tms.plan_cycles set status = 'open' where id = c;
end $$;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000e0a4', '10000000-0000-4000-8000-00000000e0a4',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a4'));
do $$
begin
  perform tests.assert_fails($q$update tms.plan_cycle_departments set status = 'submitted' where cycle_id = 'ae000000-0000-4000-8000-000000000001' and department_id = 'a3000000-0000-4000-8000-000000000004'$q$,
    array['JK006'], 'nothing to submit without a need');
  -- Department-level answers alone start the draft.
  update tms.plan_cycle_departments set answers = '{"s1": [{"f1": "x"}]}'::jsonb
    where cycle_id = 'ae000000-0000-4000-8000-000000000001' and department_id = 'a3000000-0000-4000-8000-000000000004';
  perform tests.assert_eq((select status from tms.plan_cycle_departments where cycle_id = 'ae000000-0000-4000-8000-000000000001' and department_id = 'a3000000-0000-4000-8000-000000000004'),
    'draft', 'answers start the draft');
end $$;
rollback;

\echo '99_planning_d_needs_1_app_server: ok'
