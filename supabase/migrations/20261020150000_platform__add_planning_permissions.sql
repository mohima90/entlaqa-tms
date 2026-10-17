-- Planning-cycle permissions (EP-PLN, BACKLOG T-M3-04; FR-PLN-02, FR-WFL-01/02 R1 part). Class: G rows in the
-- global catalogue (platform.ref_permissions, platform.ref_role_permissions — migration 20261019090000).
-- PII: none.
--
--   tms.plan_cycle.read    view the planning cycles, their set-up and the progress per department
--                          (L&D Manager, Training Coordinator)
--   tms.plan_cycle.manage  create, edit, launch and delete planning cycles, extend an open cycle's deadline,
--                          and edit the planning settings (default approval chain, default reminder days)
--                          (L&D Manager)
--
-- Business flow docs/business-flows/EP-PLN-planning-cycle.md (agreed by the PO, 17 Oct 2026) §2, §3 A3/B4–B5/C9.
-- The Organization Admin gets neither (a setup role, BR-IAM-4); the Department Head, HR Manager and Employee
-- get neither for now (the needs form, T-M3-05, adds what the Department Head needs). Both permissions are
-- organization-wide only in a custom role (custom_role_use = organization_only): a cycle spans departments.
-- Neither is high risk nor manages users or roles, so neither makes a role privileged.
--
-- Synced from code by the drift tests (packages/platform-rbac custom-roles.test.ts, system-roles.test.ts):
-- tms-planning-permissions.ts, custom-roles.ts (catalogue group "planning") and system-roles.ts.
-- sort_order 201+ keeps the planning permissions after the platform ones (and clear of other module ranges).

insert into platform.ref_permissions (code, risk, custom_role_use, privileged, sort_order) values
  ('tms.plan_cycle.read', 'low', 'organization_only', false, 201),
  ('tms.plan_cycle.manage', 'medium', 'organization_only', false, 202);

insert into platform.ref_role_permissions (role_code, permission_code, scope) values
  ('training_manager', 'tms.plan_cycle.read', 'tenant'),
  ('training_manager', 'tms.plan_cycle.manage', 'tenant'),
  ('training_coordinator', 'tms.plan_cycle.read', 'tenant');
