-- A planning cycle and its approval steps are named in the organization's default language; the other language
-- is optional (WP-FIX-03, T-M3-18; FR-PLN-02; PO 12 Nov 2026 — test feedback #3: «creating a cycle requires
-- Arabic names and it is mandatory — I didn't like it»). The rule the PO approved for people on 17 Oct 2026
-- (20261021090000), applied to tms.plan_cycles, tms.plan_cycle_steps and tms.planning_default_steps.
--
-- Expand only (migration conventions §6): the two name columns of each table lose NOT NULL, and a new check
-- keeps every row named in at least one language. Every existing row has both names, so all of them satisfy
-- the check; it is added NOT VALID (no scan under ACCESS EXCLUSIVE) and validated by the follow-up migration
-- 20261112100200. The existing checks on each name (trimmed, length, private.has_visible_text) pass for NULL,
-- so a GIVEN name must still be visible text within its length.
--
-- Which language is required is the application's rule (the organization's default language, General
-- settings — modules/tms planning definitions); the database only refuses a row without any name.
-- Code of the previous release keeps working: it always writes both names. Readers show the other language
-- when one is missing (modules/tms planning repository; apps/suite lib/planning-view localName).
-- The guard of an open cycle compares the names with IS DISTINCT FROM (20261105100100), so NULL is compared
-- like any value. PII: none.
set local lock_timeout = '5s';

alter table tms.plan_cycles alter column name_ar drop not null;
alter table tms.plan_cycles alter column name_en drop not null;
alter table tms.plan_cycles
  add constraint plan_cycles_name_present_check check (name_ar is not null or name_en is not null) not valid;
comment on constraint plan_cycles_name_present_check on tms.plan_cycles is
  'A planning cycle has a name in at least one language; the required one follows the organization''s default language (application rule). FR-PLN-02; PO 12 Nov 2026.';

alter table tms.plan_cycle_steps alter column name_ar drop not null;
alter table tms.plan_cycle_steps alter column name_en drop not null;
alter table tms.plan_cycle_steps
  add constraint plan_cycle_steps_name_present_check check (name_ar is not null or name_en is not null) not valid;
comment on constraint plan_cycle_steps_name_present_check on tms.plan_cycle_steps is
  'An approval step has a name in at least one language. FR-PLN-02; PO 12 Nov 2026.';

alter table tms.planning_default_steps alter column name_ar drop not null;
alter table tms.planning_default_steps alter column name_en drop not null;
alter table tms.planning_default_steps
  add constraint planning_default_steps_name_present_check check (name_ar is not null or name_en is not null) not valid;
comment on constraint planning_default_steps_name_present_check on tms.planning_default_steps is
  'A default approval step has a name in at least one language. FR-PLN-02; PO 12 Nov 2026.';
