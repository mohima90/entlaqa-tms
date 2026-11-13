-- A needs form is named in the organization's default language; the other language is optional (WP-UX-01 c,
-- T-M3-21; FR-PLN-03; forms standard rule 9 — PO, 12 Nov 2026). The rule of the planning cycle
-- (20261112100100), applied to tms.needs_forms. Sections, fields and options of a form keep both languages:
-- the builder and its inspectors are unchanged.
--
-- Expand only (migration conventions §6): the two name columns lose NOT NULL, and a new check keeps every form
-- named in at least one language. Every existing form has both names; the check is added NOT VALID and
-- validated by the follow-up migration 20261113110300. The existing checks on each name (trimmed, 1–120
-- characters) pass for NULL, so a GIVEN name is still checked; the unique indexes (lower(name_en),
-- lower(name_ar)) never compare NULLs, so a given name is still unique in its language.
--
-- Which language is required is the application's rule (modules/tms needs-forms); the database only refuses a
-- form without any name. private.seed_needs_form and private.duplicate_needs_form store the names they are
-- given, NULL included (neither is STRICT). Code of the previous release keeps working: it always writes
-- both. Readers show the other language when one is missing (`localized`). PII: none.
set local lock_timeout = '5s';

alter table tms.needs_forms alter column name_ar drop not null;
alter table tms.needs_forms alter column name_en drop not null;
alter table tms.needs_forms
  add constraint needs_forms_name_present_check check (name_ar is not null or name_en is not null) not valid;
comment on constraint needs_forms_name_present_check on tms.needs_forms is
  'A needs form has a name in at least one language; the required one follows the organization''s default language (application rule). FR-PLN-03; PO 12 Nov 2026.';
