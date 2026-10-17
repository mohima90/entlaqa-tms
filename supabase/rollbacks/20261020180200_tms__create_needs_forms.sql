-- Rollback of 20261020180200_tms__create_needs_forms.sql.
drop function private.duplicate_needs_form(uuid, text, text);
drop function private.lock_needs_form(uuid);
drop table tms.needs_form_fields;
drop table tms.needs_form_sections;
drop table tms.needs_forms;
drop function private.check_needs_form_field();
drop function private.check_needs_form_section();
drop function private.check_needs_form_system_fields();
drop function private.check_needs_form_default();
drop function private.check_needs_form();
drop function private.needs_form_locked(uuid, uuid);
drop function private.check_needs_form_actor(uuid);
drop function private.needs_form_options_valid(text, jsonb);
