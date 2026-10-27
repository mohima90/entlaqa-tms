-- db-test: run-as=owner
-- Department needs after the deadline (WP-LD-01; PO decision Q3, 27 Oct 2026): once the effective deadline has
-- passed entry is closed, the L&D Manager extends one department and entry reopens for it, and the cycle does
-- not close while a department's extension is still running. The deadline is moved into the past as the owner
-- with the guard off (a platform operation — the guard refuses it); the users act through session_user app_server.
-- Fixtures as 99_planning_d_needs_1. The block is rolled back.
\set ON_ERROR_STOP on

begin;
-- As the web app's connection (session_user app_server) with the L&D Manager's claims.
set local session authorization app_server;
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
  insert into tms.plan_cycle_departments (cycle_id, department_id, budget_amount) values (c, sal, 60000);
  update tms.plan_cycles set needs_form_id = 'a7000000-0000-4000-8000-000000000001' where id = c;
  update tms.plan_cycles set status = 'open' where id = c;
end $$;
reset role;
reset session authorization;
-- The deadline was yesterday (platform operation).
alter table tms.plan_cycles disable trigger plan_cycles_guard;
update tms.plan_cycles set deadline_on = private.plan_cycle_today(tenant_id) - 1 where id = 'ae000000-0000-4000-8000-000000000001';
alter table tms.plan_cycles enable trigger plan_cycles_guard;
-- Another department's need in the same cycle (TD, headed by uA; written by the platform with the guards off):
-- uH never reads it (review F3 c).
alter table tms.plan_cycle_departments disable trigger plan_cycle_departments_guard;
alter table tms.plan_needs disable trigger plan_needs_guard;
alter table tms.plan_need_people disable trigger plan_need_people_guard;
-- (TD's form row in ae…01 comes from 00_helpers_and_fixtures.sql.)
insert into tms.plan_needs (id, tenant_id, cycle_id, department_id, topic, people_count) values
  ('af000000-0000-4000-8000-0000000000d1', 'a0000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000001',
   'a3000000-0000-4000-8000-000000000001', 'TD only', 2);
insert into tms.plan_need_people (tenant_id, need_id, department_id, person_id) values
  ('a0000000-0000-4000-8000-000000000001', 'af000000-0000-4000-8000-0000000000d1', 'a3000000-0000-4000-8000-000000000001',
   'a1000000-0000-4000-8000-0000000000a1');
alter table tms.plan_need_people enable trigger plan_need_people_guard;
alter table tms.plan_needs enable trigger plan_needs_guard;
alter table tms.plan_cycle_departments enable trigger plan_cycle_departments_guard;

set local session authorization app_server;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000e0a4', '10000000-0000-4000-8000-00000000e0a4',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a4'));
do $$
begin
  perform tests.assert(not private.plan_needs_entry_open('a0000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000004'),
    'entry is closed after the deadline');
  perform tests.assert_eq((select count(*) from tms.plan_needs where department_id = 'a3000000-0000-4000-8000-000000000001'), 0::bigint,
    'the head of SAL reads no need of TD');
  perform tests.assert_eq((select count(*) from tms.plan_need_people where department_id = 'a3000000-0000-4000-8000-000000000001'), 0::bigint,
    'nor its names');
  perform tests.assert_eq((select count(*) from tms.plan_cycle_departments where department_id = 'a3000000-0000-4000-8000-000000000001'), 0::bigint,
    'nor its form row');
  perform tests.assert_fails($q$insert into tms.plan_needs (cycle_id, department_id, topic, people_count) values ('ae000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000004', 'Too late', 1)$q$,
    array['JK005'], 'a late head enters nothing');
  perform tests.assert_fails($q$update tms.plan_cycle_departments set status = 'submitted' where cycle_id = 'ae000000-0000-4000-8000-000000000001' and department_id = 'a3000000-0000-4000-8000-000000000004'$q$,
    array['JK005', 'JK006'], 'nor submits');
end $$;

-- The L&D Manager extends SAL to today: entry reopens for SAL; the cycle stays open until that passes.
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000e0a1', '10000000-0000-4000-8000-00000000e0a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a1'));
do $$
declare
  v_today date := private.plan_cycle_today('a0000000-0000-4000-8000-000000000001');
begin
  perform tests.assert_eq(tests.rows_affected(format($q$update tms.plan_cycle_departments set deadline_on = %L where cycle_id = 'ae000000-0000-4000-8000-000000000001' and department_id = 'a3000000-0000-4000-8000-000000000004'$q$, v_today)),
    1::bigint, 'the L&D Manager extends the late department to today');
  perform tests.assert_fails($q$update tms.plan_cycles set status = 'closed' where id = 'ae000000-0000-4000-8000-000000000001'$q$,
    array['JK001'], 'the cycle does not close while a department''s extension runs');
end $$;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000e0a4', '10000000-0000-4000-8000-00000000e0a4',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a4'));
do $$
begin
  perform tests.assert(private.plan_needs_entry_open('a0000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000004'),
    'entry is open again for the extended department');
  insert into tms.plan_needs (cycle_id, department_id, topic, people_count) values ('ae000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000004', 'Just in time', 3);
  perform tests.assert_eq(tests.rows_affected($q$update tms.plan_cycle_departments set status = 'submitted' where cycle_id = 'ae000000-0000-4000-8000-000000000001' and department_id = 'a3000000-0000-4000-8000-000000000004'$q$),
    1::bigint, 'and the head submits');
end $$;

-- Once the extension has passed too (platform operation), the cycle closes.
reset role;
reset session authorization;
alter table tms.plan_cycle_departments disable trigger plan_cycle_departments_guard;
update tms.plan_cycle_departments set deadline_on = private.plan_cycle_today(tenant_id) - 1
  where cycle_id = 'ae000000-0000-4000-8000-000000000001' and department_id = 'a3000000-0000-4000-8000-000000000004';
alter table tms.plan_cycle_departments enable trigger plan_cycle_departments_guard;
set local session authorization app_server;
set local role authenticated;
-- The head's submission stays: no recall after the (extended) deadline either (review F3 b).
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000e0a4', '10000000-0000-4000-8000-00000000e0a4',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a4'));
do $$
begin
  perform tests.assert_fails($q$update tms.plan_cycle_departments set status = 'draft' where cycle_id = 'ae000000-0000-4000-8000-000000000001' and department_id = 'a3000000-0000-4000-8000-000000000004'$q$,
    array['JK005'], 'no recall after the deadline');
end $$;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000e0a1', '10000000-0000-4000-8000-00000000e0a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a1'));
do $$
begin
  perform tests.assert_eq(tests.rows_affected($q$update tms.plan_cycles set status = 'closed' where id = 'ae000000-0000-4000-8000-000000000001'$q$),
    1::bigint, 'the cycle closes once every deadline has passed');
end $$;
rollback;

\echo '99_planning_d_needs_2_owner: ok'
