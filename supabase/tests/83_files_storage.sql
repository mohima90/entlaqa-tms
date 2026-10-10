-- db-test: run-as=storage
-- Storage policies (T-M2-18, ADR 0006 §4, ADR 0002 §8, TM-0001 F-13 / T-34): connected as Supabase Storage's
-- login role (supabase_storage_admin), switched to the caller's role and claims exactly as storage-api does
-- (set_config('role'), request.jwt.claims = the JWT payload). A user may create an object only at the key
-- of their own pending upload, inside its window, in its bucket, in their tenant; may read only clean files
-- they hold an unexpired download grant for; may never update or delete. The claims are validated like
-- the web app's (live session, active membership, the session's organization). Every block is rolled back.
\set ON_ERROR_STOP on

do $$ begin perform tests.assert(session_user = 'supabase_storage_admin', 'must run connected as supabase_storage_admin'); end $$;

-- No claims; the anonymous role: nothing.
begin;
set local role authenticated;
select tests.set_claims(null);
do $$
begin
  perform tests.assert(private.storage_request_tenant() is null, 'no claims: no tenant');
  perform tests.assert_eq((select count(*) from storage.objects), 0::bigint, 'no claims: no object visible');
  perform tests.assert_rls_violation(tests.storage_put('imports',
      'a0000000-0000-4000-8000-000000000001/platform/user_import/a5000000-0000-4000-8000-000000000001/f1a00000-0000-4000-8000-000000000001'),
    'no claims: no upload');
end $$;
reset role;
set local role anon;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
                                          'a0000000-0000-4000-8000-000000000001'));
do $$
begin
  perform tests.assert_eq((select count(*) from storage.objects), 0::bigint, 'anon: no object visible');
  perform tests.assert_rls_violation(tests.storage_put('imports',
      'a0000000-0000-4000-8000-000000000001/platform/user_import/a5000000-0000-4000-8000-000000000001/f1a00000-0000-4000-8000-000000000001'),
    'anon (publishable key alone): no upload, even with user claims');
end $$;
reset role;
rollback;

-- uA, session sA in tenant A.
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
                                          'a0000000-0000-4000-8000-000000000001'));
do $$
begin
  perform tests.assert_eq(private.storage_request_tenant(), 'a0000000-0000-4000-8000-000000000001'::uuid,
    'valid user claims under Storage''s login: tenant A');
  -- Reads: the clean file with uA's grant only.
  perform tests.assert_eq((select string_agg(name, ',') from storage.objects),
    'a0000000-0000-4000-8000-000000000001/platform/user_import/a5000000-0000-4000-8000-000000000001/f0a00000-0000-4000-8000-000000000001',
    'only the clean file uA holds a grant for is readable');
  -- Writes: exactly the pending key of uA, in its bucket, inside its window.
  perform tests.assert_eq(tests.rows_affected(tests.storage_put('imports',
      'a0000000-0000-4000-8000-000000000001/platform/user_import/a5000000-0000-4000-8000-000000000001/f1a00000-0000-4000-8000-000000000001')),
    1::bigint, 'uA uploads to their pending key');
  perform tests.assert_rls_violation(tests.storage_put('images',
      'a0000000-0000-4000-8000-000000000001/platform/user_import/a5000000-0000-4000-8000-000000000001/f1a00000-0000-4000-8000-000000000002'),
    'the pending key in another bucket');
  perform tests.assert_rls_violation(tests.storage_put('imports',
      'a0000000-0000-4000-8000-000000000001/platform/user_import/a5000000-0000-4000-8000-000000000006/f1a00000-0000-4000-8000-000000000006'),
    'a pending upload whose 15-minute window closed');
  perform tests.assert_rls_violation(tests.storage_put('imports',
      'a0000000-0000-4000-8000-000000000001/platform/user_import/a5000000-0000-4000-8000-000000000008/f1a00000-0000-4000-8000-000000000008x'),
    'another key of the tenant (no pending upload)');
  perform tests.assert_rls_violation(tests.storage_put('imports',
      'a0000000-0000-4000-8000-000000000001/platform/user_import/a5000000-0000-4000-8000-000000000001/' || gen_random_uuid()),
    'a key nobody reserved');
  perform tests.assert_rls_violation(tests.storage_put('imports',
      'b0000000-0000-4000-8000-000000000001/platform/user_import/a5000000-0000-4000-8000-000000000001/f1b00000-0000-4000-8000-000000000001'),
    'tenant B''s pending key');
  perform tests.assert_rls_violation(tests.storage_put('quarantine', 'a0000000-0000-4000-8000-000000000001/x'),
    'the quarantine bucket');
  -- A worker-generated report reserved for uA (pending in `generated`) is the worker's to write, never uA's.
  perform tests.assert(not private.can_upload_object('generated',
      'a0000000-0000-4000-8000-000000000001/platform/user_import_report/a5000000-0000-4000-8000-000000000010/f1a00000-0000-4000-8000-000000000010'),
    'no upload to a generated file''s key, even reserved for this user');
  -- Storage's upsert (x-upsert: true) is `insert … on conflict do update … returning *`: refused for a pending
  -- key that already holds the uploaded bytes, and for a clean file uA may read — the scanned bytes are never
  -- replaced (no UPDATE policy).
  perform tests.assert_rls_violation(format($q$insert into storage.objects (bucket_id, name, owner, metadata) values ('imports', %L,
      '00000000-0000-4000-8000-0000000000a1', '{"size": 10}') on conflict (bucket_id, name) do update set metadata = excluded.metadata
      returning *$q$,
      'a0000000-0000-4000-8000-000000000001/platform/user_import/a5000000-0000-4000-8000-000000000002/f1a00000-0000-4000-8000-000000000002'),
    'no upsert over the uploaded bytes of a pending upload');
  perform tests.assert_rls_violation(format($q$insert into storage.objects (bucket_id, name, owner, metadata) values ('imports', %L,
      '00000000-0000-4000-8000-0000000000a1', '{"size": 10}') on conflict (bucket_id, name) do update set metadata = excluded.metadata
      returning *$q$,
      'a0000000-0000-4000-8000-000000000001/platform/user_import/a5000000-0000-4000-8000-000000000001/f0a00000-0000-4000-8000-000000000001'),
    'no upsert over a scanned (clean) file');
  -- And for a fresh pending key without any object yet (the upload hosted Storage makes with x-upsert:
  -- true): refused too — an upload is only ever a plain insert, so nothing can later replace its bytes.
  perform tests.assert_rls_violation(format($q$insert into storage.objects (bucket_id, name, owner, metadata) values ('imports', %L,
      '00000000-0000-4000-8000-0000000000a1', '{"size": 10}') on conflict (bucket_id, name) do update set metadata = excluded.metadata
      returning *$q$,
      'a0000000-0000-4000-8000-000000000001/platform/user_import/a5000000-0000-4000-8000-000000000001/f1a00000-0000-4000-8000-000000000001'),
    'no upsert even at a fresh pending key without an object');
  perform tests.assert_eq((select count(*) from storage.objects where name like '%/f1a00000-0000-4000-8000-000000000001'),
    0::bigint, 'the refused upsert left no object');
  -- Never update or delete (no policy: nothing matches, nothing changes).
  perform tests.assert_eq(tests.rows_affected($q$update storage.objects set metadata = '{"size": 1}'$q$), 0::bigint,
    'no update of any object');
  perform tests.assert_eq(tests.rows_affected($q$delete from storage.objects$q$), 0::bigint, 'no delete of any object');
