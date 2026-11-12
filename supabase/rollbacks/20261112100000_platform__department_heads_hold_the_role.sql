-- Rollback of 20261112100000_platform__department_heads_hold_the_role.sql.
-- irreversible (data): nothing to undo in the schema
-- (data only). The members the migration made Department Heads keep the role: it cannot be told apart
-- from a role given by hand afterwards, and taking a role away is a decision for the Organization Admin or
-- the HR Manager (Team members → Edit role). The audit events of the migration name every person changed
-- (platform.user.roles_changed, data.reason = 'unit_head (migration 20261112100000)').
select 1;
