-- Rollback of 20261005090000_platform__add_persons_profile.sql.
drop trigger persons_deactivation on platform.persons;
drop function private.stamp_person_status();
drop trigger persons_stamp_row on platform.persons;
create trigger persons_set_updated_at before update on platform.persons
  for each row execute function private.set_updated_at();
alter table platform.persons
  drop constraint persons_person_type_check,
  drop constraint persons_display_name_ar_visible_check,
  drop constraint persons_display_name_en_check,
  drop constraint persons_name_parts_check,
  drop constraint persons_mobile_e164_check,
  drop constraint persons_preferred_locale_check,
  drop constraint persons_nationality_code_check,
  drop column person_type,
  drop column first_name_ar,
  drop column father_name_ar,
  drop column grandfather_name_ar,
  drop column family_name_ar,
  drop column first_name_en,
  drop column father_name_en,
  drop column grandfather_name_en,
  drop column family_name_en,
  drop column mobile_e164,
  drop column preferred_locale,
  drop column nationality_code,
  drop column is_national,
  drop column deactivated_at,
  drop column created_by,
  drop column updated_by,
  drop column version;
