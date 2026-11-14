-- Validates the «a name in at least one language» check added NOT VALID by
-- 20261113110400_platform__custom_role_names_in_either_language.sql against the roles that existed before it
-- (migration conventions §6.1): SHARE UPDATE EXCLUSIVE only, reads and writes continue. Every role written
-- before 20261113110400 had both names (NOT NULL), so the scan cannot fail.
set local lock_timeout = '5s';

alter table platform.custom_roles validate constraint custom_roles_name_present_check;
