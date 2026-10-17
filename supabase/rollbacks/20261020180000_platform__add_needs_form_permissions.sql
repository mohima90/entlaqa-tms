-- Rollback of 20261020180000_platform__add_needs_form_permissions.sql.
delete from platform.ref_role_permissions
where permission_code in ('tms.needs_form.read', 'tms.needs_form.manage');
delete from platform.ref_permissions where code in ('tms.needs_form.read', 'tms.needs_form.manage');
