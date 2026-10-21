-- Rollback of 20261023100400_platform__add_file_purposes_scan_required.sql.
alter table platform.file_purposes drop constraint if exists file_purposes_scan_required_check;
alter table platform.file_purposes drop column if exists scan_required;
