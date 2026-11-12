-- Rollback of 20261112100200_tms__validate_plan_cycle_name_checks.sql: nothing to undo — a validated check
-- cannot be marked NOT VALID again, and the rollback of 20261112100100 drops the constraints.
select 1;
