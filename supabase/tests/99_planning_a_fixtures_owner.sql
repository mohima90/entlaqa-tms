-- db-test: run-as=owner
-- Planning cycles (EP-PLN, T-M3-04; FR-PLN-02): fixtures for 99_planning_b_app_server.sql and checks that need
-- the owner connection (catalogue rows, grants). Runs after every other test file, so the extra members
-- below change nothing for them.
--   uL  (…e0a1) L&D Manager of tenant A, session sL in A
--   uT  (…e0a2) Training Coordinator of tenant A, session sT in A
--   uE  (…e0a3) Employee of tenant A (an active member: a valid approver), session sE in A
--   uAB          also the L&D Manager of tenant B (HR Manager in A), session sAB-B (…e0b1) acting in B
--   tenant A's currency is AED (General settings): new cycles copy it
--   tenant A: cycle ae…02, OPEN with a deadline that has passed (written with the guard off, as a platform
--   operation) — the lazy-close path; tenant D: nothing (no planning rows at all)
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000e0a1', 'ul@a.test'),
  ('00000000-0000-4000-8000-00000000e0a2', 'ut@a.test'),
  ('00000000-0000-4000-8000-00000000e0a3', 'ue@a.test');
insert into auth.sessions (id, user_id, not_after) values
  ('10000000-0000-4000-8000-00000000e0a1', '00000000-0000-4000-8000-00000000e0a1', null),
  ('10000000-0000-4000-8000-00000000e0a2', '00000000-0000-4000-8000-00000000e0a2', null),
  ('10000000-0000-4000-8000-00000000e0a3', '00000000-0000-4000-8000-00000000e0a3', null),
  ('10000000-0000-4000-8000-00000000e0b1', '00000000-0000-4000-8000-0000000000ab', null);
insert into platform.persons (id, tenant_id, display_name_ar, display_name_en, email) values
  ('a1000000-0000-4000-8000-00000000e0a1', 'a0000000-0000-4000-8000-000000000001', 'مدير التعلم', 'L&D Manager', 'ul@a.test'),
  ('a1000000-0000-4000-8000-00000000e0a2', 'a0000000-0000-4000-8000-000000000001', 'منسق التدريب', 'Coordinator', 'ut@a.test'),
  ('a1000000-0000-4000-8000-00000000e0a3', 'a0000000-0000-4000-8000-000000000001', 'موظف', 'Employee', 'ue@a.test');
insert into platform.tenant_memberships (tenant_id, user_id, person_id, status) values
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000e0a1', 'a1000000-0000-4000-8000-00000000e0a1', 'active'),
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000e0a2', 'a1000000-0000-4000-8000-00000000e0a2', 'active'),
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000e0a3', 'a1000000-0000-4000-8000-00000000e0a3', 'active');
insert into platform.session_context (session_id, user_id, active_tenant_id) values
  ('10000000-0000-4000-8000-00000000e0a1', '00000000-0000-4000-8000-00000000e0a1', 'a0000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-00000000e0a2', '00000000-0000-4000-8000-00000000e0a2', 'a0000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-00000000e0a3', '00000000-0000-4000-8000-00000000e0a3', 'a0000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-00000000e0b1', '00000000-0000-4000-8000-0000000000ab', 'b0000000-0000-4000-8000-000000000001');
insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary)
select m.tenant_id, m.id, r.role_code, true
from (values
  ('a0000000-0000-4000-8000-000000000001'::uuid, '00000000-0000-4000-8000-00000000e0a1'::uuid, 'training_manager'),
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000e0a2', 'training_coordinator'),
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000e0a3', 'learner'),
  ('b0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000ab', 'training_manager')
) as r (tenant_id, user_id, role_code)
join platform.tenant_memberships m on m.tenant_id = r.tenant_id and m.user_id = r.user_id
where not exists (select 1 from platform.role_assignments x where x.tenant_id = m.tenant_id and x.membership_id = m.id);

