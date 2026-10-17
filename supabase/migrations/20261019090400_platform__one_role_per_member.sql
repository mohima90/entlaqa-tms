-- One role per person in an organization (EP-ROLES, FR-IAM-07; Kawadir; PO 17 Oct 2026 — business flow
-- docs/business-flows/EP-ROLES-roles-and-custom-roles.md §5). After the backfill (20261019090300) every
-- membership holds at most one assignment; from now on the database refuses a second one, and a pending
-- invitation gives exactly one role (no additional roles). The Organization Admin role is still held alone
-- (BR-IAM-4) and the last Organization Admin is still kept (private.check_last_admin_*). Changing a member's
-- role replaces the row (delete + insert in one transaction, packages/platform-db role-admin.ts).
-- is_primary stays (always true) for the code that still reads it.

create unique index role_assignments_tenant_membership_one_role_uq
  on platform.role_assignments (tenant_id, membership_id);

alter table platform.invitations
  add constraint invitations_one_role_check check (status <> 'pending' or cardinality(additional_roles) = 0);
