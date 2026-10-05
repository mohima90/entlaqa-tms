-- Rollback of 20261006090000_platform__persons_write_guard.sql.
drop trigger person_employment_guard_writer on platform.person_employment;
drop trigger persons_guard_writer on platform.persons;
drop function private.check_person_writer();
drop function private.person_self_service_columns();
drop function private.actor_manages_users(uuid);
