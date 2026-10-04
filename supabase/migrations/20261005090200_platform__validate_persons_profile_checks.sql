-- Validates the checks added NOT VALID by 20261005090000_platform__add_persons_profile.sql against the
-- rows that existed before it (migration conventions §6.1). VALIDATE CONSTRAINT takes only a SHARE
-- UPDATE EXCLUSIVE lock, so reads and writes continue while existing rows are scanned. If it fails, a
-- row written before T-M2-02 breaks a rule (e.g. an empty English display name): fix that row with a
-- reviewed data migration first.
set local lock_timeout = '5s';

alter table platform.persons validate constraint persons_person_type_check;
alter table platform.persons validate constraint persons_display_name_ar_visible_check;
alter table platform.persons validate constraint persons_display_name_en_check;
alter table platform.persons validate constraint persons_name_parts_check;
alter table platform.persons validate constraint persons_mobile_e164_check;
alter table platform.persons validate constraint persons_preferred_locale_check;
alter table platform.persons validate constraint persons_nationality_code_check;
