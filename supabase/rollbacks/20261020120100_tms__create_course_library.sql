-- Rollback of 20261020120100_tms__create_course_library.sql. The course library is dropped with its data
-- (development only; never run in production — migration-conventions.md §6).
drop table tms.courses;
drop table tms.course_categories;

drop function tms.guard_course();
drop function tms.guard_course_category();
drop function tms.course_library_actor(uuid, text, text);
