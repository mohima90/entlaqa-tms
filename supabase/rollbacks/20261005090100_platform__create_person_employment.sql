-- Rollback of 20261005090100_platform__create_person_employment.sql.
drop trigger persons_reactivation on platform.persons;
drop function private.check_person_reactivation();
drop trigger branches_until_people_moved on platform.branches;
drop trigger departments_until_people_moved on platform.departments;
drop function private.check_org_unit_has_no_people();
drop table platform.person_employment;
drop function private.check_person_employment();
