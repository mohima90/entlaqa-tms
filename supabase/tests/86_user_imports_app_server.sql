-- db-test: run-as=app_server
-- User imports on the request path (T-M2-12, FR-IAM-04): who may start an import (Organization Admin, HR
-- Manager — with their own upload for that very import), only the importer moves it on, and only along
-- the lifecycle (mapping from the allow-list, options without a privileged default role, one running
-- import per organization, undo within 7 days); staged data is the importer's alone; held invitations
-- are scheduled by user managers but sent by the worker only. Runs CONNECTED AS app_server. Fixtures:
-- 00_helpers_and_fixtures.sql, 85_user_imports_fixtures.sql. Every block is rolled back.
-- Users in tenant A: uA = Organization Admin (sA), uAB = HR Manager + learner (sAB1), uM = no role (sM).
\set ON_ERROR_STOP on

do $$ begin perform tests.assert(session_user = 'app_server', 'must run connected as app_server'); end $$;

-- ---------------------------------------------------------------------------------------------------
-- Starting an import: user managers only, with their own upload for that import.
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
do $$
declare
  v_file uuid;
  v_other uuid;
  v_row record;
begin
  select id into v_file from private.create_file_upload('platform.user_import', 'platform', 'user_import',
    'a5000000-0000-4000-8000-0000000000f1', 'موظفون.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 5000);
  select id into v_other from private.create_file_upload('platform.user_import', 'platform', 'user_import',
    'a5000000-0000-4000-8000-0000000000f2', 'other.csv', 'text/csv', 10);
  perform tests.assert_fails(format($q$insert into platform.user_imports (id, file_id, file_name, file_size) values ('a5000000-0000-4000-8000-0000000000f1', %L, 'x.csv', 10)$q$, v_other),
    array['23514'], 'the file must be the upload made for this import');
  perform tests.assert_privilege_denied(format($q$insert into platform.user_imports (id, file_id, file_name, file_size, status) values ('a5000000-0000-4000-8000-0000000000f1', %L, 'x.xlsx', 5000, 'review')$q$, v_file),
    'users cannot choose the status (column grant)');
  perform tests.assert_privilege_denied(format($q$insert into platform.user_imports (id, file_id, file_name, file_size, created_by) values ('a5000000-0000-4000-8000-0000000000f1', %L, 'x.xlsx', 5000, '00000000-0000-4000-8000-0000000000ab')$q$, v_file),
    'users cannot choose the importer (column grant)');
  perform tests.assert_eq(tests.rows_affected(format($q$insert into platform.user_imports (id, file_id, file_name, file_size) values ('a5000000-0000-4000-8000-0000000000f1', %L, 'موظفون.xlsx', 5000)$q$, v_file)),
    1::bigint, 'an Organization Admin starts an import with their own upload');
  select * into v_row from platform.user_imports where id = 'a5000000-0000-4000-8000-0000000000f1';
  perform tests.assert(v_row.status = 'uploaded' and v_row.created_by = '00000000-0000-4000-8000-0000000000a1'
                       and v_row.created_by_person = 'a1000000-0000-4000-8000-0000000000a1'
                       and v_row.review_expires_at > now() + interval '23 hours' and v_row.lease_until is null,
    'status uploaded, importer stamped from the claims, 24-hour review window');
end $$;
rollback;

begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000ab'));
do $$
declare
  v_file uuid;
begin
  select id into v_file from private.create_file_upload('platform.user_import', 'platform', 'user_import',
    'a5000000-0000-4000-8000-0000000000f3', 'hr.csv', 'text/csv', 10);
  perform tests.assert_eq(tests.rows_affected(format($q$insert into platform.user_imports (id, file_id, file_name, file_size) values ('a5000000-0000-4000-8000-0000000000f3', %L, 'hr.csv', 10)$q$, v_file)),
    1::bigint, 'an HR Manager starts an import too');
end $$;
rollback;

begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000f7', '10000000-0000-4000-8000-0000000000f7',
  'a0000000-0000-4000-8000-000000000001'));
