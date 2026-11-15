-- The draft-session permission in the permission catalogue (WP-LD-04, T-M3-08; FR-PLN-09, FR-SCH-01 core, FR-IAM-08
-- R1 note; business flow docs/business-flows/EP-PLN-planning-cycle.md §3 F step 21; proposal
-- docs/product/proposals/wp-ld-04-plan-to-courses-and-draft-sessions.md, agreed 15 Nov 2026 — «Who sees drafts: only
-- the L&D Manager and the Training Coordinator»). Class: G (reference data). PII: none. Insert-only (drift tests in
-- packages/platform-rbac custom-roles.test.ts read every insert into these two tables; tmsPlanningPermissions in
-- tms-planning-permissions.ts, grants in system-roles.ts).
--
--   tms.session.manage  medium  create, change and delete the draft sessions of the approved training plan's lines
--                               (month, branch, seats, planned participants) and see them on the training calendar
--                               (L&D Manager, Training Coordinator: organization-wide — BRD Appendix B, Sessions &
--                               scheduling «F» for both)
--
-- It is the ONLY way to see a draft: a draft promises nothing, so employees, department heads, the HR Manager and
-- Finance see none (they will see scheduled sessions, WP-LD-08, through a read permission of their own). SCOPED in a
-- custom role (custom_role_use = 'scoped'): a custom role limited to «A department» (FR-IAM-08 R1 note) carries it
-- for the sessions of plan lines whose departments are all in its unit and below (as tms.training_plan.manage; the
-- unit scope is read by private.session_units, migration 20261117100100). Not high risk and it manages no people or
-- roles: it does not make a role privileged. sort_order 207 follows the training-plan decisions (205–206). The
-- module's older skeleton codes tms.session.read / tms.session.create were never in the catalogue and stay out of it.
-- Expand-first: new rows only; nothing calls the permission before the application does.

insert into platform.ref_permissions (code, risk, custom_role_use, privileged, sort_order) values
  ('tms.session.manage', 'medium', 'scoped', false, 207);

insert into platform.ref_role_permissions (role_code, permission_code, scope) values
  ('training_manager', 'tms.session.manage', 'tenant'),
  ('training_coordinator', 'tms.session.manage', 'tenant');
