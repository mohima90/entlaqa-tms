-- db-test: run-as=owner
-- «Return for changes» while the training plan is consolidated (WP-LD-02, T-M3-06; business flow EP-PLN §3 D14 and §6;
-- migration 20261115100400): once the needs are closed the L&D Manager may still return a submitted department —
-- with a note AND a deadline of its own — and its head changes and resubmits until that deadline; no recall; the
-- plan keeps the seats the department submitted until it resubmits and L&D adds its changes. Fixtures as
-- 99_planning_f_plan_1_owner.sql. Users act through session_user app_server; deadlines are moved into the past as
-- platform operations (the guards refuse it). The block is rolled back.
\set ON_ERROR_STOP on

begin;
create function tests.tp_need(p_topic text) returns uuid language sql stable
  as $f$ select id from tms.plan_needs where cycle_id = 'ae000000-0000-4000-8000-000000000001' and topic = p_topic $f$;
create function tests.tp_plan() returns uuid language sql stable
  as $f$ select id from tms.training_plans where cycle_id = 'ae000000-0000-4000-8000-000000000001' $f$;

set local session authorization app_server;
set local role authenticated;
-- uL launches ae…01 with SAL only.
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000e0a1', '10000000-0000-4000-8000-00000000e0a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a1'));
do $$
declare
  c constant uuid := 'ae000000-0000-4000-8000-000000000001';
  sal constant uuid := 'a3000000-0000-4000-8000-000000000004';
begin
  update tms.plan_cycles set status = 'closed' where id = 'ae000000-0000-4000-8000-000000000002';
  delete from tms.plan_cycle_scope where cycle_id = c;
  delete from tms.plan_cycle_departments where cycle_id = c;
  insert into tms.plan_cycle_scope (cycle_id, department_id) values (c, sal);
  insert into tms.plan_cycle_departments (cycle_id, department_id, budget_amount) values (c, sal, 30000);
  update tms.plan_cycles set needs_form_id = 'a7000000-0000-4000-8000-000000000001' where id = c;
  update tms.plan_cycles set status = 'open' where id = c;
end $$;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000e0a4', '10000000-0000-4000-8000-00000000e0a4',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a4'));
do $$
begin
  insert into tms.plan_needs (cycle_id, department_id, topic, people_count) values
    ('ae000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000004', 'Excel', 20),
    ('ae000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000004', 'Negotiation', 6);
  update tms.plan_cycle_departments set status = 'submitted'
    where cycle_id = 'ae000000-0000-4000-8000-000000000001' and department_id = 'a3000000-0000-4000-8000-000000000004';
end $$;

-- The needs closed early; a closed cycle without a plan returns nothing; the plan opens with SAL's two needs.
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000e0a1', '10000000-0000-4000-8000-00000000e0a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a1'));
do $$
declare
  c constant uuid := 'ae000000-0000-4000-8000-000000000001';
  sal constant uuid := 'a3000000-0000-4000-8000-000000000004';
  p uuid;
  l1 uuid;
  l2 uuid;
begin
  update tms.plan_cycles set status = 'closed' where id = c;
  perform tests.assert_fails(format($q$update tms.plan_cycle_departments set status = 'returned', return_note = 'x', deadline_on = private.plan_cycle_today(tenant_id) where cycle_id = %L and department_id = %L$q$, c, sal),
    array['JK005'], 'a closed cycle without a plan returns nothing');
  insert into tms.training_plans (cycle_id) values (c) returning id into p;
  insert into tms.plan_lines (plan_id, cycle_id, group_key, title, quarter) values (p, c, 'topic:excel', 'Excel', 1) returning id into l1;
  insert into tms.plan_lines (plan_id, cycle_id, group_key, title, quarter) values (p, c, 'topic:negotiation', 'Negotiation', 1) returning id into l2;
  insert into tms.plan_line_needs (plan_id, cycle_id, line_id, need_id, department_id) values
    (p, c, l1, tests.tp_need('Excel'), sal),
    (p, c, l2, tests.tp_need('Negotiation'), sal);
  perform set_config('tests.tp_line1', l1::text, true);

  -- Returning during consolidation needs a note and a deadline of the department's own, today or later.
  perform tests.assert_fails(format($q$update tms.plan_cycle_departments set status = 'returned', return_note = 'Please split by level' where cycle_id = %L and department_id = %L$q$, c, sal),
    array['JK004'], 'a return during consolidation needs a deadline');
  perform tests.assert_fails(format($q$update tms.plan_cycle_departments set status = 'returned', return_note = 'x', deadline_on = private.plan_cycle_today(tenant_id) - 1 where cycle_id = %L and department_id = %L$q$, c, sal),
    array['JK004'], 'not in the past');
  perform tests.assert_fails(format($q$update tms.plan_cycle_departments set status = 'returned', return_note = 'x', deadline_on = (select period_end_on + 1 from tms.plan_cycles where id = %L) where cycle_id = %L and department_id = %L$q$, c, c, sal),
    array['JK004'], 'not after the planning period');
  perform tests.assert_fails(format($q$update tms.plan_cycle_departments set status = 'returned', deadline_on = private.plan_cycle_today(tenant_id) where cycle_id = %L and department_id = %L$q$, c, sal),
    array['JK006'], 'and a note');
  perform tests.assert_eq(tests.rows_affected(format($q$update tms.plan_cycle_departments set status = 'returned', return_note = 'Please split by level', deadline_on = private.plan_cycle_today(tenant_id) where cycle_id = %L and department_id = %L$q$, c, sal)),
    1::bigint, 'the L&D Manager returns SAL for changes until today');
