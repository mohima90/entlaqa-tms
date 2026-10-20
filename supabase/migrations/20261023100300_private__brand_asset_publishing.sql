-- Publishing and serving branding images (WP-ADM-02, FR-ADM-07, FR-NTF-02; docs/engineering/branding.md).
-- All functions are owned by file_guard (SECURITY DEFINER, explicit policies, no BYPASSRLS) and check the
-- LOGIN role and the claims themselves:
--
--   worker (app_worker, system claims)
--     claim_brand_asset_work(limit)        images the Branding of an organization in service uses, found
--                                          clean by the scan, not yet published (platform task, no tenant)
--     publish_brand_asset(file, kind, bytes)  in the image's tenant transaction: stores the copy when the
--                                          bytes are exactly what the scan checked (size and SHA-256) and
--                                          the Branding still uses the file for that kind; idempotent
--   web app, claim-less (app_server, a transaction without claims — the public delivery path)
--     public_brand_asset(id)               the bytes and type of a published copy, only while its
--                                          organization is in service and its Branding still uses it
--     public_tenant_brand(slug)            the sign-in page's look of an organization in service: names,
--                                          colours, gradient and the ids of its published images
-- Nothing here lists anything: a copy is reached by its random id only; an organization's look by its slug
-- (already public: its subdomain).

-- ---------------------------------------------------------------------------------------------------
-- Worker
-- ---------------------------------------------------------------------------------------------------
create or replace function private.claim_brand_asset_work(p_limit integer)
returns table (tenant_id uuid, file_id uuid, kind text)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform private.file_worker_check();
  return query
  select b.tenant_id, s.file_id, s.kind
  from platform.tenant_branding b
  join platform.tenants t on t.id = b.tenant_id and t.status in ('trial', 'active')
  cross join lateral (values ('logo', b.logo_file_id), ('favicon', b.favicon_file_id),
                             ('sign_in_image', b.sign_in_image_file_id)) s (kind, file_id)
  join platform.files f on f.id = s.file_id and f.tenant_id = b.tenant_id
  where s.file_id is not null and f.status = 'clean' and f.deleted_at is null and f.purged_at is null
    and not exists (select 1 from platform.brand_assets a where a.tenant_id = b.tenant_id and a.file_id = s.file_id)
  order by f.scanned_at, s.file_id
  limit greatest(least(coalesce(p_limit, 20), 100), 1);
end
$$;
comment on function private.claim_brand_asset_work(integer) is
  'SECURITY-RELEVANT (WP-ADM-02). Worker: branding images in use, clean and not yet published, of organizations in service. app_worker system claims only.';

create or replace function private.publish_brand_asset(p_file_id uuid, p_kind text, p_content bytea)
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
  if p_content is null or octet_length(p_content) <> v_file.size_bytes
     or encode(sha256(p_content), 'hex') <> v_file.sha256 then
    raise exception 'the image differs from the scanned file' using errcode = 'JB002';
  end if;
  insert into platform.brand_assets (tenant_id, file_id, kind, content_type, content, byte_size, sha256)
  values (v_tenant, p_file_id, p_kind, v_file.detected_mime, p_content, octet_length(p_content), v_file.sha256)
  on conflict (tenant_id, file_id) do nothing
  returning id into v_id;
  if v_id is null then
    select a.id into v_id from platform.brand_assets a where a.tenant_id = v_tenant and a.file_id = p_file_id;
  end if;
  return v_id;
end
$$;
comment on function private.publish_brand_asset(uuid, text, bytea) is
  'SECURITY-RELEVANT (WP-ADM-02). Worker, in the image''s tenant: stores the public copy of a clean branding image still in use, only when its bytes match the scan (size, SHA-256). Idempotent.';

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

-- file_guard reads the organizations' slug and names for these functions (its read policy on
-- platform.tenants and the id/status columns: 20261015090000).
grant select (slug, name_ar, name_en) on platform.tenants to file_guard;

-- Ownership hand-over (non-superuser migration role on hosted Supabase, as in 20261015090000).
grant create on schema private to file_guard;
alter function private.claim_brand_asset_work(integer) owner to file_guard;
alter function private.publish_brand_asset(uuid, text, bytea) owner to file_guard;
alter function private.public_brand_asset(uuid) owner to file_guard;
alter function private.public_tenant_brand(text) owner to file_guard;
revoke create on schema private from file_guard;

revoke all on function private.claim_brand_asset_work(integer) from public;
revoke all on function private.publish_brand_asset(uuid, text, bytea) from public;
revoke all on function private.public_brand_asset(uuid) from public;
revoke all on function private.public_tenant_brand(text) from public;
-- Called inside `set local role authenticated` transactions; each function checks the login role itself.
grant execute on function private.claim_brand_asset_work(integer) to authenticated;
grant execute on function private.publish_brand_asset(uuid, text, bytea) to authenticated;
grant execute on function private.public_brand_asset(uuid) to authenticated;
grant execute on function private.public_tenant_brand(text) to authenticated;
