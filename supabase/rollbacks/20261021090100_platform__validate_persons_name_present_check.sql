-- Rollback of 20261021090100_platform__validate_persons_name_present_check.sql: nothing to undo — a validated
-- check cannot be marked NOT VALID again, and the rollback of 20261021090000 drops the constraint.
select 1;
