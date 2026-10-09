-- db-test: run-as=owner
-- Files (T-M2-18, ADR 0006): fixtures for 81–83 (committed; 84 removes them) and the write guard, which
-- holds for EVERY writer — here even the superuser connection (the trigger is not bypassed by privileges).
--   tenant A (uA unless noted; owner entity a5…02):
--     f1a…01 pending, no object yet            f1a…02 pending, object of 20 bytes      f1a…03 pending, empty object
--     f1a…04 pending, object of 30 MB          f1a…05 pending since 25 hours, object   f1a…06 pending, window closed
--     f1a…07 uploaded 10 minutes ago, object   f1a…08 clean, uploaded by uAB           f1a…09 infected yesterday, not yet quarantined
--     f1a…0a rejected an hour ago, object      f1a…0b profile photo deleted 31 days ago f1a…0c deleted import on legal hold, 40 days old
--     f1a…0d clean import used 8 days ago      f1a…0e scanning, left by a dead worker after 5 attempts
--     (00: f0a…01 clean, never used, created now; a grant of uAB on f1a…08 that expired 2 hours ago)
--   tenant B (uB): f1b…01 pending with object · f1b…02 uploaded 20 minutes ago, object
--   tenant C (suspended, uC): f1c…01 uploaded 30 minutes ago
\set ON_ERROR_STOP on

create or replace function tests.file_fixture(
  p_id uuid, p_tenant uuid, p_user uuid, p_status text, p_created_ago interval default '0 minutes',
  p_purpose text default 'platform.user_import', p_object_size bigint default null)
returns void
language plpgsql as $$
declare
  v_bucket text := (select bucket from platform.file_purposes where purpose = p_purpose);
  v_entity uuid := ('a5000000-0000-4000-8000-0000000000' || right(p_id::text, 2))::uuid;
  v_key text := p_tenant::text || '/platform/' || replace(p_purpose, 'platform.', '') || '/' || v_entity::text || '/' || p_id::text;
  v_scanned boolean := p_status in ('clean', 'infected', 'rejected', 'error');
begin
  alter table platform.files disable trigger files_transition;
  insert into platform.files (id, tenant_id, bucket, object_key, purpose, owner_module, owner_entity_type,
      owner_entity_id, original_name, declared_mime, declared_size, detected_mime, size_bytes, sha256, status,
      scan_engine, scan_signatures, scan_finding, scanned_at, retention_class, created_by_user, created_at,
      upload_expires_at, uploaded_at, deleted_at, status_reason)
  values (p_id, p_tenant, v_bucket, v_key, p_purpose, 'platform', replace(p_purpose, 'platform.', ''), v_entity,
          'ملف ' || right(p_id::text, 2) || '.csv',
          (select allowed_types[1] from platform.file_purposes where purpose = p_purpose), 20,
          case when v_scanned then (select allowed_types[1] from platform.file_purposes where purpose = p_purpose) end,
          case when v_scanned then 20 end, case when v_scanned then repeat('c', 64) end, p_status,
          case when v_scanned then 'ClamAV 1.5.4' end, case when v_scanned then '28137' end,
          case when p_status = 'infected' then 'Eicar-Test-Signature' end,
          case when v_scanned then now() - p_created_ago end,
          (select retention_class from platform.file_purposes where purpose = p_purpose), p_user, now() - p_created_ago,
          now() - p_created_ago + interval '15 minutes',
          case when p_status <> 'pending_upload' then now() - p_created_ago end,
          case when p_status = 'deleted' then now() - p_created_ago end,
          case when p_status = 'rejected' then 'type_not_allowed' end);
  alter table platform.files enable trigger files_transition;
  if p_object_size is not null then
    insert into storage.objects (bucket_id, name, owner, metadata)
    values (v_bucket, v_key, p_user, jsonb_build_object('size', p_object_size, 'mimetype', 'text/csv'));
  end if;
end $$;

