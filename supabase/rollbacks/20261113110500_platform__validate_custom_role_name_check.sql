-- Rollback of 20261113110500_platform__validate_custom_role_name_check.sql: nothing to undo — a validated
-- check cannot be marked NOT VALID again, and the rollback of 20261113110400 drops the constraint.
select 1;
