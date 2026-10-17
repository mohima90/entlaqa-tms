-- Needs-form permissions in the permission catalogue (T-M3-10; FR-PLN-02, FR-PLN-03; PO, 17 Oct 2026 —
-- business flow docs/business-flows/EP-PLN-planning-cycle.md §12: the L&D Manager designs the needs forms).
-- Class: G (reference data). PII: none. Insert-only (drift tests in packages/platform-rbac custom-roles.test.ts
-- read every insert into these two tables; tmsRolePermissions in platform-permissions.ts, grants in
-- system-roles.ts).
--
--   tms.needs_form.read    low     L&D Manager, Training Coordinator (organization-wide)
--   tms.needs_form.manage  medium  L&D Manager (organization-wide)
--
-- Neither is part of a custom role yet (custom_role_use 'none': the role builder offers what the
-- Organization Admin holds, and the Organization Admin holds no training permission — BR-IAM-4) and neither
-- makes a role privileged (designing a form changes no person, structure, setting or audit record).
-- sort_order 41/42 leaves room for other module permissions added in parallel (M3).

insert into platform.ref_permissions (code, risk, custom_role_use, privileged, sort_order) values
  ('tms.needs_form.read', 'low', 'none', false, 41),
  ('tms.needs_form.manage', 'medium', 'none', false, 42);

insert into platform.ref_role_permissions (role_code, permission_code, scope) values
  ('training_manager', 'tms.needs_form.read', 'tenant'),
  ('training_manager', 'tms.needs_form.manage', 'tenant'),
  ('training_coordinator', 'tms.needs_form.read', 'tenant');
