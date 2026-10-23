-- Rollback of 20261025100000_platform__add_person_hr_permissions.sql.
delete from platform.custom_role_permissions where permission_code = 'platform.person.hr_details';
delete from platform.ref_role_permissions where permission_code = 'platform.person.hr_details';
delete from platform.ref_permissions where code = 'platform.person.hr_details';
