-- Rollback of 20261020210300_tms__plan_cycle_reads_need_permission.sql: every member reads again
-- (20261020150100 / 20261020150200).
drop policy planning_default_steps_read on tms.planning_default_steps;
create policy planning_default_steps_read on tms.planning_default_steps for select to authenticated using (true);

drop policy planning_settings_read on tms.planning_settings;
create policy planning_settings_read on tms.planning_settings for select to authenticated using (true);

drop policy plan_cycle_steps_read on tms.plan_cycle_steps;
create policy plan_cycle_steps_read on tms.plan_cycle_steps for select to authenticated using (true);

drop policy plan_cycle_departments_read on tms.plan_cycle_departments;
create policy plan_cycle_departments_read on tms.plan_cycle_departments for select to authenticated using (true);

drop policy plan_cycle_scope_read on tms.plan_cycle_scope;
create policy plan_cycle_scope_read on tms.plan_cycle_scope for select to authenticated using (true);

drop policy plan_cycles_read on tms.plan_cycles;
create policy plan_cycles_read on tms.plan_cycles for select to authenticated using (true);

drop function private.may_read_plan_cycles(uuid);
