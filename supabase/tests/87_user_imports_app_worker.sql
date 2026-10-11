-- db-test: run-as=app_worker
-- User imports, the worker side (T-M2-12, FR-IAM-04, ADR 0005): only a job (system claims under the
-- app_worker login) claims imports across organizations — the next step each needs, with a lease (a leased
-- import is not handed out twice; suspended organizations wait) — and then works in the import's own
-- tenant: lifecycle moves of the worker only, staged columns and rows, never another tenant's import.
-- The processing itself (dry run, run, undo, sending): 88_user_imports_flow_owner.sql. Fixtures:
-- 00_helpers_and_fixtures.sql, 85_user_imports_fixtures.sql. Every block is rolled back.
\set ON_ERROR_STOP on

do $$ begin perform tests.assert(session_user = 'app_worker', 'must run connected as app_worker'); end $$;

begin;
set local role authenticated;
select tests.set_claims(null);
do $$
begin
  perform tests.assert_fails($q$select * from private.claim_user_import_work()$q$, array['42501'], 'no claims: refused');
  perform tests.assert_fails($q$select private.take_invitation_send_slot(interval '1 second')$q$, array['42501'],
    'no claims: the send clock is refused');
end $$;
select tests.set_claims(jsonb_build_object('role', 'system'));
do $$
begin
  perform tests.assert_fails($q$select * from private.claim_user_import_work()$q$, array['42501'], 'system claims without a job: refused');
end $$;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
                                          'a0000000-0000-4000-8000-000000000001'));
do $$
begin
  perform tests.assert_fails($q$select * from private.claim_user_import_work()$q$, array['42501'], 'user claims under the worker: refused');
  perform tests.assert_fails($q$select private.take_invitation_send_slot(interval '1 second')$q$, array['42501'],
    'user claims under the worker: the send clock is refused');
end $$;
rollback;

-- The send clock (security review M2): one slot at a time for the whole platform, at a bounded pace;
-- jobs reach it only through the slot function.
begin;
set local role authenticated;
select tests.set_claims(tests.system_claims('b0000000-0000-4000-8000-000000000001', 'tests.user_imports'));
do $$
begin
  perform tests.assert_fails($q$select private.take_invitation_send_slot(interval '2 minutes')$q$, array['22023'],
    'the pace is bounded (at most a minute)');
  perform tests.assert_fails($q$select private.take_invitation_send_slot(interval '499 milliseconds')$q$, array['22023'],
    'and at least 500 milliseconds, as the worker''s setting (integration review)');
  perform tests.assert(private.take_invitation_send_slot(interval '1 minute') is null, 'a job takes the free slot');
  perform tests.assert(private.take_invitation_send_slot(interval '1 minute') > now(),
    'the next one is a minute later, for the job of any organization');
  perform tests.assert_privilege_denied($q$update private.invitation_send_clock set next_slot = now() - interval '1 hour'$q$,
    'jobs cannot move the clock themselves');
  perform tests.assert_fails($q$select * from private.user_import_release_next('a5000000-0000-4000-8000-000000000011', interval '1 second', 10, 10)$q$,
    array['P0002'], 'tenant A''s import is unknown to tenant B''s job: it sends none of its invitations');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- The claim: what is due, in order, leased once; suspended organizations wait.
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(jsonb_build_object('role', 'system', 'job_id', 'tests.user_imports'));
do $$
declare
  r record;
  v_got text[] := '{}';
