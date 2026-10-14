-- Rollback of 20261017090200_platform__allow_tenant_display_name_update.sql.
revoke update (name_ar, name_en) on platform.tenants from authenticated;
drop policy tenants_update on platform.tenants;
alter table platform.tenants
  drop constraint tenants_names_bidi_check,
  drop constraint tenants_name_en_check,
  drop constraint tenants_name_ar_length_check;
