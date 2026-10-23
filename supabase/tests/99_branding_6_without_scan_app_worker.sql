-- db-test: run-as=app_worker
-- Branding images without a malware scan, worker side (WP-ADM-02; PO decision 20 Oct 2026; 20261023100600):
-- the scan never leases an upload of a purpose without a scan (a scanned purpose's upload still is); the
-- publishing task's fallback finds images in use that are uploaded or accepted but not published and stores
-- their copy in the image's tenant (private.publish_brand_image) — never another tenant's, never without a
-- tenant. Housekeeping removes the raw objects of such uploads once nothing needs them (security review M1).
-- Runs CONNECTED AS app_worker (fixtures: 00, 99_branding_0, the end of 99_branding_4: A's favicon is the
-- uploaded f0a2…07; f0a2…0b/0c/0d).
\set ON_ERROR_STOP on

do $$ begin perform tests.assert(session_user = 'app_worker', 'must run connected as app_worker'); end $$;

-- The scan: an import upload (scanned purpose) is leased; the branding uploads and profile photos never are.
begin;
set local role authenticated;
do $$
declare
  v_claimed uuid[] := '{}';
  v_id uuid;
begin
  perform tests.set_claims(jsonb_build_object('role', 'system', 'job_id', 'tests.scan'));
  loop
    select c.id into v_id from private.claim_file_scan() c;
    exit when v_id is null;
    v_claimed := v_claimed || v_id;
  end loop;
  perform tests.assert('f0a20000-0000-4000-8000-00000000000e' = any (v_claimed),
    'an upload of a scanned purpose is leased for the scan');
  perform tests.assert(not ('f0a20000-0000-4000-8000-000000000005' = any (v_claimed))
                       and not ('f0a20000-0000-4000-8000-000000000007' = any (v_claimed))
                       and not ('f0a20000-0000-4000-8000-000000000008' = any (v_claimed)),
    'branding uploads and profile photos are never leased (no malware scan)');
end $$;
rollback;

-- The fallback: A's favicon (uploaded, used, not published) is due and published in A only.
begin;
set local role authenticated;
do $$
declare
  v_a constant uuid := 'a0000000-0000-4000-8000-000000000001';
  v_img constant uuid := 'f0a20000-0000-4000-8000-000000000007';
  v_png constant bytea := tests.brand_png();
  v_sha constant text := encode(sha256(tests.brand_png()), 'hex');
  v_id uuid;
begin
  perform tests.set_claims(jsonb_build_object('role', 'system', 'job_id', 'tests.brand_assets'));
  perform tests.assert_eq((select string_agg(file_id::text || ':' || kind, ',') from private.claim_brand_asset_work(10)),
    v_img::text || ':favicon', 'the uploaded favicon in use is due (no scan to wait for)');
  perform tests.assert_fails(format('select private.publish_brand_image(%L, %L, %L, 16, %L, %L::bytea)', v_img, 'favicon',
                                    v_sha, 'image/png', v_png),
    array['42501'], 'a platform transaction cannot publish');
  perform tests.set_claims(tests.system_claims('b0000000-0000-4000-8000-000000000001'));
  perform tests.assert(private.publish_brand_image(v_img, 'favicon', v_sha, 16, 'image/png', v_png) is null,
    'never another tenant''s image');
  perform tests.set_claims(tests.system_claims(v_a));
  perform tests.assert(private.publish_brand_image(v_img, 'logo', v_sha, 16, 'image/png', v_png) is null,
    'a favicon is not published as the logo');
  perform tests.assert_fails_state_like(format('select private.publish_brand_image(%L, %L, %L, 16, %L, %L::bytea)', v_img,
                                               'favicon', v_sha, 'image/webp', v_png),
    'JB002', '%differs from the stored file%', 'a PNG is not a WebP');
  v_id := private.publish_brand_image(v_img, 'favicon', v_sha, 16, 'image/png', v_png);
  perform tests.assert(v_id is not null, 'the worker publishes the favicon');
  perform tests.assert((select status = 'accepted' and sha256 = v_sha and size_bytes = 16 from platform.files where id = v_img),
    'the file is accepted');
  perform tests.assert_eq(private.publish_brand_image(v_img, 'favicon', v_sha, 16, 'image/png', v_png), v_id,
    'publishing again: the same copy');
  -- The scanned path never takes an unscanned file.
  perform tests.assert(private.publish_brand_asset(v_img, 'favicon', v_sha, v_png) is null,
    'publish_brand_asset (clean files) does not publish an accepted file');
  perform tests.set_claims(jsonb_build_object('role', 'system', 'job_id', 'tests.brand_assets'));
  perform tests.assert_eq((select count(*) from private.claim_brand_asset_work(10)), 0::bigint, 'nothing left to publish');
  -- Accepted with its copy published: the raw upload's object is removed (security review M1).
  perform tests.assert(private.lock_file_housekeeping(v_img, 'remove_object'),
    'published: the original object is due for removal (the copy is served)');
  perform tests.assert(private.finish_file_housekeeping(v_img, 'remove_object'), 'removal recorded');
  perform tests.assert(not private.lock_file_housekeeping(v_img, 'remove_object'), 'once');
  perform tests.set_claims(tests.system_claims(v_a));
  perform tests.assert((select status = 'accepted' and object_removed_at is not null from platform.files where id = v_img),
    'the record stays (the Branding uses it), its object gone');
end $$;
rollback;

-- Housekeeping of uploads without a scan (security review M1): their raw objects never outlive their use.
begin;
set local role authenticated;
do $$
begin
  perform tests.set_claims(jsonb_build_object('role', 'system', 'job_id', 'tests.housekeeping'));
  perform tests.assert_eq(
    (select string_agg(h.id::text || ':' || h.action, ',' order by h.id) from private.claim_file_housekeeping(500) h
     where h.id::text like 'f0a20000-%'),
    'f0a20000-0000-4000-8000-000000000006:remove_object,'   -- rejected (as before, 20261015090000)
    'f0a20000-0000-4000-8000-000000000007:remove_object,'   -- uploaded 2 days ago, used, never published
    'f0a20000-0000-4000-8000-00000000000b:purge,'           -- uploaded 2 days ago, used by no Branding
    'f0a20000-0000-4000-8000-00000000000c:remove_object',   -- deleted (replaced): the object goes, the record stays
    'due: unpublished uploads after 24 hours, deleted ones at once; never a fresh upload (…05) or an accepted file without its copy (…0d)');
  -- Under the row lock, the same rule.
  perform tests.assert(not private.lock_file_housekeeping('f0a20000-0000-4000-8000-000000000005', 'purge')
                       and not private.lock_file_housekeeping('f0a20000-0000-4000-8000-000000000005', 'remove_object'),
    'a fresh upload waiting for the save is left alone');
  perform tests.assert(not private.lock_file_housekeeping('f0a20000-0000-4000-8000-000000000007', 'purge'),
    'an upload the Branding uses is never purged (only its object removed)');
  perform tests.assert(not private.lock_file_housekeeping('f0a20000-0000-4000-8000-00000000000d', 'remove_object'),
    'an accepted file without its published copy keeps its object (the worker may still publish it)');
  perform tests.assert(private.finish_file_housekeeping('f0a20000-0000-4000-8000-00000000000c', 'remove_object'),
    'a deleted upload: object removal recorded');
  perform tests.assert(private.finish_file_housekeeping('f0a20000-0000-4000-8000-000000000007', 'remove_object'),
    'an unpublished upload in use: object removal recorded');
  perform tests.assert_eq((select count(*) from private.claim_brand_asset_work(10) w
                           where w.file_id = 'f0a20000-0000-4000-8000-000000000007'), 0::bigint,
    'an image whose object is gone is no longer due for publishing');
  perform tests.assert(private.finish_file_housekeeping('f0a20000-0000-4000-8000-00000000000b', 'purge'), 'purged');
  -- A scanned purpose's upload (an import) is never touched by the rule for purposes without a scan.
  perform tests.assert(not private.finish_file_housekeeping('f0a20000-0000-4000-8000-00000000000e', 'remove_object'),
    'a scanned purpose''s waiting upload is never touched by the unscanned rule');
  -- What was recorded, read as a job of A (RLS: the file's tenant).
  perform tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001'));
  perform tests.assert((select status = 'deleted' and object_removed_at is not null
                        from platform.files where id = 'f0a20000-0000-4000-8000-00000000000c'), 'the deleted record stays for its retention');
  perform tests.assert((select status = 'uploaded' and object_removed_at is not null
                        from platform.files where id = 'f0a20000-0000-4000-8000-000000000007'), 'the unpublished record stays, its object gone');
  perform tests.assert_eq((select count(*) from platform.files where id = 'f0a20000-0000-4000-8000-00000000000b'), 0::bigint,
    'the abandoned upload''s record is gone');
end $$;
rollback;

-- Expand-first: an older worker (clean files only) reports FILE_NOT_CLEAN for an image without a scan — not
-- counted; a real failure of the image still is.
begin;
set local role authenticated;
do $$
begin
  perform tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001'));
  perform tests.assert_eq(private.note_brand_asset_failure('f0a20000-0000-4000-8000-000000000007', 'FILE_NOT_CLEAN'), 0,
    'an older worker''s FILE_NOT_CLEAN for an unscanned image is not counted');
  perform tests.assert_eq(private.note_brand_asset_failure('f0a20000-0000-4000-8000-000000000007', 'TYPE_NOT_ALLOWED'), 1,
    'a failure of the image itself is');
end $$;
rollback;

\echo '99_branding_6_without_scan_app_worker: ok'
