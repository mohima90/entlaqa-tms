-- Validates the «a name in at least one language» check added NOT VALID by
-- 20261113120000_platform__tenant_names_in_either_language.sql against the organizations that existed before
-- it (migration conventions §6.1). VALIDATE CONSTRAINT takes only a SHARE UPDATE EXCLUSIVE lock, so reads and
-- writes continue while existing rows are scanned. Every organization created before 20261113120000 has an
-- Arabic name (NOT NULL), so the scan cannot fail.
set local lock_timeout = '5s';

alter table platform.tenants validate constraint tenants_name_present_check;