do $$
declare
  v_file uuid;
begin
  perform tests.assert_eq(private.current_tenant_id(), 'a0000000-0000-4000-8000-000000000001'::uuid, 'uM acts in tenant A');
  select id into v_file from private.create_file_upload('platform.user_import', 'platform', 'user_import',
    'a5000000-0000-4000-8000-0000000000f4', 'm.csv', 'text/csv', 10);
  perform tests.assert_fails(format($q$insert into platform.user_imports (id, file_id, file_name, file_size) values ('a5000000-0000-4000-8000-0000000000f4', %L, 'm.csv', 10)$q$, v_file),
    array['42501'], 'a member without a user-management role cannot start an import');
  perform tests.assert_eq((select count(*) from platform.user_imports), 0::bigint,
    'and sees no import of the organization');
  perform tests.assert_eq((select count(*) from platform.user_import_rows) + (select count(*) from platform.user_import_columns),
    0::bigint, 'nor any staged data');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- The mapping step: the importer only; fields from the allow-list, each once, with the required ones.
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000ab'));
do $$
begin
  perform tests.assert_eq(tests.rows_affected($q$update platform.user_imports set status = 'validating', sheet_index = 0, mapping = '{"0": "email", "1": "first_name_ar", "2": "family_name_ar"}' where id = 'a5000000-0000-4000-8000-000000000010'$q$),
    0::bigint, 'another user manager cannot move the import on (RLS: importer only)');
  perform tests.assert_eq(tests.rows_affected($q$update platform.user_imports set status = 'cancelled' where id = 'a5000000-0000-4000-8000-000000000010'$q$),
    0::bigint, 'nor cancel it');
end $$;
rollback;

begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
do $$
begin
  perform tests.assert_fails($q$update platform.user_imports set status = 'validating', sheet_index = 0, mapping = '{"0": "email", "1": "first_name_ar"}' where id = 'a5000000-0000-4000-8000-000000000010'$q$,
    array['23514'], 'a required field (family name) missing: refused');
  perform tests.assert_fails($q$update platform.user_imports set status = 'validating', sheet_index = 0, mapping = '{"0": "email", "1": "first_name_ar", "2": "family_name_ar", "3": "status"}' where id = 'a5000000-0000-4000-8000-000000000010'$q$,
    array['23514'], 'account status is never imported (T-IAM-20)');
  perform tests.assert_fails($q$update platform.user_imports set status = 'validating', sheet_index = 0, mapping = '{"0": "email", "1": "first_name_ar", "2": "family_name_ar", "3": "tenant_id"}' where id = 'a5000000-0000-4000-8000-000000000010'$q$,
    array['23514'], 'nor the organization');
  perform tests.assert_fails($q$update platform.user_imports set status = 'validating', sheet_index = 0, mapping = '{"0": "email", "1": "first_name_ar", "2": "family_name_ar", "3": "email"}' where id = 'a5000000-0000-4000-8000-000000000010'$q$,
    array['23514'], 'two columns on one field: refused');
  perform tests.assert_fails($q$update platform.user_imports set status = 'validating', sheet_index = 3, mapping = '{"0": "email", "1": "first_name_ar", "2": "family_name_ar"}' where id = 'a5000000-0000-4000-8000-000000000010'$q$,
    array['23514'], 'a sheet the file does not have: refused');
  perform tests.assert_fails($q$update platform.user_imports set status = 'queued', options = '{"existing": "skip", "defaultRole": "learner", "invitations": "send"}' where id = 'a5000000-0000-4000-8000-000000000010'$q$,
    array['42501'], 'mapping → queued skips the review: refused');
  perform tests.assert_fails($q$update platform.user_imports set rows_total = 5 where id = 'a5000000-0000-4000-8000-000000000010'$q$,
    array['42501'], 'progress is written by the import itself');
  perform tests.assert_fails($q$update platform.user_imports set lease_until = now(), lease_token = gen_random_uuid() where id = 'a5000000-0000-4000-8000-000000000010'$q$,
    array['42501'], 'the lease belongs to the worker');
  perform tests.assert_eq(tests.rows_affected($q$update platform.user_imports set status = 'validating', sheet_index = 0, mapping = '{"0": "email", "1": "first_name_ar", "2": "family_name_ar", "4": "manager_email"}' where id = 'a5000000-0000-4000-8000-000000000010'$q$),
    1::bigint, 'a valid mapping: the dry run starts');
  perform tests.assert_eq((select status from platform.user_imports where id = 'a5000000-0000-4000-8000-000000000010'), 'validating',
    'status validating');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Confirming (options), one running import per organization, stopping.
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
do $$
declare
  v_row record;
