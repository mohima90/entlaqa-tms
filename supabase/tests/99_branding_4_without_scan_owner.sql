-- db-test: run-as=owner
-- Branding images without a malware scan (WP-ADM-02, FR-ADM-07; PO decision 20 Oct 2026, ADR 0006
-- amendment; migrations 20261023100400–100600): only the three branding purposes skip the scan, and no
-- purpose that is not a raster image users upload into `images` ever can; their uploads become `accepted`
-- (never `clean`) only through the write guard's one new move, with what the acceptance read; the publishing
-- function is file_guard's. Runs as the superuser connection (fixtures: 00, 99_branding_0). Ends with a
-- committed fixture for 99_branding_6 and 7: A's favicon becomes f0a2…07, an upload never accepted (the web
-- app's publication did not happen — e.g. Storage was unreachable — so the worker's fallback is due).
\set ON_ERROR_STOP on

do $$
declare
  r record;
begin
  perform tests.assert_eq((select string_agg(purpose, ',' order by purpose) from platform.file_purposes where not scan_required),
    'platform.brand_favicon,platform.brand_logo,platform.brand_sign_in_image',
    'only the three branding images are not scanned');
  perform tests.assert((select bool_and(scan_required) from platform.file_purposes
                        where purpose in ('platform.user_import', 'platform.user_import_report', 'platform.profile_photo')),
    'imports, generated reports and profile photos are still scanned');
  -- publish_brand_image: SECURITY DEFINER owned by file_guard, callable inside user / job transactions only.
  perform tests.assert((select p.prosecdef and pg_get_userbyid(p.proowner) = 'file_guard'
                        from pg_proc p where p.oid = 'private.publish_brand_image(uuid,text,text,bigint,text,bytea)'::regprocedure),
    'publish_brand_image: SECURITY DEFINER owned by file_guard');
  perform tests.assert(not has_function_privilege('anon', 'private.publish_brand_image(uuid,text,text,bigint,text,bytea)', 'execute'),
    'publish_brand_image: not callable by anon');
  perform tests.assert(not has_function_privilege('public', 'private.publish_brand_image(uuid,text,text,bigint,text,bytea)', 'execute'),
    'publish_brand_image: not callable by PUBLIC');
  -- file_guard's new reads are the permission check's, column by column, nothing to write.
  perform tests.assert(has_column_privilege('file_guard', 'platform.role_assignments', 'role_code', 'select')
                       and not has_column_privilege('file_guard', 'platform.role_assignments', 'created_by', 'select')
                       and not has_table_privilege('file_guard', 'platform.role_assignments', 'insert, update, delete')
                       and not has_table_privilege('file_guard', 'platform.custom_roles', 'insert, update, delete'),
    'file_guard reads role assignments for the permission check only');
end $$;

-- The purpose rule: no document, archive, spreadsheet or generated file can skip the scan.
begin;
do $$
begin
  perform tests.assert_check_constraint($q$update platform.file_purposes set scan_required = false where purpose = 'platform.user_import'$q$,
    'file_purposes_scan_required_check', 'an import is always scanned');
  perform tests.assert_check_constraint($q$update platform.file_purposes set scan_required = false where purpose = 'platform.user_import_report'$q$,
    'file_purposes_scan_required_check', 'a generated file is always scanned (it is made from scanned inputs)');
  perform tests.assert_check_constraint($q$update platform.file_purposes set allowed_types = array['image/png', 'image/svg+xml'] where purpose = 'platform.brand_logo'$q$,
    'file_purposes_scan_required_check', 'an unscanned purpose never accepts SVG');
  perform tests.assert_check_constraint($q$update platform.file_purposes set allowed_types = array['image/png', 'application/pdf'] where purpose = 'platform.brand_logo'$q$,
    'file_purposes_scan_required_check', 'nor a document');
end $$;
rollback;

-- The write guard: uploaded → accepted only for a purpose without a scan, with what the acceptance read;
-- accepted → deleted only; what was accepted never changes.
begin;
do $$
declare
  v_brand constant uuid := 'f0a20000-0000-4000-8000-000000000005';
  v_photo constant uuid := 'f0a20000-0000-4000-8000-000000000008';
  v_sha constant text := encode(sha256(tests.brand_png()), 'hex');
