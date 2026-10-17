-- Rollback of 20261021090000_platform__allow_english_only_person_names.sql: the Arabic display name is
-- required again. People saved with an English name only get their English display name in the Arabic slot
-- first (as the Super Admin console did before, 20261018100000), so NOT NULL can be set back.
set local lock_timeout = '5s';

alter table platform.persons drop constraint if exists persons_name_present_check;
update platform.persons set display_name_ar = display_name_en where display_name_ar is null;
alter table platform.persons alter column display_name_ar set not null;
