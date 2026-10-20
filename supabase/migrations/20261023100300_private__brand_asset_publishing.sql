-- Publishing and serving branding images (WP-ADM-02, FR-ADM-07, FR-NTF-02; docs/engineering/branding.md).
-- All functions are owned by file_guard (SECURITY DEFINER, explicit policies, no BYPASSRLS) and check the
-- LOGIN role and the claims themselves:
--
--   worker (app_worker, system claims)
--     claim_brand_asset_work(limit)        images the Branding of an organization in service uses, found
--                                          clean by the scan, not yet published and not waiting after a
--                                          failure (platform task, no tenant); first removes copies no
--                                          Branding uses any more (a save racing a publication — review L6)
--     publish_brand_asset(file, kind, source sha256, bytes)
--                                          in the image's tenant transaction: stores the copy — the scanned
--                                          file WITHOUT its metadata (EXIF/XMP, review M2) — when the worker
--                                          read exactly the scanned file (its SHA-256), the copy is not larger
--                                          than it, and the Branding still uses the file for that kind;
--                                          idempotent; clears earlier failures
--     note_brand_asset_failure(file, code) in the image's tenant: one more failed attempt; tried again after
--                                          1, 2, 4 … minutes (at most a day), given up after 5 (review L5)
--   web app, claim-less (app_server, a transaction without claims — the public delivery path)
--     public_brand_asset(id)               the bytes and type of a published copy, only while its
--                                          organization is in service and its Branding still uses it
--     public_brand_asset_meta(id)          the same answer without the bytes (type, SHA-256, size): a
--                                          browser's revalidation (If-None-Match) costs no transfer (review M1)
--     public_tenant_brand(slug)            the sign-in page's look of an organization in service: names,
--                                          colours, gradient and the ids of its published images
--   web app, user claims (app_server)
--     branding_image_names(ids)            the sanitized names of the organization's branding images, for the
--                                          audit record (files are otherwise visible to their uploader only;
--                                          review L10)
-- Nothing here lists anything: a copy is reached by its random id only; an organization's look by its slug
-- (already public: its subdomain).

-- ---------------------------------------------------------------------------------------------------
-- Worker
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
  where s.file_id is not null and f.status = 'clean' and f.deleted_at is null and f.purged_at is null
    and not exists (select 1 from platform.brand_assets a where a.tenant_id = b.tenant_id and a.file_id = s.file_id)
    and not exists (select 1 from platform.brand_asset_attempts x
                    where x.tenant_id = b.tenant_id and x.file_id = s.file_id and x.next_try_at > now())
  order by f.scanned_at, s.file_id
  limit greatest(least(coalesce(p_limit, 20), 100), 1);
end
$$;
comment on function private.claim_brand_asset_work(integer) is
  'SECURITY-RELEVANT (WP-ADM-02). Worker: removes copies no Branding uses; branding images in use, clean, not yet published and not waiting after a failure, of organizations in service. app_worker system claims only.';

create or replace function private.publish_brand_asset(p_file_id uuid, p_kind text, p_source_sha256 text,
                                                       p_content bytea)
returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_tenant uuid := private.current_tenant_id();
  v_file record;
  v_id uuid;
