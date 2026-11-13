-- Rollback of 20261113110400_platform__custom_role_names_in_either_language.sql: both names are required
-- again. Roles saved with one name only get it in the other language's slot first (what readers showed
-- anyway), so NOT NULL can be set back. A role whose only name is already another role's name in the other
-- language stops the rollback (unique index): rename one of the two first.
set local lock_timeout = '5s';

alter table platform.custom_roles drop constraint if exists custom_roles_name_present_check;
-- The guard of a role asks for the Organization Admin; the rollback is a platform operation.
alter table platform.custom_roles disable trigger user;
update platform.custom_roles set name_ar = coalesce(name_ar, name_en), name_en = coalesce(name_en, name_ar)
where name_ar is null or name_en is null;
alter table platform.custom_roles enable trigger user;
alter table platform.custom_roles alter column name_ar set not null;
alter table platform.custom_roles alter column name_en set not null;
