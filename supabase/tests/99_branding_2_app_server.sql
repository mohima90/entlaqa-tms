-- db-test: run-as=app_server
-- Branding (WP-ADM-02, FR-ADM-07; business flow EP-BRAND, BR-BRD-a/b/c): only an Organization Admin
-- (platform.tenant.manage) saves the organization's look, only in their own organization; every member
-- reads it; an image must be the saver's own confirmed upload of the right purpose; a replaced, removed or
-- unused image is released (copy removed, file deleted); the public delivery path serves published copies
-- of organizations in service only, and nothing else. Runs CONNECTED AS app_server (fixtures: 00, 65,
-- 99_branding_0).
\set ON_ERROR_STOP on

do $$ begin perform tests.assert(session_user = 'app_server', 'must run connected as app_server'); end $$;

-- Who may change it: the Organization Admin (AAL1 is enough — no authenticator code, as the profile).
begin;
set local role authenticated;
do $$
declare
  v_a constant uuid := 'a0000000-0000-4000-8000-000000000001';
  v_set constant text := 'update platform.tenant_branding set primary_color = ''#1E3A5F'', secondary_color = ''#2C5282'', email_action_color = ''#1E3A5F'', email_link_color = ''#1E3A5F''';
begin
  -- HR Manager of A (fresh code): reads, changes nothing.
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab', v_a,
                                             'a1000000-0000-4000-8000-0000000000ab') || tests.fresh_code());
  perform tests.assert_eq((select count(*) from platform.tenant_branding), 1::bigint, 'the HR Manager reads the branding');
  perform tests.assert_eq(tests.rows_affected(v_set), 0::bigint, 'an HR Manager cannot change the branding');
  -- An L&D (Training) Manager at AAL2: neither.
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c06', '10000000-0000-4000-8000-000000000c61', v_a,
                                             'a1000000-0000-4000-8000-000000000c06') || tests.fresh_code());
  perform tests.assert_eq(tests.rows_affected(v_set), 0::bigint, 'a Training Manager cannot change the branding');
  -- A learner reads it (the shell) and changes nothing.
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c01', '10000000-0000-4000-8000-000000000c11', v_a,
                                             'a1000000-0000-4000-8000-000000000c01'));
  perform tests.assert_eq((select primary_color from platform.tenant_branding), '#0F6E5A', 'a learner reads the colours');
  perform tests.assert_eq(tests.rows_affected(v_set), 0::bigint, 'a learner cannot change the branding');
  perform tests.assert_eq((select count(*) from platform.brand_assets), 1::bigint, 'members see which images are published');

  -- The Organization Admin uA: changed, stamped, version 2.
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', v_a,
                                             'a1000000-0000-4000-8000-0000000000a1'));
  perform tests.assert_eq(tests.rows_affected(v_set), 1::bigint, 'the Organization Admin changes the colours');
  perform tests.assert((select primary_color = '#1E3A5F' and version = 2 and updated_by = 'a1000000-0000-4000-8000-0000000000a1'
                        from platform.tenant_branding), 'stamped with the editor and a new version');
  -- The colour and address rules (BR-BRD-c; https only).
  perform tests.assert_check_constraint($q$update platform.tenant_branding set primary_color = '#1e3a5f'$q$,
    'tenant_branding_colors_check', 'colours are stored #RRGGBB in upper case');
  perform tests.assert_check_constraint($q$update platform.tenant_branding set primary_color = 'red'$q$,
    'tenant_branding_colors_check', 'a colour name is refused');
  perform tests.assert_check_constraint($q$update platform.tenant_branding set secondary_color = null$q$,
    'tenant_branding_colors_check', 'both colours or neither');
  perform tests.assert_check_constraint($q$update platform.tenant_branding set primary_color = null, secondary_color = null$q$,
    'tenant_branding_email_colors_check', 'the e-mail colours go with the colours');
  perform tests.assert_check_constraint($q$update platform.tenant_branding set primary_color = '#1E3A5F;}'$q$,
    'tenant_branding_colors_check', 'no CSS can be smuggled in a colour');
  perform tests.assert_check_constraint($q$update platform.tenant_branding set website_url = 'http://a.example'$q$,
    'tenant_branding_website_check', 'the website is https');
  perform tests.assert_check_constraint($q$update platform.tenant_branding set website_url = 'javascript:alert(1)'$q$,
    'tenant_branding_website_check', 'no script address');
  perform tests.assert_check_constraint($q$update platform.tenant_branding set website_url = 'https://a.example/"><script>'$q$,
    'tenant_branding_website_check', 'no quotes or angle brackets');
  -- Reset to the Jadarat look: no colours at all.
  perform tests.assert_eq(tests.rows_affected($q$update platform.tenant_branding set primary_color = null, secondary_color = null, email_action_color = null, email_link_color = null, use_gradient = true$q$),
    1::bigint, 'the Jadarat look again (no colours)');
  -- Only the look: not the stamps or the organization.
  perform tests.assert_privilege_denied($q$update platform.tenant_branding set updated_by = null$q$, 'updated_by is not updatable');
  perform tests.assert_privilege_denied($q$update platform.tenant_branding set created_at = now()$q$, 'created_at is not updatable');
  -- Never another organization's branding.
  perform tests.assert_eq((select count(*) from platform.tenant_branding where tenant_id <> v_a), 0::bigint,
    'the admin of A sees no other organization''s branding');
  perform tests.assert_eq((select count(*) from platform.brand_assets where tenant_id <> v_a), 0::bigint,
    'nor its published images');
