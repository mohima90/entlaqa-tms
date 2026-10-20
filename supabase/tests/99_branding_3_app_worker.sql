-- db-test: run-as=app_worker
-- Publishing branding images (WP-ADM-02): the worker finds the images an organization's Branding uses that
-- the scan found clean and that have no copy yet, and publishes a copy (its metadata removed by the worker) in
-- the image's tenant — only when the worker read exactly the scanned file; never for another tenant, never an
-- image no longer used; copies no Branding uses are removed; failures back off and are given up after 5; the
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
  v_sha constant text := encode(sha256(tests.brand_png()), 'hex');
  v_stripped constant bytea := substring(tests.brand_png() from 1 for 12);
  v_id uuid;
begin
  -- A platform pass (no tenant): A's favicon is due; A's logo is published already. Copies no Branding uses
  -- (the 00 fixtures' e0a0…/e0b0…) are removed first.
  perform tests.set_claims(jsonb_build_object('role', 'system', 'job_id', 'tests.brand_assets'));
  perform tests.assert_eq((select count(*) from private.claim_brand_asset_work(10)), 1::bigint, 'one image to publish');
  perform tests.assert((select tenant_id = v_a and file_id = v_favicon and kind = 'favicon'
                        from private.claim_brand_asset_work(10)), 'A''s favicon');
  -- Publishing needs the image's tenant.
  perform tests.assert_fails(format('select private.publish_brand_asset(%L, %L, %L, %L::bytea)', v_favicon, 'favicon',
                                    v_sha, tests.brand_png()),
    array['42501'], 'a platform transaction cannot publish');

  -- In B's tenant: A's image does not exist.
  perform tests.set_claims(tests.system_claims('b0000000-0000-4000-8000-000000000001'));
  perform tests.assert(private.publish_brand_asset(v_favicon, 'favicon', v_sha, tests.brand_png()) is null,
    'never another tenant''s image');

  -- In A's tenant: the copies no Branding used were removed by the claim.
  perform tests.set_claims(tests.system_claims(v_a));
  perform tests.assert_eq((select count(*) from platform.brand_assets where id = 'e0a00000-0000-4000-8000-000000000001'),
    0::bigint, 'an unused copy is removed by the claim');
  perform tests.assert_eq((select count(*) from platform.brand_assets where id = 'e0a20000-0000-4000-8000-000000000001'),
    1::bigint, 'the copy in use stays');
  -- Wrong kind, another source, a larger or empty copy; then the real thing (metadata removed: shorter).
  perform tests.assert(private.publish_brand_asset(v_favicon, 'logo', v_sha, tests.brand_png()) is null,
    'a favicon is not published as the logo');
  perform tests.assert(private.publish_brand_asset(v_favicon, 'bogus', v_sha, tests.brand_png()) is null,
    'unknown kind: nothing');
  perform tests.assert_fails_state_like(format('select private.publish_brand_asset(%L, %L, %L, %L::bytea)', v_favicon,
                                               'favicon', repeat('e', 64), tests.brand_png()),
    'JB002', '%differs from the scanned file%', 'a copy of another file is refused (source SHA-256)');
  perform tests.assert_fails_state_like(format('select private.publish_brand_asset(%L, %L, %L, %L::bytea)', v_favicon,
                                               'favicon', v_sha, tests.brand_png() || '\x00'::bytea),
    'JB002', '%differs from the scanned file%', 'a copy larger than the scanned file is refused');
  perform tests.assert_fails_state_like(format('select private.publish_brand_asset(%L, %L, %L, %L::bytea)', v_favicon,
                                               'favicon', v_sha, ''),
    'JB002', '%differs from the scanned file%', 'an empty copy is refused');
  perform tests.assert_eq(private.note_brand_asset_failure(v_favicon, 'DIMENSIONS_TOO_LARGE'), 1, 'a failure is counted');
  v_id := private.publish_brand_asset(v_favicon, 'favicon', v_sha, v_stripped);
  perform tests.assert(v_id is not null, 'the favicon is published');
  perform tests.assert_eq(private.publish_brand_asset(v_favicon, 'favicon', v_sha, v_stripped), v_id,
    'publishing again: the same copy');
  perform tests.assert((select kind = 'favicon' and content_type = 'image/png' and byte_size = 12
                               and sha256 = encode(sha256(v_stripped), 'hex')
                        from platform.brand_assets where id = v_id), 'the copy: the detected type, its own size and hash');
  perform tests.assert_eq((select count(*) from platform.brand_asset_attempts where file_id = v_favicon), 0::bigint,
    'a publication clears the failures');
  -- The e-mail jobs read the organization's look (colours) in its tenant.
  perform tests.assert_eq((select email_action_color from platform.tenant_branding), '#0F6E5A', 'jobs read the e-mail colours');
  perform tests.assert_eq((select count(*) from platform.tenant_branding where tenant_id <> v_a), 0::bigint,
    'and only their tenant''s');
  -- Jobs never change the look nor the copies directly.
  perform tests.assert_eq(tests.rows_affected('update platform.tenant_branding set use_gradient = false'), 0::bigint,
    'a job cannot change the branding');
  perform tests.assert_privilege_denied($q$delete from platform.brand_assets$q$, 'a job cannot delete copies directly');
  perform tests.assert_privilege_denied($q$delete from platform.brand_asset_attempts$q$,
    'a job cannot forget failures directly');

  -- Nothing left to do.
  perform tests.set_claims(jsonb_build_object('role', 'system', 'job_id', 'tests.brand_assets'));
  perform tests.assert_eq((select count(*) from private.claim_brand_asset_work(10)), 0::bigint, 'nothing left to publish');
end $$;
rollback;

-- A failing image backs off and is given up after 5 attempts; it never holds up the others.
begin;
set local role authenticated;
do $$
declare
  v_favicon constant uuid := 'f0a20000-0000-4000-8000-000000000003';
  v_attempt integer;
begin
  perform tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001'));
  perform tests.assert_eq(private.note_brand_asset_failure(v_favicon, 'TYPE_NOT_ALLOWED'), 1, 'first failure');
  perform tests.set_claims(jsonb_build_object('role', 'system', 'job_id', 'tests.brand_assets'));
  perform tests.assert_eq((select count(*) from private.claim_brand_asset_work(10)), 0::bigint, 'waits after a failure');
  perform tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001'));
  for v_attempt in 2..5 loop
    perform tests.assert_eq(private.note_brand_asset_failure(v_favicon, 'not a code!'), v_attempt, 'counted');
  end loop;
  perform tests.assert((select next_try_at = 'infinity'::timestamptz and last_code = 'FAILED'
                        from platform.brand_asset_attempts where file_id = v_favicon),
    'given up after 5; an odd code is recorded as FAILED');
  perform tests.assert_eq(private.note_brand_asset_failure('f0a00000-0000-4000-8000-000000000001', 'X_Y'), 0,
    'not a branding image: nothing recorded');
  perform tests.set_claims(tests.system_claims('b0000000-0000-4000-8000-000000000001'));
  perform tests.assert_eq(private.note_brand_asset_failure(v_favicon, 'X_Y'), 0, 'never another tenant''s image');
end $$;
rollback;

-- An image no Branding uses is not published.
begin;
set local role authenticated;
do $$
begin
  perform tests.set_claims(tests.system_claims('b0000000-0000-4000-8000-000000000001'));
  perform tests.assert(private.publish_brand_asset('f0b20000-0000-4000-8000-000000000001', 'logo',
                                                   encode(sha256(tests.brand_png()), 'hex'), tests.brand_png()) is null,
    'B''s logo is not used by B''s branding (B has none): not published');
end $$;
rollback;

\echo '99_branding_3_app_worker: ok'
