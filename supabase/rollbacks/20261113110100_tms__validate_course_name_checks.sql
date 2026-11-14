-- Rollback of 20261113110100_tms__validate_course_name_checks.sql: nothing to undo — a validated check
-- cannot be marked NOT VALID again, and the rollback of 20261113110000 drops the constraints.
select 1;