end $$;
rollback;

-- Images: the saver's own confirmed upload of the right purpose; replaced, removed and unused ones released.
begin;
set local role authenticated;
do $$
declare
  v_a constant uuid := 'a0000000-0000-4000-8000-000000000001';
begin
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', v_a,
                                             'a1000000-0000-4000-8000-0000000000a1'));
  perform tests.assert_fails_state_like($q$update platform.tenant_branding set logo_file_id = 'f0a20000-0000-4000-8000-000000000004'$q$,
    'JB001', '%logo is not usable%', 'another admin''s upload is never this admin''s image');
  perform tests.assert_fails_state_like($q$update platform.tenant_branding set logo_file_id = 'f0a20000-0000-4000-8000-000000000003'$q$,
    'JB001', '%logo is not usable%', 'a favicon is not a logo (purpose)');
  perform tests.assert_fails_state_like($q$update platform.tenant_branding set logo_file_id = 'f0a20000-0000-4000-8000-000000000006'$q$,
    'JB001', '%logo is not usable%', 'a file the scan rejected is refused');
  perform tests.assert_fails_state_like($q$update platform.tenant_branding set logo_file_id = 'f0a00000-0000-4000-8000-000000000001'$q$,
    'JB001', '%logo is not usable%', 'an import file is never an image');
  -- One save: the logo replaced, and a sign-in image still waiting for the scan (shown once clean and
  -- published). The old logo's copy goes at once and its file is deleted.
  perform tests.assert_eq(tests.rows_affected($q$update platform.tenant_branding set logo_file_id = 'f0a20000-0000-4000-8000-000000000002', sign_in_image_file_id = 'f0a20000-0000-4000-8000-000000000005'$q$),
    1::bigint, 'the logo is replaced; an upload waiting for the scan is accepted');
  perform tests.assert_eq((select count(*) from platform.brand_assets), 0::bigint, 'the old logo''s copy is removed');
  perform tests.assert_eq((select status from platform.files where id = 'f0a20000-0000-4000-8000-000000000001'), 'deleted',
    'the old logo''s file is deleted');
  -- The saver's unused uploads went with that save (the rejected one); the images in use stay.
  perform tests.assert_eq((select status from platform.files where id = 'f0a20000-0000-4000-8000-000000000006'), 'deleted',
    'an unused upload of the saver is deleted');
  perform tests.assert_eq((select status from platform.files where id = 'f0a20000-0000-4000-8000-000000000005'), 'uploaded',
    'the image in use stays');
  perform tests.assert_eq((select status from platform.files where id = 'f0a20000-0000-4000-8000-000000000002'), 'clean',
    'the new logo stays');
  -- Remove the favicon: its file is deleted (the Jadarat icon is shown again).
  perform tests.assert_eq(tests.rows_affected($q$update platform.tenant_branding set favicon_file_id = null$q$),
    1::bigint, 'the favicon is removed');
  perform tests.assert_eq((select status from platform.files where id = 'f0a20000-0000-4000-8000-000000000003'), 'deleted',
    'the removed favicon''s file is deleted');
  -- A deleted image cannot come back.
  perform tests.assert_fails_state_like($q$update platform.tenant_branding set logo_file_id = 'f0a20000-0000-4000-8000-000000000001'$q$,
    'JB001', '%logo is not usable%', 'a deleted file is refused');
