-- db-test: run-as=app_worker
-- Files, the worker side (T-M2-18, ADR 0006 §3.4, §7, §8): only a job (system claims under the app_worker
-- login) leases files for the scan, records outcomes in the file's own tenant, puts files back when the
-- scanner is unavailable (fail closed), runs housekeeping (quarantine, object removal, purge by retention
-- class, legal hold respected) and writes generated files. Fixtures: 00_helpers_and_fixtures.sql,
-- 80_files_owner.sql. Every block is rolled back.
\set ON_ERROR_STOP on

do $$ begin perform tests.assert(session_user = 'app_worker', 'must run connected as app_worker'); end $$;

begin;
set local role authenticated;
select tests.set_claims(null);
do $$
begin
  perform tests.assert_fails($q$select * from private.claim_file_scan()$q$, array['42501'], 'no claims: refused');
  perform tests.assert_fails($q$select * from private.claim_file_housekeeping(10)$q$, array['42501'], 'no claims: refused');
  perform tests.assert_fails($q$select * from private.claim_orphan_objects(10)$q$, array['42501'], 'no claims: refused');
  perform tests.assert_fails($q$select private.lock_file_housekeeping('f1a00000-0000-4000-8000-00000000000b', 'purge')$q$,
    array['42501'], 'no claims: refused');
  perform tests.assert_privilege_denied($q$update platform.files set status = 'clean' where id = 'f1a00000-0000-4000-8000-000000000007'$q$,
    'jobs never write platform.files directly either');
  perform tests.assert_privilege_denied($q$select * from private.storage_object_facts$q$, 'nor read Storage objects directly');
end $$;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
                                          'a0000000-0000-4000-8000-000000000001'));
do $$
begin
  perform tests.assert_fails($q$select * from private.claim_file_scan()$q$, array['42501'], 'user claims under the worker: refused');
  perform tests.assert_fails($q$select * from private.create_file_upload('platform.user_import', 'platform', 'user_import',
      gen_random_uuid(), 'a.csv', 'text/csv', 10)$q$, array['42501'], 'user claims under the worker: no upload intent');
end $$;
select tests.set_claims(jsonb_build_object('role', 'system'));
do $$
begin
  perform tests.assert_fails($q$select * from private.claim_file_scan()$q$, array['42501'], 'system claims without a job: refused');
end $$;
reset role;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Scan leases: organizations take turns, each its oldest file first (a scan abandoned by a dead worker is
-- taken up again); suspended organizations wait; a leased file is not handed out twice. (Turns against
-- an organization with older files: 84_files_cleanup_owner.sql.)
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(jsonb_build_object('role', 'system', 'job_id', 'tests.files.scan'));
do $$
declare
  r record;
  v_got text[] := '{}';
begin
  loop
    select * into r from private.claim_file_scan();
    exit when r.id is null;
    v_got := v_got || concat_ws('|', r.id, r.bucket, r.purpose, r.declared_mime, r.max_bytes, array_to_string(r.allowed_types, ','),
                                r.attempts);
    exit when cardinality(v_got) > 10;
  end loop;
  perform tests.assert_eq(v_got, array[
    'f1a00000-0000-4000-8000-00000000000e|imports|platform.user_import|text/csv|20971520|text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet|6',
    'f1b00000-0000-4000-8000-000000000002|imports|platform.user_import|text/csv|20971520|text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet|1',
    'f1a00000-0000-4000-8000-000000000007|imports|platform.user_import|text/csv|20971520|text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet|1'],
    'leases: A''s abandoned scan (oldest upload), then B''s turn, then A again; suspended tenant C waits');
  perform tests.assert_eq((select count(*) from platform.files), 0::bigint,
    'a platform job (no tenant) leases through the function but reads no file itself');
  -- Outcomes need the file's own tenant: platform claims (no tenant) cannot finish.
  perform tests.assert_fails($q$select private.finish_file_scan('f1a00000-0000-4000-8000-000000000007', 'clean', 'text/csv', 20,
      repeat('1', 64), 'ClamAV 1.5.4', '28137', null, null)$q$, array['42501'], 'finish needs the file''s tenant');
