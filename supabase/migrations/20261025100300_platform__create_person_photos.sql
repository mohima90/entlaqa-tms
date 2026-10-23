-- Profile photos (WP-ADM-04, FR-IAM-16, FR-IAM-01; business flow docs/business-flows/EP-PEOPLE-photo-hr-fields.md
-- BR-PPL-a..d, PO answers 21 Oct 2026 #6-#8 and 23 Oct 2026 #1). ADR 0002 §6 pattern. Class: T. PII: a
-- person's photo is personal data (biometric-adjacent) — classified pii:direct; never in logs or audit events
-- (only the file name is audited).
--
-- Same path as the branding images (20261023100000-100600), with two differences: the copy is shown only to
-- SIGNED-IN members of the same organization (an authenticated same-origin route, never a public link), and
-- only the person themself adds, replaces or removes it (BR-PPL-a; PO answer 8 and 23 Oct #1: nobody does it
-- for someone else).
--
--   platform.file_purposes           platform.profile_photo: scan_required = false (PO answer 6: profile photos
--                                    are NOT virus-scanned, like branding images; checked by content, size and
--                                    pixels and stripped of metadata before anything is shown) and at most 2 MB
--                                    (PO answer 7; it was 10 MB while nothing used it).
--   platform.person_photos           the published copy of a person's photo (one row per person): the file
--                                    WITHOUT its metadata (EXIF/GPS, XMP, comments), kept in PostgreSQL so it
--                                    serves self-hosted and hosted alike (no vendor feature). Members read the
--                                    facts (type, size, SHA-256: the cache key); the bytes only through
--                                    private.person_photo_content. Written by file_guard's functions only.
--
-- Functions (owned by file_guard, SECURITY DEFINER, no BYPASSRLS; each checks the LOGIN role and the claims):
--   publish_profile_photo(file, source sha256, source size, type, bytes)
--        the web app, USER claims: the caller's OWN upload (purpose platform.profile_photo, owner entity
--        platform/person/<caller's person>, `uploaded`, within 24 hours or already `accepted`) becomes
--        `accepted`, its copy is stored, the previous photo's copy removed and its file marked deleted.
--        Checks the bytes read are the stored object's (Storage's own size, the SHA-256 the web app read),
--        the type's signature and that the copy is no larger than the file (JB002 / JB003 as for branding).
--        Returns the file name (for the audit event) and whether a photo was replaced.
--   remove_profile_photo()        the caller's photo: copy removed, file marked deleted; returns the file name.
--   person_photo_content(person)  the bytes of a person's photo to a signed-in member of the same organization
--                                 (app_server, user claims).
--   file_housekeeping_action(f)   as 20261023100600, plus: an `accepted` profile photo whose copy exists has its
--                                 raw object removed (the copy in PostgreSQL is what is served).
-- Domain SQLSTATE: JP001 the photo is not the caller's usable upload.
-- Expand-first: a purpose row update and new objects; older code never sees them.

-- ---------------------------------------------------------------------------------------------------
-- The purpose: no scan, 2 MB
-- ---------------------------------------------------------------------------------------------------
update platform.file_purposes set scan_required = false, max_bytes = 2097152
where purpose = 'platform.profile_photo';

-- ---------------------------------------------------------------------------------------------------
-- The published copy
-- ---------------------------------------------------------------------------------------------------
create table platform.person_photos (
  tenant_id uuid not null default private.current_tenant_id() references platform.tenants (id),
  person_id uuid not null,
  file_id uuid not null,
  -- The type detected by content (never the name or the browser's header).
  content_type text not null,
  content bytea not null,
  byte_size integer not null,
  sha256 text not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, person_id),
  constraint person_photos_file_uq unique (tenant_id, file_id),
  constraint person_photos_person_fkey foreign key (tenant_id, person_id)
    references platform.persons (tenant_id, id),
  constraint person_photos_file_fkey foreign key (tenant_id, file_id)
    references platform.files (tenant_id, id),
  constraint person_photos_content_type_check check (content_type in ('image/png', 'image/jpeg', 'image/webp')),
  -- The purpose's limit (2 MB); the bytes are exactly the size recorded.
  constraint person_photos_size_check check (byte_size between 1 and 2097152 and byte_size = octet_length(content)),
  constraint person_photos_sha256_check check (sha256 ~ '^[0-9a-f]{64}$')
);
comment on table platform.person_photos is
  'Published copy of a person''s profile photo (WP-ADM-04, FR-IAM-16), metadata removed; shown to signed-in members of the organization only. Written by file_guard''s functions only. Owner: platform. Class: T.';
comment on column platform.person_photos.content is 'pii:direct';

alter table platform.person_photos enable row level security;
alter table platform.person_photos force row level security;

create policy tenant_isolation on platform.person_photos
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
-- Members read WHICH people have a photo and its version (the lists show it); the bytes stay out of reach.
create policy person_photos_read on platform.person_photos for select to authenticated using (true);
create policy person_photos_guard on platform.person_photos for all to file_guard using (true) with check (true);

