-- Rollback of 20261116100100_tms__planning_settings_finance_step.sql: the switch goes (with its value).

revoke insert (finance_confirms) on tms.planning_settings from authenticated;
revoke update (finance_confirms) on tms.planning_settings from authenticated;
alter table tms.planning_settings drop column finance_confirms;
