-- Rollback of 20261117100000_platform__add_session_permissions.sql. Custom roles holding it lose it (the catalogue's
-- foreign key from platform.custom_role_permissions).

delete from platform.custom_role_permissions where permission_code = 'tms.session.manage';
delete from platform.ref_role_permissions where permission_code = 'tms.session.manage';
delete from platform.ref_permissions where code = 'tms.session.manage';
