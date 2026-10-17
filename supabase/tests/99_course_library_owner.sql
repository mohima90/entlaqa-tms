-- db-test: run-as=owner
-- Course library (T-M3-03; FR-CAT-01, FR-CAT-10; migrations 20261020120000, 20261020120100): fixtures for
-- 99_course_library_users_app_server.sql and 99_course_library_worker_app_worker.sql, and the catalogue and
-- schema checks that need the owner connection.
--
-- New members (their own sessions, so earlier session tests cannot have ended them):
--   uLD …d001 L&D Manager of A          uTC …d002 Training Coordinator of A
--   uDH …d003 Department Head of A      uEM …d004 Employee of A
--   uCR …d005 custom role «Course editor» of A (tms.course.read + tms.course.manage, whole organization)
--   uLB …d006 L&D Manager of B
-- Fixture rows (00): tenant A category a7…01 «Leadership», courses a71…01 LEAD-101 (active, costs 15000 /
-- 250 SAR) and a71…02 OLD-001 (archived, no costs); tenant B category b7…01, course b71…01 LEAD-101.
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000d001', 'uld@a.test'),
  ('00000000-0000-4000-8000-00000000d002', 'utc@a.test'),
  ('00000000-0000-4000-8000-00000000d003', 'udh@a.test'),
  ('00000000-0000-4000-8000-00000000d004', 'uem@a.test'),
  ('00000000-0000-4000-8000-00000000d005', 'ucr@a.test'),
  ('00000000-0000-4000-8000-00000000d006', 'ulb@b.test');

insert into auth.sessions (id, user_id, not_after) values
  ('10000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000d001', null),
  ('10000000-0000-4000-8000-00000000d002', '00000000-0000-4000-8000-00000000d002', null),
  ('10000000-0000-4000-8000-00000000d003', '00000000-0000-4000-8000-00000000d003', null),
  ('10000000-0000-4000-8000-00000000d004', '00000000-0000-4000-8000-00000000d004', null),
  ('10000000-0000-4000-8000-00000000d005', '00000000-0000-4000-8000-00000000d005', null),
  ('10000000-0000-4000-8000-00000000d006', '00000000-0000-4000-8000-00000000d006', null);

insert into platform.persons (id, tenant_id, display_name_ar, email) values
  ('a1000000-0000-4000-8000-00000000d001', 'a0000000-0000-4000-8000-000000000001', 'مدير التعلم', 'uld@a.test'),
  ('a1000000-0000-4000-8000-00000000d002', 'a0000000-0000-4000-8000-000000000001', 'منسق التدريب', 'utc@a.test'),
  ('a1000000-0000-4000-8000-00000000d003', 'a0000000-0000-4000-8000-000000000001', 'رئيس قسم', 'udh@a.test'),
  ('a1000000-0000-4000-8000-00000000d004', 'a0000000-0000-4000-8000-000000000001', 'موظف', 'uem@a.test'),
  ('a1000000-0000-4000-8000-00000000d005', 'a0000000-0000-4000-8000-000000000001', 'محرر دورات', 'ucr@a.test'),
  ('b1000000-0000-4000-8000-00000000d006', 'b0000000-0000-4000-8000-000000000001', 'مدير التعلم ب', 'ulb@b.test');

insert into platform.tenant_memberships (tenant_id, user_id, person_id, status) values
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000d001', 'a1000000-0000-4000-8000-00000000d001', 'active'),
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000d002', 'a1000000-0000-4000-8000-00000000d002', 'active'),
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000d003', 'a1000000-0000-4000-8000-00000000d003', 'active'),
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000d004', 'a1000000-0000-4000-8000-00000000d004', 'active'),
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000d005', 'a1000000-0000-4000-8000-00000000d005', 'active'),
  ('b0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000d006', 'b1000000-0000-4000-8000-00000000d006', 'active');

insert into platform.session_context (session_id, user_id, active_tenant_id) values
  ('10000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000d001', 'a0000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-00000000d002', '00000000-0000-4000-8000-00000000d002', 'a0000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-00000000d003', '00000000-0000-4000-8000-00000000d003', 'a0000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-00000000d004', '00000000-0000-4000-8000-00000000d004', 'a0000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-00000000d005', '00000000-0000-4000-8000-00000000d005', 'a0000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-00000000d006', '00000000-0000-4000-8000-00000000d006', 'b0000000-0000-4000-8000-000000000001');

-- «Course editor»: a custom role of A with the course permissions an Organization Admin could only give if
-- they held them (written here as a platform operation).
insert into platform.custom_roles (id, tenant_id, code, name_en, name_ar, description, data_scope) values
  ('a6000000-0000-4000-8000-00000000d005', 'a0000000-0000-4000-8000-000000000001', 'custom_a000000d0005',
   'Course editor', 'محرر الدورات', null, 'organization');
insert into platform.custom_role_permissions (tenant_id, custom_role_id, permission_code) values
  ('a0000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-00000000d005', 'tms.course.read'),
  ('a0000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-00000000d005', 'tms.course.manage');

insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary)
select m.tenant_id, m.id, r.role_code, true
from (values
  ('a0000000-0000-4000-8000-000000000001'::uuid, '00000000-0000-4000-8000-00000000d001'::uuid, 'training_manager'),
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000d002', 'training_coordinator'),
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000d003', 'department_head'),
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000d004', 'learner'),
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000d005', 'custom_a000000d0005'),
  ('b0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000d006', 'training_manager')
) as r (tenant_id, user_id, role_code)
join platform.tenant_memberships m on m.tenant_id = r.tenant_id and m.user_id = r.user_id;