end $$;
rollback;

-- B's first save (insert) by B's Organization Admin with B's logo; never A's images, never seen from A.
begin;
set local role authenticated;
do $$
declare
  v_b constant uuid := 'b0000000-0000-4000-8000-000000000001';
begin
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ac',
                                             'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000ab'));
  perform tests.assert_rls_violation($q$insert into platform.tenant_branding (use_gradient) values (false)$q$,
    'an HR Manager cannot create the branding (and A already has one)');
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1', v_b,
                                             'b1000000-0000-4000-8000-0000000000b1'));
  perform tests.assert_eq((select count(*) from platform.tenant_branding), 0::bigint, 'B starts with the Jadarat look');
  perform tests.assert_fails($q$insert into platform.tenant_branding (logo_file_id) values ('f0a20000-0000-4000-8000-000000000002')$q$,
    array['23503', 'JB001'], 'an image of A is never B''s');
  perform tests.assert_eq(tests.rows_affected($q$insert into platform.tenant_branding (primary_color, secondary_color, use_gradient, email_action_color, email_link_color, logo_file_id) values ('#7A1F2B', '#7A1F2B', false, '#7A1F2B', '#7A1F2B', 'f0b20000-0000-4000-8000-000000000001')$q$),
    1::bigint, 'B''s admin saves B''s look for the first time');
  perform tests.assert((select tenant_id = v_b and version = 1 and updated_by = 'b1000000-0000-4000-8000-0000000000b1'
                        from platform.tenant_branding), 'B''s row, stamped');
  -- uAB (HR Manager of A and member of B) in A: A's branding only.
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
                                             'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000ab'));
  perform tests.assert_eq((select count(*) from platform.tenant_branding where tenant_id = v_b), 0::bigint,
    'A''s members never see B''s branding');
end $$;
rollback;

-- An Auditor (custom role with platform.tenant.read; EP-ROLES) reads the branding and changes nothing.
begin;
set local role authenticated;
do $$
declare
  v_a constant uuid := 'a0000000-0000-4000-8000-000000000001';
begin
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', v_a,
                                             'a1000000-0000-4000-8000-0000000000a1'));
  insert into platform.custom_roles (id, name_en, name_ar, data_scope)
  values ('a6000000-0000-4000-8000-0000000000c6', 'Auditor', 'مدقق', 'organization');
  insert into platform.custom_role_permissions (custom_role_id, permission_code)
  select 'a6000000-0000-4000-8000-0000000000c6', p
  from unnest(array['platform.user.read', 'platform.tenant.read', 'platform.audit.read']) p;
  delete from platform.role_assignments ra using platform.tenant_memberships m
  where m.id = ra.membership_id and m.user_id = '00000000-0000-4000-8000-000000000c05' and m.tenant_id = v_a;
  insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary)
  select m.tenant_id, m.id, cr.code, true from platform.tenant_memberships m, platform.custom_roles cr
  where m.user_id = '00000000-0000-4000-8000-000000000c05' and m.tenant_id = v_a
    and cr.id = 'a6000000-0000-4000-8000-0000000000c6';
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-000000000c05', '10000000-0000-4000-8000-000000000c51', v_a,
                                             'a1000000-0000-4000-8000-000000000c05') || tests.fresh_code());
  perform tests.assert(not private.actor_may_manage_tenant(v_a), 'an Auditor may not manage the organization');
  perform tests.assert_eq((select count(*) from platform.tenant_branding), 1::bigint, 'the Auditor reads the branding');
  perform tests.assert_eq(tests.rows_affected('update platform.tenant_branding set use_gradient = false'), 0::bigint,
    'an Auditor changes nothing');
