-- A course and a course category are named in the organization's default language; the other language is
-- optional (WP-UX-01 c, T-M3-21; FR-CAT-01; forms standard rule 9 — PO, 12 Nov 2026: «the name in the
-- organization's default language is required; the other language is optional»). The rule of the planning
-- cycle (20261112100100), applied to tms.courses (titles) and tms.course_categories (names).
--
-- Expand only (migration conventions §6): the two columns of each table lose NOT NULL, and a new check keeps
-- every row named in at least one language. Every existing row has both, so all of them satisfy the check; it
-- is added NOT VALID (no scan under ACCESS EXCLUSIVE) and validated by the follow-up migration
-- 20261113110100. The existing checks on each text (trimmed, length, private.has_visible_text) pass for NULL,
-- so a GIVEN title or name must still be visible text within its length. The unique indexes on the category
-- names (lower(name_en), lower(name_ar)) never compare NULLs, so a given name is still unique in its language.
--
-- Which language is required is the application's rule (the organization's default language, General
-- settings — modules/tms courses); the database only refuses a row without any title or name. Code of the
-- previous release keeps working: it always writes both. Readers show the other language when one is missing
-- (apps/suite courses page, the needs page's course picker). The guard of a course compares the titles with
-- IS DISTINCT FROM (20261020210400), so NULL is compared like any value. PII: none.
set local lock_timeout = '5s';
-- Both tables are locked in one statement, in the order the application writes them (a new category, then
-- the course that uses it — modules/tms courses service), so a course saved meanwhile cannot deadlock with
-- this migration.
lock table tms.course_categories, tms.courses in access exclusive mode;

alter table tms.course_categories alter column name_ar drop not null;
alter table tms.course_categories alter column name_en drop not null;
alter table tms.course_categories
  add constraint course_categories_name_present_check check (name_ar is not null or name_en is not null) not valid;
comment on constraint course_categories_name_present_check on tms.course_categories is
  'A course category has a name in at least one language. FR-CAT-01; PO 12 Nov 2026.';

alter table tms.courses alter column title_ar drop not null;
alter table tms.courses alter column title_en drop not null;
alter table tms.courses
  add constraint courses_title_present_check check (title_ar is not null or title_en is not null) not valid;
comment on constraint courses_title_present_check on tms.courses is
  'A course has a title in at least one language; the required one follows the organization''s default language (application rule). FR-CAT-01; PO 12 Nov 2026.';
