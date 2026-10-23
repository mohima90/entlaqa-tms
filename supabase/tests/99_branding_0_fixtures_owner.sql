-- db-test: run-as=owner
-- Branding fixtures (WP-ADM-02) for 99_branding_1…7, committed as platform operations. Branding images of
-- tenant A (owner entity platform/tenant_branding/A), written as their scan left them (the write guard makes
-- every new file start pending_upload, so it is off for this insert only):
--   f0a2…01  logo, clean, by uA          A's logo, published as e0a2…01
--   f0a2…02  logo, clean, by uA          a replacement
--   f0a2…03  favicon, clean, by uA       A's favicon, not published yet (the worker's, 99_branding_3)
--   f0a2…04  logo, clean, by uA2 (…c09)  another admin's upload
--   f0a2…05  sign-in image, uploaded (not accepted yet: no scan since 20 Oct 2026), by uA
--   f0a2…06  logo, rejected by the scan, by uA
--   f0a2…07  favicon, uploaded two days ago (never accepted), by uA
-- plus f0a2…08, a profile photo (a SCANNED purpose) uploaded by uA and waiting for the scan (owner
-- platform/person/a1…a1; 99_branding_4…7: branding images without a scan),
-- and of tenant B: f0b2…01 logo, clean, by uB (B has no branding row yet: the Jadarat look). The bytes of
-- every image are tests.brand_png() (a PNG signature and header; size and SHA-256 recorded like a scan).
\set ON_ERROR_STOP on

create or replace function tests.brand_png() returns bytea
language sql immutable as $$ select '\x89504e470d0a1a0a0000000d49484452'::bytea $$;

begin;
alter table platform.files disable trigger files_transition;
insert into platform.files (id, tenant_id, bucket, object_key, purpose, owner_module, owner_entity_type, owner_entity_id,
    original_name, declared_mime, declared_size, detected_mime, size_bytes, sha256, status, status_reason, scan_engine,
    scan_signatures, scanned_at, retention_class, created_by_user, upload_expires_at, uploaded_at)
select f.id, f.tenant_id, 'images',
       f.tenant_id::text || '/platform/tenant_branding/' || f.tenant_id::text || '/' || f.id::text,
       f.purpose, 'platform', 'tenant_branding', f.tenant_id, f.name, 'image/png', octet_length(tests.brand_png()),
       case when f.status = 'clean' then 'image/png' end,
       case when f.status = 'clean' then octet_length(tests.brand_png()) end,
       case when f.status = 'clean' then encode(sha256(tests.brand_png()), 'hex') end,
       f.status, case when f.status = 'rejected' then 'type_not_allowed' end,
       case when f.status in ('clean', 'rejected') then 'ClamAV 1.5.4' end,
       case when f.status in ('clean', 'rejected') then '28137' end,
       case when f.status in ('clean', 'rejected') then now() end,
       'owner_lifetime', f.uploader, now() + interval '15 minutes', now()
