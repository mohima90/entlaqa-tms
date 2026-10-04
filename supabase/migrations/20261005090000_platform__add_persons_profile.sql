-- Person profile fields (FR-IAM-01 R1 subset, T-M2-02) and [std] columns on platform.persons.
-- Expand-only (migration conventions §6): new nullable columns or columns with constant defaults.
-- Name parts follow the four-part Arabic name (design principles §4); display names stay required for
-- Arabic and are composed by the application from the parts. Photo, custom fields and the search
-- column (Arabic normalisation, trigram index) arrive with the users list (T-M2-04) and ADM-11.
-- PII: names, e-mail (existing), mobile_e164, nationality_code — personal data (data model §1.12).
set lock_timeout = '5s';

alter table platform.persons
  add column person_type text not null default 'employee',
  add column first_name_ar text,
  add column father_name_ar text,
  add column grandfather_name_ar text,
  add column family_name_ar text,
  add column first_name_en text,
  add column father_name_en text,
  add column grandfather_name_en text,
  add column family_name_en text,
  add column mobile_e164 text,
  add column preferred_locale text not null default 'ar',
  add column nationality_code char(2),
  add column is_national boolean,
  add column deactivated_at timestamptz,
  -- [std] (created_at / updated_at exist)
  add column created_by uuid,
  add column updated_by uuid,
  add column version integer not null default 1,
  add constraint persons_person_type_check
    check (person_type in ('employee', 'contractor', 'external_instructor', 'provider_staff')),
  add constraint persons_display_name_ar_visible_check check (private.has_visible_text(display_name_ar)),
  add constraint persons_display_name_en_check
    check (display_name_en is null or (char_length(display_name_en) <= 200 and private.has_visible_text(display_name_en))),
  add constraint persons_name_parts_check check (
    (first_name_ar is null or (char_length(first_name_ar) <= 60 and private.has_visible_text(first_name_ar)))
    and (father_name_ar is null or (char_length(father_name_ar) <= 60 and private.has_visible_text(father_name_ar)))
    and (grandfather_name_ar is null or (char_length(grandfather_name_ar) <= 60 and private.has_visible_text(grandfather_name_ar)))
    and (family_name_ar is null or (char_length(family_name_ar) <= 60 and private.has_visible_text(family_name_ar)))
    and (first_name_en is null or (char_length(first_name_en) <= 60 and private.has_visible_text(first_name_en)))
    and (father_name_en is null or (char_length(father_name_en) <= 60 and private.has_visible_text(father_name_en)))
    and (grandfather_name_en is null or (char_length(grandfather_name_en) <= 60 and private.has_visible_text(grandfather_name_en)))
    and (family_name_en is null or (char_length(family_name_en) <= 60 and private.has_visible_text(family_name_en)))),
  add constraint persons_mobile_e164_check check (mobile_e164 is null or mobile_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  add constraint persons_preferred_locale_check check (preferred_locale in ('ar', 'en')),
  add constraint persons_nationality_code_check check (nationality_code is null or nationality_code ~ '^[A-Z]{2}$');

-- [std] maintenance moves from private.set_updated_at() to private.stamp_row() (actors from claims,
-- version, immutable id). deactivated_at is stamped from the clock when status changes.
drop trigger persons_set_updated_at on platform.persons;
create trigger persons_stamp_row before insert or update on platform.persons
  for each row execute function private.stamp_row();

create or replace function private.stamp_person_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'inactive' then
    new.deactivated_at := case
      when tg_op = 'UPDATE' and old.status = 'inactive' then old.deactivated_at
      else now()
    end;
  else
    new.deactivated_at := null;
  end if;
  return new;
end
$$;

comment on function private.stamp_person_status() is
  'Sets platform.persons.deactivated_at from the clock when a person becomes inactive; clears it on reactivation.';

revoke all on function private.stamp_person_status() from public;

-- Callers only change `status`; deactivated_at always follows it (values sent by callers are replaced).
create trigger persons_deactivation before insert or update of status, deactivated_at on platform.persons
  for each row execute function private.stamp_person_status();

comment on column platform.persons.mobile_e164 is 'PII. Mobile number in E.164 (+9665…), FR-IAM-01.';
comment on column platform.persons.nationality_code is 'PII. ISO 3166-1 alpha-2, FR-IAM-01 (nationalisation reporting).';
