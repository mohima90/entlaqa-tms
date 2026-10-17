-- Rollback of 20261020180300_tms__seed_needs_forms_for_new_organizations.sql.
drop policy needs_form_fields_platform_admin_guard_insert on tms.needs_form_fields;
drop policy needs_form_fields_platform_admin_guard_read on tms.needs_form_fields;
drop policy needs_form_sections_platform_admin_guard_insert on tms.needs_form_sections;
drop policy needs_form_sections_platform_admin_guard_read on tms.needs_form_sections;
drop policy needs_forms_platform_admin_guard_insert on tms.needs_forms;
drop policy needs_forms_platform_admin_guard_read on tms.needs_forms;
revoke all on tms.needs_form_fields, tms.needs_form_sections, tms.needs_forms from platform_admin_guard;
revoke execute on function private.needs_form_options_valid(text, jsonb), private.needs_form_locked(uuid, uuid),
                           private.check_needs_form_actor(uuid)
  from platform_admin_guard;
revoke usage on schema tms from platform_admin_guard;
drop trigger tenants_seed_needs_form on platform.tenants;
drop function private.seed_tenant_needs_form();
drop function private.seed_needs_form(uuid, text, text, boolean, boolean);
