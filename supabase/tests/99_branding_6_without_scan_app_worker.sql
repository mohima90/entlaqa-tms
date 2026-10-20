-- db-test: run-as=app_worker
-- Branding images without a malware scan, worker side (WP-ADM-02; PO decision 20 Oct 2026; 20261023100600):
-- the scan never leases an upload of a purpose without a scan (a scanned purpose's upload still is); the
-- publishing task's fallback finds images in use that are uploaded or accepted but not published and stores
-- their copy in the image's tenant (private.publish_brand_image) — never another tenant's, never without a
-- tenant. Runs CONNECTED AS app_worker (fixtures: 00, 99_branding_0, the end of 99_branding_4: A's favicon is
-- the uploaded f0a2…07).
\set ON_ERROR_STOP on

do $$ begin perform tests.assert(session_user = 'app_worker', 'must run connected as app_worker'); end $$;

-- The scan: the profile photo (scanned purpose) is leased; the branding uploads never are.
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
  perform tests.assert('f0a20000-0000-4000-8000-000000000008' = any (v_claimed),
    'an upload of a scanned purpose is leased for the scan');
  perform tests.assert(not ('f0a20000-0000-4000-8000-000000000005' = any (v_claimed))
                       and not ('f0a20000-0000-4000-8000-000000000007' = any (v_claimed)),
    'branding uploads are never leased (no malware scan)');
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