begin
  perform tests.assert_fails($q$update platform.user_imports set status = 'queued', options = '{"existing": "skip", "defaultRole": "hr_manager", "invitations": "send"}' where id = 'a5000000-0000-4000-8000-000000000001'$q$,
    array['23514'], 'a privileged default role is refused (PO decision 3)');
  perform tests.assert_fails($q$update platform.user_imports set status = 'queued', options = '{"existing": "skip", "defaultRole": "tenant_admin", "invitations": "send"}' where id = 'a5000000-0000-4000-8000-000000000001'$q$,
    array['23514'], 'the Organization Admin role is never a default role');
  perform tests.assert_fails($q$update platform.user_imports set status = 'queued', options = '{"existing": "replace", "defaultRole": "learner", "invitations": "send"}' where id = 'a5000000-0000-4000-8000-000000000001'$q$,
    array['23514'], 'unknown mode refused (check constraint)');
  perform tests.assert_fails($q$update platform.user_imports set status = 'queued', options = '{"existing": "skip", "defaultRole": "nobody", "invitations": "send"}' where id = 'a5000000-0000-4000-8000-000000000001'$q$,
    array['23514'], 'unknown role refused');
  perform tests.assert_fails($q$update platform.user_imports set status = 'queued', mapping = '{"0": "email", "1": "first_name_ar", "2": "family_name_ar"}', options = '{"existing": "skip", "defaultRole": "learner", "invitations": "send"}' where id = 'a5000000-0000-4000-8000-000000000001'$q$,
    array['23514'], 'confirming changes the options only');
  perform tests.assert_eq(tests.rows_affected($q$update platform.user_imports set status = 'queued', options = '{"existing": "upsert", "defaultRole": "learner", "invitations": "hold"}' where id = 'a5000000-0000-4000-8000-000000000001'$q$),
    1::bigint, 'the importer confirms with valid options');
  select * into v_row from platform.user_imports where id = 'a5000000-0000-4000-8000-000000000001';
  perform tests.assert(v_row.status = 'queued' and v_row.confirmed_at is not null and v_row.checkpoint = 0,
    'queued, confirmed now, from the start');
  -- One running import per organization (TM-0003 T-IAM-34).
  perform tests.assert_fails($q$update platform.user_imports set status = 'undoing', undo_reason = 'wrong_file' where id = 'a5000000-0000-4000-8000-000000000011'$q$,
    array['23505'], 'a second running import (an undo) waits for the first');
  -- Stop: once, by the importer, recorded with the time.
  perform tests.assert_eq(tests.rows_affected($q$update platform.user_imports set stop_requested_at = now() - interval '1 day' where id = 'a5000000-0000-4000-8000-000000000001'$q$),
    1::bigint, 'the importer stops a running import');
  perform tests.assert((select stop_requested_at > now() - interval '1 minute' from platform.user_imports
                        where id = 'a5000000-0000-4000-8000-000000000001'), 'stop time stamped by the database');
  perform tests.assert_fails($q$update platform.user_imports set stop_requested_at = now() where id = 'a5000000-0000-4000-8000-000000000001'$q$,
    array['42501'], 'stopping twice is not a change');
  perform tests.assert_fails($q$update platform.user_imports set status = 'cancelled' where id = 'a5000000-0000-4000-8000-000000000001'$q$,
    array['42501'], 'a running import is stopped, not cancelled');
