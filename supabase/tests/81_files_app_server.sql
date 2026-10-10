-- db-test: run-as=app_server
-- Files on the request path (T-M2-18, ADR 0006 §3–§5): the web app (app_server, the signed-in user's claims)
-- creates upload intents, confirms uploads, obtains download grants, deletes and marks files used — only
-- through file_guard's functions; it never writes the file tables directly, never reaches another tenant's
-- or another user's file, never runs the worker's functions, and gets nothing without valid user claims.
-- Fixtures: 00_helpers_and_fixtures.sql, 80_files_owner.sql. Every block is rolled back.
\set ON_ERROR_STOP on

do $$ begin perform tests.assert(session_user = 'app_server', 'must run connected as app_server'); end $$;

-- ---------------------------------------------------------------------------------------------------
-- Without claims, and with forged system claims: nothing.
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(null);
do $$
begin
  perform tests.assert_eq((select count(*) from platform.files), 0::bigint, 'no claims: no file visible');
  perform tests.assert_eq((select count(*) from platform.file_download_grants), 0::bigint, 'no claims: no grant visible');
  perform tests.assert_fails($q$select * from private.create_file_upload('platform.user_import', 'platform', 'user_import',
      gen_random_uuid(), 'a.csv', 'text/csv', 10)$q$, array['42501'], 'no claims: no upload intent');
  perform tests.assert_fails($q$select private.confirm_file_upload('f1a00000-0000-4000-8000-000000000002')$q$,
    array['42501'], 'no claims: no confirmation');
  perform tests.assert_fails($q$select * from private.grant_file_download('f0a00000-0000-4000-8000-000000000001',
      'platform.user_import', 'platform', 'user_import', 'a5000000-0000-4000-8000-000000000001')$q$,
    array['42501'], 'no claims: no download grant');
end $$;
select tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001', 'tests.forged'));
do $$
begin
  perform tests.assert_eq((select count(*) from platform.files), 0::bigint, 'forged system claims: no file visible');
  perform tests.assert_fails($q$select * from private.claim_file_scan()$q$, array['42501'],
    'forged system claims under app_server: the worker functions refuse');
  perform tests.assert_fails($q$select private.delete_file('f0a00000-0000-4000-8000-000000000001')$q$, array['42501'],
    'forged system claims under app_server: no deletion');
end $$;
reset role;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- uA in tenant A: what the user sees and can never write directly.
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
                                          'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
do $$
begin
  perform tests.assert_eq((select count(*) from platform.files where tenant_id <> 'a0000000-0000-4000-8000-000000000001'),
    0::bigint, 'no file of another tenant is visible');
  perform tests.assert_eq((select count(*) from platform.files where id = 'f1a00000-0000-4000-8000-000000000008'), 0::bigint,
    'another user''s file of the same tenant is not visible');
  perform tests.assert_eq((select count(*) from platform.files where id = 'f0a00000-0000-4000-8000-000000000001'), 1::bigint,
    'the uploader sees their own file');
  perform tests.assert_privilege_denied($q$insert into platform.files (bucket, object_key, purpose, owner_module, owner_entity_type,
      owner_entity_id, original_name, declared_mime, declared_size, retention_class, upload_expires_at)
    values ('imports', 'x', 'platform.user_import', 'platform', 'user_import', gen_random_uuid(), 'a.csv', 'text/csv', 1,
      'import', now())$q$, 'no direct insert into platform.files');
  perform tests.assert_privilege_denied($q$update platform.files set status = 'clean' where id = 'f1a00000-0000-4000-8000-000000000007'$q$,
    'no direct update of platform.files (a file never becomes clean without the scan)');
  perform tests.assert_privilege_denied($q$delete from platform.files where id = 'f0a00000-0000-4000-8000-000000000001'$q$,
    'no direct delete from platform.files');
  perform tests.assert_privilege_denied($q$insert into platform.file_download_grants (file_id, user_id, expires_at)
      values ('f1a00000-0000-4000-8000-000000000008', '00000000-0000-4000-8000-0000000000a1', now() + interval '1 minute')$q$,
    'no direct download grant');
  perform tests.assert_privilege_denied($q$select * from private.storage_object_facts$q$,
    'Storage objects are not readable on the request path');
  perform tests.assert_privilege_denied($q$update platform.file_purposes set max_bytes = 209715200$q$,
    'purposes are read-only');
  perform tests.assert_eq((select count(*) from platform.file_download_grants), 1::bigint, 'only the user''s own grants are visible');
  -- The worker's functions and Storage's checks refuse the web app.
  perform tests.assert_fails($q$select * from private.claim_file_scan()$q$, array['42501'], 'claim_file_scan: worker only');
  perform tests.assert_fails($q$select private.finish_file_scan('f1a00000-0000-4000-8000-000000000007', 'clean', 'text/csv', 20,
      repeat('a', 64), 'x', 'y', null, null)$q$, array['42501'], 'finish_file_scan: worker only');
  perform tests.assert_fails($q$select private.retry_file_scan('f1a00000-0000-4000-8000-000000000007', 'scanner')$q$,
    array['42501'], 'retry_file_scan: worker only');
  perform tests.assert_fails($q$select * from private.claim_file_housekeeping(10)$q$, array['42501'], 'housekeeping: worker only');
  perform tests.assert_fails($q$select private.lock_file_housekeeping('f1a00000-0000-4000-8000-00000000000b', 'purge')$q$,
    array['42501'], 'housekeeping lock: worker only');
  perform tests.assert_fails($q$select * from private.claim_orphan_objects(10)$q$, array['42501'], 'orphan objects: worker only');
  perform tests.assert_fails($q$select private.finish_file_housekeeping('f1a00000-0000-4000-8000-00000000000b', 'purge')$q$,
    array['42501'], 'housekeeping finish: worker only');
  perform tests.assert_fails($q$select * from private.create_generated_file('platform.user_import_report', 'platform', 'user_import',
      gen_random_uuid(), 'r.csv', 'text/csv', 10, null)$q$, array['42501'], 'generated files: worker only');
  perform tests.assert(private.storage_request_tenant() is null, 'the Storage tenant check answers only under Storage''s login');
  perform tests.assert(not private.can_upload_object('imports',
      'a0000000-0000-4000-8000-000000000001/platform/user_import/a5000000-0000-4000-8000-000000000001/f1a00000-0000-4000-8000-000000000001'),
    'the Storage upload check is false outside Storage');
end $$;
reset role;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Upload intents: checked against the purpose (types, size), names checked, at most 50 pending a day.
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
                                          'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
do $$
declare
  r record;
  v_count integer := 0;
begin
  select * into r from private.create_file_upload('platform.user_import', 'platform', 'user_import',
    'a5000000-0000-4000-8000-0000000000f1', 'موظفو الرياض.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 1048576);
  perform tests.assert_eq(r.bucket, 'imports', 'imports go to the imports bucket');
  perform tests.assert_eq(r.object_key,
    'a0000000-0000-4000-8000-000000000001/platform/user_import/a5000000-0000-4000-8000-0000000000f1/' || r.id::text,
    'the key is <tenant>/<module>/<entity type>/<entity id>/<file id> (never the name)');
  perform tests.assert(r.upload_expires_at between now() + interval '14 minutes' and now() + interval '16 minutes',
    'the upload window is 15 minutes');
  perform tests.assert_eq(r.max_bytes, 20971520::bigint, 'the purpose limit comes back (20 MB)');
  perform tests.assert_eq((select status || '|' || created_by_user || '|' || created_by_person || '|' || retention_class
                           from platform.files where id = r.id),
    'pending_upload|00000000-0000-4000-8000-0000000000a1|a1000000-0000-4000-8000-0000000000a1|import',
    'a pending upload of uA, retention from the purpose');
  perform tests.assert_fails($q$select * from private.create_file_upload('platform.unknown', 'platform', 'x', gen_random_uuid(),
      'a.csv', 'text/csv', 10)$q$, array['JF003'], 'unknown purpose');
  perform tests.assert_fails($q$select * from private.create_file_upload('platform.user_import_report', 'platform', 'user_import',
      gen_random_uuid(), 'a.csv', 'text/csv', 10)$q$, array['JF003'], 'worker-generated purposes cannot be uploaded');
  perform tests.assert_fails($q$select * from private.create_file_upload('platform.user_import', 'platform', 'user_import',
      gen_random_uuid(), 'a.png', 'image/png', 10)$q$, array['JF001'], 'a type the purpose does not allow');
  perform tests.assert_fails($q$select * from private.create_file_upload('platform.user_import', 'platform', 'user_import',
      gen_random_uuid(), 'a.csv', 'text/csv', 0)$q$, array['JF002'], 'an empty file');
  perform tests.assert_fails($q$select * from private.create_file_upload('platform.user_import', 'platform', 'user_import',
      gen_random_uuid(), 'a.csv', 'text/csv', 20971521)$q$, array['JF002'], 'over the purpose limit');
  perform tests.assert_fails($q$select * from private.create_file_upload('platform.profile_photo', 'platform', 'person',
      gen_random_uuid(), 'a.svg', 'image/svg+xml', 10)$q$, array['JF001'], 'no SVG for photos');
  perform tests.assert_fails(format($q$select * from private.create_file_upload('platform.user_import', 'platform', 'user_import',
      gen_random_uuid(), %L, 'text/csv', 10)$q$, 'payroll' || chr(8238) || 'vsc.exe'), array['23514'],
    'a name with a right-to-left override is refused');
  perform tests.assert_fails($q$select * from private.create_file_upload('platform.user_import', 'Platform/../x', 'user_import',
      gen_random_uuid(), 'a.csv', 'text/csv', 10)$q$, array['23514'], 'the module segment of the key is checked');
  -- 50 unconfirmed uploads a day per user: the fixtures hold 6 recent ones of uA (one a generated report
-- reserved for them), this block one more.
  loop
    begin
      perform private.create_file_upload('platform.user_import', 'platform', 'user_import', gen_random_uuid(), 'a.csv',
                                         'text/csv', 10);
      v_count := v_count + 1;
    exception when sqlstate 'JF007' then
      exit;
    end;
    exit when v_count > 60;
  end loop;
  perform tests.assert_eq(v_count, 43, 'the 51st pending upload of the day is refused');
end $$;
reset role;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Confirmation: the object must be in Storage; empty or oversized objects are rejected at once; only the
-- uploader confirms; an upload older than 24 hours cannot be confirmed; repeating is harmless.
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
                                          'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
do $$
begin
  perform tests.assert_fails($q$select private.confirm_file_upload('f1a00000-0000-4000-8000-000000000001')$q$, array['JF005'],
    'no object in Storage yet');
  perform tests.assert_eq(private.confirm_file_upload('f1a00000-0000-4000-8000-000000000002'), 'uploaded', 'object present: uploaded');
  perform tests.assert_eq(private.confirm_file_upload('f1a00000-0000-4000-8000-000000000002'), 'uploaded', 'confirming again: same status');
  perform tests.assert_eq((select size_bytes from platform.files where id = 'f1a00000-0000-4000-8000-000000000002'), 20::bigint,
    'Storage''s reported size is recorded (the scan re-counts the bytes)');
  perform tests.assert_eq(private.confirm_file_upload('f1a00000-0000-4000-8000-000000000003'), 'rejected', 'an empty object');
  perform tests.assert_eq((select status_reason from platform.files where id = 'f1a00000-0000-4000-8000-000000000003'), 'empty',
    'rejected as empty');
  perform tests.assert_eq(private.confirm_file_upload('f1a00000-0000-4000-8000-000000000004'), 'rejected', 'a 30 MB object');
  perform tests.assert_eq((select status_reason from platform.files where id = 'f1a00000-0000-4000-8000-000000000004'), 'too_large',
    'rejected as too large');
  perform tests.assert_fails($q$select private.confirm_file_upload('f1a00000-0000-4000-8000-000000000005')$q$, array['JF006'],
    'an upload older than 24 hours cannot be confirmed');
  perform tests.assert_fails($q$select private.confirm_file_upload('f1a00000-0000-4000-8000-000000000008')$q$, array['JF004'],
    'another user''s file');
  perform tests.assert_fails($q$select private.confirm_file_upload('f1b00000-0000-4000-8000-000000000001')$q$, array['JF004'],
    'another tenant''s file');
  perform tests.assert_eq(private.confirm_file_upload('f0a00000-0000-4000-8000-000000000001'), 'clean',
    'a file past the confirmation: its status, unchanged');
  perform tests.assert_fails($q$select private.confirm_file_upload('f1a00000-0000-4000-8000-000000000010')$q$, array['JF004'],
    'a worker-generated file reserved for uA is never confirmed by uA (it is not an upload)');
end $$;
reset role;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Download grants: after the owning module authorized THIS user for files of THIS owner entity and purpose;
-- clean, undeleted files of the tenant that belong to exactly that owner and purpose.
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
                                          'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
do $$
declare
  r record;
begin
  select * into r from private.grant_file_download('f1a00000-0000-4000-8000-000000000008', 'platform.user_import', 'platform',
    'user_import', 'a5000000-0000-4000-8000-000000000008');
  perform tests.assert_eq(r.bucket || '|' || r.ttl_seconds || '|' || r.audit_downloads || '|' || r.detected_mime,
    'imports|60|true|text/csv', 'a clean file of the tenant (another user''s: the module authorized its owner entity)');
  perform tests.assert_eq((select count(*) from platform.file_download_grants
                           where file_id = 'f1a00000-0000-4000-8000-000000000008'
                             and user_id = '00000000-0000-4000-8000-0000000000a1'
                             and expires_at between now() + interval '59 seconds' and now() + interval '61 seconds'),
    1::bigint, 'the grant is for the caller and lives as long as the signed URL (60 s for documents)');
  -- The file must belong to the entity, type, module and purpose the module authorized: as if it did not exist.
  perform tests.assert_fails($q$select * from private.grant_file_download('f1a00000-0000-4000-8000-000000000008',
      'platform.user_import', 'platform', 'user_import', 'a5000000-0000-4000-8000-000000000001')$q$, array['JF004'],
    'a file of another owner entity (the module authorized entity …01, the file belongs to …08)');
  perform tests.assert_fails($q$select * from private.grant_file_download('f1a00000-0000-4000-8000-000000000008',
      'platform.user_import', 'platform', 'person', 'a5000000-0000-4000-8000-000000000008')$q$, array['JF004'],
    'a file of another owner entity type');
  perform tests.assert_fails($q$select * from private.grant_file_download('f1a00000-0000-4000-8000-000000000008',
      'platform.user_import', 'tms', 'user_import', 'a5000000-0000-4000-8000-000000000008')$q$, array['JF004'],
    'a file of another module');
  perform tests.assert_fails($q$select * from private.grant_file_download('f1a00000-0000-4000-8000-000000000008',
      'platform.profile_photo', 'platform', 'user_import', 'a5000000-0000-4000-8000-000000000008')$q$, array['JF004'],
    'a file of another purpose');
  perform tests.assert_fails($q$select * from private.grant_file_download('f1a00000-0000-4000-8000-000000000008',
      null, 'platform', 'user_import', 'a5000000-0000-4000-8000-000000000008')$q$, array['JF004'],
    'no purpose: nothing matches');
  perform tests.assert_fails($q$select * from private.grant_file_download('f1a00000-0000-4000-8000-000000000007',
      'platform.user_import', 'platform', 'user_import', 'a5000000-0000-4000-8000-000000000007')$q$, array['JF008'],
    'not scanned yet: no download');
  perform tests.assert_fails($q$select * from private.grant_file_download('f1a00000-0000-4000-8000-000000000009',
      'platform.user_import', 'platform', 'user_import', 'a5000000-0000-4000-8000-000000000009')$q$, array['JF008'],
    'infected: no download');
  perform tests.assert_fails($q$select * from private.grant_file_download('f1a00000-0000-4000-8000-00000000000b',
      'platform.profile_photo', 'platform', 'profile_photo', 'a5000000-0000-4000-8000-00000000000b')$q$, array['JF004'],
    'deleted: no download');
  perform tests.assert_fails($q$select * from private.grant_file_download('f0b00000-0000-4000-8000-000000000001',
      'platform.user_import', 'platform', 'user_import', 'b5000000-0000-4000-8000-000000000001')$q$, array['JF004'],
    'another tenant''s file: as if it did not exist');
  perform tests.assert_eq((select count(*) from platform.file_download_grants where user_id = '00000000-0000-4000-8000-0000000000a1'),
    2::bigint, 'refusals leave no grant (uA: the fixture''s and the one above)');
end $$;
reset role;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Deleting and marking used: the uploader only (or a job); never while scanning, never an infected file.
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
                                          'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
do $$
begin
  perform tests.assert(private.mark_file_used('f0a00000-0000-4000-8000-000000000001'), 'first use recorded');
  perform tests.assert(not private.mark_file_used('f0a00000-0000-4000-8000-000000000001'), 'the first use stays');
  perform tests.assert_fails($q$select private.mark_file_used('f1a00000-0000-4000-8000-000000000007')$q$, array['JF008'],
    'a file not scanned yet cannot be used');
  perform tests.assert_fails($q$select private.mark_file_used('f1a00000-0000-4000-8000-000000000008')$q$, array['JF004'],
    'another user''s file');
  perform tests.assert(private.delete_file('f0a00000-0000-4000-8000-000000000001'), 'the uploader deletes a clean file');
  perform tests.assert(not private.delete_file('f0a00000-0000-4000-8000-000000000001'), 'deleting twice: nothing more');
  perform tests.assert_eq((select status || '|' || (deleted_at is not null)::text from platform.files
                           where id = 'f0a00000-0000-4000-8000-000000000001'), 'deleted|true', 'soft-deleted');
  perform tests.assert_eq((select count(*) from platform.file_download_grants where file_id = 'f0a00000-0000-4000-8000-000000000001'),
    0::bigint, 'its download grants are gone');
  perform tests.assert_fails($q$select private.delete_file('f1a00000-0000-4000-8000-000000000009')$q$, array['JF009'],
    'an infected file stays in quarantine');
  perform tests.assert_fails($q$select private.delete_file('f1a00000-0000-4000-8000-000000000008')$q$, array['JF004'],
    'another user''s file');
  perform tests.assert_fails($q$select private.delete_file('f1b00000-0000-4000-8000-000000000001')$q$, array['JF004'],
    'another tenant''s file');
  perform tests.assert(private.delete_file('f1a00000-0000-4000-8000-000000000001'), 'an abandoned upload intent');
  perform tests.assert(private.delete_file('f1a00000-0000-4000-8000-00000000000e'),
    'a file waiting for the scanner (no worker holds its lease): its owner may give up on it');
  perform tests.assert_eq((select status || '|' || (scan_leased_until is null)::text from platform.files
                           where id = 'f1a00000-0000-4000-8000-00000000000e'), 'deleted|true', 'deleted, never scanned');
end $$;
reset role;
rollback;

-- Another member of the same tenant (uAB) cannot confirm or delete uA's uploads; a stale session (its
-- organization switched away) reaches nothing.
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
                                          'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000ab'));
do $$
begin
  perform tests.assert_fails($q$select private.confirm_file_upload('f1a00000-0000-4000-8000-000000000002')$q$, array['JF004'],
    'uAB cannot confirm uA''s upload');
  perform tests.assert_fails($q$select private.delete_file('f1a00000-0000-4000-8000-000000000002')$q$, array['JF004'],
    'uAB cannot delete uA''s upload');
  perform tests.assert_eq((select count(*) from platform.files), 1::bigint, 'uAB sees their own file only');
end $$;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
                                          'b0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-0000000000ab'));
do $$
begin
  perform tests.assert_fails($q$select * from private.create_file_upload('platform.user_import', 'platform', 'user_import',
      gen_random_uuid(), 'a.csv', 'text/csv', 10)$q$, array['42501'],
    'a session acting in A cannot claim tenant B (stale tenant claim): refused');
end $$;
reset role;
rollback;

\echo '81_files_app_server: ok'
