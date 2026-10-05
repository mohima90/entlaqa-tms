-- System role catalogue (FR-IAM-07, T-M2-03). Class: G (global reference, allow-listed in
-- supabase/tests/00_helpers_and_fixtures.sql). The 14 tenant roles of BRD Appendix B; Platform Super
-- Admin is not a tenant role (ADR 0003 §6). Names and grants live in code
-- (packages/platform-rbac/src/system-roles.ts); this table holds the codes that role assignments
-- reference and the `is_privileged` flag the database guard uses. A unit test
-- (packages/platform-rbac/src/system-roles.test.ts) fails when this seed drifts from the code and when
-- a later migration changes ref_roles without updating that test. PII: none.

create table platform.ref_roles (
  code text primary key check (code ~ '^[a-z][a-z_]{1,39}$'),
  is_privileged boolean not null,
  sort_order smallint not null unique
);
comment on table platform.ref_roles is
  'System roles (FR-IAM-07). Class: G. Synced from platform-rbac system-roles.ts (drift test).';

insert into platform.ref_roles (code, is_privileged, sort_order) values
  ('tenant_admin', true, 1),
  ('training_manager', false, 2),
  ('training_coordinator', false, 3),
  ('hr_manager', true, 4),
  ('finance_manager', true, 5),
  ('compliance_officer', true, 6),
  ('department_head', false, 7),
  ('line_manager', false, 8),
  ('internal_instructor', false, 9),
  ('external_instructor', false, 10),
  ('provider_admin', false, 11),
  ('mentor', false, 12),
  ('learner', false, 13),
  ('auditor', true, 14);

alter table platform.ref_roles enable row level security;
alter table platform.ref_roles force row level security;
create policy ref_roles_read on platform.ref_roles for select to authenticated using (true);
revoke all on platform.ref_roles from public, anon;
grant select on platform.ref_roles to authenticated;