update platform.tenant_settings set currency_code = 'AED' where tenant_id = 'a0000000-0000-4000-8000-000000000001';

-- An open cycle of tenant A whose deadline has passed (platform operation: the guard would refuse writing
-- an open cycle directly).
begin;
alter table tms.plan_cycles disable trigger plan_cycles_guard;
insert into tms.plan_cycles (id, tenant_id, name_ar, name_en, period_start_on, period_end_on, deadline_on, status,
    launched_at, currency) values
  ('ae000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'خطة سابقة', 'Earlier plan',
   private.plan_cycle_today('a0000000-0000-4000-8000-000000000001') - 300,
   private.plan_cycle_today('a0000000-0000-4000-8000-000000000001') + 60,
   -- The organization's calendar day, as the guards use (never current_date, UTC: a day apart after 21:00 UTC).
   private.plan_cycle_today('a0000000-0000-4000-8000-000000000001') - 3, 'open', now() - interval '20 days', 'SAR');
alter table tms.plan_cycles enable trigger plan_cycles_guard;
commit;

-- The catalogue and the standard roles' grants (EP-ROLES tables): what the migration seeded.
do $$
begin
  perform tests.assert_eq(
    (select string_agg(code || ':' || risk || ':' || custom_role_use || ':' || privileged::text, ',' order by code)
     from platform.ref_permissions where code like 'tms.plan\_cycle.%'),
    'tms.plan_cycle.manage:medium:organization_only:false,tms.plan_cycle.read:low:organization_only:false',
    'planning permissions in the catalogue');
  perform tests.assert_eq(
    (select string_agg(role_code || ':' || permission_code || ':' || scope, ',' order by role_code, permission_code)
     from platform.ref_role_permissions where permission_code like 'tms.plan\_cycle.%'),
    'training_coordinator:tms.plan_cycle.read:tenant,training_manager:tms.plan_cycle.manage:tenant,training_manager:tms.plan_cycle.read:tenant',
    'planning permissions: L&D Manager manages, Training Coordinator reads, nobody else (Organization Admin none)');
  perform tests.assert(not private.role_is_privileged('a0000000-0000-4000-8000-000000000001', 'training_manager'),
    'the L&D Manager stays a role that is not privileged');
  -- Helpers: invoker functions callable by authenticated only.
  perform tests.assert(has_function_privilege('authenticated', 'private.may_manage_plan_cycles(uuid)', 'execute'),
    'authenticated may call private.may_manage_plan_cycles');
  perform tests.assert(not has_function_privilege('app_worker', 'private.plan_cycles_guard()', 'execute'),
    'app_worker cannot call the guard directly');
  -- Grants: only the columns the application writes.
  perform tests.assert(not has_column_privilege('authenticated', 'tms.plan_cycles', 'launched_at', 'UPDATE'),
    'plan_cycles.launched_at is not updatable');
  perform tests.assert(not has_column_privilege('authenticated', 'tms.plan_cycles', 'currency', 'INSERT'),
    'plan_cycles.currency is set by the database');
  perform tests.assert(not has_table_privilege('authenticated', 'tms.planning_settings', 'DELETE'),
    'planning_settings: no DELETE');
  -- The submission state (WP-LD-01): the status, answers, return note and a department deadline are written by
  -- the application; the stamps are the guard's.
  perform tests.assert(has_column_privilege('authenticated', 'tms.plan_cycle_departments', 'status', 'UPDATE'),
    'plan_cycle_departments.status is updatable (the head submits, the L&D Manager returns)');
  perform tests.assert(not has_column_privilege('authenticated', 'tms.plan_cycle_departments', 'submitted_at', 'UPDATE')
                       and not has_column_privilege('authenticated', 'tms.plan_cycle_departments', 'submitted_by', 'UPDATE')
                       and not has_column_privilege('authenticated', 'tms.plan_cycle_departments', 'returned_at', 'UPDATE'),
    'plan_cycle_departments: the submission stamps are set by the database only');
end $$;

\echo '99_planning_a_fixtures_owner: ok'
