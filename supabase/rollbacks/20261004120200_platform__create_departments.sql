-- Rollback of 20261004120200_platform__create_departments.sql.
drop table platform.departments;
drop function private.check_department_hierarchy();