-- What Storage runs as the caller for an upload (83_files_storage.sql): an object row at <bucket>/<key>.
create or replace function tests.storage_put(p_bucket text, p_key text) returns text
language sql as $$
  select format('insert into storage.objects (bucket_id, name, owner, metadata) values (%L, %L, %L, %L)',
                p_bucket, p_key, nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '{"size": 10}');
$$;
grant execute on function tests.storage_put(text, text) to public;

begin;
select tests.file_fixture('f1a00000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'pending_upload');
select tests.file_fixture('f1a00000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'pending_upload', '0 minutes', 'platform.user_import', 20);
select tests.file_fixture('f1a00000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'pending_upload', '0 minutes', 'platform.user_import', 0);
select tests.file_fixture('f1a00000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'pending_upload', '0 minutes', 'platform.user_import', 30000000);
select tests.file_fixture('f1a00000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'pending_upload', '25 hours', 'platform.user_import', 20);
select tests.file_fixture('f1a00000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'pending_upload', '20 minutes');
select tests.file_fixture('f1a00000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'uploaded', '10 minutes', 'platform.user_import', 20);
select tests.file_fixture('f1a00000-0000-4000-8000-000000000008', 'a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000ab', 'clean', '1 minute', 'platform.user_import', 20);
select tests.file_fixture('f1a00000-0000-4000-8000-000000000009', 'a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'infected', '1 day', 'platform.user_import', 20);
select tests.file_fixture('f1a00000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'rejected', '1 hour', 'platform.user_import', 20);
select tests.file_fixture('f1a00000-0000-4000-8000-00000000000b', 'a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'deleted', '31 days', 'platform.profile_photo', 20);
select tests.file_fixture('f1a00000-0000-4000-8000-00000000000c', 'a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'deleted', '40 days', 'platform.user_import', 20);
select tests.file_fixture('f1a00000-0000-4000-8000-00000000000d', 'a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'clean', '9 days', 'platform.user_import', 20);
select tests.file_fixture('f1a00000-0000-4000-8000-00000000000e', 'a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'scanning', '40 minutes', 'platform.user_import', 20);
select tests.file_fixture('f1b00000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000b1', 'pending_upload', '0 minutes', 'platform.user_import', 20);
select tests.file_fixture('f1b00000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000b1', 'uploaded', '20 minutes', 'platform.user_import', 20);
select tests.file_fixture('f1c00000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000c1', 'uploaded', '30 minutes', 'platform.user_import', 20);
alter table platform.files disable trigger files_transition;
-- f1a…06: the 15-minute window to create the signed upload URL closed 5 minutes ago.
update platform.files set upload_expires_at = now() - interval '5 minutes' where id = 'f1a00000-0000-4000-8000-000000000006';
update platform.files set legal_hold = true where id = 'f1a00000-0000-4000-8000-00000000000c';
update platform.files set used_at = now() - interval '8 days' where id = 'f1a00000-0000-4000-8000-00000000000d';
-- f1a…0e: a scan left behind by a dead worker (lease expired) after 5 attempts.
update platform.files set scan_attempts = 5, scan_not_before = now() - interval '1 minute', scan_leased_until = now() - interval '1 minute'
where id = 'f1a00000-0000-4000-8000-00000000000e';
alter table platform.files enable trigger files_transition;
-- A download grant of uAB that expired two hours ago (housekeeping removes it).
insert into platform.file_download_grants (tenant_id, file_id, user_id, created_at, expires_at) values
  ('a0000000-0000-4000-8000-000000000001', 'f1a00000-0000-4000-8000-000000000008', '00000000-0000-4000-8000-0000000000ab',
   now() - interval '2 hours 5 minutes', now() - interval '2 hours');
commit;

-- ---------------------------------------------------------------------------------------------------
-- Write guard (every writer, even this superuser connection): new files start pending_upload; only the
-- allowed status transitions; identity immutable; the bucket changes only into quarantine; scan results
-- stay as recorded.
-- ---------------------------------------------------------------------------------------------------
begin;
do $$
begin
  perform tests.assert_fails($q$insert into platform.files (tenant_id, bucket, object_key, purpose, owner_module,
      owner_entity_type, owner_entity_id, original_name, declared_mime, declared_size, retention_class, upload_expires_at,
      status, detected_mime, size_bytes, sha256, scanned_at)
    values ('a0000000-0000-4000-8000-000000000001', 'imports', 'x', 'platform.user_import', 'platform', 'user_import',
      gen_random_uuid(), 'a.csv', 'text/csv', 1, 'import', now(), 'clean', 'text/csv', 1, repeat('d', 64), now())$q$,
    array['42501'], 'a file cannot be inserted as clean (it starts pending_upload)');
  -- A user upload never becomes clean without the scan.
  perform tests.assert_fails($q$update platform.files set status = 'clean', detected_mime = 'text/csv', size_bytes = 20,
      sha256 = repeat('d', 64), scanned_at = now() where id = 'f1a00000-0000-4000-8000-000000000001'$q$,
    array['42501'], 'pending_upload → clean is refused for a user upload');
  perform tests.assert_fails($q$update platform.files set status = 'scanning' where id = 'f1a00000-0000-4000-8000-000000000001'$q$,
    array['42501'], 'pending_upload → scanning is refused (confirmation first)');
  perform tests.assert_fails($q$update platform.files set status = 'uploaded' where id = 'f0a00000-0000-4000-8000-000000000001'$q$,
    array['42501'], 'clean → uploaded is refused');
  perform tests.assert_fails($q$update platform.files set status = 'clean' where id = 'f1a00000-0000-4000-8000-000000000009'$q$,
    array['42501'], 'infected stays infected');
  perform tests.assert_fails($q$update platform.files set status = 'pending_upload' where id = 'f1a00000-0000-4000-8000-00000000000b'$q$,
    array['42501'], 'deleted stays deleted');
  perform tests.assert_fails($q$update platform.files set tenant_id = 'b0000000-0000-4000-8000-000000000001' where id = 'f0a00000-0000-4000-8000-000000000001'$q$,
    array['42501', '23514'], 'the tenant of a file cannot change');
  perform tests.assert_fails($q$update platform.files set owner_entity_id = gen_random_uuid() where id = 'f0a00000-0000-4000-8000-000000000001'$q$,
    array['42501', '23514'], 'the owner of a file cannot change');
  perform tests.assert_fails($q$update platform.files set created_by_user = '00000000-0000-4000-8000-0000000000b1' where id = 'f0a00000-0000-4000-8000-000000000001'$q$,
    array['42501'], 'the uploader of a file cannot change');
  perform tests.assert_fails($q$update platform.files set bucket = 'images' where id = 'f0a00000-0000-4000-8000-000000000001'$q$,
    array['42501', '23514'], 'a clean file does not change bucket');
  perform tests.assert_fails($q$update platform.files set sha256 = repeat('e', 64) where id = 'f0a00000-0000-4000-8000-000000000001'$q$,
    array['42501'], 'the hash of a scanned file does not change');
  -- The one bucket change: an infected file into quarantine.
  perform tests.assert_eq(tests.rows_affected($q$update platform.files set bucket = 'quarantine', quarantined_at = now()
      where id = 'f1a00000-0000-4000-8000-000000000009'$q$), 1::bigint, 'infected → quarantine bucket is allowed');
  perform tests.assert_fails($q$update platform.files set bucket = 'imports', quarantined_at = null
      where id = 'f1a00000-0000-4000-8000-000000000009'$q$, array['42501'], 'nothing leaves quarantine');
end $$;
rollback;

-- Generated purposes may go straight from pending_upload to clean (written by the worker), user ones not.
begin;
do $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into platform.files (id, tenant_id, bucket, object_key, purpose, owner_module, owner_entity_type, owner_entity_id,
      original_name, declared_mime, declared_size, retention_class, upload_expires_at)
  values (v_id, 'a0000000-0000-4000-8000-000000000001', 'generated',
          'a0000000-0000-4000-8000-000000000001/platform/user_import/a5000000-0000-4000-8000-000000000002/' || v_id,
          'platform.user_import_report', 'platform', 'user_import', 'a5000000-0000-4000-8000-000000000002', 'report.csv',
          'text/csv', 10, 'import', now());
  perform tests.assert_eq(tests.rows_affected(format($q$update platform.files set status = 'clean', detected_mime = 'text/csv',
      size_bytes = 10, sha256 = repeat('f', 64), scanned_at = now() where id = %L$q$, v_id)), 1::bigint,
    'a generated file becomes clean without a scan');
  perform tests.assert_fails(format($q$update platform.files set object_key = 'other' where id = %L$q$, v_id),
    array['42501'], 'the key of a file never changes');
end $$;
rollback;

-- Names: no control characters, path separators or bidirectional overrides; keys never carry the name.
begin;
do $$
begin
  perform tests.assert_check_constraint($q$insert into platform.files (tenant_id, bucket, object_key, purpose, owner_module,
      owner_entity_type, owner_entity_id, original_name, declared_mime, declared_size, retention_class, upload_expires_at)
    values ('a0000000-0000-4000-8000-000000000001', 'imports', 'x', 'platform.user_import', 'platform', 'user_import',
      gen_random_uuid(), 'a/b.csv', 'text/csv', 1, 'import', now())$q$, 'files_key_check',
    'a key that does not follow the shape is refused');
  perform tests.assert_check_constraint(format($q$insert into platform.files (id, tenant_id, bucket, object_key, purpose,
      owner_module, owner_entity_type, owner_entity_id, original_name, declared_mime, declared_size, retention_class,
      upload_expires_at)
    values ('a1110000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'imports',
      'a0000000-0000-4000-8000-000000000001/platform/user_import/a5000000-0000-4000-8000-000000000002/a1110000-0000-4000-8000-000000000001',
      'platform.user_import', 'platform', 'user_import', 'a5000000-0000-4000-8000-000000000002', %L, 'text/csv', 1, 'import',
      now())$q$, 'invoice' || chr(8238) || 'vsc.exe'), 'files_name_check', 'a right-to-left override in a name is refused');
  perform tests.assert_check_constraint(format($q$insert into platform.files (id, tenant_id, bucket, object_key, purpose,
      owner_module, owner_entity_type, owner_entity_id, original_name, declared_mime, declared_size, retention_class,
      upload_expires_at)
    values ('a1110000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'imports',
      'a0000000-0000-4000-8000-000000000001/platform/user_import/a5000000-0000-4000-8000-000000000002/a1110000-0000-4000-8000-000000000001',
      'platform.user_import', 'platform', 'user_import', 'a5000000-0000-4000-8000-000000000002', %L, 'text/csv', 1, 'import',
      now())$q$, '..' || chr(92) || 'a.csv'), 'files_name_check', 'a backslash in a name is refused');
end $$;
rollback;

-- Purposes are reference data: read-only for users, and Storage's own role cannot read the file tables.
begin;
do $$
begin
  perform tests.assert(has_table_privilege('authenticated', 'platform.file_purposes', 'select'), 'users read the purposes');
  perform tests.assert(not has_table_privilege('supabase_storage_admin', 'platform.files', 'select'),
    'Storage''s login role reads no file metadata itself');
  perform tests.assert_eq((select string_agg(purpose || '=' || bucket || '/' || retention_class || '/' || upload_by, ',' order by purpose)
                           from platform.file_purposes),
    'platform.profile_photo=images/owner_lifetime/user,platform.user_import=imports/import/user,platform.user_import_report=generated/import/worker',
    'the R1 purposes');
end $$;
rollback;

\echo '80_files_owner: ok'