begin
  perform private.file_worker_check();
  if v_tenant is null then
    raise exception 'reserved to a job of the image''s organization' using errcode = 'insufficient_privilege';
  end if;
  select f.id, f.purpose, f.detected_mime, f.size_bytes, f.sha256 into v_file
  from platform.files f
  join platform.tenant_branding b on b.tenant_id = f.tenant_id
  where f.id = p_file_id and f.tenant_id = v_tenant and f.status = 'clean' and f.deleted_at is null
    and f.purged_at is null
    and f.purpose = 'platform.brand_' || p_kind
    and p_file_id = case p_kind when 'logo' then b.logo_file_id when 'favicon' then b.favicon_file_id
                                when 'sign_in_image' then b.sign_in_image_file_id end;
  if not found then
    -- Replaced, removed or not clean any more: nothing to publish.
    return null;
  end if;
  -- The worker read the scanned file (its stream checks size and SHA-256) and removed the metadata: the
  -- copy is that file's (same source hash), never larger than it.
  if p_source_sha256 is distinct from v_file.sha256 or p_content is null or octet_length(p_content) = 0
     or octet_length(p_content) > v_file.size_bytes then
    raise exception 'the image differs from the scanned file' using errcode = 'JB002';
  end if;
  insert into platform.brand_assets (tenant_id, file_id, kind, content_type, content, byte_size, sha256)
  values (v_tenant, p_file_id, p_kind, v_file.detected_mime, p_content, octet_length(p_content),
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
comment on function private.publish_brand_asset(uuid, text, text, bytea) is
  'SECURITY-RELEVANT (WP-ADM-02). Worker, in the image''s tenant: stores the public copy (metadata removed) of a clean branding image still in use, only when the worker read exactly the scanned file. Idempotent.';

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
  'SECURITY-RELEVANT (WP-ADM-02). Worker, in the image''s tenant: one more failed publishing attempt (back-off; given up after 5). app_worker system claims only.';

-- ---------------------------------------------------------------------------------------------------
-- Public delivery (claim-less app_server transactions)
-- ---------------------------------------------------------------------------------------------------
create or replace function private.public_brand_asset(p_id uuid)
returns table (content_type text, content bytea, sha256 text)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if session_user <> 'app_server' or p_id is null then
    return;
  end if;
  return query
  select a.content_type, a.content, a.sha256
  from platform.brand_assets a
  join platform.tenants t on t.id = a.tenant_id and t.status in ('trial', 'active')
  join platform.tenant_branding b on b.tenant_id = a.tenant_id
  where a.id = p_id
    and a.file_id = case a.kind when 'logo' then b.logo_file_id when 'favicon' then b.favicon_file_id
                                when 'sign_in_image' then b.sign_in_image_file_id end;
end
$$;
comment on function private.public_brand_asset(uuid) is
  'SECURITY-RELEVANT (WP-ADM-02). Public delivery path: a published branding image by its random id, only while its organization is in service and its Branding still uses it. app_server only.';

create or replace function private.public_brand_asset_meta(p_id uuid)
returns table (content_type text, sha256 text, byte_size integer)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if session_user <> 'app_server' or p_id is null then
    return;
  end if;
  return query
  select a.content_type, a.sha256, a.byte_size
  from platform.brand_assets a
  join platform.tenants t on t.id = a.tenant_id and t.status in ('trial', 'active')
  join platform.tenant_branding b on b.tenant_id = a.tenant_id
  where a.id = p_id
    and a.file_id = case a.kind when 'logo' then b.logo_file_id when 'favicon' then b.favicon_file_id
                                when 'sign_in_image' then b.sign_in_image_file_id end;
end
$$;
comment on function private.public_brand_asset_meta(uuid) is
  'SECURITY-RELEVANT (WP-ADM-02). Public delivery path: type, SHA-256 and size of a published branding image (revalidation without the bytes); same rules as public_brand_asset. app_server only.';

create or replace function private.public_tenant_brand(p_slug text)
returns table (name_ar text, name_en text, primary_color text, secondary_color text, use_gradient boolean,
               logo_asset_id uuid, favicon_asset_id uuid, sign_in_image_asset_id uuid)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if session_user <> 'app_server' or p_slug is null or p_slug !~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$' then
    return;
  end if;
  return query
  select t.name_ar, t.name_en, b.primary_color, b.secondary_color, coalesce(b.use_gradient, true),
         (select a.id from platform.brand_assets a where a.tenant_id = t.id and a.file_id = b.logo_file_id),
         (select a.id from platform.brand_assets a where a.tenant_id = t.id and a.file_id = b.favicon_file_id),
         (select a.id from platform.brand_assets a where a.tenant_id = t.id and a.file_id = b.sign_in_image_file_id)
  from platform.tenants t
  left join platform.tenant_branding b on b.tenant_id = t.id
  where t.slug = p_slug and t.status in ('trial', 'active');
end
$$;
comment on function private.public_tenant_brand(text) is
  'SECURITY-RELEVANT (WP-ADM-02). The sign-in page''s look of an organization in service, by its slug: names, colours, gradient, published image ids. app_server only.';

-- ---------------------------------------------------------------------------------------------------
-- Audit (user claims)
-- ---------------------------------------------------------------------------------------------------
create or replace function private.branding_image_names(p_ids uuid[])
returns table (id uuid, name text)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_tenant uuid := private.current_tenant_id();
begin
  if session_user <> 'app_server' or v_tenant is null
     or coalesce(private.request_claims() ->> 'role', '') <> 'authenticated' then
    return;
  end if;
  return query
  select f.id, f.original_name
  from platform.files f
  where f.id = any (p_ids) and f.tenant_id = v_tenant and f.owner_module = 'platform'
    and f.owner_entity_type = 'tenant_branding' and f.owner_entity_id = v_tenant and f.purged_at is null;
end
$$;
comment on function private.branding_image_names(uuid[]) is
  'SECURITY-RELEVANT (WP-ADM-02). Sanitized names of the claims'' organization''s branding images (audit record, BR-BRD-a). app_server user claims only.';

-- file_guard reads the organizations' slug and names for these functions (its read policy on
-- platform.tenants and the id/status columns: 20261015090000).
grant select (slug, name_ar, name_en) on platform.tenants to file_guard;

-- Ownership hand-over (non-superuser migration role on hosted Supabase, as in 20261015090000).
grant create on schema private to file_guard;
alter function private.claim_brand_asset_work(integer) owner to file_guard;
alter function private.publish_brand_asset(uuid, text, text, bytea) owner to file_guard;
alter function private.note_brand_asset_failure(uuid, text) owner to file_guard;
alter function private.public_brand_asset(uuid) owner to file_guard;
alter function private.public_brand_asset_meta(uuid) owner to file_guard;
alter function private.public_tenant_brand(text) owner to file_guard;
alter function private.branding_image_names(uuid[]) owner to file_guard;
revoke create on schema private from file_guard;

revoke all on function private.claim_brand_asset_work(integer) from public;
revoke all on function private.publish_brand_asset(uuid, text, text, bytea) from public;
revoke all on function private.note_brand_asset_failure(uuid, text) from public;
revoke all on function private.public_brand_asset(uuid) from public;
revoke all on function private.public_brand_asset_meta(uuid) from public;
revoke all on function private.public_tenant_brand(text) from public;
revoke all on function private.branding_image_names(uuid[]) from public;
-- Called inside `set local role authenticated` transactions; each function checks the login role itself.
grant execute on function private.claim_brand_asset_work(integer) to authenticated;
grant execute on function private.publish_brand_asset(uuid, text, text, bytea) to authenticated;
grant execute on function private.note_brand_asset_failure(uuid, text) to authenticated;
grant execute on function private.public_brand_asset(uuid) to authenticated;
grant execute on function private.public_brand_asset_meta(uuid) to authenticated;
grant execute on function private.public_tenant_brand(text) to authenticated;
grant execute on function private.branding_image_names(uuid[]) to authenticated;
