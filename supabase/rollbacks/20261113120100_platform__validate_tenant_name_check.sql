-- Rollback of 20261113120100_platform__validate_tenant_name_check.sql: nothing to undo — a validated check
-- cannot be marked NOT VALID again, and the rollback of 20261113120000 drops the constraint.
select 1;
