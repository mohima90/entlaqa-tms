-- db-test: run-as=owner
-- Branding (WP-ADM-02): the purposes of the branding images (BR-BRD-b), who owns and may run the functions,
-- and the shape of the two tables. Runs as the superuser connection (fixtures: 00, 99_branding_0).
\set ON_ERROR_STOP on

do $$
declare
  r record;
begin
  -- PNG, JPEG, WebP only (never SVG or GIF), Kawadir's limits, private images bucket, scanned uploads.
  for r in select * from (values ('platform.brand_logo', 2097152::bigint), ('platform.brand_favicon', 512000),
                                 ('platform.brand_sign_in_image', 5242880)) v (purpose, max_bytes) loop
    perform tests.assert(
      (select bucket = 'images' and max_bytes = r.max_bytes and upload_by = 'user' and retention_class = 'owner_lifetime'
              and allowed_types = array['image/png', 'image/jpeg', 'image/webp'] and not audit_downloads
       from platform.file_purposes where purpose = r.purpose),
      format('%s: images bucket, %s bytes, PNG/JPEG/WebP, scanned', r.purpose, r.max_bytes));
  end loop;
  perform tests.assert_eq((select count(*) from platform.file_purposes
                           where purpose like 'platform.brand_%' and 'image/svg+xml' = any (allowed_types)), 0::bigint,
    'no branding purpose accepts SVG');

  -- SECURITY DEFINER functions owned by file_guard (no BYPASSRLS); helpers run inside them only.
  for r in select * from (values ('private.tenant_branding_files()'), ('private.claim_brand_asset_work(integer)'),
                                 ('private.publish_brand_asset(uuid,text,text,bytea)'), ('private.public_brand_asset(uuid)'),
                                 ('private.note_brand_asset_failure(uuid,text)'), ('private.public_brand_asset_meta(uuid)'),
                                 ('private.branding_image_names(uuid[])'),
                                 ('private.public_tenant_brand(text)')) v (fn) loop
    perform tests.assert(
      (select p.prosecdef and pg_get_userbyid(p.proowner) = 'file_guard' from pg_proc p where p.oid = r.fn::regprocedure),
      format('%s: SECURITY DEFINER owned by file_guard', r.fn));
  end loop;
  for r in select * from (values ('private.branding_file_usable(uuid,uuid,text)'),
                                 ('private.release_branding_file(uuid,uuid)')) v (fn) loop
    perform tests.assert(not has_function_privilege('authenticated', r.fn::regprocedure, 'execute'),
      format('%s: not callable by users', r.fn));
  end loop;
  perform tests.assert(not has_function_privilege('authenticated', 'private.tenant_branding_files()', 'execute'),
    'the image trigger is not callable');
  perform tests.assert(not (select rolbypassrls from pg_roles where rolname = 'file_guard'), 'file_guard has no BYPASSRLS');

  -- Users: insert and update the look only; no delete; the copies' bytes never readable.
  perform tests.assert(not has_table_privilege('authenticated', 'platform.tenant_branding', 'delete'), 'no delete of the branding');
  perform tests.assert(not has_column_privilege('authenticated', 'platform.tenant_branding', 'tenant_id', 'insert'),
    'tenant_id is never inserted by users');
  perform tests.assert(not has_column_privilege('authenticated', 'platform.brand_assets', 'content', 'select'),
    'the copies'' bytes are not readable through SQL');
  perform tests.assert(not has_table_privilege('authenticated', 'platform.brand_assets', 'insert, update, delete'),
    'users never write copies');
  perform tests.assert(exists (select 1 from pg_trigger where tgrelid = 'platform.tenant_branding'::regclass
                               and tgname = 'tenant_branding_files' and tgenabled = 'O'), 'the image trigger is on');
end $$;

-- An infected image is never released by a save (kept in quarantine; its scan result stays).
begin;
do $$
begin
  alter table platform.files disable trigger files_transition;
  update platform.files set status = 'infected', scan_finding = 'Eicar-Test-Signature'
  where id = 'f0a20000-0000-4000-8000-000000000003';
  alter table platform.files enable trigger files_transition;
  perform private.release_branding_file('a0000000-0000-4000-8000-000000000001', 'f0a20000-0000-4000-8000-000000000003');
  perform tests.assert_eq((select status from platform.files where id = 'f0a20000-0000-4000-8000-000000000003'), 'infected',
    'an infected image is not marked deleted');
  -- Another organization's file is never touched, whatever the id.
  perform private.release_branding_file('a0000000-0000-4000-8000-000000000001', 'f0b20000-0000-4000-8000-000000000001');
  perform tests.assert_eq((select status from platform.files where id = 'f0b20000-0000-4000-8000-000000000001'), 'clean',
    'B''s image stays');
  -- Not a branding image: never released.
  perform private.release_branding_file('a0000000-0000-4000-8000-000000000001', 'f0a00000-0000-4000-8000-000000000001');
  perform tests.assert_eq((select status from platform.files where id = 'f0a00000-0000-4000-8000-000000000001'), 'clean',
    'an import file stays');
end $$;
rollback;

\echo '99_branding_1_owner: ok'
