-- Units of the structure, branches and structure levels are named in the organization's default language; the
-- other language is optional (WP-UX-01 b, T-M3-21; FR-ADM-04, FR-ADM-05; PO 12 Nov 2026 — the Kawadir popup
-- pattern, docs/design/forms-standard.md rule 9: «the name in the organization's default language is required,
-- the other language optional»). The rule the PO approved for people on 17 Oct 2026 (20261021090000) and for
-- planning cycles on 12 Nov 2026 (20261112100100), applied to platform.departments, platform.branches and
-- platform.structure_levels.
--
-- Expand only (migration conventions §6): platform.departments.name_ar and platform.branches.name_ar lose
-- NOT NULL (their name_en was optional already), both names of platform.structure_levels lose it, and a new
-- check keeps every row named in at least one language. Every existing row has its Arabic name (levels: both
-- names), so all of them satisfy the check; it is added NOT VALID (no scan under ACCESS EXCLUSIVE) and validated
-- by the follow-up migration 20261113100100. The existing checks on each name (length, trimmed for levels,
-- private.has_visible_text — a STRICT function) pass for NULL, so a GIVEN name must still be visible text within
-- its length. The unique indexes of the level names (tenant, lower(name)) ignore NULLs: two levels without an
-- Arabic name do not collide.
--
-- Which language is required is the application's rule (the organization's default language, General settings —
-- packages/platform-rbac iam/structure.ts and iam/branches.ts); the database only refuses a row without any
-- name. Code of the previous release keeps working: it always writes both names. Readers show the other
-- language when one is missing (apps/suite lib/users-view localizedName; private.user_import_changes since
-- 20261113100200). The bulk user import matches a unit or a branch by code, else by either name
-- (private.search_key is STRICT: a missing name matches nothing). PII: none.
--
-- The deploy window (the app and the database deploy in parallel). New code that runs before this migration
-- finds name_ar still NOT NULL (a catalog lookup, packages/platform-db custom-roles-present.ts
-- oneNameStructureExists) and stores the one name that was given in the empty slot too. Such a row keeps that
-- copy afterwards: nothing tells it apart from a name typed twice, so no migration clears it — the person
-- sees the same name in both languages and can change either one. Known and accepted (minutes, once).
--
-- Rolling back. The lookup's answer «one name is allowed» is cached for the life of each app process (it only
-- ever goes from false to true). After the rollback of this migration a running process would still try to
-- save one name and the database would refuse it (NOT NULL): roll the application back FIRST (or restart it
-- right after the database rollback), then run supabase/rollbacks/20261113100000_….sql.
set local lock_timeout = '5s';

alter table platform.departments alter column name_ar drop not null;
alter table platform.departments
  add constraint departments_name_present_check check (name_ar is not null or name_en is not null) not valid;
comment on constraint departments_name_present_check on platform.departments is
  'A unit of the structure has a name in at least one language; the required one follows the organization''s default language (application rule). FR-ADM-05; PO 12 Nov 2026.';

alter table platform.branches alter column name_ar drop not null;
alter table platform.branches
  add constraint branches_name_present_check check (name_ar is not null or name_en is not null) not valid;
comment on constraint branches_name_present_check on platform.branches is
  'A branch has a name in at least one language; the required one follows the organization''s default language (application rule). FR-ADM-04; PO 12 Nov 2026.';

alter table platform.structure_levels alter column name_en drop not null;
alter table platform.structure_levels alter column name_ar drop not null;
alter table platform.structure_levels
  add constraint structure_levels_name_present_check check (name_ar is not null or name_en is not null) not valid;
comment on constraint structure_levels_name_present_check on platform.structure_levels is
  'A level of the structure has a name in at least one language; the required one follows the organization''s default language (application rule). FR-ADM-05; PO 12 Nov 2026.';
