-- Rollback of 20261112100100_tms__plan_cycle_names_in_either_language.sql: both names are required again.
-- Rows saved with one name only get it in the other language's slot first (what readers showed anyway), so
-- NOT NULL can be set back.
set local lock_timeout = '5s';

alter table tms.plan_cycles drop constraint if exists plan_cycles_name_present_check;
-- The guard of an open or closed cycle refuses a change of its names; the rollback is a platform operation.
alter table tms.plan_cycles disable trigger user;
update tms.plan_cycles set name_ar = coalesce(name_ar, name_en), name_en = coalesce(name_en, name_ar)
where name_ar is null or name_en is null;
alter table tms.plan_cycles enable trigger user;
alter table tms.plan_cycles alter column name_ar set not null;
alter table tms.plan_cycles alter column name_en set not null;

alter table tms.plan_cycle_steps drop constraint if exists plan_cycle_steps_name_present_check;
alter table tms.plan_cycle_steps disable trigger user;
update tms.plan_cycle_steps set name_ar = coalesce(name_ar, name_en), name_en = coalesce(name_en, name_ar)
where name_ar is null or name_en is null;
alter table tms.plan_cycle_steps enable trigger user;
alter table tms.plan_cycle_steps alter column name_ar set not null;
alter table tms.plan_cycle_steps alter column name_en set not null;

alter table tms.planning_default_steps drop constraint if exists planning_default_steps_name_present_check;
alter table tms.planning_default_steps disable trigger user;
update tms.planning_default_steps set name_ar = coalesce(name_ar, name_en), name_en = coalesce(name_en, name_ar)
where name_ar is null or name_en is null;
alter table tms.planning_default_steps enable trigger user;
alter table tms.planning_default_steps alter column name_ar set not null;
alter table tms.planning_default_steps alter column name_en set not null;
