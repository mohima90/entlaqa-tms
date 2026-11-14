-- A custom role is named in the organization's default language; the other language is optional (WP-UX-01 c,
-- T-M3-21; FR-IAM-07; forms standard rule 9 — PO, 12 Nov 2026). The rule of the planning cycle
-- (20261112100100), applied to platform.custom_roles. The standard (built-in) roles are code, not rows: they
-- keep both names.
--
-- Expand only (migration conventions §6): the two name columns lose NOT NULL, and a new check keeps every role
-- named in at least one language. Every existing role has both names; the check is added NOT VALID and
-- validated by the follow-up migration 20261113110500. The existing checks on each name (trimmed, 1–80
-- characters) pass for NULL, so a GIVEN name is still checked; the unique indexes (lower(name_en),
-- lower(name_ar)) never compare NULLs, so a given name is still unique in its language.
--
-- Which language is required is the application's rule (platform-rbac custom roles); the database only
-- refuses a role without any name. No guard, grant or policy changes: who builds roles is decided as before
-- (private.check_custom_role). Code of the previous release keeps working: it always writes both names.
-- Readers show the other language when one is missing (role lists and choices, invitation e-mails). PII: none.
set local lock_timeout = '5s';

alter table platform.custom_roles alter column name_ar drop not null;
alter table platform.custom_roles alter column name_en drop not null;
alter table platform.custom_roles
  add constraint custom_roles_name_present_check check (name_ar is not null or name_en is not null) not valid;
comment on constraint custom_roles_name_present_check on platform.custom_roles is
  'A custom role has a name in at least one language; the required one follows the organization''s default language (application rule). FR-IAM-07; PO 12 Nov 2026.';
