-- db-test: run-as=owner
-- Files (T-M2-18): the paths that need a set-up only the owner can make — a business table referencing a
-- file (a purge keeps a tombstone without the name), a stored generated object (the job marks it clean) —
-- run under the worker's login role through SET SESSION AUTHORIZATION, so the functions see session_user =
-- app_worker exactly as in production. Then the fixtures of 80_files_owner.sql are removed again.
\set ON_ERROR_STOP on

begin;
-- A module table referencing files (composite FK, as docs/engineering/files.md tells modules to do).
create table tests.file_refs (tenant_id uuid not null, file_id uuid not null,
  foreign key (tenant_id, file_id) references platform.files (tenant_id, id));
insert into tests.file_refs values ('a0000000-0000-4000-8000-000000000001', 'f1a00000-0000-4000-8000-00000000000d');
-- The bytes of a generated report, as the worker stores them through the Storage API.
insert into storage.objects (bucket_id, name, metadata) values ('generated',
  'a0000000-0000-4000-8000-000000000001/platform/user_import/a5000000-0000-4000-8000-0000000000f3/f2a00000-0000-4000-8000-000000000001',
  '{"size": 120}');
set session authorization app_worker;
set local role authenticated;
select tests.set_claims(jsonb_build_object('role', 'system', 'job_id', 'tests.files.housekeeping'));
do $$
begin
  perform tests.assert(session_user = 'app_worker', 'acting under the worker''s login role');
  perform tests.assert(exists (select 1 from private.claim_file_housekeeping(100)
                               where id = 'f1a00000-0000-4000-8000-00000000000d' and action = 'purge'),
    'the import used 8 days ago is due');
  perform tests.assert(private.finish_file_housekeeping('f1a00000-0000-4000-8000-00000000000d', 'purge'), 'purged');
end $$;
reset role;
reset session authorization;
do $$
begin
  perform tests.assert_eq((select concat_ws('|', status, original_name, purged_at is not null, object_removed_at is not null)
                           from platform.files where id = 'f1a00000-0000-4000-8000-00000000000d'),
    'deleted|deleted|t|t', 'still referenced: a tombstone without its name');
  perform tests.assert_eq((select count(*) from platform.file_download_grants where expires_at < now() - interval '1 hour'),
    0::bigint, 'housekeeping removed the download grant that expired two hours ago');
  perform tests.assert_eq((select count(*) from platform.file_download_grants where expires_at > now()), 2::bigint,
    'unexpired grants stay');
end $$;
set session authorization app_worker;
set local role authenticated;
select tests.set_claims(jsonb_build_object('role', 'system', 'job_id', 'tests.files.housekeeping'));
do $$
begin
  perform tests.assert(not exists (select 1 from private.claim_file_housekeeping(100)
                                   where id = 'f1a00000-0000-4000-8000-00000000000d'), 'a tombstone is never due again');
end $$;
-- A generated report: reserved, stored, then clean (size and hash recorded) — only with its object.
select tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001', 'tests.files.generated'));
do $$
declare
  v_id uuid;
begin
  select id into v_id from private.create_generated_file('platform.user_import_report', 'platform', 'user_import',
    'a5000000-0000-4000-8000-0000000000f3', 'report.csv', 'text/csv', 120, '00000000-0000-4000-8000-0000000000a1');
  perform tests.assert(not private.finish_generated_file(v_id, 120, repeat('5', 64)), 'not yet stored');
end $$;
reset role;
reset session authorization;
rollback;

-- The generated path end to end with a known id (the key must match the stored object).
begin;
alter table platform.files disable trigger files_transition;
insert into platform.files (id, tenant_id, bucket, object_key, purpose, owner_module, owner_entity_type, owner_entity_id,
    original_name, declared_mime, declared_size, retention_class, created_by_user, upload_expires_at)
values ('f2a00000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'generated',
  'a0000000-0000-4000-8000-000000000001/platform/user_import/a5000000-0000-4000-8000-0000000000f3/f2a00000-0000-4000-8000-000000000001',
  'platform.user_import_report', 'platform', 'user_import', 'a5000000-0000-4000-8000-0000000000f3', 'report.csv', 'text/csv', 120,
  'import', '00000000-0000-4000-8000-0000000000a1', now() + interval '15 minutes');
alter table platform.files enable trigger files_transition;
insert into storage.objects (bucket_id, name, metadata) values ('generated',
  'a0000000-0000-4000-8000-000000000001/platform/user_import/a5000000-0000-4000-8000-0000000000f3/f2a00000-0000-4000-8000-000000000001',
  '{"size": 120}');
set session authorization app_worker;
set local role authenticated;
select tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001', 'tests.files.generated'));
do $$
begin
  perform tests.assert(not private.finish_generated_file('f2a00000-0000-4000-8000-000000000001', 121, repeat('5', 64)),
    'the size must be the reserved one');
  perform tests.assert(private.finish_generated_file('f2a00000-0000-4000-8000-000000000001', 120, repeat('5', 64)),
    'stored: clean');
  perform tests.assert_eq((select concat_ws('|', status, detected_mime, size_bytes, scan_engine) from platform.files
                           where id = 'f2a00000-0000-4000-8000-000000000001'),
    'clean|text/csv|120|generated', 'clean, marked as generated (not scanned)');
end $$;
reset role;
reset session authorization;
rollback;

-- Remove the fixtures of 80_files_owner.sql (files, their objects and grants); 00's remain.
begin;
delete from platform.file_download_grants where file_id in (select id from platform.files where id::text like 'f1%');
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.objects o using platform.files f
where f.id::text like 'f1%' and o.bucket_id = f.bucket and o.name = f.object_key;
alter table platform.files disable trigger files_transition;
delete from platform.files where id::text like 'f1%';
alter table platform.files enable trigger files_transition;
do $$
begin
  perform tests.assert_eq((select count(*) from platform.files), 2::bigint, 'the two files of 00 remain');
  perform tests.assert_eq((select count(*) from storage.objects), 2::bigint, 'their two objects remain');
end $$;
commit;

\echo '84_files_cleanup_owner: ok'
