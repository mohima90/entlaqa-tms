-- Data backfill for role assignments (T-M2-03, separate from the schema change per conventions §2).
-- Until now the only way to create a membership was the "Provision organization" operation, which
-- creates Organization Admins. Every active membership without any role therefore becomes an
-- Organization Admin (primary role), so existing organizations keep an administrator.
-- Runs without user claims (platform operation): the role guard's actor rules do not apply.
insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary)
select m.tenant_id, m.id, 'tenant_admin', true
from platform.tenant_memberships m
where m.status = 'active'
  and not exists (select 1 from platform.role_assignments ra
                  where ra.tenant_id = m.tenant_id and ra.membership_id = m.id);