end $$;
reset role;
rollback;

-- Another member (uAB) of the same tenant: uA's pending key is not theirs; their own grant expired.
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
                                          'a0000000-0000-4000-8000-000000000001'));
do $$
begin
  perform tests.assert_rls_violation(tests.storage_put('imports',
      'a0000000-0000-4000-8000-000000000001/platform/user_import/a5000000-0000-4000-8000-000000000001/f1a00000-0000-4000-8000-000000000001'),
    'another user''s pending key');
  perform tests.assert_eq((select count(*) from storage.objects), 0::bigint, 'an expired grant reads nothing');
end $$;
reset role;
rollback;

-- uB in tenant B: their own pending key and grant only.
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1',
                                          'b0000000-0000-4000-8000-000000000001'));
do $$
begin
  perform tests.assert_eq((select count(*) from storage.objects where name like 'b0000000-0000-4000-8000-000000000001/%'), 1::bigint,
    'uB reads B''s clean file with their grant');
  perform tests.assert_eq((select count(*) from storage.objects where name not like 'b0000000-0000-4000-8000-000000000001/%'), 0::bigint,
    'nothing of tenant A');
  perform tests.assert(private.can_upload_object('imports',
      'b0000000-0000-4000-8000-000000000001/platform/user_import/a5000000-0000-4000-8000-000000000001/f1b00000-0000-4000-8000-000000000001'),
    'uB may upload to their own pending key');
  perform tests.assert(not private.can_upload_object('imports',
      'a0000000-0000-4000-8000-000000000001/platform/user_import/a5000000-0000-4000-8000-000000000001/f1a00000-0000-4000-8000-000000000001'),
    'but not to uA''s');
end $$;
reset role;
rollback;

-- Claims that do not hold: an expired Auth session, a suspended membership, a token naming another
-- organization than the session acts in (stale after a switch), forged system claims, a suspended tenant.
begin;
set local role authenticated;
do $$
declare
  v_claims jsonb;
begin
  foreach v_claims in array array[
    tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a9', 'a0000000-0000-4000-8000-000000000001'),
    tests.user_claims('00000000-0000-4000-8000-0000000000a3', '10000000-0000-4000-8000-0000000000a3', 'a0000000-0000-4000-8000-000000000001'),
    tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab', 'b0000000-0000-4000-8000-000000000001'),
    tests.user_claims('00000000-0000-4000-8000-0000000000a1', gen_random_uuid(), 'a0000000-0000-4000-8000-000000000001'),
    tests.user_claims('00000000-0000-4000-8000-0000000000c1', '10000000-0000-4000-8000-0000000000c1', 'c0000000-0000-4000-8000-000000000001'),
    tests.system_claims('a0000000-0000-4000-8000-000000000001', 'tests.forged')]
  loop
    perform tests.set_claims(v_claims);
    perform tests.assert(private.storage_request_tenant() is null, format('claims refused: %s', v_claims));
    perform tests.assert_eq((select count(*) from storage.objects), 0::bigint, format('nothing readable: %s', v_claims));
    perform tests.assert_rls_violation(tests.storage_put('imports',
        'a0000000-0000-4000-8000-000000000001/platform/user_import/a5000000-0000-4000-8000-000000000001/f1a00000-0000-4000-8000-000000000001'),
      format('no upload: %s', v_claims));
  end loop;
end $$;
reset role;
rollback;

\echo '83_files_storage: ok'
