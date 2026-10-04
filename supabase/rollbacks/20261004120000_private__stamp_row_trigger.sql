-- Rollback of 20261004120000_private__stamp_row_trigger.sql.
drop function private.stamp_soft_delete();
drop function private.stamp_row();
drop function private.request_person_id();