end $$;

-- uH changes SAL's needs (the seats, a new need, a need removed) and resubmits; no recall.
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000e0a4', '10000000-0000-4000-8000-00000000e0a4',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a4'));
do $$
declare
  c constant uuid := 'ae000000-0000-4000-8000-000000000001';
  sal constant uuid := 'a3000000-0000-4000-8000-000000000004';
begin
  perform tests.assert(private.plan_cycle_consolidating('a0000000-0000-4000-8000-000000000001', c),
    'the head''s guards know the plan is being consolidated');
  perform tests.assert(private.plan_needs_entry_open('a0000000-0000-4000-8000-000000000001', c, sal),
    'entry is open again for the returned department');
  perform tests.assert(not private.plan_needs_entry_open('a0000000-0000-4000-8000-000000000001', c, 'a3000000-0000-4000-8000-000000000001'),
    'and only for it');
  update tms.plan_needs set people_count = 25 where id = tests.tp_need('Excel');
  insert into tms.plan_needs (cycle_id, department_id, topic, people_count) values (c, sal, 'Excel for managers', 4);
  delete from tms.plan_needs where id = tests.tp_need('Negotiation');
  update tms.plan_cycle_departments set answers = '{"s1": [{"f1": "Updated"}]}'::jsonb where cycle_id = c and department_id = sal;
  perform tests.assert_eq(tests.rows_affected(format($q$update tms.plan_cycle_departments set status = 'submitted' where cycle_id = %L and department_id = %L$q$, c, sal)),
    1::bigint, 'the head resubmits before their deadline');
  perform tests.assert_fails(format($q$update tms.plan_cycle_departments set status = 'draft' where cycle_id = %L and department_id = %L$q$, c, sal),
    array['JK005'], 'no recall while the plan is consolidated');
  perform tests.assert_fails(format($q$insert into tms.plan_needs (cycle_id, department_id, topic, people_count) values (%L, %L, 'After', 1)$q$, c, sal),
    array['JK005'], 'nothing changes once resubmitted');
end $$;

-- L&D sees the plan as submitted until they add the changes.
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000e0a1', '10000000-0000-4000-8000-00000000e0a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a1'));
do $$
declare
  c constant uuid := 'ae000000-0000-4000-8000-000000000001';
  sal constant uuid := 'a3000000-0000-4000-8000-000000000004';
  l1 constant uuid := current_setting('tests.tp_line1')::uuid;
begin
  perform tests.assert_eq((select string_agg(seats::text, ',') from tms.plan_line_needs where plan_id = tests.tp_plan()),
    '20', 'a removed need left the plan; the changed one still counts what was submitted');
  update tms.plan_line_needs set line_id = line_id where need_id = tests.tp_need('Excel');
  perform tests.assert_eq((select seats from tms.plan_line_needs where need_id = tests.tp_need('Excel')), 25,
    'refreshed: the resubmitted seats');
  insert into tms.plan_line_needs (plan_id, cycle_id, line_id, need_id, department_id)
    values (tests.tp_plan(), c, l1, tests.tp_need('Excel for managers'), sal);
  perform tests.assert_eq((select sum(seats) from tms.plan_line_needs where line_id = l1), 29::bigint,
    'the new need joins the plan');
  perform tests.assert_eq((select status from tms.plan_cycle_departments where cycle_id = c and department_id = sal),
    'submitted', 'SAL is submitted again');
