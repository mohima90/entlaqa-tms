-- Branding images without a malware scan, published when the Branding page is saved (WP-ADM-02, FR-ADM-07;
-- PO decision 20 Oct 2026 — like Kawadir ATS; ADR 0006 amendment; docs/engineering/branding.md §2). Purposes
-- with platform.file_purposes.scan_required = false (20261023100400: the three branding images only) are never
-- scanned; their uploads become `accepted` (20261023100500), never `clean`. Every other purpose is scanned
-- exactly as before. All functions stay owned by file_guard (SECURITY DEFINER, explicit policies, no
-- BYPASSRLS) and check the LOGIN role and the claims themselves.
--
--   can_read_object(bucket, key)          Storage's read policy: as before (a clean file with a download
--                                         grant), PLUS the uploader's own upload of a purpose without a scan
--                                         while it waits to be accepted (`uploaded`, at most 24 hours after the
--                                         upload) — the web app reads it with the uploader's session, before
--                                         the save's transaction, to check it and remove its metadata
--   claim_file_scan()                     as before, but never leases an `uploaded` file of a purpose without
--                                         a scan (one already being scanned at the deploy gets its verdict)
--   branding_file_usable(…)               a saved image may also be an `accepted` upload
--   release_branding_file(…)              a replaced or removed `accepted` image is deleted too
--   claim_brand_asset_work(limit)         the worker's fallback (web publishing failed, self-hosted without
--                                         the web path, older uploads): also images in use of a purpose
--                                         without a scan that are `uploaded` or `accepted` but not published
--   note_brand_asset_failure(file, code)  as before; an older worker's FILE_NOT_CLEAN for an image without a
--                                         scan is not counted (expand-first: it is not the image's fault)
--   publish_brand_image(file, kind, source sha256, source size, type, bytes)   NEW
--                                         stores the public copy of a branding image of a purpose without a
--                                         scan, in the image's tenant, called by
--                                           · the web app (app_server, USER claims) in the Branding save's
--                                             transaction: an Organization Admin (platform.tenant.manage, as
--                                             the tenant_branding policies), the caller's OWN upload, or
--                                           · the worker (app_worker, system claims of the image's tenant);
--                                         only an image the Branding uses for that kind (`uploaded` → it
--                                         becomes `accepted`, with the detected type, the size and the SHA-256
--                                         of the bytes read; `accepted` → the same bytes again); the size read
--                                         must be the stored object's (confirmation and Storage now); the
--                                         copy: the detected type's signature, no larger than the file.
--                                         Idempotent; clears earlier failures. Clean images keep the worker's
--                                         publish_brand_asset (20261023100300).
-- Domain SQLSTATE: JB002 the bytes are not the stored file's, JB003 not an allowed image type.

-- ---------------------------------------------------------------------------------------------------
-- What file_guard reads to check the caller's permission (pattern of email_guard, 20261022100100): the
-- caller's roles in the caller's organization only.
-- ---------------------------------------------------------------------------------------------------
grant select (id) on platform.tenant_memberships to file_guard;
create policy role_assignments_file_guard_read on platform.role_assignments for select to file_guard
  using (tenant_id = (select private.current_tenant_id()));
grant select (tenant_id, membership_id, role_code, valid_from, valid_until) on platform.role_assignments
  to file_guard;
create policy custom_roles_file_guard_read on platform.custom_roles for select to file_guard
  using (tenant_id = (select private.current_tenant_id()));
grant select (tenant_id, id, code, data_scope) on platform.custom_roles to file_guard;
create policy custom_role_permissions_file_guard_read on platform.custom_role_permissions for select
  to file_guard using (tenant_id = (select private.current_tenant_id()));
grant select (tenant_id, custom_role_id, permission_code) on platform.custom_role_permissions to file_guard;
create policy ref_permissions_file_guard_read on platform.ref_permissions for select to file_guard using (true);
grant select (code, custom_role_use) on platform.ref_permissions to file_guard;
create policy ref_role_permissions_file_guard_read on platform.ref_role_permissions for select to file_guard
  using (true);
grant select (role_code, permission_code, scope) on platform.ref_role_permissions to file_guard;
grant execute on function private.member_permissions(uuid, uuid) to file_guard;
grant execute on function private.member_has_permission(uuid, uuid, text) to file_guard;

-- ---------------------------------------------------------------------------------------------------
-- Storage's read policy
-- ---------------------------------------------------------------------------------------------------
create or replace function private.can_read_object(p_bucket text, p_name text)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_tenant uuid := private.storage_request_tenant();
begin
  if v_tenant is null or p_bucket is null or p_name is null then
    return false;
  end if;
  return exists (
    select 1 from platform.files f
    join platform.file_download_grants g on g.tenant_id = f.tenant_id and g.file_id = f.id
    where f.bucket = p_bucket and f.object_key = p_name and f.tenant_id = v_tenant and f.status = 'clean'
      and f.deleted_at is null and g.user_id = private.request_user_id() and g.expires_at > now())
  -- The uploader reads back their own upload of a purpose without a malware scan (the branding images, PO
  -- 20 Oct 2026) while it waits to be accepted: the web app checks and copies it with the uploader's
  -- session before the save's transaction. Their own bytes only, for a day after the upload.
  or exists (
    select 1 from platform.files f
    join platform.file_purposes p on p.purpose = f.purpose and not p.scan_required and p.upload_by = 'user'
    where f.bucket = p_bucket and f.object_key = p_name and f.tenant_id = v_tenant and f.status = 'uploaded'
      and f.deleted_at is null and f.purged_at is null and f.created_by_user = private.request_user_id()
      and f.uploaded_at > now() - interval '24 hours');
end
$$;
comment on function private.can_read_object(text, text) is
  'SECURITY-RELEVANT (ADR 0006 §4, T-M2-18, WP-ADM-02). storage.objects SELECT policy: clean file of the caller''s tenant with an unexpired download grant for the caller; or the caller''s own upload of a purpose without a malware scan, waiting to be accepted (24 hours).';

-- ---------------------------------------------------------------------------------------------------
-- The scan leaves purposes without a scan alone
-- ---------------------------------------------------------------------------------------------------
create or replace function private.claim_file_scan()
returns table (id uuid, tenant_id uuid, bucket text, object_key text, purpose text, declared_mime text,
               size_bytes bigint, max_bytes bigint, allowed_types text[], attempts integer)
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_tenant uuid;
begin
  perform private.file_worker_check();
  for v_tenant in
    select d.tenant_id
    from (select f.tenant_id, min(f.uploaded_at) as oldest
          from platform.files f
          where f.status in ('uploaded', 'scanning') and f.scan_not_before <= now()
            and (f.scan_leased_until is null or f.scan_leased_until <= now()) and f.purged_at is null
            and (f.housekeeping_leased_until is null or f.housekeeping_leased_until <= now())
            and (f.status = 'scanning'
                 or exists (select 1 from platform.file_purposes p where p.purpose = f.purpose and p.scan_required))
            and exists (select 1 from platform.tenants t where t.id = f.tenant_id and t.status in ('active', 'trial'))
          group by f.tenant_id) d
    order by (select max(g.scan_claimed_at) from platform.files g where g.tenant_id = d.tenant_id) nulls first,
             d.oldest, d.tenant_id
  loop
    select f.id into v_id from platform.files f
    where f.tenant_id = v_tenant and f.status in ('uploaded', 'scanning') and f.scan_not_before <= now()
      and (f.scan_leased_until is null or f.scan_leased_until <= now()) and f.purged_at is null
      and (f.housekeeping_leased_until is null or f.housekeeping_leased_until <= now())
      -- An upload of a purpose without a malware scan is never leased (one already being scanned when this
      -- migration was deployed gets its verdict).
      and (f.status = 'scanning'
           or exists (select 1 from platform.file_purposes p where p.purpose = f.purpose and p.scan_required))
    order by f.uploaded_at, f.id
    limit 1
    for update of f skip locked;
    exit when v_id is not null;
  end loop;
  if v_id is null then
    return;
  end if;
  update platform.files f
  set status = 'scanning', scan_leased_until = now() + interval '15 minutes', scan_claimed_at = now(),
      scan_attempts = least(f.scan_attempts + 1, 1000)
  where f.id = v_id;
  return query
    select f.id, f.tenant_id, f.bucket, f.object_key, f.purpose, f.declared_mime, f.size_bytes, p.max_bytes,
           p.allowed_types, f.scan_attempts::integer
    from platform.files f join platform.file_purposes p on p.purpose = f.purpose
    where f.id = v_id;
end
$$;
comment on function private.claim_file_scan() is
  'SECURITY-RELEVANT (T-M2-18). Worker: leases the next uploaded file for the type check and malware scan, organizations taking turns; never an upload of a purpose without a scan. app_worker system claims only.';

-- ---------------------------------------------------------------------------------------------------
-- The Branding row's image rules (20261023100200) with `accepted`
-- ---------------------------------------------------------------------------------------------------
create or replace function private.branding_file_usable(p_tenant_id uuid, p_file_id uuid, p_purpose text)
returns boolean
language sql stable
set search_path = ''
as $$
  select exists (
    select 1 from platform.files f
    where f.id = p_file_id and f.tenant_id = p_tenant_id and f.purpose = p_purpose
      and f.owner_module = 'platform' and f.owner_entity_type = 'tenant_branding' and f.owner_entity_id = p_tenant_id
      and f.status in ('uploaded', 'scanning', 'clean', 'accepted') and f.deleted_at is null and f.purged_at is null
      and f.created_by_user = private.request_user_id());
$$;
comment on function private.branding_file_usable(uuid, uuid, text) is
  'SECURITY-RELEVANT (WP-ADM-02). A branding image may reference only the saver''s own confirmed upload (uploaded, scanning, clean or accepted) of that purpose for this organization''s branding.';

create or replace function private.release_branding_file(p_tenant_id uuid, p_file_id uuid)
returns void
language plpgsql volatile
set search_path = ''
as $$
begin
  delete from platform.brand_assets a where a.tenant_id = p_tenant_id and a.file_id = p_file_id;
  delete from platform.file_download_grants g where g.tenant_id = p_tenant_id and g.file_id = p_file_id;
  update platform.files f set status = 'deleted', deleted_at = now(), scan_leased_until = null
  where f.id = p_file_id and f.tenant_id = p_tenant_id and f.deleted_at is null
    and f.owner_module = 'platform' and f.owner_entity_type = 'tenant_branding'
    and (f.status in ('pending_upload', 'uploaded', 'clean', 'accepted', 'rejected', 'error')
         or (f.status = 'scanning' and coalesce(f.scan_leased_until <= now(), true)));
end
$$;
comment on function private.release_branding_file(uuid, uuid) is
  'SECURITY-RELEVANT (WP-ADM-02). Removes the published copy of a branding image no longer used and marks its file deleted.';

-- ---------------------------------------------------------------------------------------------------
-- Worker: what is due (the fallback for images the web app did not publish)
-- ---------------------------------------------------------------------------------------------------
create or replace function private.claim_brand_asset_work(p_limit integer)
returns table (tenant_id uuid, file_id uuid, kind text)
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  perform private.file_worker_check();
  -- Copies no Branding uses any more (published while a save replaced the image): never served, removed.
  delete from platform.brand_assets a
  where not exists (
    select 1 from platform.tenant_branding b
    where b.tenant_id = a.tenant_id
      and a.file_id = case a.kind when 'logo' then b.logo_file_id when 'favicon' then b.favicon_file_id
                                  when 'sign_in_image' then b.sign_in_image_file_id end);
  return query
  select b.tenant_id, s.file_id, s.kind
  from platform.tenant_branding b
  join platform.tenants t on t.id = b.tenant_id and t.status in ('trial', 'active')
  cross join lateral (values ('logo', b.logo_file_id), ('favicon', b.favicon_file_id),
                             ('sign_in_image', b.sign_in_image_file_id)) s (kind, file_id)
  join platform.files f on f.id = s.file_id and f.tenant_id = b.tenant_id
  join platform.file_purposes p on p.purpose = f.purpose
  where s.file_id is not null and f.deleted_at is null and f.purged_at is null
    -- Scanned purposes: clean only. Purposes without a scan (20261023100400): waiting or accepted.
    and (f.status = 'clean' or (not p.scan_required and f.status in ('uploaded', 'accepted')))
    and not exists (select 1 from platform.brand_assets a where a.tenant_id = b.tenant_id and a.file_id = s.file_id)
    and not exists (select 1 from platform.brand_asset_attempts x
                    where x.tenant_id = b.tenant_id and x.file_id = s.file_id and x.next_try_at > now())
  order by coalesce(f.scanned_at, f.uploaded_at), s.file_id
  limit greatest(least(coalesce(p_limit, 20), 100), 1);
end
$$;
comment on function private.claim_brand_asset_work(integer) is
  'SECURITY-RELEVANT (WP-ADM-02). Worker: removes copies no Branding uses; branding images in use (clean, or of a purpose without a scan: uploaded or accepted), not yet published and not waiting after a failure, of organizations in service. app_worker system claims only.';

-- Expand-first: a worker of before this change reads only clean files, so for an image of a purpose without
-- a scan it reports FILE_NOT_CLEAN — not the image's fault: not counted (else it would be given up after 5).
create or replace function private.note_brand_asset_failure(p_file_id uuid, p_code text)
returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_tenant uuid := private.current_tenant_id();
  v_attempts integer;
begin
  perform private.file_worker_check();
  if v_tenant is null then
    raise exception 'reserved to a job of the image''s organization' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from platform.files f where f.id = p_file_id and f.tenant_id = v_tenant
                 and f.owner_entity_type = 'tenant_branding') then
    return 0;
  end if;
  if p_code = 'FILE_NOT_CLEAN' and exists (
       select 1 from platform.files f join platform.file_purposes p on p.purpose = f.purpose
       where f.id = p_file_id and f.tenant_id = v_tenant and not p.scan_required) then
    return 0;
  end if;
  insert into platform.brand_asset_attempts as x (tenant_id, file_id, attempts, next_try_at, last_code)
  values (v_tenant, p_file_id, 1, now() + interval '1 minute',
          case when p_code ~ '^[A-Z][A-Z0-9_]{1,40}$' then p_code else 'FAILED' end)
  on conflict (tenant_id, file_id) do update
    set attempts = least(x.attempts + 1, 100),
        next_try_at = case when x.attempts + 1 >= 5 then 'infinity'::timestamptz
                           else now() + least(interval '1 minute' * power(2, x.attempts), interval '1 day') end,
        last_code = excluded.last_code,
        updated_at = now()
  returning x.attempts into v_attempts;
  return v_attempts;
end
$$;
comment on function private.note_brand_asset_failure(uuid, text) is
  'SECURITY-RELEVANT (WP-ADM-02). Worker, in the image''s tenant: one more failed publishing attempt (back-off; given up after 5); an older worker''s FILE_NOT_CLEAN for an image without a scan is not counted. app_worker system claims only.';

-- ---------------------------------------------------------------------------------------------------
-- Publishing an image of a purpose without a scan: the web app at save time, or the worker
-- ---------------------------------------------------------------------------------------------------
create or replace function private.publish_brand_image(p_file_id uuid, p_kind text, p_source_sha256 text,
                                                       p_source_size bigint, p_content_type text,
                                                       p_content bytea)
returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_worker boolean := session_user = 'app_worker';
  v_tenant uuid;
  v_user uuid;
  v_file record;
  v_stored text;
  v_stored_size bigint;
  v_signed boolean;
  v_id uuid;
begin
  if v_worker then
    perform private.file_worker_check();
    v_tenant := private.current_tenant_id();
    if v_tenant is null then
      raise exception 'reserved to a job of the image''s organization' using errcode = 'insufficient_privilege';
    end if;
  else
    -- The web app: a signed-in member (app_server user claims) who may change the organization's look —
    -- the same permission as the tenant_branding policies (platform.tenant.manage).
    v_tenant := private.file_user_tenant();
    v_user := private.request_user_id();
    if not private.member_has_permission(v_tenant, v_user, 'platform.tenant.manage') then
      raise exception 'only an Organization Admin publishes branding images' using errcode = 'insufficient_privilege';
    end if;
  end if;
  if p_kind is null or p_kind not in ('logo', 'favicon', 'sign_in_image') then
    return null;
  end if;
  select f.id, f.status, f.bucket, f.object_key, f.size_bytes, f.sha256, f.detected_mime, p.max_bytes,
         p.allowed_types
    into v_file
  from platform.files f
  join platform.file_purposes p on p.purpose = f.purpose and not p.scan_required and p.upload_by = 'user'
  join platform.tenant_branding b on b.tenant_id = f.tenant_id
  where f.id = p_file_id and f.tenant_id = v_tenant and f.deleted_at is null and f.purged_at is null
    and f.status in ('uploaded', 'accepted')
    and f.purpose = 'platform.brand_' || p_kind
    and f.owner_module = 'platform' and f.owner_entity_type = 'tenant_branding' and f.owner_entity_id = v_tenant
    -- The web app publishes only the caller's own upload (as the Branding row's image rule).
    and (v_worker or f.created_by_user = v_user)
    -- Still the image the Branding uses for that kind.
    and p_file_id = case p_kind when 'logo' then b.logo_file_id when 'favicon' then b.favicon_file_id
                                else b.sign_in_image_file_id end
  for update of f;
  if not found then
    -- Not used (replaced, removed), someone else's, scanned (clean: publish_brand_asset), or gone.
    return null;
  end if;
  if p_content_type is null or not (p_content_type = any (v_file.allowed_types)) then
    raise exception 'not an allowed image type' using errcode = 'JB003';
  end if;
  -- What was read is the stored object: its size as confirmed and as Storage reports it now, within the
  -- purpose's limit; an accepted file again with exactly what its acceptance recorded.
  v_signed := case p_content_type
                when 'image/png' then substring(p_content from 1 for 8) = '\x89504e470d0a1a0a'::bytea
                when 'image/jpeg' then substring(p_content from 1 for 3) = '\xffd8ff'::bytea
                when 'image/webp' then substring(p_content from 1 for 4) = '\x52494646'::bytea
                                       and substring(p_content from 9 for 4) = '\x57454250'::bytea
                else false
              end;
  select o.size_text into v_stored from private.storage_object_facts o
  where o.bucket_id = v_file.bucket and o.name = v_file.object_key;
  v_stored_size := case when v_stored ~ '^[0-9]{1,15}$' then v_stored::bigint end;
  if p_source_size is null or p_source_size < 1 or p_source_size > v_file.max_bytes
     or p_source_sha256 is null or p_source_sha256 !~ '^[0-9a-f]{64}$'
     or (v_file.size_bytes is not null and v_file.size_bytes <> p_source_size)
     or (v_stored_size is not null and v_stored_size <> p_source_size)
     or (v_file.status = 'accepted' and (v_file.sha256 is distinct from p_source_sha256
                                         or v_file.detected_mime is distinct from p_content_type))
     -- The copy (metadata removed) is never larger than the file and starts as its type must.
     or p_content is null or octet_length(p_content) = 0 or octet_length(p_content) > p_source_size
     or not coalesce(v_signed, false) then
    raise exception 'the image differs from the stored file' using errcode = 'JB002';
  end if;
  if v_file.status = 'uploaded' then
    update platform.files f
    set status = 'accepted', status_reason = 'scan_not_required', detected_mime = p_content_type,
        size_bytes = p_source_size, sha256 = p_source_sha256
    where f.id = p_file_id;
  end if;
  insert into platform.brand_assets (tenant_id, file_id, kind, content_type, content, byte_size, sha256)
  values (v_tenant, p_file_id, p_kind, p_content_type, p_content, octet_length(p_content),
          encode(sha256(p_content), 'hex'))
  on conflict (tenant_id, file_id) do nothing
  returning id into v_id;
  if v_id is null then
    select a.id into v_id from platform.brand_assets a where a.tenant_id = v_tenant and a.file_id = p_file_id;
  end if;
  delete from platform.brand_asset_attempts x where x.tenant_id = v_tenant and x.file_id = p_file_id;
  return v_id;
end
$$;
comment on function private.publish_brand_image(uuid, text, text, bigint, text, bytea) is
  'SECURITY-RELEVANT (WP-ADM-02; PO 20 Oct 2026). Stores the public copy (metadata removed) of a branding image of a purpose without a malware scan, still in use, in the image''s tenant: the web app (Organization Admin, own upload, in the save''s transaction) or the worker; the file becomes accepted (detected type, size, SHA-256 of the bytes read). Idempotent.';

-- Ownership hand-over (non-superuser migration role on hosted Supabase, as in 20261015090000).
grant create on schema private to file_guard;
alter function private.publish_brand_image(uuid, text, text, bigint, text, bytea) owner to file_guard;
revoke create on schema private from file_guard;

revoke all on function private.publish_brand_image(uuid, text, text, bigint, text, bytea) from public;
-- Called inside `set local role authenticated` transactions; the function checks the login role itself.
grant execute on function private.publish_brand_image(uuid, text, text, bigint, text, bytea) to authenticated;
