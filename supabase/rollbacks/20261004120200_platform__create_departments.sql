-- Rollback of 20261004120200_platform__create_departments.sql.
drop trigger branches_until_departments_moved on platform.branches;
drop function private.check_branch_in_use();
drop table platform.departments;
drop function private.check_department_refs();
