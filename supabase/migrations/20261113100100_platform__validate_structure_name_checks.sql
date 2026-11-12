-- Validates the «a name in at least one language» checks added NOT VALID by
-- 20261113100000_platform__structure_names_in_either_language.sql against the rows that existed before them
-- (migration conventions §6.1). VALIDATE CONSTRAINT takes only a SHARE UPDATE EXCLUSIVE lock, so reads and
-- writes continue while existing rows are scanned. Every row written before 20261113100000 had its Arabic name
-- (NOT NULL), so the scans cannot fail.
set local lock_timeout = '5s';

alter table platform.departments validate constraint departments_name_present_check;
alter table platform.branches validate constraint branches_name_present_check;
alter table platform.structure_levels validate constraint structure_levels_name_present_check;
