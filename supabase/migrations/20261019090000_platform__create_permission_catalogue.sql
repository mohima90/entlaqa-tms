-- Permission catalogue and standard-role grants (EP-ROLES, FR-IAM-07; PO 17 Oct 2026). Class: G (global
-- reference, allow-listed in supabase/tests/00_helpers_and_fixtures.sql and scripts/sql/verify-deployment.sql).
-- PII: none.
--
--   platform.ref_permissions       every platform permission (packages/platform-rbac platform-permissions.ts)
--                                  with its risk and how a custom role may use it (custom-roles.ts:
--                                  scoped / organization / organization_only / none) and whether holding
--                                  it makes a custom role PRIVILEGED (`privileged`): every high-risk
--                                  permission, and every permission that manages users or roles — user.invite,
--                                  user.update, user.deactivate, role.assign, org.manage (PO rule of 5 Oct
--                                  2026: a role that manages users or roles is privileged; security review H1).
--   platform.ref_role_permissions  the grants of the six standard roles (system-roles.ts) with their scope,
--                                  so the database guards decide by PERMISSION (private.member_permissions,
--                                  migration 20261019090200) and custom roles work in the database exactly
--                                  as in the application.
-- Both are synced from code by drift tests (packages/platform-rbac custom-roles.test.ts,
-- system-roles.test.ts): a later change to either list must come with a migration and the test update.
-- The new permission platform.role.manage (create, change and delete custom roles) is the Organization
-- Admin's alone, and platform.audit.read is high-risk from now on (reading the audit log makes a role
-- privileged).