end $$;
-- Tenant B's job cannot touch tenant A's file.
select tests.set_claims(tests.system_claims('b0000000-0000-4000-8000-000000000001', 'tests.files.scan'));
do $$
begin
  perform tests.assert(not private.finish_file_scan('f1a00000-0000-4000-8000-000000000007', 'clean', 'text/csv', 20,
      repeat('1', 64), 'ClamAV 1.5.4', '28137', null, null), 'another tenant''s file: nothing recorded');
  perform tests.assert_eq((select count(*) from platform.files where tenant_id <> 'b0000000-0000-4000-8000-000000000001'), 0::bigint,
    'tenant B''s job sees only tenant B''s files');
end $$;
select tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001', 'tests.files.scan'));
do $$
begin
  perform tests.assert_eq((select count(*) from platform.files where status = 'scanning' and scan_leased_until > now()), 2::bigint,
    'tenant A''s two leased files are scanning, with a lease');
  perform tests.assert_eq((select count(*) from platform.files where scan_claimed_at = now()), 2::bigint,
    'each lease records the organization''s turn');
  perform tests.assert_fails($q$select private.delete_file('f1a00000-0000-4000-8000-000000000007')$q$, array['JF009'],
    'a file a worker is scanning cannot be deleted (its verdict is recorded first)');
  perform tests.assert_fails($q$select private.finish_file_scan('f1a00000-0000-4000-8000-000000000007', 'clean', 'image/png', 20,
      repeat('1', 64), 'ClamAV 1.5.4', '28137', null, null)$q$, array['23514'], 'clean needs a type the purpose allows');
  perform tests.assert_fails($q$select private.finish_file_scan('f1a00000-0000-4000-8000-000000000007', 'clean', 'text/csv', 20971521,
      repeat('1', 64), 'ClamAV 1.5.4', '28137', null, null)$q$, array['23514'], 'clean needs a size within the limit');
  perform tests.assert_fails($q$select private.finish_file_scan('f1a00000-0000-4000-8000-000000000007', 'clean', 'text/csv', 20,
      'not-a-hash', 'ClamAV 1.5.4', '28137', null, null)$q$, array['23514'], 'clean needs the hash');
  perform tests.assert(private.finish_file_scan('f1a00000-0000-4000-8000-000000000007', 'clean', 'text/csv', 21,
      repeat('1', 64), 'ClamAV 1.5.4', '28137/Mon Sep 28 06:24:12 2026', null, null), 'clean recorded');
  perform tests.assert_eq((select concat_ws('|', status, detected_mime, size_bytes, sha256 = repeat('1', 64), scan_engine,
                                            scan_signatures, scanned_at is not null, scan_leased_until is null)
                           from platform.files where id = 'f1a00000-0000-4000-8000-000000000007'),
    'clean|text/csv|21|t|ClamAV 1.5.4|28137/Mon Sep 28 06:24:12 2026|t|t', 'the scan result is kept');
  perform tests.assert(not private.finish_file_scan('f1a00000-0000-4000-8000-000000000007', 'infected', 'text/csv', 21,
      repeat('1', 64), 'ClamAV 1.5.4', '28137', 'Eicar-Test-Signature', null), 'a finished file is not finished again');
  perform tests.assert(private.mark_file_used('f1a00000-0000-4000-8000-000000000007'), 'a job may record the use');
end $$;
reset role;
rollback;

