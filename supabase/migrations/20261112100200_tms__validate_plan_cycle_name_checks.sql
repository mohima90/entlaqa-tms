-- Validates the «a name in at least one language» checks added NOT VALID by
-- 20261112100100_tms__plan_cycle_names_in_either_language.sql against the rows that existed before them
-- (migration conventions §6.1). VALIDATE CONSTRAINT takes only a SHARE UPDATE EXCLUSIVE lock, so reads and
-- writes continue while existing rows are scanned. Every row written before 20261112100100 had both names
-- (NOT NULL), so the scans cannot fail.
set local lock_timeout = '5s';

alter table tms.plan_cycles validate constraint plan_cycles_name_present_check;
alter table tms.plan_cycle_steps validate constraint plan_cycle_steps_name_present_check;
alter table tms.planning_default_steps validate constraint planning_default_steps_name_present_check;