create table platform.ref_permissions (
  code text primary key check (code ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  risk text not null constraint ref_permissions_risk_check check (risk in ('low', 'medium', 'high')),
  custom_role_use text not null
    constraint ref_permissions_custom_role_use_check
    check (custom_role_use in ('scoped', 'organization', 'organization_only', 'none')),
  privileged boolean not null,
  sort_order smallint not null unique,
  constraint ref_permissions_high_risk_privileged_check check (risk <> 'high' or privileged)
);
comment on table platform.ref_permissions is
  'Permission catalogue (FR-IAM-07, EP-ROLES). Class: G. Synced from platform-rbac platform-permissions.ts / custom-roles.ts (drift test).';

insert into platform.ref_permissions (code, risk, custom_role_use, privileged, sort_order) values
  ('platform.user.read', 'low', 'scoped', false, 1),
  ('platform.user.invite', 'medium', 'organization_only', true, 2),
  ('platform.user.update', 'medium', 'organization_only', true, 3),
  ('platform.user.deactivate', 'medium', 'organization_only', true, 4),
  ('platform.user.reset_mfa', 'high', 'organization_only', true, 5),
  ('platform.user.unlock_sign_in', 'medium', 'organization_only', false, 6),
  ('platform.role.read', 'low', 'scoped', false, 7),
  ('platform.role.assign', 'medium', 'organization_only', true, 8),
  ('platform.role.assign_privileged', 'high', 'none', true, 9),
  ('platform.role.manage', 'high', 'none', true, 10),
  ('platform.org.read', 'low', 'organization', false, 11),
  ('platform.org.manage', 'medium', 'organization_only', true, 12),
  ('platform.tenant.read', 'low', 'organization', false, 13),
  ('platform.tenant.manage', 'high', 'organization_only', true, 14),
  ('platform.security.manage', 'high', 'organization_only', true, 15),
  ('platform.audit.read', 'high', 'organization_only', true, 16);

create table platform.ref_role_permissions (
  role_code text not null references platform.ref_roles (code) on delete cascade,
  permission_code text not null references platform.ref_permissions (code),
  scope text not null
    constraint ref_role_permissions_scope_check
    check (scope in ('tenant', 'own', 'direct_reports', 'reports_tree', 'headed_departments')),
  primary key (role_code, permission_code)
);
comment on table platform.ref_role_permissions is
  'Grants of the standard roles (FR-IAM-07, EP-ROLES). Class: G. Synced from platform-rbac system-roles.ts (drift test).';

create index ref_role_permissions_permission_idx on platform.ref_role_permissions (permission_code);

insert into platform.ref_role_permissions (role_code, permission_code, scope) values
  -- Organization Admin: every platform permission except the organization structure (HR Manager's).
  ('tenant_admin', 'platform.user.read', 'tenant'),
  ('tenant_admin', 'platform.user.invite', 'tenant'),
  ('tenant_admin', 'platform.user.update', 'tenant'),
  ('tenant_admin', 'platform.user.deactivate', 'tenant'),
  ('tenant_admin', 'platform.user.reset_mfa', 'tenant'),
  ('tenant_admin', 'platform.user.unlock_sign_in', 'tenant'),
  ('tenant_admin', 'platform.role.read', 'tenant'),
  ('tenant_admin', 'platform.role.assign', 'tenant'),
  ('tenant_admin', 'platform.role.assign_privileged', 'tenant'),
  ('tenant_admin', 'platform.role.manage', 'tenant'),
  ('tenant_admin', 'platform.org.read', 'tenant'),
  ('tenant_admin', 'platform.tenant.read', 'tenant'),
  ('tenant_admin', 'platform.tenant.manage', 'tenant'),
  ('tenant_admin', 'platform.security.manage', 'tenant'),
  ('tenant_admin', 'platform.audit.read', 'tenant'),
  ('hr_manager', 'platform.user.read', 'tenant'),
  ('hr_manager', 'platform.user.invite', 'tenant'),
  ('hr_manager', 'platform.user.update', 'tenant'),
  ('hr_manager', 'platform.user.deactivate', 'tenant'),
  ('hr_manager', 'platform.role.read', 'tenant'),
  ('hr_manager', 'platform.role.assign', 'tenant'),
  ('hr_manager', 'platform.org.read', 'tenant'),
  ('hr_manager', 'platform.org.manage', 'tenant'),
  ('training_manager', 'platform.user.read', 'tenant'),
  ('training_manager', 'platform.role.read', 'tenant'),
  ('training_manager', 'platform.org.read', 'tenant'),
  ('training_coordinator', 'platform.user.read', 'tenant'),
  ('training_coordinator', 'platform.role.read', 'tenant'),
  ('training_coordinator', 'platform.org.read', 'tenant'),
  ('department_head', 'platform.user.read', 'headed_departments'),
  ('department_head', 'platform.role.read', 'headed_departments'),
  ('department_head', 'platform.org.read', 'tenant'),
  ('learner', 'platform.user.read', 'own');

-- Read-only reference data: every request reads it, and the guard roles whose reviewed functions decide by
-- permission (invitations, deactivation, security, sign-in locks) read it too.
alter table platform.ref_permissions enable row level security;
alter table platform.ref_permissions force row level security;
create policy ref_permissions_read on platform.ref_permissions for select to authenticated using (true);
create policy ref_permissions_guard_read on platform.ref_permissions for select
  to invitation_guard, membership_guard, tenant_guard, rate_limit_guard using (true);
revoke all on platform.ref_permissions from public, anon;
grant select on platform.ref_permissions to authenticated;
grant select (code, risk, custom_role_use, privileged) on platform.ref_permissions
  to invitation_guard, membership_guard, tenant_guard, rate_limit_guard;

alter table platform.ref_role_permissions enable row level security;
alter table platform.ref_role_permissions force row level security;
create policy ref_role_permissions_read on platform.ref_role_permissions for select to authenticated using (true);
create policy ref_role_permissions_guard_read on platform.ref_role_permissions for select
  to invitation_guard, membership_guard, tenant_guard, rate_limit_guard using (true);
revoke all on platform.ref_role_permissions from public, anon;
grant select on platform.ref_role_permissions to authenticated;
grant select (role_code, permission_code, scope) on platform.ref_role_permissions
  to invitation_guard, membership_guard, tenant_guard, rate_limit_guard;
