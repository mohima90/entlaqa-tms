-- Rollback of 20261113110000_tms__course_names_in_either_language.sql: both titles and both category names
-- are required again. Rows saved with one only get it in the other language's slot first (what readers showed
-- anyway), so NOT NULL can be set back. A category whose only name is already another category's name in the
-- other language stops the rollback (unique index): rename one of the two first.
set local lock_timeout = '5s';

alter table tms.courses drop constraint if exists courses_title_present_check;
-- The guard of a course asks for a member who manages the library; the rollback is a platform operation.
alter table tms.courses disable trigger user;
update tms.courses set title_ar = coalesce(title_ar, title_en), title_en = coalesce(title_en, title_ar)
where title_ar is null or title_en is null;
alter table tms.courses enable trigger user;
alter table tms.courses alter column title_ar set not null;
alter table tms.courses alter column title_en set not null;

alter table tms.course_categories drop constraint if exists course_categories_name_present_check;
alter table tms.course_categories disable trigger user;
update tms.course_categories set name_ar = coalesce(name_ar, name_en), name_en = coalesce(name_en, name_ar)
where name_ar is null or name_en is null;
alter table tms.course_categories enable trigger user;
alter table tms.course_categories alter column name_ar set not null;
alter table tms.course_categories alter column name_en set not null;