from (values
  ('f0a20000-0000-4000-8000-000000000001'::uuid, 'a0000000-0000-4000-8000-000000000001'::uuid, 'platform.brand_logo', 'logo.png', 'clean', '00000000-0000-4000-8000-0000000000a1'::uuid),
  ('f0a20000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'platform.brand_logo', 'logo-2.png', 'clean', '00000000-0000-4000-8000-0000000000a1'),
  ('f0a20000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'platform.brand_favicon', 'icon.png', 'clean', '00000000-0000-4000-8000-0000000000a1'),
  ('f0a20000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001', 'platform.brand_logo', 'other.png', 'clean', '00000000-0000-4000-8000-000000000c09'),
  ('f0a20000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000001', 'platform.brand_sign_in_image', 'welcome.png', 'uploaded', '00000000-0000-4000-8000-0000000000a1'),
  ('f0a20000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000001', 'platform.brand_logo', 'bad.png', 'rejected', '00000000-0000-4000-8000-0000000000a1'),
  ('f0a20000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-000000000001', 'platform.brand_favicon', 'old.png', 'uploaded', '00000000-0000-4000-8000-0000000000a1'),
  ('f0b20000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'platform.brand_logo', 'logo-b.png', 'clean', '00000000-0000-4000-8000-0000000000b1')
) as f (id, tenant_id, purpose, name, status, uploader);
update platform.files set uploaded_at = now() - interval '2 days', created_at = now() - interval '2 days'
where id = 'f0a20000-0000-4000-8000-000000000007';
insert into platform.files (id, tenant_id, bucket, object_key, purpose, owner_module, owner_entity_type, owner_entity_id,
    original_name, declared_mime, declared_size, size_bytes, status, retention_class, created_by_user, upload_expires_at,
    uploaded_at) values
  ('f0a20000-0000-4000-8000-000000000008', 'a0000000-0000-4000-8000-000000000001', 'images',
   'a0000000-0000-4000-8000-000000000001/platform/person/a1000000-0000-4000-8000-0000000000a1/f0a20000-0000-4000-8000-000000000008',
   'platform.profile_photo', 'platform', 'person', 'a1000000-0000-4000-8000-0000000000a1', 'me.png', 'image/png',
   octet_length(tests.brand_png()), octet_length(tests.brand_png()), 'uploaded', 'owner_lifetime',
   '00000000-0000-4000-8000-0000000000a1', now() + interval '15 minutes', now());
-- A PURPOSE THAT IS STILL SCANNED, waiting for its scan: an import upload (profile photos stopped being
-- scanned with WP-ADM-04, PO 21 Oct 2026, so f0a2…08 above is no longer a scanned purpose's upload).
insert into platform.files (id, tenant_id, bucket, object_key, purpose, owner_module, owner_entity_type, owner_entity_id,
    original_name, declared_mime, declared_size, size_bytes, status, retention_class, created_by_user, upload_expires_at,
    uploaded_at) values
  ('f0a20000-0000-4000-8000-00000000000e', 'a0000000-0000-4000-8000-000000000001', 'imports',
   'a0000000-0000-4000-8000-000000000001/platform/user_import/a5000000-0000-4000-8000-000000000001/f0a20000-0000-4000-8000-00000000000e',
   'platform.user_import', 'platform', 'user_import', 'a5000000-0000-4000-8000-000000000001', 'staff.csv', 'text/csv',
   16, 16, 'uploaded', 'import', '00000000-0000-4000-8000-0000000000a1', now() + interval '15 minutes', now());
alter table platform.files enable trigger files_transition;

alter table platform.tenant_branding disable trigger tenant_branding_stamp;
alter table platform.tenant_branding disable trigger tenant_branding_files;
update platform.tenant_branding
set logo_file_id = 'f0a20000-0000-4000-8000-000000000001', favicon_file_id = 'f0a20000-0000-4000-8000-000000000003'
where tenant_id = 'a0000000-0000-4000-8000-000000000001';
alter table platform.tenant_branding enable trigger tenant_branding_stamp;
alter table platform.tenant_branding enable trigger tenant_branding_files;

-- Storage's objects of the uploaded sign-in image and of the old uploaded favicon (their reported size: the
-- publishing check, 99_branding_5 and 6 — a missing object is refused, review L3).
insert into storage.objects (bucket_id, name, owner, metadata) values
  ('images', 'a0000000-0000-4000-8000-000000000001/platform/tenant_branding/a0000000-0000-4000-8000-000000000001/f0a20000-0000-4000-8000-000000000005',
   '00000000-0000-4000-8000-0000000000a1', jsonb_build_object('size', octet_length(tests.brand_png()), 'mimetype', 'image/png')),
  ('images', 'a0000000-0000-4000-8000-000000000001/platform/tenant_branding/a0000000-0000-4000-8000-000000000001/f0a20000-0000-4000-8000-000000000007',
   '00000000-0000-4000-8000-0000000000a1', jsonb_build_object('size', octet_length(tests.brand_png()), 'mimetype', 'image/png'));

insert into platform.brand_assets (id, tenant_id, file_id, kind, content_type, content, byte_size, sha256) values
  ('e0a20000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'f0a20000-0000-4000-8000-000000000001',
   'logo', 'image/png', tests.brand_png(), octet_length(tests.brand_png()), encode(sha256(tests.brand_png()), 'hex'));
commit;

do $$
begin
  perform tests.assert_eq((select count(*) from platform.files where owner_entity_type = 'tenant_branding'), 8::bigint,
    'eight branding images in the fixtures');
end $$;

\echo '99_branding_0_fixtures_owner: ok'
