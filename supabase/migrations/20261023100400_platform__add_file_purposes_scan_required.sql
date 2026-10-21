-- Purposes whose uploads are NOT virus-scanned (WP-ADM-02, FR-ADM-07; PO decision 20 Oct 2026 — like Kawadir
-- ATS, which stores logos in a public bucket and shows them at once): the branding images (logo, favicon,
-- sign-in picture) show as soon as the Organization Admin saves the Branding page, without waiting for the
-- worker's malware scan (hosted production runs it only every few hours, and not at all with FILE_SCANNING
-- off). ADR 0006 amendment of 20 Oct 2026; docs/engineering/files.md §2, branding.md §2.
--
--   platform.file_purposes.scan_required  true (the default, every existing purpose): uploads are scanned
--                                         by the worker and usable only once `clean` — unchanged.
--                                         false: uploads are never scanned; what still protects them is
--                                         the type check BY CONTENT (raster images only: PNG, JPEG or
--                                         WebP; never SVG, GIF or HTML), the size and pixel limits and the
--                                         removal of metadata before anything is published (the published
--                                         copy, platform.brand_assets). Such a file is never `clean`: it
--                                         becomes `accepted` (20261023100500) and is usable by the
--                                         branding paths only — never downloadable, never readable by
--                                         module jobs (they all require `clean`).
--   file_purposes_scan_required_check     an unscanned purpose can only be one users upload into the
--                                         `images` bucket with raster image types: no document, archive,
--                                         spreadsheet or generated file can ever skip the scan.
-- Mirror: FILE_PURPOSES[*].scanRequired in packages/platform-files/src/purposes.ts (an integration test keeps
-- both equal). Expand-first: a column with a constant default; older code ignores it.
set lock_timeout = '5s';

alter table platform.file_purposes add column scan_required boolean not null default true;
comment on column platform.file_purposes.scan_required is
  'false: uploads of this purpose are not virus-scanned (PO, 20 Oct 2026: branding images, like Kawadir); type by content, size, pixel limits and metadata removal still apply; such files become accepted, never clean.';

alter table platform.file_purposes add constraint file_purposes_scan_required_check check (
  scan_required
  or (upload_by = 'user' and bucket = 'images'
      and allowed_types <@ array['image/png', 'image/jpeg', 'image/webp']::text[])) not valid;
alter table platform.file_purposes validate constraint file_purposes_scan_required_check;

update platform.file_purposes set scan_required = false
where purpose in ('platform.brand_logo', 'platform.brand_favicon', 'platform.brand_sign_in_image');
