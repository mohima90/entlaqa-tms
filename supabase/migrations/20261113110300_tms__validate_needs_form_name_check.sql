-- Validates the «a name in at least one language» check added NOT VALID by
-- 20261113110200_tms__needs_form_names_in_either_language.sql against the forms that existed before it
-- (migration conventions §6.1): SHARE UPDATE EXCLUSIVE only, reads and writes continue. Every form written
-- before 20261113110200 had both names (NOT NULL), so the scan cannot fail.
set local lock_timeout = '5s';

alter table tms.needs_forms validate constraint needs_forms_name_present_check;
