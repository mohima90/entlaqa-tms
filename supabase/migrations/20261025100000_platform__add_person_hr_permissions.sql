-- «View and edit HR-only fields» in the permission catalogue (WP-ADM-04, FR-IAM-02; business flow
-- docs/business-flows/EP-PEOPLE-photo-hr-fields.md BR-PPL-e, PO answers 21 and 23 Oct 2026). Class: G
-- (reference data). PII: none. Insert-only (drift tests in packages/platform-rbac custom-roles.test.ts read
-- every insert into these two tables; platformPermissions in platform-permissions.ts, grants in
-- system-roles.ts).
--
--   platform.person.hr_details  medium  privileged  organization_only
--     Gender, date of birth and employment category of every member (platform.person_hr_details,
--     20261025100200). Held by the HR Manager (organization-wide). The Organization Admin does NOT hold it
--     (PO answer 1: the Organization Admin is a set-up role). A custom role may hold it (Compliance, an HR
--     assistant) only with the whole organization as its scope; such a role is PRIVILEGED (only the
--     Organization Admin gives it — flow §5). The person always reads their own row, without this permission.
-- sort_order 60 leaves room for the permissions other work packages add in parallel.

insert into platform.ref_permissions (code, risk, custom_role_use, privileged, sort_order) values
  ('platform.person.hr_details', 'medium', 'organization_only', true, 60);

insert into platform.ref_role_permissions (role_code, permission_code, scope) values
  ('hr_manager', 'platform.person.hr_details', 'tenant');
