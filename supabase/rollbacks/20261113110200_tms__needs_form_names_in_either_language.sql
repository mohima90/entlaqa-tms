-- Rollback of 20261113110200_tms__needs_form_names_in_either_language.sql: both names are required again.
-- Forms saved with one name only get it in the other language's slot first (what readers showed anyway), so
-- NOT NULL can be set back. A form whose only name is already another form's name in the other language
-- stops the rollback (unique index): rename one of the two first.
set local lock_timeout = '5s';

alter table tms.needs_forms drop constraint if exists needs_forms_name_present_check;
-- The guard of a form asks for a member who manages needs forms; the rollback is a platform operation.
alter table tms.needs_forms disable trigger user;
update tms.needs_forms set name_ar = coalesce(name_ar, name_en), name_en = coalesce(name_en, name_ar)
where name_ar is null or name_en is null;
alter table tms.needs_forms enable trigger user;
alter table tms.needs_forms alter column name_ar set not null;
alter table tms.needs_forms alter column name_en set not null;
