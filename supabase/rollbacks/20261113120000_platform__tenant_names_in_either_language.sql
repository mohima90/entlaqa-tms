-- Rollback of 20261113120000_platform__tenant_names_in_either_language.sql: the Arabic name is required
-- again. An organization saved with an English name only gets it in the Arabic slot first (what readers
-- showed anyway), so NOT NULL can be set back.
set local lock_timeout = '5s';

alter table platform.tenants drop constraint if exists tenants_name_present_check;
update platform.tenants set name_ar = name_en where name_ar is null;
alter table platform.tenants alter column name_ar set not null;