-- Infected, rejected and failed outcomes.
begin;
set local role authenticated;
select tests.set_claims(jsonb_build_object('role', 'system', 'job_id', 'tests.files.scan'));
select count(*) from private.claim_file_scan();
select count(*) from private.claim_file_scan();
select count(*) from private.claim_file_scan();
select tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001', 'tests.files.scan'));
do $$
begin
  perform tests.assert_fails($q$select private.finish_file_scan('f1a00000-0000-4000-8000-000000000007', 'infected', 'text/csv', 68,
      repeat('2', 64), 'ClamAV 1.5.4', '28137', null, null)$q$, array['23514'], 'infected needs the finding');
  perform tests.assert(private.finish_file_scan('f1a00000-0000-4000-8000-000000000007', 'infected', 'text/csv', 68,
      repeat('2', 64), 'ClamAV 1.5.4', '28137', 'Eicar-Test-Signature', null), 'infected recorded');
  perform tests.assert_eq((select concat_ws('|', status, status_reason, scan_finding, bucket) from platform.files
                           where id = 'f1a00000-0000-4000-8000-000000000007'),
    'infected|malware|Eicar-Test-Signature|imports', 'infected: blocked at once; the move to quarantine follows');
  perform tests.assert_fails($q$select private.finish_file_scan('f1a00000-0000-4000-8000-00000000000e', 'rejected', 'application/x-msdownload',
      20, repeat('3', 64), 'ClamAV 1.5.4', '28137', null, null)$q$, array['23514'], 'rejected needs a reason');
  perform tests.assert(private.finish_file_scan('f1a00000-0000-4000-8000-00000000000e', 'rejected', 'application/x-msdownload',
      20, repeat('3', 64), 'ClamAV 1.5.4', '28137', null, 'type_not_allowed'), 'rejected recorded');
  perform tests.assert_eq((select status || '|' || status_reason from platform.files where id = 'f1a00000-0000-4000-8000-00000000000e'),
    'rejected|type_not_allowed', 'rejected with its reason');
  perform tests.assert_fails($q$select private.finish_file_scan('f1a00000-0000-4000-8000-00000000000e', 'quarantined', null, null,
      null, null, null, null, 'x')$q$, array['23514'], 'unknown outcome');
end $$;
reset role;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Fail closed: a file whose scan could not finish stays `scanning` and waits (back-off); failures of the file
-- itself end as `error` after 5; the scanner's unavailability is not counted against the file (the
-- 24-hour limit for that: 84_files_cleanup_owner.sql).
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(jsonb_build_object('role', 'system', 'job_id', 'tests.files.scan'));
do $$
declare
  r record;
begin
  select * into r from private.claim_file_scan();
  perform tests.assert_eq(r.id, 'f1a00000-0000-4000-8000-00000000000e'::uuid, 'the abandoned scan first');
  perform tests.assert_eq(private.retry_file_scan(r.id, 'processing'), 'error', 'the fifth failure of the file itself: error');
  select * into r from private.claim_file_scan();
  perform tests.assert_eq(r.id, 'f1b00000-0000-4000-8000-000000000002'::uuid, 'next file');
  perform tests.assert_eq(private.retry_file_scan(r.id, 'scanner'), 'waiting', 'scanner unavailable: it waits');
  select * into r from private.claim_file_scan();
  perform tests.assert_eq(r.id, 'f1a00000-0000-4000-8000-000000000007'::uuid, 'a waiting file is not leased again before its time');
  perform tests.assert_eq(private.retry_file_scan(r.id, 'processing'), 'waiting', 'a first failure of the file: it waits');
  perform tests.assert_eq(private.retry_file_scan(gen_random_uuid(), 'scanner'), 'gone', 'unknown file');
  perform tests.assert_fails($q$select private.retry_file_scan('f1a00000-0000-4000-8000-000000000007', 'never')$q$, array['23514'],
    'unknown retry kind');
end $$;
select tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001', 'tests.files.scan'));
do $$
begin
  perform tests.assert_eq((select status || '|' || status_reason || '|' || scan_failures from platform.files
                           where id = 'f1a00000-0000-4000-8000-00000000000e'),
    'error|processing_failed|5', 'error with its reason');
  perform tests.assert_eq((select concat_ws('|', status, scan_failures, scan_attempts) from platform.files
                           where id = 'f1a00000-0000-4000-8000-000000000007'),
    'scanning|1|1', 'one failure of the file counted, still waiting');
  perform tests.assert(private.delete_file('f1a00000-0000-4000-8000-00000000000e'), 'a failed file can be deleted');
  perform tests.assert(private.delete_file('f1a00000-0000-4000-8000-000000000007'),
    'a file waiting after a failure (no worker holds its lease) can be deleted');
end $$;
select tests.set_claims(tests.system_claims('b0000000-0000-4000-8000-000000000001', 'tests.files.scan'));
do $$
begin
  perform tests.assert_eq((select concat_ws('|', status, scan_leased_until is null, scan_failures,
                                            scan_not_before between now() + interval '14 seconds' and now() + interval '16 seconds')
                           from platform.files where id = 'f1b00000-0000-4000-8000-000000000002'),
    'scanning|t|0|t', 'scanner unavailable: still scanning (never clean), not counted against the file, 15 s back-off');