begin
  perform tests.assert_fails(format($q$update platform.files set status = 'accepted', detected_mime = 'image/png', size_bytes = 16, sha256 = %L where id = %L$q$, v_sha, v_photo),
    array['42501'], 'a profile photo (scanned purpose) is never accepted without its scan');
  perform tests.assert_fails(format($q$update platform.files set status = 'accepted', detected_mime = 'image/png', size_bytes = 16, sha256 = %L where id = 'f0a20000-0000-4000-8000-000000000002'$q$, v_sha),
    array['42501'], 'a clean file does not become accepted');
  perform tests.assert_check_constraint(format($q$update platform.files set status = 'accepted' where id = %L$q$, v_brand),
    'files_accepted_check', 'an accepted file has its type, size and hash');
  perform tests.assert_eq(tests.rows_affected(format($q$update platform.files set status = 'accepted', status_reason = 'scan_not_required', detected_mime = 'image/png', size_bytes = 16, sha256 = %L where id = %L$q$, v_sha, v_brand)),
    1::bigint, 'a branding image upload becomes accepted');
  perform tests.assert_fails(format($q$update platform.files set sha256 = repeat('e', 64) where id = %L$q$, v_brand),
    array['42501'], 'what the acceptance read never changes');
  perform tests.assert_fails(format($q$update platform.files set status = 'clean', scanned_at = now() where id = %L$q$, v_brand),
    array['42501'], 'an accepted file never becomes clean');
  perform tests.assert_fails(format($q$update platform.files set status = 'uploaded' where id = %L$q$, v_brand),
    array['42501'], 'nor goes back');
  -- Released by the Branding (replaced or removed): deleted, its copy gone.
  insert into platform.brand_assets (tenant_id, file_id, kind, content_type, content, byte_size, sha256)
  values ('a0000000-0000-4000-8000-000000000001', v_brand, 'sign_in_image', 'image/png', tests.brand_png(),
          octet_length(tests.brand_png()), v_sha);
  perform private.release_branding_file('a0000000-0000-4000-8000-000000000001', v_brand);
  perform tests.assert_eq((select status from platform.files where id = v_brand), 'deleted', 'a released accepted image is deleted');
  perform tests.assert_eq((select count(*) from platform.brand_assets where file_id = v_brand), 0::bigint, 'and its copy removed');
end $$;
rollback;

-- Permission and ownership apart (security review M3): an upload that is the caller's OWN, of the right
-- purpose and used by the Branding (a state only an owner fixture reaches — e.g. an admin demoted after
-- saving it) is still refused to a member without platform.tenant.manage. The web app's login role is
-- taken for the transaction (SET LOCAL SESSION AUTHORIZATION: publish_brand_image tells app_server from
-- app_worker by the login role).
begin;
alter table platform.files disable trigger files_transition;
insert into platform.files (id, tenant_id, bucket, object_key, purpose, owner_module, owner_entity_type, owner_entity_id,
    original_name, declared_mime, declared_size, size_bytes, status, retention_class, created_by_user, upload_expires_at,
    uploaded_at) values
  ('f0a20000-0000-4000-8000-000000000009', 'a0000000-0000-4000-8000-000000000001', 'images',
   'a0000000-0000-4000-8000-000000000001/platform/tenant_branding/a0000000-0000-4000-8000-000000000001/f0a20000-0000-4000-8000-000000000009',
   'platform.brand_sign_in_image', 'platform', 'tenant_branding', 'a0000000-0000-4000-8000-000000000001', 'hr.png',
   'image/png', octet_length(tests.brand_png()), octet_length(tests.brand_png()), 'uploaded', 'owner_lifetime',
   '00000000-0000-4000-8000-0000000000ab', now() + interval '15 minutes', now());
alter table platform.files enable trigger files_transition;
insert into storage.objects (bucket_id, name, owner, metadata) values
  ('images', 'a0000000-0000-4000-8000-000000000001/platform/tenant_branding/a0000000-0000-4000-8000-000000000001/f0a20000-0000-4000-8000-000000000009',
   '00000000-0000-4000-8000-0000000000ab', jsonb_build_object('size', octet_length(tests.brand_png()), 'mimetype', 'image/png'));
alter table platform.tenant_branding disable trigger tenant_branding_stamp;
alter table platform.tenant_branding disable trigger tenant_branding_files;
update platform.tenant_branding set sign_in_image_file_id = 'f0a20000-0000-4000-8000-000000000009'
where tenant_id = 'a0000000-0000-4000-8000-000000000001';
alter table platform.tenant_branding enable trigger tenant_branding_stamp;
alter table platform.tenant_branding enable trigger tenant_branding_files;
set local session authorization app_server;
set local role authenticated;
do $$
declare
  v_img constant uuid := 'f0a20000-0000-4000-8000-000000000009';
  v_sha constant text := encode(sha256(tests.brand_png()), 'hex');
