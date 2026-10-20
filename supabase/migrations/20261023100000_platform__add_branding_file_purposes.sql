-- Branding images (WP-ADM-02, FR-ADM-07; business flow EP-BRAND, agreed 20 Oct 2026, BR-BRD-b): three new
-- file purposes for the Organization Admin's Branding page. PNG, JPEG or WebP only — detected by CONTENT by
-- the worker's scan (never SVG: it can carry scripts; never GIF) — with Kawadir's limits: logo 2 MB,
-- favicon 500 KB, sign-in page image 5 MB. Bucket `images` (private, 10 MB; migration 20261015090100):
-- the files are uploaded and scanned like every other upload (ADR 0006); what the sign-in page, the
-- browser tab and e-mails show is a COPY of a clean file published by the worker
-- (20261023100100_platform__create_brand_assets.sql), without its metadata (EXIF/XMP). Retention
-- `owner_lifetime`: a replaced or removed image is marked deleted (20261023100200_platform__create_
-- tenant_branding.sql) and purged 30 days later. Downloads are not audited (no
-- personal data: an organization's public look); grants live 300 s like other media.
-- Mirror: FILE_PURPOSES in packages/platform-files/src/purposes.ts (an integration test keeps both equal).

insert into platform.file_purposes (purpose, bucket, max_bytes, allowed_types, retention_class, upload_by,
                                    audit_downloads, download_ttl_seconds) values
  ('platform.brand_logo', 'images', 2097152, array['image/png', 'image/jpeg', 'image/webp'],
   'owner_lifetime', 'user', false, 300),
  ('platform.brand_favicon', 'images', 512000, array['image/png', 'image/jpeg', 'image/webp'],
   'owner_lifetime', 'user', false, 300),
  ('platform.brand_sign_in_image', 'images', 5242880, array['image/png', 'image/jpeg', 'image/webp'],
   'owner_lifetime', 'user', false, 300);
