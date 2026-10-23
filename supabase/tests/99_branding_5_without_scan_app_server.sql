-- db-test: run-as=app_server
-- Branding images published at save time, without a malware scan (WP-ADM-02, FR-ADM-07; PO decision 20 Oct
-- 2026; private.publish_brand_image, 20261023100600): in the Branding save's transaction the web app stores
-- the copy of the image it read with the uploader's session — only an Organization Admin
-- (platform.tenant.manage), only their OWN upload of that branding purpose for their organization, only
-- while the Branding uses it for that kind, only with bytes that are the stored file's; the file becomes
-- `accepted` (never clean, never downloadable). Runs CONNECTED AS app_server (fixtures: 00, 65,
-- 99_branding_0).
\set ON_ERROR_STOP on

do $$ begin perform tests.assert(session_user = 'app_server', 'must run connected as app_server'); end $$;

begin;
set local role authenticated;
do $$
declare
  v_a constant uuid := 'a0000000-0000-4000-8000-000000000001';
  v_img constant uuid := 'f0a20000-0000-4000-8000-000000000005';
  v_png constant bytea := tests.brand_png();
  v_sha constant text := encode(sha256(tests.brand_png()), 'hex');
  v_id uuid;
begin
  -- uA, the Organization Admin of A: the sign-in image is not used by the Branding yet → nothing.
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', v_a,
                                             'a1000000-0000-4000-8000-0000000000a1'));
  perform tests.assert(private.publish_brand_image(v_img, 'sign_in_image', v_sha, 16, 'image/png', v_png) is null,
    'an image the Branding does not use is not published');
  -- Saved (the save's own transaction): now it is the sign-in image.
  perform tests.assert_eq(tests.rows_affected(format($q$update platform.tenant_branding set sign_in_image_file_id = %L$q$, v_img)),
    1::bigint, 'the admin saves the sign-in image (uploaded, not scanned)');

  -- Another kind, another tenant's file, a scanned purpose's file, a clean branding image: nothing.
  perform tests.assert(private.publish_brand_image(v_img, 'logo', v_sha, 16, 'image/png', v_png) is null,
    'a sign-in image is not published as the logo');
  perform tests.assert(private.publish_brand_image(v_img, 'bogus', v_sha, 16, 'image/png', v_png) is null, 'unknown kind: nothing');
  perform tests.assert(private.publish_brand_image('f0b20000-0000-4000-8000-000000000001', 'logo', v_sha, 16, 'image/png', v_png) is null,
    'never another tenant''s image');
  perform tests.assert(private.publish_brand_image('f0a20000-0000-4000-8000-000000000008', 'logo', v_sha, 16, 'image/png', v_png) is null,
    'never a file of another purpose (a profile photo)');
  perform tests.assert(private.publish_brand_image('f0a00000-0000-4000-8000-000000000001', 'logo', v_sha, 16, 'image/png', v_png) is null,
    'never an import file');
  perform tests.assert(private.publish_brand_image('f0a20000-0000-4000-8000-000000000001', 'logo', v_sha, 16, 'image/png', v_png) is null,
    'a clean (scanned) logo is the worker''s publish_brand_asset path');

  -- Bytes that are not the stored file's, or not an allowed image.
  perform tests.assert_fails_state_like(format('select private.publish_brand_image(%L, %L, %L, %L::bigint, %L, %L::bytea)', v_img::text, 'sign_in_image', v_sha, 16, 'image/gif', v_png),
    'JB003', '%not an allowed image type%', 'GIF is refused');
  perform tests.assert_fails_state_like(format('select private.publish_brand_image(%L, %L, %L, %L::bigint, %L, %L::bytea)', v_img::text, 'sign_in_image', v_sha, 16, 'image/svg+xml', v_png),
    'JB003', '%not an allowed image type%', 'SVG is refused');
  perform tests.assert_fails_state_like(format('select private.publish_brand_image(%L, %L, %L, %L::bigint, %L, %L::bytea)', v_img::text, 'sign_in_image', v_sha, 16, 'image/jpeg', v_png),
    'JB002', '%differs from the stored file%', 'a PNG is not a JPEG (the copy''s signature)');
  perform tests.assert_fails_state_like(format('select private.publish_brand_image(%L, %L, %L, %L::bigint, %L, %L::bytea)', v_img::text, 'sign_in_image', v_sha, 16, 'image/png', '\x3c68746d6c3e3c2f68746d6c3e3c2f3e'::bytea),
    'JB002', '%differs from the stored file%', 'HTML is not a PNG');
  perform tests.assert_fails_state_like(format('select private.publish_brand_image(%L, %L, %L, %L::bigint, %L, %L::bytea)', v_img::text, 'sign_in_image', v_sha, 16, 'image/png', v_png || '\x00'::bytea),
    'JB002', '%differs from the stored file%', 'a copy larger than the file is refused');
  perform tests.assert_fails_state_like(format('select private.publish_brand_image(%L, %L, %L, %L::bigint, %L, %L::bytea)', v_img::text, 'sign_in_image', v_sha, 16, 'image/png', ''::bytea),
    'JB002', '%differs from the stored file%', 'an empty copy is refused');
  perform tests.assert_fails_state_like(format('select private.publish_brand_image(%L, %L, %L, %L::bigint, %L, %L::bytea)', v_img::text, 'sign_in_image', v_sha, 5242881, 'image/png', v_png),
    'JB002', '%differs from the stored file%', 'a source over the purpose''s limit is refused');
  perform tests.assert_fails_state_like(format('select private.publish_brand_image(%L, %L, %L, %L::bigint, %L, %L::bytea)', v_img::text, 'sign_in_image', 'not-a-hash', 16, 'image/png', v_png),
    'JB002', '%differs from the stored file%', 'a source without its SHA-256 is refused');
  perform tests.assert_fails_state_like(format('select private.publish_brand_image(%L, %L, %L, %L::bigint, %L, %L::bytea)', v_img::text, 'sign_in_image', v_sha, null::bigint, 'image/png', v_png),
    'JB002', '%differs from the stored file%', 'a source without its size is refused');

  perform tests.assert_fails_state_like(format('select private.publish_brand_image(%L, %L, %L, %L::bigint, %L, %L::bytea)', v_img::text, 'sign_in_image', v_sha, 15, 'image/png', substring(v_png from 1 for 15)),
    'JB002', '%differs from the stored file%', 'a size read that is not the size Storage reports is refused');

  -- The real thing: published at once, the file accepted with what was read (never clean).
  v_id := private.publish_brand_image(v_img, 'sign_in_image', v_sha, 16, 'image/png', v_png);
  perform tests.assert(v_id is not null, 'the sign-in image is published at save time');
  perform tests.assert((select status = 'accepted' and status_reason = 'scan_not_required' and detected_mime = 'image/png'
                               and size_bytes = 16 and sha256 = v_sha and scanned_at is null and scan_engine is null
                        from platform.files where id = v_img),
    'the file is accepted (type, size, hash of the bytes read) — no scan recorded');
  perform tests.assert((select kind = 'sign_in_image' and content_type = 'image/png' and byte_size = 16 and sha256 = v_sha
                        from platform.brand_assets where id = v_id), 'the copy is stored (its bytes: SQL never reads them)');
  perform tests.assert_eq(private.publish_brand_image(v_img, 'sign_in_image', v_sha, 16, 'image/png', v_png), v_id,
    'publishing again: the same copy');
  perform tests.assert_fails_state_like(format('select private.publish_brand_image(%L, %L, %L, %L::bigint, %L, %L::bytea)', v_img::text, 'sign_in_image', repeat('e', 64), 16, 'image/png', v_png),
    'JB002', '%differs from the stored file%', 'an accepted file again: only with the bytes accepted');

  -- Accepted is not clean: no download grant, no use mark.
  perform tests.assert_fails(format($q$select * from private.grant_file_download(%L, 'platform.brand_sign_in_image', 'platform', 'tenant_branding', %L)$q$, v_img, v_a),
    array['JF008'], 'an accepted file is never downloadable');
  perform tests.assert_fails(format($q$select private.mark_file_used(%L)$q$, v_img), array['JF008'],
    'nor used as a scanned file');

  -- The sign-in page shows it at once (claim-less public delivery path).
  perform tests.set_claims(null);
  perform tests.assert_eq((select sign_in_image_asset_id from private.public_tenant_brand('tenant-a')), v_id,
    'the sign-in page names the published copy');
  perform tests.assert_eq((select content from private.public_brand_asset(v_id)), v_png, 'and it is served');

  -- Replaced (removed): the copy goes, the file is deleted; publishing it again does nothing.
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', v_a,
                                             'a1000000-0000-4000-8000-0000000000a1'));
  perform tests.assert_eq(tests.rows_affected($q$update platform.tenant_branding set sign_in_image_file_id = null$q$), 1::bigint,
    'the sign-in image is removed');
  perform tests.assert_eq((select status from platform.files where id = v_img), 'deleted', 'the accepted file is deleted');
  perform tests.assert_eq((select count(*) from platform.brand_assets where id = v_id), 0::bigint, 'its copy is removed');
  perform tests.assert(private.publish_brand_image(v_img, 'sign_in_image', v_sha, 16, 'image/png', v_png) is null,
    'a replaced image is never published again');
