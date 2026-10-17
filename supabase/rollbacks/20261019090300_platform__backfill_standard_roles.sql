-- Rollback of 20261019090300_platform__backfill_standard_roles.sql.
-- irreversible (data): the mapped assignments, cleared additional roles and revoked invitations are not
-- restored — restore from backup if ever needed. The former role codes come back to platform.ref_roles so
-- that the earlier schema (foreign keys to ref_roles) can be restored by the next rollbacks.
insert into platform.ref_roles (code, is_privileged, sort_order) values
  ('finance_manager', true, 5),
  ('compliance_officer', true, 6),
  ('line_manager', false, 8),
  ('internal_instructor', false, 9),
  ('external_instructor', false, 10),
  ('provider_admin', false, 11),
  ('mentor', false, 12),
  ('auditor', true, 14)
on conflict (code) do nothing;
