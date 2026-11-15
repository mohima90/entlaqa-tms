-- Rollback of 20261117100100_private__session_scope.sql: the helpers go.

drop function private.session_units(uuid);
drop function private.may_manage_sessions(uuid);