revoke all on platform.person_photos from public, anon;
grant select (tenant_id, person_id, file_id, content_type, byte_size, sha256, created_at)
  on platform.person_photos to authenticated;
grant select, insert, update, delete on platform.person_photos to file_guard;

-- ---------------------------------------------------------------------------------------------------
-- Publishing and removing (user claims)
-- ---------------------------------------------------------------------------------------------------
create or replace function private.publish_profile_photo(p_file_id uuid, p_source_sha256 text,
                                                         p_source_size bigint, p_content_type text,
                                                         p_content bytea)
returns table (file_name text, replaced boolean)
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_tenant uuid := private.file_user_tenant();
  v_user uuid := private.request_user_id();
  v_person uuid := private.request_person_id();
  v_file record;
  v_stored text;
  v_stored_size bigint;
  v_signed boolean;
  v_old uuid;
begin
  if session_user <> 'app_server' or v_person is null then
    raise exception 'reserved to a signed-in member' using errcode = 'insufficient_privilege';
  end if;
  select f.id, f.status, f.bucket, f.object_key, f.size_bytes, f.sha256, f.detected_mime, f.object_removed_at,
         f.original_name, p.max_bytes, p.allowed_types
    into v_file
  from platform.files f
  join platform.file_purposes p on p.purpose = f.purpose and not p.scan_required and p.upload_by = 'user'
  where f.id = p_file_id and f.tenant_id = v_tenant and f.deleted_at is null and f.purged_at is null
    and f.status in ('uploaded', 'accepted')
    and f.purpose = 'platform.profile_photo'
    -- Own photo only (BR-PPL-a): the owner entity is the caller's own person and the caller uploaded it.
    and f.owner_module = 'platform' and f.owner_entity_type = 'person' and f.owner_entity_id = v_person
    and f.created_by_user = v_user
  for update of f;
  if not found then
    raise exception 'the photo is not a usable upload of the caller' using errcode = 'JP001';
  end if;
  if p_content_type is null or not (p_content_type = any (v_file.allowed_types)) then
    raise exception 'not an allowed image type' using errcode = 'JB003';
  end if;
  v_signed := case p_content_type
                when 'image/png' then substring(p_content from 1 for 8) = '\x89504e470d0a1a0a'::bytea
                when 'image/jpeg' then substring(p_content from 1 for 3) = '\xffd8ff'::bytea
                when 'image/webp' then substring(p_content from 1 for 4) = '\x52494646'::bytea
                                       and substring(p_content from 9 for 4) = '\x57454250'::bytea
                else false
              end;
  -- Storage's own row for the object: it must exist and report the size read.
  select o.size_text into v_stored from private.storage_object_facts o
  where o.bucket_id = v_file.bucket and o.name = v_file.object_key;
  v_stored_size := case when v_stored ~ '^[0-9]{1,15}$' then v_stored::bigint end;
  if v_stored_size is null or v_file.object_removed_at is not null
     or p_source_size is null or p_source_size < 1 or p_source_size > v_file.max_bytes
     or p_source_sha256 is null or p_source_sha256 !~ '^[0-9a-f]{64}$'
     or (v_file.size_bytes is not null and v_file.size_bytes <> p_source_size)
     or v_stored_size <> p_source_size
     or (v_file.status = 'accepted' and (v_file.sha256 is distinct from p_source_sha256
                                         or v_file.detected_mime is distinct from p_content_type))
     or p_content is null or octet_length(p_content) = 0 or octet_length(p_content) > p_source_size
     or not coalesce(v_signed, false) then
    raise exception 'the image differs from the stored file' using errcode = 'JB002';
  end if;
  select ph.file_id into v_old from platform.person_photos ph
  where ph.tenant_id = v_tenant and ph.person_id = v_person for update;
  if v_old is not null and v_old <> p_file_id then
    -- The replaced photo is deleted (BR-PPL-b): its copy now, its file marked deleted (housekeeping removes
    -- the object and purges the record 30 days later).
    delete from platform.person_photos ph where ph.tenant_id = v_tenant and ph.person_id = v_person;
    delete from platform.file_download_grants g where g.tenant_id = v_tenant and g.file_id = v_old;
    update platform.files f set status = 'deleted', deleted_at = now(), scan_leased_until = null
    where f.id = v_old and f.tenant_id = v_tenant and f.deleted_at is null;
  end if;
  if v_file.status = 'uploaded' then
    update platform.files f
    set status = 'accepted', status_reason = 'scan_not_required', detected_mime = p_content_type,
        size_bytes = p_source_size, sha256 = p_source_sha256
    where f.id = p_file_id;
  end if;
  insert into platform.person_photos (tenant_id, person_id, file_id, content_type, content, byte_size, sha256)
  values (v_tenant, v_person, p_file_id, p_content_type, p_content, octet_length(p_content),
          encode(sha256(p_content), 'hex'))
  on conflict (tenant_id, person_id) do nothing;
  return query select v_file.original_name, v_old is not null and v_old <> p_file_id;
