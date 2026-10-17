-- Course library permissions in the permission catalogue (T-M3-03; FR-CAT-01, FR-CAT-10). Class: G (rows of
-- the global catalogue tables of 20261019090000). PII: none.
--
-- BRD Appendix B row «Course library & programs»: HR Manager V, L&D Manager F, Training Coordinator E,
-- Department Head V, Organization Admin none (setup role, BR-IAM-4). Employee V is deferred to the
-- employees' own catalogue (M4): granting it now would stop custom roles with platform.role.assign from
-- giving the Employee role (nobody gives a permission they do not hold) — PO decision pending. Definitions in
-- packages/platform-rbac course-permissions.ts; grants in system-roles.ts; how a custom role uses them in
-- custom-roles.ts — synced with these rows by the drift tests (custom-roles.test.ts).
--
--   tms.course.read        low     organization        see the library (codes, titles, categories, delivery
--                                                      type, duration, capacity) — organization data
--   tms.course_cost.read   low     organization        see the estimated planning costs (Employee: no)
--   tms.course.manage      medium  organization_only   add and edit courses and categories
--   tms.course.archive     medium  organization_only   archive and restore courses (L&D Manager only)
--
-- None is privileged: changing the course library changes no person, role, structure, setting or audit
-- record (PO rule of 5 Oct 2026). The database guards of tms.courses / tms.course_categories decide by
-- these codes (private.member_has_permission, migration 20261020120100).

insert into platform.ref_permissions (code, risk, custom_role_use, privileged, sort_order) values
  ('tms.course.read', 'low', 'organization', false, 101),
  ('tms.course_cost.read', 'low', 'organization', false, 102),
  ('tms.course.manage', 'medium', 'organization_only', false, 103),
  ('tms.course.archive', 'medium', 'organization_only', false, 104);

insert into platform.ref_role_permissions (role_code, permission_code, scope) values
  ('hr_manager', 'tms.course.read', 'tenant'),
  ('hr_manager', 'tms.course_cost.read', 'tenant'),
  ('training_manager', 'tms.course.read', 'tenant'),
  ('training_manager', 'tms.course_cost.read', 'tenant'),
  ('training_manager', 'tms.course.manage', 'tenant'),
  ('training_manager', 'tms.course.archive', 'tenant'),
  ('training_coordinator', 'tms.course.read', 'tenant'),
  ('training_coordinator', 'tms.course_cost.read', 'tenant'),
  ('training_coordinator', 'tms.course.manage', 'tenant'),
  ('department_head', 'tms.course.read', 'tenant'),
  ('department_head', 'tms.course_cost.read', 'tenant');
