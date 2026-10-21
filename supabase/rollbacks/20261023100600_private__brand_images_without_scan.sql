-- Rollback of 20261023100600_private__brand_images_without_scan.sql: the functions as in 20261015090000,
-- 20261023100200 and 20261023100300 (housekeeping included); publish_brand_image and file_guard's permission
-- reads removed.
drop function if exists private.publish_brand_image(uuid, text, text, bigint, text, bytea);

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
      and f.deleted_at is null and g.user_id = private.request_user_id() and g.expires_at > now());
end
$$;
comment on function private.can_read_object(text, text) is
  'SECURITY-RELEVANT (ADR 0006 §4, T-M2-18). storage.objects SELECT policy: clean file of the caller''s tenant with an unexpired download grant for the caller.';

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
            and exists (select 1 from platform.tenants t where t.id = f.tenant_id and t.status in ('active', 'trial'))
          group by f.tenant_id) d
    order by (select max(g.scan_claimed_at) from platform.files g where g.tenant_id = d.tenant_id) nulls first,
             d.oldest, d.tenant_id
  loop
    select f.id into v_id from platform.files f
    where f.tenant_id = v_tenant and f.status in ('uploaded', 'scanning') and f.scan_not_before <= now()
      and (f.scan_leased_until is null or f.scan_leased_until <= now()) and f.purged_at is null
      and (f.housekeeping_leased_until is null or f.housekeeping_leased_until <= now())
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
  'SECURITY-RELEVANT (T-M2-18). Worker: leases the next uploaded file for the type check and malware scan, organizations taking turns. app_worker system claims only.';

create or replace function private.branding_file_usable(p_tenant_id uuid, p_file_id uuid, p_purpose text)
returns boolean
language sql stable
set search_path = ''
as $$
  select exists (
    select 1 from platform.files f
    where f.id = p_file_id and f.tenant_id = p_tenant_id and f.purpose = p_purpose
      and f.owner_module = 'platform' and f.owner_entity_type = 'tenant_branding' and f.owner_entity_id = p_tenant_id
      and f.status in ('uploaded', 'scanning', 'clean') and f.deleted_at is null and f.purged_at is null
      and f.created_by_user = private.request_user_id());
$$;
comment on function private.branding_file_usable(uuid, uuid, text) is
  'SECURITY-RELEVANT (WP-ADM-02). A branding image may reference only the saver''s own confirmed upload of that purpose for this organization''s branding.';

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
    and (f.status in ('pending_upload', 'uploaded', 'clean', 'rejected', 'error')
         or (f.status = 'scanning' and coalesce(f.scan_leased_until <= now(), true)));
end
$$;
comment on function private.release_branding_file(uuid, uuid) is
  'SECURITY-RELEVANT (WP-ADM-02). Removes the published copy of a branding image no longer used and marks its file deleted.';

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

revoke execute on function private.member_has_permission(uuid, uuid, text) from file_guard;
revoke execute on function private.member_permissions(uuid, uuid) from file_guard;
revoke select (role_code, permission_code, scope) on platform.ref_role_permissions from file_guard;
drop policy if exists ref_role_permissions_file_guard_read on platform.ref_role_permissions;
revoke select (code, custom_role_use) on platform.ref_permissions from file_guard;
drop policy if exists ref_permissions_file_guard_read on platform.ref_permissions;
revoke select (tenant_id, custom_role_id, permission_code) on platform.custom_role_permissions from file_guard;
drop policy if exists custom_role_permissions_file_guard_read on platform.custom_role_permissions;
revoke select (tenant_id, id, code, data_scope) on platform.custom_roles from file_guard;
drop policy if exists custom_roles_file_guard_read on platform.custom_roles;
revoke select (tenant_id, membership_id, role_code, valid_from, valid_until) on platform.role_assignments
  from file_guard;
drop policy if exists role_assignments_file_guard_read on platform.role_assignments;
revoke select (id) on platform.tenant_memberships from file_guard;

-- Housekeeping as in 20261015090000.
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
    when f.status = 'rejected' and f.object_removed_at is null then 'remove_object'
  end
$$;
revoke all on function private.file_housekeeping_action(platform.files) from public;

create or replace function private.finish_file_housekeeping(p_file_id uuid, p_action text)
returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  perform private.file_worker_check();
  if p_action = 'quarantine' then
    update platform.files f set bucket = 'quarantine', quarantined_at = now(), housekeeping_leased_until = null
    where f.id = p_file_id and f.status = 'infected' and f.bucket <> 'quarantine';
    return found;
  elsif p_action = 'remove_object' then
    update platform.files f set object_removed_at = now(), housekeeping_leased_until = null
    where f.id = p_file_id and f.status = 'rejected' and f.object_removed_at is null and not f.legal_hold;
    return found;
  elsif p_action = 'purge' then
    if exists (select 1 from platform.files f where f.id = p_file_id and f.legal_hold) then
      return false;
    end if;
    begin
      delete from platform.files f where f.id = p_file_id;
      return found;
    exception when foreign_key_violation then
      update platform.files f
      set purged_at = now(), object_removed_at = coalesce(f.object_removed_at, now()), original_name = 'deleted',
          housekeeping_leased_until = null, scan_leased_until = null,
          status = case when f.status in ('pending_upload', 'uploaded', 'scanning', 'clean', 'rejected', 'error')
                        then 'deleted' else f.status end,
          deleted_at = coalesce(f.deleted_at, now())
      where f.id = p_file_id;
      return found;
    end;
  end if;
  raise exception 'unknown housekeeping action' using errcode = 'check_violation';
end
$$;
comment on function private.finish_file_housekeeping(uuid, text) is
  'SECURITY-RELEVANT (T-M2-18). Worker: records a quarantine move, an object removal or a purge (record deleted, or kept as a tombstone while referenced). app_worker system claims only.';