end $$;
reset role;
rollback;

-- A file that crashes the scanner: each suspected crash (stream lost, no PING answer right after) is counted
-- for the file and waits like an outage; the third makes it `error` (scanner_crashed), so it cannot take the
-- scanner down for every organization again and again.
begin;
set local role authenticated;
select tests.set_claims(jsonb_build_object('role', 'system', 'job_id', 'tests.files.scan'));
do $$
declare
  r record;
begin
  select * into r from private.claim_file_scan();
  perform tests.assert_eq(r.id, 'f1a00000-0000-4000-8000-00000000000e'::uuid, 'A''s file first');
  perform tests.assert_eq(private.retry_file_scan(r.id, 'crash'), 'waiting', 'first suspected crash: it waits');
  perform tests.assert_eq(private.retry_file_scan(r.id, 'crash'), 'waiting', 'second: it waits');
  perform tests.assert_eq(private.retry_file_scan(r.id, 'crash'), 'crashed', 'third: error (answered as crashed)');
  perform tests.assert_eq(private.retry_file_scan(r.id, 'crash'), 'gone', 'nothing more once it failed');
end $$;
select tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001', 'tests.files.scan'));
do $$
begin
  perform tests.assert_eq((select concat_ws('|', status, status_reason, scan_crashes, scan_failures) from platform.files
                           where id = 'f1a00000-0000-4000-8000-00000000000e'),
    'error|scanner_crashed|3|4', 'error (scanner_crashed); crashes counted apart from the file''s other failures');
end $$;
reset role;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Housekeeping (ADR 0006 §7): what is due, per retention class; legal hold respected; a lease per file.
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(jsonb_build_object('role', 'system', 'job_id', 'tests.files.housekeeping'));
do $$
declare
  v_got text;
begin
  select string_agg(id || ':' || action, ',' order by id) into v_got from private.claim_file_housekeeping(100);
  perform tests.assert_eq(v_got,
    'f1a00000-0000-4000-8000-000000000005:purge,'           -- unconfirmed upload, 25 hours old
    'f1a00000-0000-4000-8000-000000000009:quarantine,'      -- infected, still in its upload bucket
    'f1a00000-0000-4000-8000-00000000000a:remove_object,'   -- rejected: object removed, record kept 30 days
    'f1a00000-0000-4000-8000-00000000000b:purge,'           -- photo deleted 31 days ago
    'f1a00000-0000-4000-8000-00000000000d:purge',           -- import used 8 days ago
    'due: unconfirmed > 24 h, imports 7 days after use, deleted photos after 30 days; never the legal hold (…0c), fresh or in-flight files');
  perform tests.assert_eq((select count(*) from private.claim_file_housekeeping(100)), 0::bigint, 'leased: not handed out twice');
  -- Just before the Storage work: still due? (Legal hold set or use recorded since: 84_files_cleanup_owner.sql.)
  perform tests.assert(private.lock_file_housekeeping('f1a00000-0000-4000-8000-00000000000b', 'purge'), 'still due: locked for its purge');
  perform tests.assert(not private.lock_file_housekeeping('f1a00000-0000-4000-8000-00000000000c', 'purge'), 'legal hold: never');
  perform tests.assert(not private.lock_file_housekeeping('f1a00000-0000-4000-8000-000000000009', 'purge'),
    'not the action that is due (quarantine)');
  perform tests.assert(not private.lock_file_housekeeping(gen_random_uuid(), 'purge'), 'unknown file');
  perform tests.assert_fails($q$select private.lock_file_housekeeping('f1a00000-0000-4000-8000-00000000000b', 'shred')$q$,
    array['23514'], 'unknown action');
  perform tests.assert(private.finish_file_housekeeping('f1a00000-0000-4000-8000-000000000009', 'quarantine'), 'quarantined');
  perform tests.assert(not private.finish_file_housekeeping('f1a00000-0000-4000-8000-000000000009', 'quarantine'), 'once');
  perform tests.assert(private.finish_file_housekeeping('f1a00000-0000-4000-8000-00000000000a', 'remove_object'), 'object removed');
  perform tests.assert(private.finish_file_housekeeping('f1a00000-0000-4000-8000-00000000000b', 'purge'), 'purged');
  perform tests.assert(not private.finish_file_housekeeping('f1a00000-0000-4000-8000-00000000000c', 'purge'),
    'a file on legal hold is never purged');
  perform tests.assert_fails($q$select private.finish_file_housekeeping('f1a00000-0000-4000-8000-00000000000c', 'shred')$q$,
    array['23514'], 'unknown action');
