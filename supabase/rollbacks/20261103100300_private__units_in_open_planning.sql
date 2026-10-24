-- Rollback of 20261103100300_private__units_in_open_planning.sql. The cluster-wide role structure_guard is kept
-- (roles are not per database; a later migration re-checks its attributes).

drop function private.units_in_open_plan_cycles(uuid[]);
revoke execute on function private.current_tenant_id() from structure_guard;
revoke execute on function private.request_claims() from structure_guard;
drop policy plan_cycle_departments_structure_guard_read on tms.plan_cycle_departments;
drop policy plan_cycles_structure_guard_read on tms.plan_cycles;
revoke select on tms.plan_cycle_departments from structure_guard;
revoke select on tms.plan_cycles from structure_guard;
revoke usage on schema private, tms from structure_guard;