begin
  loop
    select * into r from private.claim_user_import_work();
    exit when r.import_id is null;
    perform tests.assert(r.lease_token is not null, 'a lease token comes with every claim');
    v_got := v_got || concat_ws('|', r.tenant_id, r.import_id, r.step);
    exit when cardinality(v_got) > 10;
  end loop;
  perform tests.assert_eq(v_got, array[
    'a0000000-0000-4000-8000-000000000001|a5000000-0000-4000-8000-000000000012|purge',
    'a0000000-0000-4000-8000-000000000001|a5000000-0000-4000-8000-000000000015|read',
    'a0000000-0000-4000-8000-000000000001|a5000000-0000-4000-8000-000000000017|expire'],
    'due: data 7 days after the end (purge), a clean upload (read), a review past its 24 hours (expire); '
    'an upload not made yet waits, a suspended organization waits, a review in time waits, a leased one is not handed out again');
  perform tests.assert_eq((select count(*) from platform.user_imports), 0::bigint,
    'a platform job (no tenant) claims through the function but reads no import itself');
end $$;
-- The lease is visible to the import's tenant job; it can be released there.
select tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001', 'tests.user_imports'));
do $$
begin
  perform tests.assert_eq((select count(*) from platform.user_imports where lease_until > now() and lease_token is not null),
    3::bigint, 'three imports leased (about 15 minutes)');
  perform tests.assert((select bool_and(lease_until between now() + interval '14 minutes' and now() + interval '16 minutes')
                        from platform.user_imports where lease_token is not null), 'leases last 15 minutes');
  perform tests.assert_eq(tests.rows_affected($q$update platform.user_imports set lease_until = null, lease_token = null where lease_token is not null$q$),
    3::bigint, 'the tenant''s job releases its leases');
end $$;
select tests.set_claims(jsonb_build_object('role', 'system', 'job_id', 'tests.user_imports'));
do $$
begin
  perform tests.assert_eq((select import_id from private.claim_user_import_work()), 'a5000000-0000-4000-8000-000000000012'::uuid,
    'released: claimed again');
end $$;
rollback;

-- Back-off: an import whose next attempt is later is not due yet.
begin;
set local role authenticated;
select tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001', 'tests.user_imports'));
update platform.user_imports set next_attempt_at = now() + interval '1 minute', failures = 1
  where id = 'a5000000-0000-4000-8000-000000000012';
select tests.set_claims(jsonb_build_object('role', 'system', 'job_id', 'tests.user_imports'));
do $$
begin
  perform tests.assert_eq((select import_id from private.claim_user_import_work()), 'a5000000-0000-4000-8000-000000000015'::uuid,
    'an import backing off after a failure waits for its next attempt');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- The worker's moves, in the import's tenant.
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001', 'tests.user_imports'));
do $$
declare
  v_row record;