end $$;
-- What it left, seen by a job of tenant A.
select tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001', 'tests.files.housekeeping'));
do $$
begin
  -- (Expired download grants removed: 84_files_cleanup_owner.sql, which sees every grant.)
  perform tests.assert_eq((select bucket || '|' || status || '|' || (quarantined_at is not null)::text from platform.files
                           where id = 'f1a00000-0000-4000-8000-000000000009'), 'quarantine|infected|true', 'in the quarantine bucket');
  perform tests.assert_eq((select status || '|' || (object_removed_at is not null)::text from platform.files
                           where id = 'f1a00000-0000-4000-8000-00000000000a'), 'rejected|true', 'the rejected record stays');
  perform tests.assert_eq((select count(*) from platform.files where id = 'f1a00000-0000-4000-8000-00000000000b'), 0::bigint,
    'the purged record is gone');
  perform tests.assert_eq((select count(*) from platform.files where id = 'f1a00000-0000-4000-8000-00000000000c'), 1::bigint,
    'the record on legal hold stays');
end $$;
reset role;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Generated files (worker purposes only, in the job's tenant, for an active member).
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001', 'tests.files.generated'));
do $$
declare
  r record;
begin
  select * into r from private.create_generated_file('platform.user_import_report', 'platform', 'user_import',
    'a5000000-0000-4000-8000-0000000000f2', 'تقرير الأخطاء.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 120,
    '00000000-0000-4000-8000-0000000000a1');
  perform tests.assert_eq(r.bucket, 'generated', 'reports go to the generated bucket');
  perform tests.assert(r.object_key like 'a0000000-0000-4000-8000-000000000001/platform/user_import/a5000000-0000-4000-8000-0000000000f2/%',
    'tenant-prefixed key');
  perform tests.assert(not private.finish_generated_file(r.id, 120, repeat('4', 64)), 'no object stored yet: not clean');
  perform tests.assert_fails($q$select * from private.create_generated_file('platform.user_import', 'platform', 'user_import',
      gen_random_uuid(), 'a.csv', 'text/csv', 10, null)$q$, array['JF003'], 'user purposes are uploaded, never generated');
  perform tests.assert_fails($q$select * from private.create_generated_file('platform.user_import_report', 'platform', 'user_import',
      gen_random_uuid(), 'a.csv', 'text/csv', 10, null)$q$,
    array['JF001'], 'a type the purpose does not allow (the import''s reports are XLSX: security review L2)');
  perform tests.assert_fails($q$select * from private.create_generated_file('platform.user_import_report', 'platform', 'user_import',
      gen_random_uuid(), 'a.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 10, '00000000-0000-4000-8000-0000000000b1')$q$,
    array['42501'], 'only for an active member of the job''s tenant');
  perform tests.assert(private.delete_file('f1a00000-0000-4000-8000-000000000008'), 'a job of the tenant may delete a file');
end $$;
-- Without a tenant: no generated file, no deletion.
select tests.set_claims(jsonb_build_object('role', 'system', 'job_id', 'tests.files.generated'));
do $$
begin
  perform tests.assert_fails($q$select * from private.create_generated_file('platform.user_import_report', 'platform', 'user_import',
      gen_random_uuid(), 'a.csv', 'text/csv', 10, null)$q$, array['42501'], 'a tenant job only');
  perform tests.assert_fails($q$select private.delete_file('f1a00000-0000-4000-8000-000000000008')$q$, array['42501'],
    'deleting needs the file''s tenant');
end $$;
reset role;
rollback;

\echo '82_files_app_worker: ok'
