-- Rollback of 20261020150100_tms__create_planning_settings.sql.
drop table tms.planning_default_steps;
drop table tms.planning_settings;
drop function private.may_manage_plan_cycles(uuid);
drop function private.plan_reminder_days_valid(smallint[]);
