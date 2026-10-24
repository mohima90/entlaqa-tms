-- Rollback of 20261103100000_platform__cost_centres.sql.

drop trigger person_employment_validate_cost_centre_2_ref on platform.person_employment;
drop trigger person_employment_validate_cost_centre_1_default on platform.person_employment;
drop trigger departments_validate_cost_centre on platform.departments;
drop function private.fill_person_cost_centre();
drop function private.check_cost_centre_ref();
revoke update (cost_centre_id) on platform.person_employment from authenticated;
alter table platform.departments drop column default_cost_centre_id;
alter table platform.person_employment drop column cost_centre_id;
drop table platform.cost_centres;