end $$;
rollback;

-- Who may publish: the Organization Admin, their own upload only.
begin;
set local role authenticated;
do $$
declare
  v_a constant uuid := 'a0000000-0000-4000-8000-000000000001';
  v_img constant uuid := 'f0a20000-0000-4000-8000-000000000005';
  v_png constant bytea := tests.brand_png();
  v_sha constant text := encode(sha256(tests.brand_png()), 'hex');
begin
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', v_a,
                                             'a1000000-0000-4000-8000-0000000000a1'));
  perform tests.assert_eq(tests.rows_affected(format($q$update platform.tenant_branding set sign_in_image_file_id = %L$q$, v_img)),
    1::bigint, 'uA saves the sign-in image');
  -- uA2, the second Organization Admin of A: not their upload.
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c09', '10000000-0000-4000-8000-000000000c91', v_a,
                                             'a1000000-0000-4000-8000-000000000c09'));
  perform tests.assert(private.publish_brand_image(v_img, 'sign_in_image', v_sha, 16, 'image/png', v_png) is null,
    'another admin never publishes someone else''s upload');
  -- The HR Manager of A (fresh code): not an Organization Admin.
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab', v_a,
                                             'a1000000-0000-4000-8000-0000000000ab') || tests.fresh_code());
  perform tests.assert_fails(format('select private.publish_brand_image(%L, %L, %L, %L::bigint, %L, %L::bytea)', v_img::text, 'sign_in_image', v_sha, 16, 'image/png', v_png), array['42501'],
    'an HR Manager cannot publish branding images');
  -- A learner: neither.
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c01', '10000000-0000-4000-8000-000000000c11', v_a,
                                             'a1000000-0000-4000-8000-000000000c01'));
  perform tests.assert_fails(format('select private.publish_brand_image(%L, %L, %L, %L::bigint, %L, %L::bytea)', v_img::text, 'sign_in_image', v_sha, 16, 'image/png', v_png), array['42501'],
    'a learner cannot publish branding images');
  -- B's Organization Admin (in B): A's image does not exist for them.
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1',
                                             'b0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-0000000000b1'));
  perform tests.assert(private.publish_brand_image(v_img, 'sign_in_image', v_sha, 16, 'image/png', v_png) is null,
    'another organization''s admin never publishes A''s image');
  -- Forged system claims under app_server, and no claims at all.
  perform tests.set_claims(tests.system_claims(v_a));
  perform tests.assert_fails(format('select private.publish_brand_image(%L, %L, %L, %L::bigint, %L, %L::bytea)', v_img::text, 'sign_in_image', v_sha, 16, 'image/png', v_png), array['42501'],
    'forged system claims under app_server cannot publish');
  perform tests.set_claims(null);
  perform tests.assert_fails(format('select private.publish_brand_image(%L, %L, %L, %L::bigint, %L, %L::bytea)', v_img::text, 'sign_in_image', v_sha, 16, 'image/png', v_png), array['42501'],
    'no claims: no publishing');
  -- Nothing was published by any of them.
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', v_a,
                                             'a1000000-0000-4000-8000-0000000000a1'));
  perform tests.assert_eq((select status from platform.files where id = v_img), 'uploaded', 'the file is still waiting');
  perform tests.assert_eq((select count(*) from platform.brand_assets where file_id = v_img), 0::bigint, 'no copy');
end $$;
rollback;

\echo '99_branding_5_without_scan_app_server: ok'
