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

-- Organizations take turns: A has two files older than B's only one, yet B's comes second; an organization
-- served a moment ago waits behind one that was not, whatever the age of its files.
begin;
alter table platform.files disable trigger files_transition;
update platform.files set uploaded_at = now() - interval '30 minutes' where id = 'f1a00000-0000-4000-8000-000000000007';
alter table platform.files enable trigger files_transition;
set session authorization app_worker;
set local role authenticated;
select tests.set_claims(jsonb_build_object('role', 'system', 'job_id', 'tests.files.scan'));
do $$
begin
  perform tests.assert_eq(array[(select id from private.claim_file_scan()), (select id from private.claim_file_scan()),
                                (select id from private.claim_file_scan())],
    array['f1a00000-0000-4000-8000-00000000000e', 'f1b00000-0000-4000-8000-000000000002',
          'f1a00000-0000-4000-8000-000000000007']::uuid[],
    'A (oldest), then B''s turn although A''s second file is older, then A');
end $$;
reset role;
reset session authorization;
rollback;

begin;
-- A was served a minute ago (another of its files was scanned), B never.
alter table platform.files disable trigger files_transition;
update platform.files set scan_claimed_at = now() - interval '1 minute' where id = 'f1a00000-0000-4000-8000-000000000008';
alter table platform.files enable trigger files_transition;
set session authorization app_worker;
set local role authenticated;
select tests.set_claims(jsonb_build_object('role', 'system', 'job_id', 'tests.files.scan'));
do $$
begin
  perform tests.assert_eq((select id from private.claim_file_scan()), 'f1b00000-0000-4000-8000-000000000002'::uuid,
    'B first: A had the last turn, although A''s file is older');
end $$;
reset role;
reset session authorization;
rollback;

-- The scanner unavailable for a file uploaded more than 24 hours ago: no more waiting — error, so the
-- operators are alerted (the worker logs it as an error) instead of the file waiting for ever.
begin;
alter table platform.files disable trigger files_transition;
update platform.files set uploaded_at = now() - interval '25 hours' where id = 'f1b00000-0000-4000-8000-000000000002';
alter table platform.files enable trigger files_transition;
set session authorization app_worker;
set local role authenticated;
select tests.set_claims(jsonb_build_object('role', 'system', 'job_id', 'tests.files.scan'));
do $$
declare
  r record;
begin
  select * into r from private.claim_file_scan();
  perform tests.assert_eq(r.id, 'f1b00000-0000-4000-8000-000000000002'::uuid, 'B''s file uploaded 25 hours ago');
  perform tests.assert_eq(private.retry_file_scan(r.id, 'scanner'), 'error', 'no verdict 24 hours after the upload: error');
end $$;
select tests.set_claims(tests.system_claims('b0000000-0000-4000-8000-000000000001', 'tests.files.scan'));
do $$
begin
  perform tests.assert_eq((select status || '|' || status_reason from platform.files where id = 'f1b00000-0000-4000-8000-000000000002'),
    'error|scanner_unavailable', 'error, with the reason');
end $$;
reset role;
reset session authorization;
rollback;

-- Confirmation compares the Content-Type Storage stored (and serves the object with) to the declared type.
begin;
update storage.objects set metadata = metadata || '{"mimetype": "text/html"}'
where name like '%/f1a00000-0000-4000-8000-000000000002';
update storage.objects set metadata = metadata || '{"mimetype": "TEXT/CSV; charset=utf-8"}'
where name like '%/f1b00000-0000-4000-8000-000000000001';
set session authorization app_server;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
                                          'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
do $$
begin
  perform tests.assert_eq(private.confirm_file_upload('f1a00000-0000-4000-8000-000000000002'), 'rejected',
    'stored as text/html, declared text/csv: rejected');
  perform tests.assert_eq((select status_reason from platform.files where id = 'f1a00000-0000-4000-8000-000000000002'),
    'type_mismatch', 'rejected for the type mismatch');
