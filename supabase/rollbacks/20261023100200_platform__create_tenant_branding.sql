-- Rollback of 20261023100200_platform__create_tenant_branding.sql.
drop table platform.tenant_branding;
drop function private.tenant_branding_files();
drop function private.release_branding_file(uuid, uuid);
drop function private.branding_file_usable(uuid, uuid, text);
drop function private.stamp_tenant_branding();
