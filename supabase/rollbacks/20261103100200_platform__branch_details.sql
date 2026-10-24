-- Rollback of 20261103100200_platform__branch_details.sql.

drop table platform.branch_working_days;
alter table platform.branches
  drop constraint branches_location_check,
  drop constraint branches_address_check,
  drop column longitude,
  drop column latitude,
  drop column address_ar,
  drop column address_en;
