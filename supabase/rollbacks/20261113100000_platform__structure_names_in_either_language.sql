-- Rollback of 20261113100000_platform__structure_names_in_either_language.sql: the Arabic name of a unit and of
-- a branch, and both names of a level, are required again. Rows saved with one name only get it in the other
-- language's slot first (what readers showed anyway), so NOT NULL can be set back. The guards of these tables
-- (structure writers, level rules, stamps) are for members' writes; the rollback is a platform operation.
-- A level whose only name equals another level's name in the other language would collide on the unique index
-- of that language: rename it first.
--
-- What the backfill does, and what it needs:
--   * It COPIES the one name a row has into the empty slot (departments, branches: name_ar from name_en;
--     levels: either way). The copy is data, not a translation: after the rollback such a row shows the same
--     text in both languages until someone renames it. Rows are not marked — count them BEFORE running this
--     file if they must be found again (select … where name_ar is null / name_en is null).
--   * It runs with the tables' user triggers OFF (`disable trigger user` … `enable trigger user`, inside this
--     transaction): the write guards (…_guard_writer, structure_levels_guard, the tree and soft-delete
--     rules) and the row stamps (…_stamp_row) do not fire, so the copy is not stamped as anybody's change and
--     no application audit event is written for it — this header and the operator's log are its record. A
--     failure anywhere rolls the whole transaction back, the triggers' state included.
--   * `alter table … disable trigger user` needs the tables' OWNER: run the file as the migration role
--     (hosted: `postgres`; deliberately and by hand — docs/engineering/db-deploy.md), never as app_server or
--     app_worker, which are refused by design.
--   * Order: roll the APPLICATION back first (or restart it right after). A running process has cached «one
--     name is allowed» and would send NULL names the database now refuses (see the migration's header).
set local lock_timeout = '5s';

alter table platform.departments drop constraint if exists departments_name_present_check;
alter table platform.departments disable trigger user;
update platform.departments set name_ar = name_en where name_ar is null;
alter table platform.departments enable trigger user;
alter table platform.departments alter column name_ar set not null;

alter table platform.branches drop constraint if exists branches_name_present_check;
alter table platform.branches disable trigger user;
update platform.branches set name_ar = name_en where name_ar is null;
alter table platform.branches enable trigger user;
alter table platform.branches alter column name_ar set not null;

alter table platform.structure_levels drop constraint if exists structure_levels_name_present_check;
alter table platform.structure_levels disable trigger user;
update platform.structure_levels set name_ar = coalesce(name_ar, name_en), name_en = coalesce(name_en, name_ar)
where name_ar is null or name_en is null;
alter table platform.structure_levels enable trigger user;
alter table platform.structure_levels alter column name_ar set not null;
alter table platform.structure_levels alter column name_en set not null;
