-- The ready-made Finance role and who decides on the training plan (WP-LD-03, T-M3-07; FR-PLN-08, FR-WFL-01/02 R1
-- part, FR-IAM-07; business flow docs/business-flows/EP-PLN-planning-cycle.md §13, agreed 12 Nov 2026; BRD v3.6
-- §4.2 «A ready-made Finance role»; proposal docs/product/proposals/wp-ld-02-03-consolidation-approval.md).
-- Class: G (reference data). PII: none. Insert-only (drift tests in packages/platform-rbac system-roles.test.ts and
-- custom-roles.test.ts read every insert into these tables; the code is system-roles.ts and
-- tms-planning-permissions.ts).
--
--   platform.ref_roles             finance — «المالية» / Finance, a seventh ready-made role beside the six standard
--                                  roles. Standard roles are global (codes here, grants below), so every
--                                  organization, new or existing, has it at once; it is given in Team members like
--                                  any other role. PRIVILEGED: only the Organization Admin gives it (the Finance
--                                  step is the check on the plan the HR Manager approved — the HR Manager must not
--                                  choose who confirms it; BRD §4.2: «finance approval» makes a role privileged).
--   platform.ref_permissions       tms.training_plan.approve  medium  the HR Manager's step: approve the submitted
--                                                                     plan or send it back with a comment
--                                  tms.training_plan.confirm  medium  the Finance step (only where Planning
--                                                                     settings «Finance confirms the plan» is on)
--                                  Both are custom_role_use = 'none': approval is BY ROLE (PO decision §13 a, b):
--                                  no custom role can hold them, so «every HR Manager» and «every Finance member»
--                                  are exactly the holders of the two roles.
--   platform.ref_role_permissions  hr_manager  + tms.training_plan.read (BRD Appendix B, Training plan «V»), approve
--                                  finance     platform.user.read (own record: My profile), platform.org.read
--                                              (department names), tms.training_plan.read (the plan and its
--                                              budgets, BRD §4.2), tms.training_plan.confirm
-- The decisions themselves (states, separation of duties, the first decision settles the step) are migration
-- 20261116100200. Expand-first: new rows only; nothing calls the new permissions before the application does.

insert into platform.ref_roles (code, is_privileged, sort_order) values
  ('finance', true, 15);

insert into platform.ref_permissions (code, risk, custom_role_use, privileged, sort_order) values
  ('tms.training_plan.approve', 'medium', 'none', false, 205),
  ('tms.training_plan.confirm', 'medium', 'none', false, 206);

insert into platform.ref_role_permissions (role_code, permission_code, scope) values
  ('hr_manager', 'tms.training_plan.read', 'tenant'),
  ('hr_manager', 'tms.training_plan.approve', 'tenant'),
  ('finance', 'platform.user.read', 'own'),
  ('finance', 'platform.org.read', 'tenant'),
  ('finance', 'tms.training_plan.read', 'tenant'),
  ('finance', 'tms.training_plan.confirm', 'tenant');
