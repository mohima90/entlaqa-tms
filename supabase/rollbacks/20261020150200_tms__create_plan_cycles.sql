-- Rollback of 20261020150200_tms__create_plan_cycles.sql.
drop table tms.plan_cycle_steps;
drop table tms.plan_cycle_departments;
drop table tms.plan_cycle_scope;
drop table tms.plan_cycles;
drop function private.plan_cycle_child_guard();
drop function private.plan_cycles_guard();
drop function private.plan_cycle_today(uuid);
