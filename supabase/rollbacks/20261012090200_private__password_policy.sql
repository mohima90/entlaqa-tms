-- Rollback of 20261012090200_private__password_policy.sql.
drop function private.tenant_lockout_policy(uuid);
drop function private.invitation_password_min_length(bytea);
drop function private.password_min_length_for_caller();
drop function private.password_min_length_of(uuid);
