-- Validates persons_name_present_check (added NOT VALID by 20261021090000_platform__allow_english_only_person_names.sql)
-- against the rows that existed before it (migration conventions §6.1). VALIDATE CONSTRAINT takes only a
-- SHARE UPDATE EXCLUSIVE lock, so reads and writes continue while existing rows are scanned. Every row
-- written before 20261021090000 had an Arabic display name (NOT NULL), so the scan cannot fail.
set local lock_timeout = '5s';

alter table platform.persons validate constraint persons_name_present_check;
