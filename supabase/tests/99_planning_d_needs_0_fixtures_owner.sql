-- db-test: run-as=owner
-- Department needs (WP-LD-01, T-M3-05; FR-PLN-03, FR-MGR-05): fixtures for 99_planning_d_needs_1_app_server.sql
-- and 99_planning_d_needs_2_owner.sql, and the catalogue checks that need the owner connection.
--   uH  (…e0a4) Department Head of tenant A, session sH in A; heads the new department SALES-NEEDS (a3…04);
--       uE (the Employee, 99_planning_a) now works in SAL under uH — a person uH may name for a need
--   uA  heads TD in the structure but holds no Department Head role (the Organization Admin): never enters needs
--   Nothing else changes for the earlier test files (this file runs after them).
\set ON_ERROR_STOP on

insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000e0a4', 'uh@a.test');
insert into auth.sessions (id, user_id, not_after) values
  ('10000000-0000-4000-8000-00000000e0a4', '00000000-0000-4000-8000-00000000e0a4', null);
insert into platform.persons (id, tenant_id, display_name_ar, display_name_en, email) values
  ('a1000000-0000-4000-8000-00000000e0a4', 'a0000000-0000-4000-8000-000000000001', 'رئيس المبيعات', 'Head of Sales', 'uh@a.test');
insert into platform.tenant_memberships (tenant_id, user_id, person_id, status) values
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000e0a4', 'a1000000-0000-4000-8000-00000000e0a4', 'active');
insert into platform.session_context (session_id, user_id, active_tenant_id) values
  ('10000000-0000-4000-8000-00000000e0a4', '00000000-0000-4000-8000-00000000e0a4', 'a0000000-0000-4000-8000-000000000001');
insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary)
select m.tenant_id, m.id, 'department_head', true
from platform.tenant_memberships m
where m.tenant_id = 'a0000000-0000-4000-8000-000000000001' and m.user_id = '00000000-0000-4000-8000-00000000e0a4';

insert into platform.departments (id, tenant_id, code, name_ar, name_en, parent_id, branch_id, head_person_id) values
  ('a3000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001', 'SALES-NEEDS', 'مبيعات الاحتياجات', 'Needs Sales', null,
   'a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a4');
insert into platform.person_employment (tenant_id, person_id, branch_id, department_id, job_title_ar, manager_person_id) values
  ('a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a4', 'a2000000-0000-4000-8000-000000000001',
   'a3000000-0000-4000-8000-000000000004', 'رئيس المبيعات', null),
  ('a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e0a3', 'a2000000-0000-4000-8000-000000000001',
   'a3000000-0000-4000-8000-000000000004', 'مندوب مبيعات', 'a1000000-0000-4000-8000-00000000e0a4');

-- The catalogue (migration 20261105100000) and the grants (20261105100100).
do $$
begin
  perform tests.assert_eq(
    (select code || ':' || risk || ':' || custom_role_use || ':' || privileged::text from platform.ref_permissions
     where code = 'tms.plan_needs.submit'),
    'tms.plan_needs.submit:low:none:false', 'the needs-entry permission in the catalogue');
  perform tests.assert_eq(
    (select string_agg(role_code || ':' || scope, ',' order by role_code)
     from platform.ref_role_permissions where permission_code = 'tms.plan_needs.submit'),
    'department_head:headed_departments', 'the Department Head holds it for the departments they head, nobody else');
  perform tests.assert(not private.role_is_privileged('a0000000-0000-4000-8000-000000000001', 'department_head'),
    'the Department Head stays a role that is not privileged');
  perform tests.assert(has_function_privilege('authenticated', 'private.may_submit_plan_needs(uuid, uuid)', 'execute'),
    'authenticated may call private.may_submit_plan_needs');
  perform tests.assert(not has_function_privilege('app_worker', 'private.plan_needs_guard()', 'execute'),
    'app_worker cannot call the needs guard directly');
  -- Grants: the application's columns only.
  perform tests.assert(not has_column_privilege('authenticated', 'tms.plan_needs', 'tenant_id', 'UPDATE')
                       and not has_column_privilege('authenticated', 'tms.plan_needs', 'cycle_id', 'UPDATE')
                       and not has_column_privilege('authenticated', 'tms.plan_needs', 'department_id', 'UPDATE'),
    'plan_needs: a need never moves to another department, cycle or organization');
  perform tests.assert(not has_table_privilege('authenticated', 'tms.plan_need_people', 'UPDATE'),
    'plan_need_people: no UPDATE (names are added and removed)');
  -- The default form no longer seeds an «Estimated cost» field (20261105100200); existing unlocked default forms
  -- lost theirs. (Tenant B's default form is checked field by field in 99_needs_forms_2_owner.sql.)
  perform tests.assert_eq(
    (select count(*) from tms.needs_form_fields x join tms.needs_forms f on f.id = x.form_id
     where f.locked_at is null and x.system_key is null and x.field_type = 'number' and x.label_en = 'Estimated cost'),
    0::bigint, 'no unlocked form keeps the seeded «Estimated cost» field');
end $$;

\echo '99_planning_d_needs_0_fixtures_owner: ok'
