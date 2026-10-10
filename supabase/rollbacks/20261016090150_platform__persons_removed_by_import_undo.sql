-- Rollback of 20261016090150_platform__persons_removed_by_import_undo.sql. Run the rollback of
-- 20261016090200 first. Removed people become ordinary inactive records again; if a later invitation or
-- import reused a removed person's e-mail or employee number, restoring the plain unique indexes fails —
-- resolve those duplicates first (keep the newer record).
drop trigger persons_removal_guard on platform.persons;
drop function private.check_person_removal();
drop policy persons_not_removed on platform.persons;

drop index platform.persons_tenant_employee_number_uq;
create unique index persons_tenant_employee_number_uq on platform.persons (tenant_id, employee_number)
  where employee_number is not null;
drop index platform.persons_tenant_email_uq;
create unique index persons_tenant_email_uq on platform.persons (tenant_id, email) where email is not null;

alter table platform.persons
  drop constraint persons_removed_check,
  drop constraint persons_removed_by_import_fk,
  drop column removed_by_import_id,
  drop column removed_at;