begin
  perform tests.assert_eq(tests.rows_affected($q$update platform.user_imports set status = 'mapping', sheets = '[{"name": "الموظفون", "rows": 2, "columns": 3}]' where id = 'a5000000-0000-4000-8000-000000000015'$q$),
    1::bigint, 'uploaded → mapping with the file''s sheets');
  select * into v_row from platform.user_imports where id = 'a5000000-0000-4000-8000-000000000015';
  perform tests.assert(v_row.read_at is not null, 'read time stamped');
  perform tests.assert_fails($q$update platform.user_imports set mapping = '{"0": "email", "1": "first_name_ar", "2": "family_name_ar"}' where id = 'a5000000-0000-4000-8000-000000000015'$q$,
    array['42501'], 'only the importer chooses the mapping');
  perform tests.assert_fails($q$update platform.user_imports set status = 'queued' where id = 'a5000000-0000-4000-8000-000000000001'$q$,
    array['23514'], 'only the importer confirms (review → queued is not a worker move)');
  perform tests.assert_fails($q$update platform.user_imports set status = 'undoing' where id = 'a5000000-0000-4000-8000-000000000011'$q$,
    array['23514'], 'only the importer asks for an undo');
  perform tests.assert_fails($q$update platform.user_imports set stop_requested_at = now() where id = 'a5000000-0000-4000-8000-000000000013'$q$,
    array['42501'], 'only the importer stops');
  perform tests.assert_privilege_denied($q$update platform.user_imports set created_by = '00000000-0000-4000-8000-0000000000ab' where id = 'a5000000-0000-4000-8000-000000000015'$q$,
    'the importer never changes');
  perform tests.assert_eq(tests.rows_affected($q$update platform.user_imports set status = 'expired' where id = 'a5000000-0000-4000-8000-000000000017'$q$),
    1::bigint, 'a review past its window expires');
  perform tests.assert_eq(tests.rows_affected($q$update platform.user_imports set data_purged_at = now() where id = 'a5000000-0000-4000-8000-000000000017'$q$),
    1::bigint, 'its data is purged once');
  perform tests.assert_fails($q$update platform.user_imports set data_purged_at = now() + interval '1 day' where id = 'a5000000-0000-4000-8000-000000000017'$q$,
    array['23514'], 'and only once');
  perform tests.assert_privilege_denied($q$delete from platform.user_imports where id = 'a5000000-0000-4000-8000-000000000017'$q$,
    'an import record is never deleted (kept with the audit log)');
  -- Staged data: written by the import's tenant job.
  perform tests.assert_eq(tests.rows_affected($q$insert into platform.user_import_columns (import_id, sheet_index, column_index, header, samples) values ('a5000000-0000-4000-8000-000000000015', 0, 0, 'البريد', '{a@imp.test}')$q$),
    1::bigint, 'the job stores a column with samples');
  perform tests.assert_eq(tests.rows_affected($q$insert into platform.user_import_rows (import_id, row_number, cells, data) values ('a5000000-0000-4000-8000-000000000015', 2, '{"email": "A@imp.test"}', '{"email": "a@imp.test"}')$q$),
    1::bigint, 'and a staged row');
  perform tests.assert_fails($q$insert into platform.user_import_columns (import_id, sheet_index, column_index, header, samples) values ('a5000000-0000-4000-8000-000000000015', 0, 1, 'x', '{a,b,c,d}')$q$,
    array['23514'], 'at most 3 samples per column');
  perform tests.assert_fails($q$insert into platform.user_import_rows (import_id, row_number) values ('a5000000-0000-4000-8000-000000000015', 1)$q$,
    array['23514'], 'row 1 is the header');
  perform tests.assert_fails($q$insert into platform.user_import_rows (import_id, row_number) values ('b5000000-0000-4000-8000-000000000001', 3)$q$,
    array['42501', '23503'], 'never under another tenant''s import');
end $$;
rollback;

-- Another tenant's job sees and changes nothing of tenant A's imports.
begin;
set local role authenticated;
select tests.set_claims(tests.system_claims('b0000000-0000-4000-8000-000000000001', 'tests.user_imports'));
do $$
begin
  perform tests.assert_eq((select count(*) from platform.user_imports where tenant_id <> 'b0000000-0000-4000-8000-000000000001'),
    0::bigint, 'tenant B''s job sees only tenant B''s imports');
  perform tests.assert_eq(tests.rows_affected($q$update platform.user_imports set status = 'expired' where id = 'a5000000-0000-4000-8000-000000000017'$q$),
    0::bigint, 'and changes none of tenant A''s');
  perform tests.assert_eq((select count(*) from platform.user_import_rows where tenant_id <> 'b0000000-0000-4000-8000-000000000001')
                          + (select count(*) from platform.user_import_columns where tenant_id <> 'b0000000-0000-4000-8000-000000000001'),
    0::bigint, 'nor their staged data');
  perform tests.assert_fails($q$select private.user_import_classify('a5000000-0000-4000-8000-000000000001')$q$, array['P0002'],
    'tenant A''s import is unknown to tenant B''s job');
  perform tests.assert_fails($q$select private.user_import_apply_batch('a5000000-0000-4000-8000-000000000001', 10)$q$,
    array['23514'], 'nor can it run it');
  perform tests.assert_fails($q$select private.user_import_undo_batch('a5000000-0000-4000-8000-000000000011', 10)$q$,
    array['23514'], 'or undo it');
end $$;
rollback;

\echo '87_user_imports_app_worker: ok'