end $$;
-- Another user manager's import cannot start while one runs.
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000ab'));
do $$
begin
  perform tests.assert_fails($q$update platform.user_imports set status = 'queued', options = '{"existing": "skip", "defaultRole": "learner", "invitations": "send"}' where id = 'a5000000-0000-4000-8000-000000000014'$q$,
    array['23505'], 'ANOTHER_IMPORT_RUNNING: the HR Manager''s import waits');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Cancel and undo windows.
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
do $$
declare
  v_row record;
begin
  perform tests.assert_eq(tests.rows_affected($q$update platform.user_imports set status = 'cancelled' where id = 'a5000000-0000-4000-8000-000000000010'$q$),
    1::bigint, 'an import is cancelled before it runs');
  perform tests.assert_fails($q$update platform.user_imports set status = 'cancelled' where id = 'a5000000-0000-4000-8000-000000000011'$q$,
    array['42501'], 'a finished import is not cancelled');
  perform tests.assert_fails($q$update platform.user_imports set status = 'undoing' where id = 'a5000000-0000-4000-8000-000000000012'$q$,
    array['23514'], 'undo only within 7 days of the end');
  perform tests.assert_fails($q$update platform.user_imports set status = 'undoing', undo_reason = 'because' where id = 'a5000000-0000-4000-8000-000000000011'$q$,
    array['23514'], 'the reason is a code from the dialog''s list');
  perform tests.assert_eq(tests.rows_affected($q$update platform.user_imports set status = 'undoing', undo_reason = 'wrong_file' where id = 'a5000000-0000-4000-8000-000000000011'$q$),
    1::bigint, 'the importer undoes an import within 7 days');
  select * into v_row from platform.user_imports where id = 'a5000000-0000-4000-8000-000000000011';
  perform tests.assert(v_row.undo_requested_by = '00000000-0000-4000-8000-0000000000a1' and v_row.undo_requested_at is not null
                       and v_row.checkpoint = 0, 'undo requester and time stamped');
  perform tests.assert_fails($q$update platform.user_imports set status = 'undone' where id = 'a5000000-0000-4000-8000-000000000011'$q$,
    array['42501'], 'only the worker finishes an undo');
end $$;
rollback;

begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000ab'));
do $$
begin
  perform tests.assert_eq(tests.rows_affected($q$update platform.user_imports set status = 'undoing', undo_reason = 'other' where id = 'a5000000-0000-4000-8000-000000000011'$q$),
    0::bigint, 'another user manager cannot undo someone''s import');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Staged data: the importer's alone (PO decision 9). Metadata: every user manager (recent imports).
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000ab'));
do $$
begin
  perform tests.assert((select count(*) from platform.user_imports) >= 6, 'an HR Manager sees the organization''s imports');
  perform tests.assert_eq((select count(*) from platform.user_import_rows where import_id = 'a5000000-0000-4000-8000-000000000014'),
    1::bigint, 'and the rows of their own import');
  perform tests.assert_eq((select count(*) from platform.user_import_columns where import_id = 'a5000000-0000-4000-8000-000000000014'),
    1::bigint, 'and its columns');
  perform tests.assert_eq((select count(*) from platform.user_import_rows where import_id <> 'a5000000-0000-4000-8000-000000000014'),
    0::bigint, 'but no row of another importer''s import');
  perform tests.assert_eq((select count(*) from platform.user_import_columns where import_id <> 'a5000000-0000-4000-8000-000000000014'),
    0::bigint, 'nor its columns');
