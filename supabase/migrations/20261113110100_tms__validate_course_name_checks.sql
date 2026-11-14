-- Validates the «a title / a name in at least one language» checks added NOT VALID by
-- 20261113110000_tms__course_names_in_either_language.sql against the rows that existed before them
-- (migration conventions §6.1). VALIDATE CONSTRAINT takes only a SHARE UPDATE EXCLUSIVE lock, so reads and
-- writes continue while existing rows are scanned. Every row written before 20261113110000 had both texts
-- (NOT NULL), so the scans cannot fail.
set local lock_timeout = '5s';

alter table tms.courses validate constraint courses_title_present_check;
alter table tms.course_categories validate constraint course_categories_name_present_check;
