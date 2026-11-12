-- db-test: run-as=app_server
-- A planning cycle and its approval steps are named in at least one language (WP-FIX-03, migration
-- 20261112100100; FR-PLN-02; PO 12 Nov 2026): one name is enough, in either language; no name at all is
-- refused; a given name is still checked (trimmed, visible, within its length). As the L&D Manager of
-- tenant A. Fixtures: 00_helpers_and_fixtures.sql and 99_planning_a_fixtures_owner.sql. Rolled back.
\set ON_ERROR_STOP on

begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-00000000e0a1', '10000000-0000-4000-8000-00000000e0a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a1'));
do $$
declare
  v_today date := private.plan_cycle_today('a0000000-0000-4000-8000-000000000001');
  v_en uuid;
  v_ar uuid;
begin
  -- A cycle named in English only, and one in Arabic only.
  insert into tms.plan_cycles (name_en, period_start_on, period_end_on, deadline_on)
  values ('Training plan 2031', v_today, v_today + 300, v_today + 10)
  returning id into v_en;
  insert into tms.plan_cycles (name_ar, period_start_on, period_end_on, deadline_on)
  values ('خطة التدريب ٢٠٣٢', v_today, v_today + 300, v_today + 10)
  returning id into v_ar;
  perform tests.assert_eq((select name_ar from tms.plan_cycles where id = v_en), null::text,
    'a cycle named in English only keeps no Arabic name');
  perform tests.assert_eq((select name_en from tms.plan_cycles where id = v_ar), null::text,
    'a cycle named in Arabic only keeps no English name');

  -- No name at all, and a name taken away from a cycle that has only one.
  perform tests.assert_check_constraint(format($q$insert into tms.plan_cycles (period_start_on, period_end_on, deadline_on) values (%L, %L, %L)$q$,
    v_today, v_today + 300, v_today + 10), 'plan_cycles_name_present_check', 'a cycle without any name is refused');
  perform tests.assert_check_constraint(format($q$update tms.plan_cycles set name_en = null where id = %L$q$, v_en),
    'plan_cycles_name_present_check', 'the only name of a cycle cannot be removed');
  -- A given name is still checked.
  perform tests.assert_check_constraint(format($q$update tms.plan_cycles set name_ar = '   ' where id = %L$q$, v_en),
    'plan_cycles_name_ar_check', 'a given Arabic name must be visible text');
  perform tests.assert_check_constraint(format($q$update tms.plan_cycles set name_ar = %L where id = %L$q$, repeat('ن', 121), v_en),
    'plan_cycles_name_ar_check', 'a given Arabic name keeps its length limit');
  -- The other language can be added later, and removed again.
  update tms.plan_cycles set name_ar = 'خطة التدريب ٢٠٣١' where id = v_en;
  update tms.plan_cycles set name_ar = null where id = v_en;

  -- Approval steps of the cycle, and the default steps.
  insert into tms.plan_cycle_steps (cycle_id, position, kind, name_en, approver_person_id)
  values (v_en, 1, 'person', 'Finance', 'a1000000-0000-4000-8000-00000000e0a3');
  insert into tms.plan_cycle_steps (cycle_id, position, kind, name_ar)
  values (v_en, 2, 'department_heads', 'رؤساء الإدارات');
  perform tests.assert_check_constraint(format($q$insert into tms.plan_cycle_steps (cycle_id, position, kind) values (%L, 3, 'department_heads')$q$, v_en),
    'plan_cycle_steps_name_present_check', 'a step without any name is refused');
  -- (A cycle's steps are replaced as a whole, never updated: no UPDATE grant.)
  delete from tms.planning_default_steps;
  insert into tms.planning_default_steps (position, kind, name_en) values (1, 'department_heads', 'Department heads');
  insert into tms.planning_default_steps (position, kind, name_ar, approver_person_id)
  values (2, 'person', 'المالية', 'a1000000-0000-4000-8000-00000000e0a3');
  perform tests.assert_check_constraint($q$insert into tms.planning_default_steps (position, kind) values (3, 'person')$q$,
    'planning_default_steps_name_present_check', 'a default step without any name is refused');
end $$;
rollback;

\echo '99_planning_e_names_app_server: ok'