begin
  perform tests.assert(session_user = 'app_server', 'the web app''s login role');
  -- uAB, the HR Manager of A, with a fresh code: the upload is theirs, in use — no permission.
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
                                             'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000ab')
                           || tests.fresh_code());
  perform tests.assert_fails(format('select private.publish_brand_image(%L, %L, %L, %L::bigint, %L, %L::bytea)', v_img::text,
                                    'sign_in_image', v_sha, 16, 'image/png', tests.brand_png()),
    array['42501'], 'a non-admin never publishes, not even their own upload in use');
  -- uA, the Organization Admin: the permission, but not their upload — nothing published.
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
                                             'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
  perform tests.assert(private.publish_brand_image(v_img, 'sign_in_image', v_sha, 16, 'image/png', tests.brand_png()) is null,
    'an Organization Admin never publishes someone else''s upload');
  perform tests.assert_eq((select count(*) from platform.brand_assets where file_id = v_img), 0::bigint, 'no copy');
end $$;
rollback;

-- The stored object must exist (security review L3): Storage's row missing → refused, never a skipped size
-- comparison.
begin;
delete from storage.objects
where bucket_id = 'images'
  and name = 'a0000000-0000-4000-8000-000000000001/platform/tenant_branding/a0000000-0000-4000-8000-000000000001/f0a20000-0000-4000-8000-000000000005';
alter table platform.tenant_branding disable trigger tenant_branding_stamp;
alter table platform.tenant_branding disable trigger tenant_branding_files;
update platform.tenant_branding set sign_in_image_file_id = 'f0a20000-0000-4000-8000-000000000005'
where tenant_id = 'a0000000-0000-4000-8000-000000000001';
alter table platform.tenant_branding enable trigger tenant_branding_stamp;
alter table platform.tenant_branding enable trigger tenant_branding_files;
set local session authorization app_server;
set local role authenticated;
do $$
declare
  v_img constant uuid := 'f0a20000-0000-4000-8000-000000000005';
  v_sha constant text := encode(sha256(tests.brand_png()), 'hex');
begin
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
                                             'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
  perform tests.assert_fails_state_like(format('select private.publish_brand_image(%L, %L, %L, %L::bigint, %L, %L::bytea)', v_img::text,
                                               'sign_in_image', v_sha, 16, 'image/png', tests.brand_png()),
    'JB002', '%differs from the stored file%', 'no Storage object: refused');
  perform tests.assert_eq((select status from platform.files where id = v_img), 'uploaded', 'the file is not accepted');
end $$;
rollback;

-- Fixtures for 99_branding_6/7 (committed, platform operations):
--   A's favicon is the uploaded f0a2…07 (two days old, used, never published);
--   f0a2…0b  logo, uploaded two days ago by uA, used by no Branding  → housekeeping purges it (review M1)
--   f0a2…0c  favicon, deleted (released) today, by uA                → its object is removed (review M1)
--   f0a2…0d  sign-in image, accepted today, by uA, not published     → nothing due; Storage never reads it
begin;
alter table platform.tenant_branding disable trigger tenant_branding_stamp;
alter table platform.tenant_branding disable trigger tenant_branding_files;
update platform.tenant_branding set favicon_file_id = 'f0a20000-0000-4000-8000-000000000007'
where tenant_id = 'a0000000-0000-4000-8000-000000000001';
alter table platform.tenant_branding enable trigger tenant_branding_stamp;
alter table platform.tenant_branding enable trigger tenant_branding_files;
alter table platform.files disable trigger files_transition;
insert into platform.files (id, tenant_id, bucket, object_key, purpose, owner_module, owner_entity_type, owner_entity_id,
    original_name, declared_mime, declared_size, detected_mime, size_bytes, sha256, status, status_reason, retention_class,
    created_by_user, upload_expires_at, uploaded_at, deleted_at)
select f.id, 'a0000000-0000-4000-8000-000000000001', 'images',
       'a0000000-0000-4000-8000-000000000001/platform/tenant_branding/a0000000-0000-4000-8000-000000000001/' || f.id::text,
       f.purpose, 'platform', 'tenant_branding', 'a0000000-0000-4000-8000-000000000001', f.name, 'image/png',
       octet_length(tests.brand_png()), case when f.status = 'accepted' then 'image/png' end, octet_length(tests.brand_png()),
       case when f.status = 'accepted' then encode(sha256(tests.brand_png()), 'hex') end, f.status,
       case when f.status = 'accepted' then 'scan_not_required' end, 'owner_lifetime',
       '00000000-0000-4000-8000-0000000000a1', now() + interval '15 minutes', now() - f.age,
       case when f.status = 'deleted' then now() end
from (values
  ('f0a20000-0000-4000-8000-00000000000b'::uuid, 'platform.brand_logo', 'abandoned.png', 'uploaded', interval '2 days'),
  ('f0a20000-0000-4000-8000-00000000000c', 'platform.brand_favicon', 'replaced.png', 'deleted', interval '0'),
  ('f0a20000-0000-4000-8000-00000000000d', 'platform.brand_sign_in_image', 'accepted.png', 'accepted', interval '0')
) as f (id, purpose, name, status, age);
alter table platform.files enable trigger files_transition;
commit;

\echo '99_branding_4_without_scan_owner: ok'
