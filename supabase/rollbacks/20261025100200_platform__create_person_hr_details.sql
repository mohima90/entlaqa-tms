-- Rollback of 20261025100200_platform__create_person_hr_details.sql.
drop table platform.person_hr_details;
drop function private.stamp_person_hr_details();
drop function private.actor_holds_hr_details(uuid);
