-- The needs-entry permission in the permission catalogue (WP-LD-01, T-M3-05; FR-PLN-03, FR-MGR-05; business
-- flow docs/business-flows/EP-PLN-planning-cycle.md §3 C6–9, amended by the PO's decisions of 27 Oct 2026:
-- docs/product/proposals/step-10-needs-entry.md). Class: G (reference data). PII: none. Insert-only (drift
-- tests in packages/platform-rbac custom-roles.test.ts read every insert into these two tables;
-- tmsRolePermissions in platform-permissions.ts, grants in system-roles.ts).
--
--   tms.plan_needs.submit   low   Department Head, scope headed_departments: enters, submits and recalls the
--                                 training needs of the departments they head (the department's EFFECTIVE head —
--                                 its own head, else the nearest head above, EP-ORG — as the database checks in
--                                 private.may_submit_plan_needs, migration 20261105100100)
--
-- Not part of a custom role yet (custom_role_use 'none', like the other training permissions: the role builder
-- offers what the Organization Admin holds, BR-IAM-4) and not privileged (entering needs changes no person,
-- structure, setting or audit record). sort_order 43 follows the needs-form permissions (41, 42).

insert into platform.ref_permissions (code, risk, custom_role_use, privileged, sort_order) values
  ('tms.plan_needs.submit', 'low', 'none', false, 43);

insert into platform.ref_role_permissions (role_code, permission_code, scope) values
  ('department_head', 'tms.plan_needs.submit', 'headed_departments');
