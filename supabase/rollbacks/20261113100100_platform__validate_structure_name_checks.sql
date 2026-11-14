-- Rollback of 20261113100100_platform__validate_structure_name_checks.sql: nothing to undo — a validated check
-- cannot be marked NOT VALID again, and the rollback of 20261113100000 drops the constraints.
select 1;