-- The catalogue and the standard roles' grants (synced with platform-rbac by drift tests).
do $$
begin
  perform tests.assert_eq(
    (select string_agg(format('%s:%s:%s:%s', code, risk, custom_role_use, privileged), ' ' order by code collate "C")
     from platform.ref_permissions where code like 'tms.course%'),
    'tms.course.archive:medium:organization_only:f tms.course.manage:medium:organization_only:f '
    'tms.course.read:low:organization:f tms.course_cost.read:low:organization:f',
    'the four course permissions are in the catalogue, none privileged');
  perform tests.assert_eq(
    (select string_agg(format('%s:%s', role_code, permission_code), ' ' order by role_code collate "C", permission_code collate "C")
     from platform.ref_role_permissions where permission_code like 'tms.course%' and scope = 'tenant'),
    'department_head:tms.course.read department_head:tms.course_cost.read '
    'hr_manager:tms.course.read hr_manager:tms.course_cost.read '
    'training_coordinator:tms.course.manage training_coordinator:tms.course.read training_coordinator:tms.course_cost.read '
    'training_manager:tms.course.archive training_manager:tms.course.manage training_manager:tms.course.read training_manager:tms.course_cost.read',
    'BRD Appendix B «Course library & programs»: HR V, L&D F, TC E, Department Head V (Employee: later, M4)');
  perform tests.assert(not exists (select 1 from platform.ref_role_permissions
                                   where role_code = 'tenant_admin' and permission_code like 'tms.%'),
    'the Organization Admin holds no training permission (BR-IAM-4)');
  -- The course permissions do not make the standard roles privileged: the L&D Manager and the Training
  -- Coordinator are ordinary roles, which the HR Manager gives although it does not hold the course
  -- permissions (who can give what, PO 17 Oct 2026 — migration 20261020200000).
  perform tests.assert(not private.role_is_privileged('a0000000-0000-4000-8000-000000000001', 'custom_a000000d0005'),
    'a custom role with course permissions is not privileged');
  perform tests.assert(not private.role_is_privileged('a0000000-0000-4000-8000-000000000001', 'training_manager')
                       and not private.role_is_privileged('a0000000-0000-4000-8000-000000000001', 'training_coordinator'),
    'the L&D Manager and the Training Coordinator are ordinary roles');
  perform tests.assert(not private.member_has_permission('a0000000-0000-4000-8000-000000000001',
                         '00000000-0000-4000-8000-0000000000ab', 'tms.course.manage'),
    'the HR Manager does not change the course library');
  perform tests.assert(private.member_may_give_roles('a0000000-0000-4000-8000-000000000001',
                         '00000000-0000-4000-8000-0000000000ab', array['training_manager']),
    'the HR Manager gives the L&D Manager role (course permissions it does not hold)');
  perform tests.assert(private.member_may_give_roles('a0000000-0000-4000-8000-000000000001',
                         '00000000-0000-4000-8000-0000000000ab', array['training_coordinator']),
    'the HR Manager gives the Training Coordinator role');
  perform tests.assert(private.member_may_give_roles('a0000000-0000-4000-8000-000000000001',
                         '00000000-0000-4000-8000-0000000000ab', array['custom_a000000d0005']),
    'the HR Manager gives an ordinary custom role with course permissions');

  -- Fixture stamps written by the guard as a platform operation: the costs' currency and the archive.
  perform tests.assert_eq((select cost_currency from tms.courses where id = 'a7100000-0000-4000-8000-000000000001'),
    'SAR', 'a course with costs is stamped with the organization''s default currency');
  perform tests.assert((select cost_currency is null and status = 'archived' and archived_at is not null and archived_by is null
                        from tms.courses where id = 'a7100000-0000-4000-8000-000000000002'),
    'no costs → no currency; archived by a platform operation (no person)');

  -- The tables: tenant-owned, RLS enabled and forced (10_catalog), no DELETE for anyone in the app.
  perform tests.assert(not has_table_privilege('authenticated', 'tms.courses', 'delete')
                       and not has_table_privilege('authenticated', 'tms.course_categories', 'delete'),
    'courses and categories are never deleted by the application');
  perform tests.assert(not has_column_privilege('authenticated', 'tms.courses', 'status', 'insert'),
    'a new course is always active (status not insertable)');
  perform tests.assert(not has_column_privilege('authenticated', 'tms.courses', 'cost_currency', 'insert')
                       and not has_column_privilege('authenticated', 'tms.courses', 'cost_currency', 'update'),
    'the costs'' currency is the database''s (from the organization''s settings)');
  perform tests.assert(not has_column_privilege('authenticated', 'tms.courses', 'archived_at', 'update')
                       and not has_column_privilege('authenticated', 'tms.courses', 'archived_by', 'update')
                       and not has_column_privilege('authenticated', 'tms.courses', 'created_by', 'update'),
    'archive and [std] stamps are not writable');
  perform tests.assert(not has_table_privilege('app_worker', 'tms.courses', 'select'),
    'app_worker has no privileges of its own (NOINHERIT)');
end $$;

\echo '99_course_library_owner: ok'
