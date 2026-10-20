-- db-test: run-as=app_worker
-- Publishing branding images (WP-ADM-02): the worker finds the images an organization's Branding uses that
-- the scan found clean and that have no copy yet, and publishes a copy in the image's tenant — only when the
-- bytes are exactly what the scan checked; never for another tenant, never an image no longer used, and the
-- e-mail jobs read the organization's look (FR-NTF-02). Runs CONNECTED AS app_worker (fixtures: 00,
-- 99_branding_0).
\set ON_ERROR_STOP on

do $$ begin perform tests.assert(session_user = 'app_worker', 'must run connected as app_worker'); end $$;

begin;
set local role authenticated;
do $$
declare
  v_a constant uuid := 'a0000000-0000-4000-8000-000000000001';
  v_favicon constant uuid := 'f0a20000-0000-4000-8000-000000000003';
  v_id uuid;
begin
  -- A platform pass (no tenant): A's favicon is due; A's logo is published already.
  perform tests.set_claims(jsonb_build_object('role', 'system', 'job_id', 'tests.brand_assets'));
  perform tests.assert_eq((select count(*) from private.claim_brand_asset_work(10)), 1::bigint, 'one image to publish');
  perform tests.assert((select tenant_id = v_a and file_id = v_favicon and kind = 'favicon'
                        from private.claim_brand_asset_work(10)), 'A''s favicon');
  -- Publishing needs the image's tenant.
  perform tests.assert_fails(format('select private.publish_brand_asset(%L, %L, %L::bytea)', v_favicon, 'favicon', tests.brand_png()),
    array['42501'], 'a platform transaction cannot publish');

  -- In B's tenant: A's image does not exist.
  perform tests.set_claims(tests.system_claims('b0000000-0000-4000-8000-000000000001'));
  perform tests.assert(private.publish_brand_asset(v_favicon, 'favicon', tests.brand_png()) is null,
    'never another tenant''s image');

  -- In A's tenant: wrong kind, other bytes, then the real thing (idempotent).
  perform tests.set_claims(tests.system_claims(v_a));
  perform tests.assert(private.publish_brand_asset(v_favicon, 'logo', tests.brand_png()) is null,
    'a favicon is not published as the logo');
  perform tests.assert(private.publish_brand_asset(v_favicon, 'bogus', tests.brand_png()) is null, 'unknown kind: nothing');
  perform tests.assert_fails_state_like(format('select private.publish_brand_asset(%L, %L, %L::bytea)', v_favicon, 'favicon',
                                               tests.brand_png() || '\x00'::bytea),
    'JB002', '%differs from the scanned file%', 'bytes other than the scanned ones are refused');
  perform tests.assert_fails_state_like(format('select private.publish_brand_asset(%L, %L, %L::bytea)', v_favicon, 'favicon',
                                               '\x89504e470d0a1a0a0000000d49484453'),
    'JB002', '%differs from the scanned file%', 'same size, other bytes: refused (SHA-256)');
  v_id := private.publish_brand_asset(v_favicon, 'favicon', tests.brand_png());
  perform tests.assert(v_id is not null, 'the favicon is published');
  perform tests.assert_eq(private.publish_brand_asset(v_favicon, 'favicon', tests.brand_png()), v_id, 'publishing again: the same copy');
  perform tests.assert((select kind = 'favicon' and content_type = 'image/png' and byte_size = octet_length(tests.brand_png())
                        from platform.brand_assets where id = v_id), 'the copy carries the detected type and size');
  -- The e-mail jobs read the organization's look (colours) in its tenant.
  perform tests.assert_eq((select email_action_color from platform.tenant_branding), '#0F6E5A', 'jobs read the e-mail colours');
  perform tests.assert_eq((select count(*) from platform.tenant_branding where tenant_id <> v_a), 0::bigint,
    'and only their tenant''s');
  -- Jobs never change the look nor the copies.
  perform tests.assert_eq(tests.rows_affected('update platform.tenant_branding set use_gradient = false'), 0::bigint,
    'a job cannot change the branding');
  perform tests.assert_privilege_denied($q$delete from platform.brand_assets$q$, 'a job cannot delete copies directly');

  -- Nothing left to do.
  perform tests.set_claims(jsonb_build_object('role', 'system', 'job_id', 'tests.brand_assets'));
  perform tests.assert_eq((select count(*) from private.claim_brand_asset_work(10)), 0::bigint, 'nothing left to publish');
end $$;
rollback;

-- An image not clean, or a suspended organization, is not due.
begin;
set local role authenticated;
do $$
begin
  perform tests.set_claims(tests.system_claims('b0000000-0000-4000-8000-000000000001'));
  perform tests.assert(private.publish_brand_asset('f0b20000-0000-4000-8000-000000000001', 'logo', tests.brand_png()) is null,
    'B''s logo is not used by B''s branding (B has none): not published');
end $$;
rollback;

\echo '99_branding_3_app_worker: ok'
