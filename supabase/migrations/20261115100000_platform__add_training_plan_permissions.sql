-- The training-plan permissions in the permission catalogue (WP-LD-02, T-M3-06; FR-PLN-05, FR-PLN-06, FR-IAM-08 R1
-- note; business flow docs/business-flows/EP-PLN-planning-cycle.md §3 D; proposal
-- docs/product/proposals/wp-ld-02-03-consolidation-approval.md, agreed 14 Nov 2026; test feedback #4 — the
-- department-limited L&D Manager, agreed 17 Oct 2026). Class: G (reference data). PII: none. Insert-only (drift
-- tests in packages/platform-rbac custom-roles.test.ts read every insert into these two tables;
-- tmsPlanningPermissions in tms-planning-permissions.ts, grants in system-roles.ts).
--
--   tms.training_plan.read    low     view the consolidated training plan — its lines, sessions and costs, and
--                                     the budget check per department — within the role's scope
--                                     (L&D Manager, Training Coordinator: organization-wide)
--   tms.training_plan.manage  medium  build and adjust the plan within the role's scope: line sizes and costs,
--                                     quarter, merge, move a need out, leave a line out (with a reason) or
--                                     bring it back, a department's over-budget reason (L&D Manager)
--
-- Both are SCOPED in a custom role (custom_role_use = 'scoped'): a custom role limited to «A department»
-- (FR-IAM-08 R1 note) carries them for that unit and everything under it — the department-limited L&D Manager
-- of feedback #4. They stay organization-wide in private.member_permissions only for roles whose scope is the
-- organization; the unit scope is read by private.training_plan_units (migration 20261115100100). What stays
-- organization-wide is unchanged: cycles, needs forms, planning settings (tms.plan_cycle.*, tms.needs_form.*,
-- organization_only) and — in WP-LD-03 — submitting the plan. The Training Coordinator reads the plan only
-- (BRD Appendix B, Training plan: «V»). Neither permission is high risk nor manages people or roles: neither
-- makes a role privileged. sort_order 203–204 follows the planning-cycle permissions (201–202).

insert into platform.ref_permissions (code, risk, custom_role_use, privileged, sort_order) values
  ('tms.training_plan.read', 'low', 'scoped', false, 203),
  ('tms.training_plan.manage', 'medium', 'scoped', false, 204);

insert into platform.ref_role_permissions (role_code, permission_code, scope) values
  ('training_manager', 'tms.training_plan.read', 'tenant'),
  ('training_manager', 'tms.training_plan.manage', 'tenant'),
  ('training_coordinator', 'tms.training_plan.read', 'tenant');