end $$;

-- Returned again; while returned, its new needs stay out of the plan; after its deadline the head changes nothing.
do $$
declare
  c constant uuid := 'ae000000-0000-4000-8000-000000000001';
  sal constant uuid := 'a3000000-0000-4000-8000-000000000004';
begin
  update tms.plan_cycle_departments set status = 'returned', return_note = 'One more', deadline_on = private.plan_cycle_today(tenant_id)
    where cycle_id = c and department_id = sal;
end $$;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000e0a4', '10000000-0000-4000-8000-00000000e0a4',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a4'));
insert into tms.plan_needs (cycle_id, department_id, topic, people_count)
  values ('ae000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000004', 'Coaching', 3);
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000e0a1', '10000000-0000-4000-8000-00000000e0a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a1'));
do $$
begin
  perform tests.assert_fails(format($q$insert into tms.plan_line_needs (plan_id, cycle_id, line_id, need_id, department_id) values (%L, 'ae000000-0000-4000-8000-000000000001', %L, %L, 'a3000000-0000-4000-8000-000000000004')$q$,
      tests.tp_plan(), current_setting('tests.tp_line1'), tests.tp_need('Coaching')),
    array['JK009'], 'a returned department''s needs enter the plan once it resubmits');
  update tms.plan_line_needs set line_id = line_id where need_id = tests.tp_need('Excel');
  perform tests.assert_eq((select seats from tms.plan_line_needs where need_id = tests.tp_need('Excel')), 25,
    'a returned department keeps its submitted seats');
end $$;
reset role;
reset session authorization;
alter table tms.plan_cycle_departments disable trigger plan_cycle_departments_guard;
update tms.plan_cycle_departments set deadline_on = private.plan_cycle_today(tenant_id) - 1
  where cycle_id = 'ae000000-0000-4000-8000-000000000001' and department_id = 'a3000000-0000-4000-8000-000000000004';
alter table tms.plan_cycle_departments enable trigger plan_cycle_departments_guard;
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000e0a4', '10000000-0000-4000-8000-00000000e0a4',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a4'));
do $$
begin
  perform tests.assert(not private.plan_needs_entry_open('a0000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000004'),
    'entry closes with the department''s own deadline');
  perform tests.assert_fails($q$insert into tms.plan_needs (cycle_id, department_id, topic, people_count) values ('ae000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000004', 'Too late', 1)$q$,
    array['JK005'], 'a late head enters nothing');
  perform tests.assert_fails($q$update tms.plan_cycle_departments set status = 'submitted' where cycle_id = 'ae000000-0000-4000-8000-000000000001' and department_id = 'a3000000-0000-4000-8000-000000000004'$q$,
    array['JK005'], 'nor resubmits');
end $$;
-- The L&D Manager reopens it with a new deadline (business flow §6 (b)); the head resubmits.
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000e0a1', '10000000-0000-4000-8000-00000000e0a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a1'));
do $$
begin
  perform tests.assert_eq(tests.rows_affected($q$update tms.plan_cycle_departments set deadline_on = private.plan_cycle_today(tenant_id) where cycle_id = 'ae000000-0000-4000-8000-000000000001' and department_id = 'a3000000-0000-4000-8000-000000000004'$q$),
    1::bigint, 'the L&D Manager reopens the department until today');
end $$;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000e0a4', '10000000-0000-4000-8000-00000000e0a4',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a4'));
do $$
begin
  perform tests.assert_fails($q$update tms.plan_cycle_departments set deadline_on = private.plan_cycle_today(tenant_id) + 5 where cycle_id = 'ae000000-0000-4000-8000-000000000001' and department_id = 'a3000000-0000-4000-8000-000000000004'$q$,
    array['JK001'], 'a head never moves their own deadline');
  perform tests.assert_eq(tests.rows_affected($q$update tms.plan_cycle_departments set status = 'submitted' where cycle_id = 'ae000000-0000-4000-8000-000000000001' and department_id = 'a3000000-0000-4000-8000-000000000004'$q$),
    1::bigint, 'and resubmits');
end $$;
rollback;

\echo '99_planning_f_plan_2_owner: ok'