end $$;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1',
                                          'b0000000-0000-4000-8000-000000000001'));
do $$
begin
  perform tests.assert_eq(private.confirm_file_upload('f1b00000-0000-4000-8000-000000000001'), 'uploaded',
    'the declared type with a charset parameter (any case): accepted');
end $$;
reset role;
reset session authorization;
rollback;

-- Housekeeping re-checks under the row lock, just before the Storage work: a legal hold set, or a use
-- recorded, after the lease was handed out stops the removal.
begin;
set session authorization app_worker;
set local role authenticated;
select tests.set_claims(jsonb_build_object('role', 'system', 'job_id', 'tests.files.housekeeping'));
do $$
begin
  perform tests.assert(exists (select 1 from private.claim_file_housekeeping(100)
                               where id = 'f1a00000-0000-4000-8000-00000000000b' and action = 'purge'), 'the deleted photo is due');
end $$;
reset role;
reset session authorization;
update platform.files set legal_hold = true where id = 'f1a00000-0000-4000-8000-00000000000b';
set session authorization app_worker;
set local role authenticated;
select tests.set_claims(jsonb_build_object('role', 'system', 'job_id', 'tests.files.housekeeping'));
do $$
begin
  perform tests.assert(not private.lock_file_housekeeping('f1a00000-0000-4000-8000-00000000000b', 'purge'),
    'a legal hold set after the lease: not removed');
  perform tests.assert(not private.finish_file_housekeeping('f1a00000-0000-4000-8000-00000000000b', 'purge'),
    'and never recorded as purged');
end $$;
reset role;
reset session authorization;
rollback;

-- Orphan objects: in our buckets, older than 3 hours, owned by no live file — removed by housekeeping.
begin;
insert into storage.objects (bucket_id, name, metadata, created_at) values
  -- A generated report whose job rolled back after writing it (no file record), 4 hours ago: orphan.
  ('generated', 'a0000000-0000-4000-8000-000000000001/platform/user_import_report/a5000000-0000-4000-8000-0000000000f4/f3a00000-0000-4000-8000-000000000001',
   '{"size": 5}', now() - interval '4 hours'),
  -- The same, an hour ago: a write may still be in flight.
  ('generated', 'a0000000-0000-4000-8000-000000000001/platform/user_import_report/a5000000-0000-4000-8000-0000000000f4/f3a00000-0000-4000-8000-000000000002',
   '{"size": 5}', now() - interval '1 hour'),
  -- The infected file's object already moved to quarantine, its record not yet updated: owned.
  ('quarantine', 'a0000000-0000-4000-8000-000000000001/platform/user_import/a5000000-0000-4000-8000-000000000009/f1a00000-0000-4000-8000-000000000009',
   '{"size": 20}', now() - interval '4 hours'),
  -- Not our key shape: not ours to remove.
  ('imports', 'a0000000-0000-4000-8000-000000000001/operator-notes.txt', '{"size": 5}', now() - interval '4 hours');
update storage.objects set created_at = now() - interval '4 hours' where name like '%/f1a00000-0000-4000-8000-00000000000a'
  or name like '%/f1a00000-0000-4000-8000-000000000008';
-- The rejected file's object was removed; a still-valid signed upload URL created it again: orphan.
update platform.files set object_removed_at = now() - interval '1 hour' where id = 'f1a00000-0000-4000-8000-00000000000a';
set session authorization app_worker;
set local role authenticated;
select tests.set_claims(jsonb_build_object('role', 'system', 'job_id', 'tests.files.housekeeping'));
do $$
begin
  perform tests.assert_eq((select string_agg(bucket || ':' || split_part(object_key, '/', 5), ',' order by bucket)
                           from private.claim_orphan_objects(100)),
    'generated:f3a00000-0000-4000-8000-000000000001,imports:f1a00000-0000-4000-8000-00000000000a',
    'orphans: the object recreated after its removal and the rolled-back report; never a live file''s object, a fresh one, a quarantined one, or a foreign key shape');
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
