-- Published branding images (WP-ADM-02, FR-ADM-07, FR-NTF-02; business flow EP-BRAND, agreed 20 Oct 2026).
-- ADR 0002 §6 pattern. Class: T. PII: none (an organization's logo, browser icon and sign-in picture — its
-- public look; the uploader is on platform.files).
--
-- Why a copy: the organization's logo, favicon and sign-in image are shown BEFORE anyone signs in (the
-- sign-in page, the browser tab) and in e-mails, whose clients fetch images without a session. Uploaded
-- files stay private in Storage (ADR 0006: no public bucket, no long-lived link, no Storage key in the web
-- app). Instead the worker — after the malware scan found a file clean AND the Branding page uses it —
-- copies its bytes here (private.publish_brand_asset, 20261023100300), checking them against the size and
-- SHA-256 the scan recorded. The web app serves a copy at /api/brand/<id> through a narrow claim-less
-- function (private.public_brand_asset): no listing, the id is a random UUID (122 random bits) that only
-- the organization's own pages and e-mails name, and only while the organization is in service and its
-- Branding still uses the image. The same origin as the app, so the page's CSP (`img-src 'self'`) holds.
-- Self-hosted and hosted alike (plain PostgreSQL; no vendor feature): docs/engineering/branding.md.
--
-- Writers: none on the request path. file_guard's functions (worker: publish; the Branding row's trigger:
-- remove the copy of a replaced or removed image, 20261023100200). Members read the ids and types (the
-- shell builds the image links from them), never the bytes through SQL.

create table platform.brand_assets (
  -- The public id in /api/brand/<id> (random, never the file's id).
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants (id),
  file_id uuid not null,
  kind text not null,
  -- The type the scan detected by content (never the name or the browser's header).
  content_type text not null,
  content bytea not null,
  byte_size integer not null,
  sha256 text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint brand_assets_tenant_file_uq unique (tenant_id, file_id),
  constraint brand_assets_kind_check check (kind in ('logo', 'favicon', 'sign_in_image')),
  constraint brand_assets_content_type_check check (content_type in ('image/png', 'image/jpeg', 'image/webp')),
  -- The largest branding purpose (sign-in image, 5 MB); the bytes are exactly the size recorded.
  constraint brand_assets_size_check check (byte_size between 1 and 5242880 and byte_size = octet_length(content)),
  constraint brand_assets_sha256_check check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint brand_assets_file_fkey foreign key (tenant_id, file_id) references platform.files (tenant_id, id)
);
comment on table platform.brand_assets is
  'Published copies of clean branding images (WP-ADM-02, FR-ADM-07): served at /api/brand/<id> to the sign-in page, the browser tab and e-mails. Written by file_guard''s functions only. Owner: platform. Class: T.';
comment on column platform.brand_assets.id is
  'Public, unguessable id of the copy (random UUID): the only key the public delivery path accepts.';

alter table platform.brand_assets enable row level security;
alter table platform.brand_assets force row level security;

create policy tenant_isolation on platform.brand_assets
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
-- Members (and the organization's jobs) read which images are published; the bytes stay out of reach.
create policy brand_assets_read on platform.brand_assets for select to authenticated using (true);
create policy brand_assets_guard on platform.brand_assets for all to file_guard using (true) with check (true);

revoke all on platform.brand_assets from public, anon;
grant select (id, tenant_id, file_id, kind, content_type, byte_size, sha256, created_at)
  on platform.brand_assets to authenticated;
grant select, insert, delete on platform.brand_assets to file_guard;

-- Publishing attempts that failed (security review L5): an image the worker cannot publish (not a PNG/JPEG/
-- WebP by content, too many pixels, its bytes differ from the scan, …) is tried again later — after 1, 2,
-- 4 … minutes, at most a day — and given up after 5 attempts (next_try_at = infinity): it never holds up
-- the others. The page tells the admin to upload another image. Written by file_guard's functions only.
create table platform.brand_asset_attempts (
  tenant_id uuid not null references platform.tenants (id),
  file_id uuid not null,
  attempts smallint not null default 0,
  next_try_at timestamptz not null default now(),
  last_code text,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, file_id),
  constraint brand_asset_attempts_attempts_check check (attempts between 0 and 100),
  constraint brand_asset_attempts_code_check check (last_code is null or last_code ~ '^[A-Z][A-Z0-9_]{1,40}$'),
  constraint brand_asset_attempts_file_fkey foreign key (tenant_id, file_id)
    -- Bookkeeping only (no business row): it goes with its file when housekeeping purges it.
    references platform.files (tenant_id, id) on delete cascade
);
comment on table platform.brand_asset_attempts is
  'Failed publishing attempts of branding images (WP-ADM-02): back-off and give-up after 5. Written by file_guard''s functions only. Owner: platform. Class: T.';

alter table platform.brand_asset_attempts enable row level security;
alter table platform.brand_asset_attempts force row level security;

create policy tenant_isolation on platform.brand_asset_attempts
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
-- Members read whether an image could not be prepared (the Branding page says so).
create policy brand_asset_attempts_read on platform.brand_asset_attempts for select to authenticated using (true);
create policy brand_asset_attempts_guard on platform.brand_asset_attempts for all to file_guard
  using (true) with check (true);

revoke all on platform.brand_asset_attempts from public, anon;
grant select on platform.brand_asset_attempts to authenticated;
grant select, insert, update, delete on platform.brand_asset_attempts to file_guard;