end $$;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
do $$
begin
  perform tests.assert_eq((select count(*) from platform.user_import_rows where import_id = 'a5000000-0000-4000-8000-000000000014'),
    0::bigint, 'the Organization Admin does not see the HR Manager''s rows either');
  perform tests.assert_eq((select count(*) from platform.user_import_rows where import_id = 'a5000000-0000-4000-8000-000000000001'),
    1::bigint, 'only their own');
  perform tests.assert_fails($q$select * from private.claim_user_import_work()$q$, array['42501'],
    'the worker''s claim is refused on the request path');
  perform tests.assert_fails($q$select private.user_import_classify('a5000000-0000-4000-8000-000000000001')$q$, array['42501'],
    'the processing functions need system claims');
  perform tests.assert_fails($q$select private.user_import_apply_batch('a5000000-0000-4000-8000-000000000001', 10)$q$, array['42501'],
    'the run needs system claims');
  perform tests.assert_fails($q$select private.user_import_undo_batch('a5000000-0000-4000-8000-000000000011', 10)$q$, array['42501'],
    'an undo needs system claims');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Invitations of imports: users never create held or import invitations; they ask for a held one to be
-- sent (scheduled once, at the database's pace) but only the worker sends it.
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
do $$
declare
  v_person uuid;
begin
  insert into platform.persons (display_name_ar, email) values ('شخص جديد', 'new.person@imp.test') returning id into v_person;
  perform tests.assert_fails(format($q$insert into platform.invitations (person_id, email, locale, primary_role, import_id, mail_held) values (%L, 'new.person@imp.test', 'ar', 'learner', 'a5000000-0000-4000-8000-000000000011', true)$q$, v_person),
    array['42501'], 'users cannot create held invitations of an import');
  perform tests.assert_fails(format($q$insert into platform.invitations (person_id, email, locale, primary_role, import_id) values (%L, 'new.person@imp.test', 'ar', 'learner', 'a5000000-0000-4000-8000-000000000011')$q$, v_person),
    array['42501'], 'nor link an invitation to an import');
  perform tests.assert_fails($q$update platform.invitations set mail_held = false where id = 'a4000000-0000-4000-8000-000000000c07'$q$,
    array['42501'], 'a held invitation is sent by the worker, never by a user');
  perform tests.assert_fails($q$update platform.invitations set resend_requested_at = now() where id = 'a4000000-0000-4000-8000-000000000c07'$q$,
    array['23514'], 'no resend for a held invitation (it was never sent)');
  perform tests.assert_eq(private.schedule_held_invitations(array['a4000000-0000-4000-8000-000000000c07'::uuid], interval '1 second'),
    1, 'a user manager asks for the held invitation to be sent');
  perform tests.assert((select send_at is not null and mail_held and send_count = 0 from platform.invitations
                        where id = 'a4000000-0000-4000-8000-000000000c07'), 'scheduled, still held, no token');
  perform tests.assert_eq(private.schedule_held_invitations(array['a4000000-0000-4000-8000-000000000c07'::uuid], interval '1 second'),
    0, 'scheduling again changes nothing');
  perform tests.assert_fails($q$update platform.invitations set send_at = now() - interval '1 hour' where id = 'a4000000-0000-4000-8000-000000000c07'$q$,
    array['23514'], 'users cannot move a scheduled time');
  perform tests.assert_fails($q$select private.schedule_held_invitations(array['a4000000-0000-4000-8000-000000000c07'::uuid], interval '2 minutes')$q$,
    array['22023'], 'the pace is bounded');
  perform tests.assert_eq(tests.rows_affected($q$update platform.invitations set status = 'revoked' where id = 'a4000000-0000-4000-8000-000000000c07'$q$),
    1::bigint, 'a held invitation can be revoked');
  perform tests.assert((select send_at is null and revoked_by = '00000000-0000-4000-8000-0000000000a1' from platform.invitations
                        where id = 'a4000000-0000-4000-8000-000000000c07'), 'revoked: schedule cleared, revoker stamped');
end $$;
rollback;

begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000f7', '10000000-0000-4000-8000-0000000000f7',
  'a0000000-0000-4000-8000-000000000001'));
do $$
begin
  perform tests.assert_eq(private.schedule_held_invitations(array['a4000000-0000-4000-8000-000000000c07'::uuid], interval '1 second'),
    0, 'a member without a user-management role schedules nothing (sees no invitation)');
end $$;
rollback;

\echo '86_user_imports_app_server: ok'
