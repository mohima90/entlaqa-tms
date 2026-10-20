-- The organization's look (WP-ADM-02, FR-ADM-07; business flow EP-BRAND, agreed 20 Oct 2026; Kawadir ATS
-- /org/branding). ADR 0002 §6 pattern. Class: T. PII: none (colours, a website address, references to the
-- organization's images; who saved last is a person id).
--
--   platform.tenant_branding  at most one row per organization; NO row (or no colours) = the Jadarat look
--     (slate #2F4858 → steel #33658A, the shipped theme). Created by the first save on the Branding page.
--       primary_color / secondary_color  #RRGGBB (upper case), both or neither; the gradient runs 135° from
--                                primary to secondary (Kawadir). The product derives every shade it shows
--                                from them so that text stays readable (WCAG 2.2 AA, packages/ui theme);
--                                the page warns when the colours chosen are hard to read (BR-BRD-c)
--       use_gradient             off: the primary colour alone marks the current menu item and main buttons
--       website_url              the organization's website (https only)
--       logo_file_id, favicon_file_id, sign_in_image_file_id
--                                images uploaded through platform-files (purposes platform.brand_*,
--                                20261023100000) for owner entity platform/tenant_branding/<tenant id>;
--                                shown once the scan found them clean and the worker published a copy
--                                (platform.brand_assets). Missing: the Jadarat image is shown (BR-BRD e5)
--       email_action_color / email_link_color
--                                the e-mail button and link colours (white text on the button ≥ 4.5 : 1, the
--                                link ≥ 4.5 : 1 on white), DERIVED by the web app from the primary colour at
--                                save time — e-mails are rendered by the worker, which has no theme code
--                                (docs/design/theming.md §6 point 1). Null with the Jadarat look.
--   The organization's display names stay on platform.tenants (name_ar / name_en): the Branding page edits
--   them now (FR-ADM-02 moved them from General; same writer, policy tenants_update).
--   Writers: the Organization Admin (platform.tenant.manage, organization-wide; private.actor_may_manage_tenant)
--   — insert and update; no delete (reset = colours back to null). Every member and the organization's jobs
--   read it (the shell, the e-mails).
--   Images (trigger tenant_branding_files, owner file_guard): a newly referenced image must be the SAVER'S
--   OWN upload of the right purpose for this organization's branding, confirmed (uploaded, being scanned or
--   clean); a replaced or removed image is marked deleted (housekeeping purges it after 30 days) and its
--   published copy removed at once; the saver's other branding uploads that were never used, and anyone's
--   older than a day, are marked deleted too (BR-BRD-b: "a replaced or removed image is deleted").

create table platform.tenant_branding (
  tenant_id uuid primary key default private.current_tenant_id() references platform.tenants (id),
  primary_color text,
  secondary_color text,
  use_gradient boolean not null default true,
  website_url text,
  logo_file_id uuid,
  favicon_file_id uuid,
  sign_in_image_file_id uuid,
  email_action_color text,
  email_link_color text,
  -- [std] without id (one row per organization).
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  constraint tenant_branding_colors_check check (
    (primary_color is null) = (secondary_color is null)
    and (primary_color is null or primary_color ~ '^#[0-9A-F]{6}$')
    and (secondary_color is null or secondary_color ~ '^#[0-9A-F]{6}$')),
  constraint tenant_branding_email_colors_check check (
    (email_action_color is null) = (primary_color is null)
    and (email_link_color is null) = (primary_color is null)
    and (email_action_color is null or email_action_color ~ '^#[0-9A-F]{6}$')
    and (email_link_color is null or email_link_color ~ '^#[0-9A-F]{6}$')),
  -- https only, no spaces, quotes, angle brackets or backslashes (it is shown as a link).
  constraint tenant_branding_website_check check (
    website_url is null
    or (char_length(website_url) <= 300 and website_url ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[^[:space:][:cntrl:]<>"''\\]*)?$')),
  constraint tenant_branding_logo_fkey foreign key (tenant_id, logo_file_id)
    references platform.files (tenant_id, id) on delete set null (logo_file_id),
  constraint tenant_branding_favicon_fkey foreign key (tenant_id, favicon_file_id)
    references platform.files (tenant_id, id) on delete set null (favicon_file_id),
  constraint tenant_branding_sign_in_image_fkey foreign key (tenant_id, sign_in_image_file_id)
    references platform.files (tenant_id, id) on delete set null (sign_in_image_file_id),
  constraint tenant_branding_updated_by_fkey foreign key (tenant_id, updated_by)
    references platform.persons (tenant_id, id)
);
comment on table platform.tenant_branding is
  'The organization''s look (WP-ADM-02, FR-ADM-07): colours, gradient, website, logo / favicon / sign-in image. No row = the Jadarat look. Changed only by the Organization Admin; read by every member and the organization''s jobs. Owner: platform. Class: T.';
comment on column platform.tenant_branding.email_action_color is
  'E-mail button colour derived from primary_color by the web app (white text ≥ 4.5:1); the worker''s e-mail layout uses it as is.';

-- [std]-style stamps from verified claims; the organization of a row never changes.
create or replace function private.stamp_tenant_branding()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := new.created_at;
    new.updated_by := private.request_person_id();
    new.version := 1;
    return new;
  end if;
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'the organization of its branding cannot change' using errcode = 'insufficient_privilege';
  end if;
  new.created_at := old.created_at;
  new.updated_at := now();
  new.updated_by := private.request_person_id();
  new.version := old.version + 1;
  return new;
end
$$;
comment on function private.stamp_tenant_branding() is
  'SECURITY-RELEVANT. Stamps updated_*/version of the branding from verified claims (WP-ADM-02).';
revoke all on function private.stamp_tenant_branding() from public;

create trigger tenant_branding_stamp before insert or update on platform.tenant_branding
  for each row execute function private.stamp_tenant_branding();

-- Is this file usable as the branding image `p_purpose` of the organization, saved by the caller? The
-- caller's own confirmed upload (uploaded, being scanned or clean — never pending, refused, infected or
-- deleted) for owner entity platform/tenant_branding/<organization>.
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
revoke all on function private.branding_file_usable(uuid, uuid, text) from public;

-- A branding image no longer used: its published copy removed, the file marked deleted (housekeeping purges
-- it per retention class) — unless a worker is scanning it right now or it is infected (kept in quarantine);
-- such a file stays until the next save finds it unused.
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
revoke all on function private.release_branding_file(uuid, uuid) from public;

-- The images of a saved branding row (owner file_guard: it reads and changes platform.files).
create or replace function private.tenant_branding_files()
returns trigger
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_slot record;
  v_old uuid;
  v_new uuid;
begin
  for v_slot in
    select * from (values ('logo', 'platform.brand_logo'), ('favicon', 'platform.brand_favicon'),
                          ('sign_in_image', 'platform.brand_sign_in_image')) s (kind, purpose)
  loop
    v_new := case v_slot.kind when 'logo' then new.logo_file_id when 'favicon' then new.favicon_file_id
                              else new.sign_in_image_file_id end;
    v_old := case when tg_op = 'INSERT' then null
                  when v_slot.kind = 'logo' then old.logo_file_id
                  when v_slot.kind = 'favicon' then old.favicon_file_id
                  else old.sign_in_image_file_id end;
    if v_new is distinct from v_old then
      if v_new is not null and not private.branding_file_usable(new.tenant_id, v_new, v_slot.purpose) then
        raise exception 'branding image % is not usable', v_slot.kind using errcode = 'JB001';
      end if;
      if v_old is not null then
        perform private.release_branding_file(new.tenant_id, v_old);
      end if;
    end if;
  end loop;
  -- Uploads for this organization's branding that the saved row does not use: the saver's own (an image
  -- picked and replaced before saving) and anyone's older than a day (an abandoned page).
  perform private.release_branding_file(new.tenant_id, f.id)
  from platform.files f
  where f.tenant_id = new.tenant_id and f.owner_module = 'platform' and f.owner_entity_type = 'tenant_branding'
    and f.owner_entity_id = new.tenant_id and f.deleted_at is null and f.status <> 'infected'
    and f.id is distinct from new.logo_file_id and f.id is distinct from new.favicon_file_id
    and f.id is distinct from new.sign_in_image_file_id
    and (f.created_by_user = private.request_user_id() or f.created_at < now() - interval '1 day');
  return new;
end
$$;
comment on function private.tenant_branding_files() is
  'SECURITY-RELEVANT (WP-ADM-02). Branding images: only the saver''s own confirmed upload of the right purpose; replaced, removed and unused uploads released (copy removed, file deleted).';
revoke all on function private.tenant_branding_files() from public;

create trigger tenant_branding_files after insert or update on platform.tenant_branding
  for each row execute function private.tenant_branding_files();

alter table platform.tenant_branding enable row level security;
alter table platform.tenant_branding force row level security;

create policy tenant_isolation on platform.tenant_branding
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
-- Every member (the shell) and the organization's jobs (e-mails) read it.
create policy tenant_branding_read on platform.tenant_branding for select to authenticated using (true);
create policy tenant_branding_insert on platform.tenant_branding for insert to authenticated
  with check (private.actor_may_manage_tenant(tenant_id));
create policy tenant_branding_update on platform.tenant_branding for update to authenticated
  using (private.actor_may_manage_tenant(tenant_id))
  with check (private.actor_may_manage_tenant(tenant_id));
-- file_guard's functions (the worker's publishing, the public delivery path) read which images are used.
create policy tenant_branding_guard_read on platform.tenant_branding for select to file_guard using (true);

revoke all on platform.tenant_branding from public, anon;
grant select on platform.tenant_branding to authenticated;
-- No tenant_id (its default is the claims' organization) and no stamps.
grant insert (primary_color, secondary_color, use_gradient, website_url, logo_file_id, favicon_file_id,
              sign_in_image_file_id, email_action_color, email_link_color)
  on platform.tenant_branding to authenticated;
grant update (primary_color, secondary_color, use_gradient, website_url, logo_file_id, favicon_file_id,
              sign_in_image_file_id, email_action_color, email_link_color)
  on platform.tenant_branding to authenticated;
grant select (tenant_id, logo_file_id, favicon_file_id, sign_in_image_file_id, primary_color, secondary_color,
              use_gradient)
  on platform.tenant_branding to file_guard;

-- Ownership hand-over (non-superuser migration role on hosted Supabase, as in 20261015090000).
grant create on schema private to file_guard;
alter function private.branding_file_usable(uuid, uuid, text) owner to file_guard;
alter function private.release_branding_file(uuid, uuid) owner to file_guard;
alter function private.tenant_branding_files() owner to file_guard;
revoke create on schema private from file_guard;
revoke all on function private.branding_file_usable(uuid, uuid, text) from public;
revoke all on function private.release_branding_file(uuid, uuid) from public;
revoke all on function private.tenant_branding_files() from public;
grant execute on function private.branding_file_usable(uuid, uuid, text) to file_guard;
grant execute on function private.release_branding_file(uuid, uuid) to file_guard;
