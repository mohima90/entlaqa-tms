-- Rollback of 20261020210200_tms__narrow_needs_form_seed_policies.sql: the policies of 20261020180300 again.
drop policy needs_form_fields_platform_admin_guard_insert on tms.needs_form_fields;
create policy needs_form_fields_platform_admin_guard_insert on tms.needs_form_fields for insert
  to platform_admin_guard with check (true);

drop policy needs_form_sections_platform_admin_guard_insert on tms.needs_form_sections;
create policy needs_form_sections_platform_admin_guard_insert on tms.needs_form_sections for insert
  to platform_admin_guard with check (true);

revoke select (created_at) on tms.needs_forms from platform_admin_guard;