end
$$;
comment on function private.publish_profile_photo(uuid, text, bigint, text, bytea) is
  'SECURITY-RELEVANT (WP-ADM-04; PO 21 Oct 2026). Stores the copy (metadata removed) of the caller''s OWN uploaded profile photo, replacing and deleting the previous one; the bytes must be the stored object''s. app_server, user claims.';

create or replace function private.remove_profile_photo()
returns table (file_name text)
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_tenant uuid := private.file_user_tenant();
  v_person uuid := private.request_person_id();
  v_file uuid;
begin
  if session_user <> 'app_server' or v_person is null then
    raise exception 'reserved to a signed-in member' using errcode = 'insufficient_privilege';
  end if;
  delete from platform.person_photos ph where ph.tenant_id = v_tenant and ph.person_id = v_person
  returning ph.file_id into v_file;
  if v_file is null then
    return;
  end if;
  delete from platform.file_download_grants g where g.tenant_id = v_tenant and g.file_id = v_file;
  update platform.files f set status = 'deleted', deleted_at = now(), scan_leased_until = null
  where f.id = v_file and f.tenant_id = v_tenant and f.deleted_at is null;
  return query select f.original_name from platform.files f where f.id = v_file and f.tenant_id = v_tenant;
end
$$;
comment on function private.remove_profile_photo() is
  'SECURITY-RELEVANT (WP-ADM-04). Removes the caller''s OWN profile photo: the copy at once, the file marked deleted. app_server, user claims.';

-- ---------------------------------------------------------------------------------------------------
-- Delivery: signed-in members of the same organization
-- ---------------------------------------------------------------------------------------------------
create or replace function private.person_photo_content(p_person_id uuid)
returns table (content_type text, content bytea, sha256 text)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_tenant uuid := private.current_tenant_id();
begin
  if session_user <> 'app_server' or p_person_id is null or v_tenant is null
     or coalesce(private.request_claims() ->> 'role', '') <> 'authenticated'
     or private.request_user_id() is null then
    return;
  end if;
  return query
  select ph.content_type, ph.content, ph.sha256
  from platform.person_photos ph
  where ph.tenant_id = v_tenant and ph.person_id = p_person_id;
end
$$;
comment on function private.person_photo_content(uuid) is
  'SECURITY-RELEVANT (WP-ADM-04). The bytes and type of a person''s photo for a signed-in member of the same organization. app_server, user claims only.';

-- ---------------------------------------------------------------------------------------------------
-- Housekeeping: the raw object of an accepted profile photo goes once its copy exists
-- ---------------------------------------------------------------------------------------------------
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
        -- Never published (an abandoned upload) and used by no Branding: object and record.
        when f.status = 'uploaded' and f.uploaded_at < now() - interval '24 hours'
             and not exists (select 1 from platform.tenant_branding b
                             where b.tenant_id = f.tenant_id
                               and f.id in (b.logo_file_id, b.favicon_file_id, b.sign_in_image_file_id))
             and not exists (select 1 from platform.person_photos ph
                             where ph.tenant_id = f.tenant_id and ph.file_id = f.id)
          then 'purge'
        when f.status = 'uploaded' and f.uploaded_at < now() - interval '24 hours' then 'remove_object'
        when f.status = 'accepted'
             and (exists (select 1 from platform.brand_assets a where a.tenant_id = f.tenant_id and a.file_id = f.id)
                  or exists (select 1 from platform.person_photos ph
                             where ph.tenant_id = f.tenant_id and ph.file_id = f.id))
          then 'remove_object'
        when f.status = 'deleted' then 'remove_object'
      end
    when f.status = 'rejected' and f.object_removed_at is null then 'remove_object'
  end
$$;
revoke all on function private.file_housekeeping_action(platform.files) from public;

-- Ownership hand-over (non-superuser migration role on hosted Supabase, as in 20261015090000).
grant create on schema private to file_guard;
alter function private.publish_profile_photo(uuid, text, bigint, text, bytea) owner to file_guard;
alter function private.remove_profile_photo() owner to file_guard;
alter function private.person_photo_content(uuid) owner to file_guard;
revoke create on schema private from file_guard;

revoke all on function private.publish_profile_photo(uuid, text, bigint, text, bytea) from public;
revoke all on function private.remove_profile_photo() from public;
revoke all on function private.person_photo_content(uuid) from public;
-- Called inside `set local role authenticated` transactions; each function checks the login role itself.
grant execute on function private.publish_profile_photo(uuid, text, bigint, text, bytea) to authenticated;
grant execute on function private.remove_profile_photo() to authenticated;
grant execute on function private.person_photo_content(uuid) to authenticated;
