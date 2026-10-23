-- Rollback of 20261025100300_platform__create_person_photos.sql.
-- Files of profile photos already uploaded stay records of purpose platform.profile_photo; their copies go
-- with the table.
drop function private.person_photo_content(uuid);
drop function private.remove_profile_photo();
drop function private.publish_profile_photo(uuid, text, bigint, text, bytea);
drop table platform.person_photos;
update platform.file_purposes set scan_required = true, max_bytes = 10485760
where purpose = 'platform.profile_photo';

-- The housekeeping rule as it was (20261023100600).
create or replace function private.file_housekeeping_action(f platform.files)
returns text
language sql stable
set search_path = ''
as $$
  select case
    when f.purged_at is not null or (f.status = 'scanning' and f.scan_leased_until > now()) then null
    when f.status = 'infected' and f.bucket <> 'quarantine' and f.object_removed_at is null then 'quarantine'
    when f.legal_hold then null
    when (f.status = 'infected' and f.scanned_at < now() - interval '30 days')
         or (f.status in ('rejected', 'error') and f.created_at < now() - interval '30 days')
         or (f.status = 'pending_upload' and f.created_at < now() - interval '24 hours')
         or (f.status not in ('infected', 'rejected', 'error', 'pending_upload') and (
               (f.retention_class = 'import' and (f.status = 'deleted'
                  or (f.used_at is not null and f.used_at < now() - interval '7 days')
                  or (f.used_at is null and f.created_at < now() - interval '24 hours')))
               or (f.retention_class = 'export' and (f.status = 'deleted' or f.created_at < now() - interval '24 hours'))
               or (f.retention_class = 'owner_lifetime' and f.status = 'deleted'
                   and f.deleted_at < now() - interval '30 days'))) then 'purge'
    when f.status in ('uploaded', 'accepted', 'deleted') and f.object_removed_at is null
         and exists (select 1 from platform.file_purposes p
                     where p.purpose = f.purpose and not p.scan_required and p.upload_by = 'user') then
      case
        when f.status = 'uploaded' and f.uploaded_at < now() - interval '24 hours'
             and not exists (select 1 from platform.tenant_branding b
                             where b.tenant_id = f.tenant_id
                               and f.id in (b.logo_file_id, b.favicon_file_id, b.sign_in_image_file_id))
          then 'purge'
        when f.status = 'uploaded' and f.uploaded_at < now() - interval '24 hours' then 'remove_object'
        when f.status = 'accepted'
             and exists (select 1 from platform.brand_assets a where a.tenant_id = f.tenant_id and a.file_id = f.id)
          then 'remove_object'
        when f.status = 'deleted' then 'remove_object'
      end
    when f.status = 'rejected' and f.object_removed_at is null then 'remove_object'
  end
$$;
revoke all on function private.file_housekeeping_action(platform.files) from public;