end $$;
rollback;

-- The public delivery path: a claim-less app_server transaction (the sign-in page, /api/brand/<id>).
begin;
set local role authenticated;
select tests.set_claims(null);
do $$
begin
  perform tests.assert_eq((select count(*) from platform.tenant_branding), 0::bigint, 'no claims: no branding row readable');
  perform tests.assert_eq((select content from private.public_brand_asset('e0a20000-0000-4000-8000-000000000001')),
    tests.brand_png(), 'a published copy is served by its id');
  perform tests.assert_eq((select content_type from private.public_brand_asset('e0a20000-0000-4000-8000-000000000001')),
    'image/png', 'with the type the scan detected');
  perform tests.assert_eq((select count(*) from private.public_brand_asset('f0a20000-0000-4000-8000-000000000001')), 0::bigint,
    'never by the file''s id');
  perform tests.assert_eq((select count(*) from private.public_brand_asset('e0a20000-0000-4000-8000-0000000000ff')), 0::bigint,
    'an unknown id: nothing');
  perform tests.assert_eq((select count(*) from private.public_brand_asset(null)), 0::bigint, 'no id: nothing');
  perform tests.assert((select primary_color = '#0F6E5A' and secondary_color = '#138A72' and use_gradient
                               and logo_asset_id = 'e0a20000-0000-4000-8000-000000000001' and favicon_asset_id is null
                               and name_en = 'Tenant A'
                        from private.public_tenant_brand('tenant-a')),
    'the sign-in page''s look of A: colours and published images only');
  perform tests.assert((select primary_color is null and logo_asset_id is null and name_ar = 'المنشأة ب'
                        from private.public_tenant_brand('tenant-b')), 'B: the Jadarat look');
  perform tests.assert_eq((select count(*) from private.public_tenant_brand('tenant-c')), 0::bigint,
    'a suspended organization shows nothing');
  perform tests.assert_eq((select count(*) from private.public_tenant_brand('Tenant-A')), 0::bigint, 'slugs are exact');
  perform tests.assert_eq((select count(*) from private.public_tenant_brand('tenant-a'' or ''1''=''1')), 0::bigint,
    'not a slug: nothing');
end $$;
rollback;

-- Once the Branding no longer uses an image, its copy is not served (even before anything is removed), and
-- a suspended organization's images are not served at all.
begin;
set local role authenticated;
do $$
begin
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
                                             'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
  perform tests.assert_eq(tests.rows_affected($q$update platform.tenant_branding set logo_file_id = null$q$), 1::bigint,
    'the logo is removed');
  perform tests.set_claims(null);
  perform tests.assert_eq((select count(*) from private.public_brand_asset('e0a20000-0000-4000-8000-000000000001')), 0::bigint,
    'a removed image is not served');
end $$;
rollback;

-- The worker's functions refuse the web app.
begin;
set local role authenticated;
do $$
begin
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
                                             'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
  perform tests.assert_fails($q$select * from private.claim_brand_asset_work(10)$q$, array['42501'],
    'the web app cannot claim publishing work');
  perform tests.assert_fails(format('select private.publish_brand_asset(%L, %L, %L::bytea)',
                                    'f0a20000-0000-4000-8000-000000000003', 'favicon', tests.brand_png()),
    array['42501'], 'the web app cannot publish an image');
  perform tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001'));
  perform tests.assert_fails(format('select private.publish_brand_asset(%L, %L, %L::bytea)',
                                    'f0a20000-0000-4000-8000-000000000003', 'favicon', tests.brand_png()),
    array['42501'], 'forged system claims under app_server cannot publish');
end $$;
rollback;

\echo '99_branding_2_app_server: ok'
