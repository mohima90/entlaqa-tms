-- db-test: run-as=owner
-- The move preview's open planning cycles (WP-HR-01, migration 20261103100300): the role structure_guard and its
-- reach, and private.units_in_open_plan_cycles — names of the open cycles of the CALLER's organization that include
-- the given units; nothing for another organization's units, a draft or closed cycle, or a caller without user
-- claims. Runs as the owner and switches to app_server. Every block is rolled back.
\set ON_ERROR_STOP on

do $$
declare
  v_list text;
begin
  perform tests.assert(not (select rolbypassrls or rolcanlogin or rolsuper or rolinherit or rolcreaterole or rolcreatedb
                            from pg_roles where rolname = 'structure_guard'),
    'structure_guard must be NOLOGIN NOINHERIT and not BYPASSRLS / superuser / createrole / createdb');
  perform tests.assert(not exists (select 1 from pg_auth_members m join pg_roles u on u.oid = m.member
                                   where m.roleid = 'structure_guard'::regrole and (m.inherit_option or m.set_option)
                                     and not u.rolsuper and u.rolname <> current_user),
    'nobody acts as structure_guard');
  perform tests.assert(not has_schema_privilege('structure_guard', 'private', 'CREATE')
                       and not has_schema_privilege('structure_guard', 'tms', 'CREATE')
                       and not exists (select 1 from pg_class c where c.relowner = 'structure_guard'::regrole),
    'structure_guard creates and owns no relations');
  select string_agg(format('%s%s', p.oid::regprocedure, case when p.prosecdef then ' (definer)' else '' end), ', ')
    into v_list
  from pg_proc p where p.proowner = 'structure_guard'::regrole;
  perform tests.assert_eq(v_list, 'private.units_in_open_plan_cycles(uuid[]) (definer)',
    'structure_guard owns one function');
  perform tests.assert(not has_table_privilege('structure_guard', 'tms.plan_cycles', 'SELECT')
                       and has_column_privilege('structure_guard', 'tms.plan_cycles', 'name_en', 'SELECT')
                       and not has_column_privilege('structure_guard', 'tms.plan_cycles', 'deadline_on', 'SELECT')
                       and not has_column_privilege('structure_guard', 'tms.plan_cycle_departments', 'budget_amount', 'SELECT')
                       and not has_table_privilege('structure_guard', 'platform.persons', 'SELECT'),
    'structure_guard reads the cycles'' names and status, and the units in them — nothing else');
  perform tests.assert(not has_function_privilege('anon', 'private.units_in_open_plan_cycles(uuid[])', 'EXECUTE'),
    'anonymous callers cannot ask');
end $$;

-- Tenant A's open cycle «Earlier plan» (99_planning_a_fixtures_owner.sql; one open cycle per organization) with
-- OPS, and a draft one with RUH-OPS (platform operation: the guards would refuse these writes directly).
begin;
alter table tms.plan_cycles disable trigger plan_cycles_guard;
alter table tms.plan_cycle_departments disable trigger plan_cycle_departments_guard;
insert into tms.plan_cycles (id, tenant_id, name_ar, name_en, period_start_on, period_end_on, deadline_on) values
  ('a9000000-0000-4000-8000-0000000000c2', 'a0000000-0000-4000-8000-000000000001', 'مسودة', 'Draft plan',
   current_date, current_date + 300, current_date + 30);
insert into tms.plan_cycle_departments (tenant_id, cycle_id, department_id) values
  ('a0000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000003'),
  ('a0000000-0000-4000-8000-000000000001', 'a9000000-0000-4000-8000-0000000000c2', 'a3000000-0000-4000-8000-000000000001')
on conflict do nothing;
alter table tms.plan_cycles enable trigger plan_cycles_guard;
alter table tms.plan_cycle_departments enable trigger plan_cycle_departments_guard;

set local session authorization app_server;
set local role authenticated;
select tests.set_claims(tests.uab_claims());
do $$
begin
  perform tests.assert(
    (select bool_or(name_en = 'Earlier plan') and not bool_or(name_en = 'Draft plan')
     from private.units_in_open_plan_cycles(
       array['a3000000-0000-4000-8000-000000000003', 'a3000000-0000-4000-8000-000000000001']::uuid[])),
    'the open cycle that includes a moved unit (a draft one is not open)');
  perform tests.assert_eq(
    (select count(*) from private.units_in_open_plan_cycles(array['b3000000-0000-4000-8000-000000000001']::uuid[])),
    0::bigint, 'another organization''s units: nothing');
  perform tests.assert_eq((select count(*) from private.units_in_open_plan_cycles('{}'::uuid[])), 0::bigint,
    'no units: nothing');
  perform tests.assert_eq((select count(*) from tms.plan_cycles), 0::bigint,
    'the HR Manager still reads no planning cycle directly (S-L3)');
end $$;
select tests.set_claims('{"role": "system"}'::jsonb);
do $$
begin
  perform tests.assert_eq(
    (select count(*) from private.units_in_open_plan_cycles(array['a3000000-0000-4000-8000-000000000003']::uuid[])),
    0::bigint, 'no user claims: nothing');
end $$;
rollback;

\echo '99_structure_5_open_planning_owner: ok'
