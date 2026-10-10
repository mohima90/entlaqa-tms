-- db-test: run-as=owner
-- User imports end to end (T-M2-12, FR-IAM-04, BRD §10.4): the dry run (private.user_import_classify) on a
-- file that meets every rule of the approved design, the run in batches with the fresh check, held
-- invitations of the importer scheduled and sent, an HR Manager's limits, an importer who loses the role
-- mid-run, the sign-in rule for held invitations (T-M2-09) and the undo (people it removes disappear as if
-- never added: migration 20261016090150). The owner connection switches
-- between the worker (app_worker, system claims) and the importer (app_server, user claims) like
-- 64_sign_in_refusal_owner.sql. Fixtures: 00_helpers_and_fixtures.sql, 85_user_imports_fixtures.sql. Every
-- block is rolled back.
\set ON_ERROR_STOP on

create or replace function pg_temp.become_worker(p_tenant uuid) returns void language plpgsql as $$
begin
  set local session authorization app_worker;
  set local role authenticated;
  perform tests.set_claims(tests.system_claims(p_tenant, 'tests.user_imports'));
end $$;
create or replace function pg_temp.become_user(p_user uuid, p_session uuid, p_person uuid) returns void language plpgsql as $$
begin
  set local session authorization app_server;
  set local role authenticated;
  perform tests.set_claims(tests.user_claims(p_user, p_session, 'a0000000-0000-4000-8000-000000000001', p_person));
end $$;
create or replace function pg_temp.become_owner() returns void language plpgsql as $$
begin
  reset role;
  reset session authorization;
end $$;
-- A row of the file: number, normalized data, format issues (the worker's TypeScript checks).
create or replace function pg_temp.stage(p_import uuid, p_row integer, p_data jsonb, p_format jsonb default '[]')
returns void language sql as $$
  insert into platform.user_import_rows (tenant_id, import_id, row_number, cells, data, format_issues, issues)
  values ('a0000000-0000-4000-8000-000000000001', p_import, p_row, p_data, p_data, p_format, p_format);
$$;
-- The codes of a row's issues, sorted: 'CODE:s,…'.
create or replace function pg_temp.codes(p_import uuid, p_row integer) returns text language sql as $$
  select coalesce(string_agg((i ->> 'c') || ':' || (i ->> 's'), ',' order by i ->> 'c'), '')
  from platform.user_import_rows r, jsonb_array_elements(r.issues) i
  where r.import_id = p_import and r.row_number = p_row;
$$;
create or replace function pg_temp.kind(p_import uuid, p_row integer) returns text language sql as $$
  select review_kind from platform.user_import_rows where import_id = p_import and row_number = p_row;
$$;
-- A new import of tenant A in `validating` (mapping chosen), as a platform operation.
create or replace function pg_temp.new_import(p_import uuid, p_user uuid, p_person uuid, p_file uuid) returns void
language plpgsql as $$
begin
  perform tests.import_file(p_import, 'a0000000-0000-4000-8000-000000000001', p_user, p_file);
  insert into platform.user_imports (id, tenant_id, created_by, created_by_person, file_id, file_name, file_size, status,
                                     sheets, sheet_index, mapping, review_expires_at)
  values (p_import, 'a0000000-0000-4000-8000-000000000001', p_user, p_person, p_file, 'staff.csv', 100, 'validating',
          '[{"name": "", "rows": 30, "columns": 12}]', 0,
          '{"0": "email", "1": "first_name_ar", "2": "family_name_ar"}', now() + interval '1 day');
end $$;
-- The file of the scenarios below (rows 2–20).
create or replace function pg_temp.stage_file(p_import uuid) returns void language plpgsql as $$
begin
  perform pg_temp.stage(p_import, 2, '{"email": "new1@imp.test", "first_name_ar": "نورة", "father_name_ar": "فهد",
    "family_name_ar": "الدوسري", "first_name_en": "Noura", "family_name_en": "Aldossari", "department": "sal",
    "branch": "فرع الرياض", "manager_email": "mgr@imp.test", "primary_role": "training_coordinator",
    "additional_roles": ["learner"], "language": "en", "employee_number": "NEW-1", "mobile": "+966551234567",
    "hire_date": "2024-03-03", "job_title_ar": "أخصائية تدريب", "roles_given": true}');
  perform pg_temp.stage(p_import, 3, '{"email": "new2@imp.test", "first_name_ar": "خالد", "family_name_ar": "الشهري",
    "department": "المبيعات", "manager_email": "new1@imp.test"}');
  perform pg_temp.stage(p_import, 4, '{"email": "dup@imp.test", "first_name_ar": "مكرر", "family_name_ar": "أول"}');
  perform pg_temp.stage(p_import, 5, '{"email": "dup@imp.test", "first_name_ar": "مكرر", "family_name_ar": "ثان"}');
  perform pg_temp.stage(p_import, 6, '{"email": "exist@imp.test", "first_name_ar": "موجود", "family_name_ar": "قديم",
    "job_title_ar": "مدير", "department": "TD", "primary_role": "mentor", "roles_given": true}');
  perform pg_temp.stage(p_import, 7, '{"email": "priv@imp.test", "first_name_ar": "مميز", "family_name_ar": "جدا",
    "job_title_ar": "المدير المالي"}');
  perform pg_temp.stage(p_import, 8, '{"email": "deact@imp.test", "first_name_ar": "معطل", "family_name_ar": "سابق"}');
  perform pg_temp.stage(p_import, 9, '{"email": "pend@imp.test", "first_name_ar": "مدعو", "family_name_ar": "منتظر"}');
  perform pg_temp.stage(p_import, 10, '{"email": "ua@a.test", "first_name_ar": "أنا", "family_name_ar": "نفسي"}');
  perform pg_temp.stage(p_import, 11, '{"email": "noacc@imp.test", "first_name_ar": "بلا", "family_name_ar": "حساب",
    "job_title_ar": "عائد"}');
  perform pg_temp.stage(p_import, 12, '{"email": "taken@imp.test", "first_name_ar": "رقم", "family_name_ar": "مأخوذ",
    "employee_number": "IMP-100"}');
  perform pg_temp.stage(p_import, 13, '{"email": "mgr@imp.test", "first_name_ar": "مدير", "family_name_ar": "القسم",
    "employee_number": "IMP-200"}');
  perform pg_temp.stage(p_import, 14, '{"email": "loopa@imp.test", "first_name_ar": "حلقة", "family_name_ar": "أ",
    "manager_email": "loopb@imp.test"}');
  perform pg_temp.stage(p_import, 15, '{"email": "loopb@imp.test", "first_name_ar": "حلقة", "family_name_ar": "ب",
    "manager_email": "loopa@imp.test"}');
  perform pg_temp.stage(p_import, 16, '{"email": "self@imp.test", "first_name_ar": "نفسه", "family_name_ar": "مديره",
    "manager_email": "self@imp.test"}');
  perform pg_temp.stage(p_import, 17, '{"email": "nomgr@imp.test", "first_name_ar": "بلا", "family_name_ar": "مدير",
    "manager_email": "nobody@imp.test", "department": "التسويق الرقمي", "branch": "فرع الدمام"}');
  perform pg_temp.stage(p_import, 18, '{"first_name_ar": "بريد", "family_name_ar": "خاطئ"}',
    '[{"c": "EMAIL_INVALID", "s": "e", "f": "email"}]');
  perform pg_temp.stage(p_import, 19, '{"email": "under.dup@imp.test", "first_name_ar": "تحت", "family_name_ar": "مكرر",
    "manager_email": "dup@imp.test", "mobile": null}', '[{"c": "MOBILE_NO_COUNTRY_CODE", "s": "w", "f": "mobile"}]');
  perform pg_temp.stage(p_import, 20, '{"email": "race@imp.test", "first_name_ar": "سباق", "family_name_ar": "يدوي"}');
end $$;

-- The file above imported to its end by `p_user` with `p_options` (review, confirm, fresh check, batches),
-- as the steps do it; back to the owner connection afterwards.
create or replace function pg_temp.run_import(p_import uuid, p_user uuid, p_session uuid, p_person uuid, p_file uuid,
                                              p_options jsonb) returns void language plpgsql as $$
begin
  perform pg_temp.new_import(p_import, p_user, p_person, p_file);
  perform pg_temp.stage_file(p_import);
  perform pg_temp.become_worker('a0000000-0000-4000-8000-000000000001');
  perform private.user_import_classify(p_import);
  update platform.user_imports set status = 'review' where id = p_import;
  perform pg_temp.become_user(p_user, p_session, p_person);
  update platform.user_imports set status = 'queued', options = p_options where id = p_import;
  perform pg_temp.become_worker('a0000000-0000-4000-8000-000000000001');
  update platform.user_imports set status = 'checking' where id = p_import;
  perform private.user_import_recheck(p_import);
  update platform.user_imports set status = 'importing' where id = p_import;
  while private.user_import_apply_batch(p_import, 50) > 0 loop
  end loop;
  perform private.user_import_finish_rows(p_import);
  update platform.user_imports set status = 'finished' where id = p_import;
  perform pg_temp.become_owner();
end $$;
-- The undo results of an import: 'row:result,…'.
create or replace function pg_temp.undo_results(p_import uuid) returns text language sql as $$
  select string_agg(row_number || ':' || undo_result, ',' order by row_number)
  from platform.user_import_rows where import_id = p_import and undo_result is not null;
$$;

-- ---------------------------------------------------------------------------------------------------
-- The dry run.
-- ---------------------------------------------------------------------------------------------------
begin;
select pg_temp.new_import('a5000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000a1',
                          'a1000000-0000-4000-8000-0000000000a1', 'f0a00000-0000-4000-8000-0000000000d1');
select pg_temp.stage_file('a5000000-0000-4000-8000-0000000000d1');
select pg_temp.become_worker('a0000000-0000-4000-8000-000000000001');
select private.user_import_classify('a5000000-0000-4000-8000-0000000000d1');
do $$
declare
  i constant uuid := 'a5000000-0000-4000-8000-0000000000d1';
  v_counts jsonb;
  v_row record;
begin
  perform tests.assert_eq(pg_temp.kind(i, 2) || '|' || pg_temp.codes(i, 2), 'new|',
    'row 2: new, department by code (letter case ignored), branch by name, existing manager, no issue');
  select * into v_row from platform.user_import_rows where import_id = i and row_number = 2;
  perform tests.assert(v_row.department_id = 'a3000000-0000-4000-8000-000000000e01' and v_row.branch_id = 'a2000000-0000-4000-8000-000000000001'
                       and v_row.manager_person_id = 'a1000000-0000-4000-8000-000000000e06' and v_row.manager_row is null,
    'row 2: references resolved (SAL, RUH, the existing manager)');
  perform tests.assert_eq(pg_temp.kind(i, 3) || '|' || pg_temp.codes(i, 3), 'new|DEPARTMENT_AMBIGUOUS:w',
    'row 3: two departments named «المبيعات»: added without one (warning)');
  perform tests.assert_eq((select manager_row from platform.user_import_rows where import_id = i and row_number = 3), 2,
    'row 3: the manager is row 2 of the file');
  perform tests.assert_eq(pg_temp.kind(i, 4) || '|' || pg_temp.codes(i, 4), 'error|EMAIL_DUPLICATE_IN_FILE:e',
    'row 4: the same e-mail twice in the file: an error');
  perform tests.assert_eq(pg_temp.kind(i, 5), 'error', 'row 5: and the other row too (never one picked silently)');
  perform tests.assert_eq((select issues -> 0 -> 'p' ->> 'rows' from platform.user_import_rows where import_id = i and row_number = 5),
    '[4, 5]', 'the rows are named');
  perform tests.assert_eq(pg_temp.kind(i, 6) || '|' || pg_temp.codes(i, 6), 'existing|ROLES_IGNORED_EXISTING:w',
    'row 6: an existing member; the role column is not read for them (warning)');
  perform tests.assert_eq((select changes::text from platform.user_import_rows where import_id = i and row_number = 6),
    '[{"f": "job_title_ar", "to": "مدير", "from": "محاسب"}, {"f": "department", "to": "التدريب والتطوير", "from": "العمليات"}]',
    'row 6: what an update would change, named');
  perform tests.assert_eq(pg_temp.kind(i, 7), 'existing', 'row 7: an existing member');
  perform tests.assert((select target_privileged from platform.user_import_rows where import_id = i and row_number = 7),
    'row 7: who holds a privileged role');
  perform tests.assert_eq(pg_temp.kind(i, 8) || '|' || pg_temp.codes(i, 8), 'skip|MEMBER_DEACTIVATED:k',
    'row 8: a deactivated account is skipped (never reactivated by import)');
  perform tests.assert_eq(pg_temp.kind(i, 9) || '|' || pg_temp.codes(i, 9), 'skip|INVITATION_PENDING:k',
    'row 9: someone with an invitation not accepted yet is skipped');
  perform tests.assert_eq(pg_temp.kind(i, 10) || '|' || pg_temp.codes(i, 10), 'skip|OWN_ROW:k',
    'row 10: the importer''s own record is never changed by import');
  perform tests.assert_eq(pg_temp.kind(i, 11) || '|' || pg_temp.codes(i, 11), 'new|',
    'row 11: a person without account or invitation is invited again');
  perform tests.assert_eq((select target_person_id from platform.user_import_rows where import_id = i and row_number = 11),
    'a1000000-0000-4000-8000-000000000e05'::uuid, 'row 11: their record is reused');
  perform tests.assert_eq(pg_temp.kind(i, 12) || '|' || pg_temp.codes(i, 12), 'error|EMPLOYEE_NUMBER_TAKEN:e',
    'row 12: an employee number of someone else: an error');
  perform tests.assert_eq(pg_temp.kind(i, 13) || '|' || pg_temp.codes(i, 13), 'error|KEY_CONFLICT:e',
    'row 13: the e-mail of one person, the number of another: neither is changed');
  perform tests.assert_eq(pg_temp.kind(i, 14) || '|' || pg_temp.codes(i, 14), 'error|MANAGER_LOOP:e',
    'row 14: a loop in the reporting line');
  perform tests.assert_eq((select issues -> 0 -> 'p' ->> 'rows' from platform.user_import_rows where import_id = i and row_number = 14),
    '[15]', 'row 14: with the other row of the loop');
  perform tests.assert_eq(pg_temp.kind(i, 15), 'error', 'row 15: the loop''s other row');
  perform tests.assert_eq(pg_temp.kind(i, 16) || '|' || pg_temp.codes(i, 16), 'error|MANAGER_SELF:e',
    'row 16: one''s own manager');
  perform tests.assert_eq(pg_temp.kind(i, 17) || '|' || pg_temp.codes(i, 17),
    'new|BRANCH_NOT_FOUND:w,DEPARTMENT_NOT_FOUND:w,MANAGER_NOT_FOUND:w',
    'row 17: unknown department, branch and manager: added without them (warnings; never created)');
  perform tests.assert_eq(pg_temp.kind(i, 18) || '|' || pg_temp.codes(i, 18), 'error|EMAIL_INVALID:e',
    'row 18: a format error from the worker''s checks');
  perform tests.assert_eq(pg_temp.kind(i, 19) || '|' || pg_temp.codes(i, 19), 'new|MANAGER_NOT_FOUND:w,MOBILE_NO_COUNTRY_CODE:w',
    'row 19: a manager whose row is not imported: added without one');
  perform tests.assert((select apply_order from platform.user_import_rows where import_id = i and row_number = 3)
                       > (select apply_order from platform.user_import_rows where import_id = i and row_number = 2),
    'managers are added before the people who report to them');
  perform tests.assert_eq((select count(*) from platform.user_import_rows where import_id = i and reviewed_kind is distinct from review_kind),
    0::bigint, 'the review''s kinds are remembered');

  v_counts := private.user_import_review_counts(i);
  perform tests.assert_eq(v_counts - array['errorCodes', 'warningCodes', 'skipCodes', 'roles', 'additionalRoles'],
    '{"new": 6, "total": 19, "errors": 8, "skipped": 3, "existing": 2, "warnings": 4, "defaultRole": 5, "newReinvited": 1,
      "newWithWarnings": 3, "existingPrivileged": 1, "existingWithChanges": 2, "existingWithWarnings": 1,
      "existingPrivilegedWithChanges": 1}'::jsonb,
    'review numbers');
  perform tests.assert_eq(v_counts -> 'errorCodes',
    '{"KEY_CONFLICT": 1, "MANAGER_SELF": 1, "MANAGER_LOOP": 2, "EMAIL_INVALID": 1, "EMPLOYEE_NUMBER_TAKEN": 1, "EMAIL_DUPLICATE_IN_FILE": 2}'::jsonb,
    'errors per code (rows)');
  perform tests.assert_eq(v_counts -> 'skipCodes', '{"OWN_ROW": 1, "INVITATION_PENDING": 1, "MEMBER_DEACTIVATED": 1}'::jsonb,
    'skipped per code');
  perform tests.assert_eq(v_counts -> 'roles', '{"training_coordinator": 1}'::jsonb, 'primary roles given by the file');
  perform tests.assert_eq(v_counts -> 'additionalRoles', '{"learner": 1}'::jsonb, 'additional roles');
end $$;
select pg_temp.become_owner();
rollback;

-- ---------------------------------------------------------------------------------------------------
-- The run (Organization Admin, add and update, send invitations), then the undo.
-- ---------------------------------------------------------------------------------------------------
begin;
select pg_temp.new_import('a5000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000a1',
                          'a1000000-0000-4000-8000-0000000000a1', 'f0a00000-0000-4000-8000-0000000000d2');
select pg_temp.stage_file('a5000000-0000-4000-8000-0000000000d2');
select pg_temp.become_worker('a0000000-0000-4000-8000-000000000001');
select private.user_import_classify('a5000000-0000-4000-8000-0000000000d2');
update platform.user_imports set status = 'review', review_counts = private.user_import_review_counts(id)
  where id = 'a5000000-0000-4000-8000-0000000000d2';
-- The importer confirms: add new people, update existing ones, send invitations.
select pg_temp.become_user('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
                           'a1000000-0000-4000-8000-0000000000a1');
update platform.user_imports set status = 'queued',
  options = '{"existing": "upsert", "defaultRole": "learner", "invitations": "send"}'
  where id = 'a5000000-0000-4000-8000-0000000000d2';
-- Meanwhile someone is invited by hand with the e-mail of row 20.
insert into platform.persons (display_name_ar, email) values ('سباق', 'race@imp.test');
select pg_temp.become_worker('a0000000-0000-4000-8000-000000000001');
update platform.user_imports set status = 'checking' where id = 'a5000000-0000-4000-8000-0000000000d2';
do $$
declare
  i constant uuid := 'a5000000-0000-4000-8000-0000000000d2';
begin
  perform tests.assert_eq(private.user_import_recheck(i), 1, 'the fresh check finds the row that changed since the review');
  perform tests.assert_eq(pg_temp.kind(i, 20) || '|' || pg_temp.codes(i, 20), 'error|CHANGED_SINCE_REVIEW:e',
    'row 20: not written; it goes to the error report');
  perform tests.assert_fails($q$select private.user_import_apply_batch('a5000000-0000-4000-8000-0000000000d2', 3)$q$,
    array['23514'], 'rows are written only while the import is adding people');
end $$;
update platform.user_imports set status = 'importing',
  rows_total = (select count(*) from platform.user_import_rows where import_id = 'a5000000-0000-4000-8000-0000000000d2'
                  and review_kind in ('new', 'existing'))
  where id = 'a5000000-0000-4000-8000-0000000000d2';
do $$
declare
  i constant uuid := 'a5000000-0000-4000-8000-0000000000d2';
  v_n integer;
  v_batches integer := 0;
  v_row record;
  v_person record;
begin
  loop
    v_n := private.user_import_apply_batch(i, 3);
    exit when v_n = 0;
    v_batches := v_batches + 1;
    exit when v_batches > 10;
  end loop;
  perform tests.assert_eq(v_batches, 3, 'seven rows in batches of 3, with checkpoints');
  perform tests.assert((select rows_done = rows_total and rows_total = 7 from platform.user_imports where id = i),
    'progress: every row to write was processed');
  perform private.user_import_finish_rows(i);

  -- Row 2: a new person with a held invitation of the importer.
  select * into v_row from platform.user_import_rows where import_id = i and row_number = 2;
  perform tests.assert_eq(v_row.result, 'added', 'row 2 added');
  select * into v_person from platform.persons where id = v_row.person_id;
  perform tests.assert(v_person.display_name_ar = 'نورة فهد الدوسري' and v_person.display_name_en = 'Noura Aldossari'
                       and v_person.preferred_locale = 'en' and v_person.employee_number = 'NEW-1'
                       and v_person.mobile_e164 = '+966551234567' and v_person.status = 'active'
                       and v_person.created_by is null,
    'row 2: names composed from the parts, language, number, mobile; created by the job (no person)');
  perform tests.assert((select department_id = 'a3000000-0000-4000-8000-000000000e01' and branch_id = 'a2000000-0000-4000-8000-000000000001'
                               and manager_person_id = 'a1000000-0000-4000-8000-000000000e06' and hire_on = '2024-03-03'
                               and job_title_ar = 'أخصائية تدريب' and source = 'import'
                        from platform.person_employment where person_id = v_row.person_id), 'row 2: placement from the file');
  perform tests.assert((select mail_held and send_count = 0 and token_issued_at is null and import_id = i
                               and invited_by = '00000000-0000-4000-8000-0000000000a1' and primary_role = 'training_coordinator'
                               and additional_roles = '{learner}' and locale = 'en' and status = 'pending'
                        from platform.invitations where id = v_row.invitation_id),
    'row 2: a held invitation of the importer with the file''s roles and language');
  perform tests.assert_eq((select count(*) from platform.audit_events where action = 'platform.invitation.created'
                             and entity_id = v_row.invitation_id::text and actor_user_id is null
                             and data ->> 'importId' = i::text and data ->> 'job' = 'tests.user_imports'),
    1::bigint, 'row 2: audited (system actor, linked to the import)');
  -- Row 3: reports to row 2's new person; the default role.
  select * into v_row from platform.user_import_rows where import_id = i and row_number = 3;
  perform tests.assert_eq((select manager_person_id from platform.person_employment where person_id = v_row.person_id),
    (select person_id from platform.user_import_rows where import_id = i and row_number = 2), 'row 3: reports to row 2');
  perform tests.assert_eq((select primary_role || '/' || cardinality(additional_roles) from platform.invitations where id = v_row.invitation_id),
    'learner/0', 'row 3: the default role');
  perform tests.assert_eq(v_row.result_issues::text, '[{"c": "DEPARTMENT_AMBIGUOUS", "f": "department", "p": {"name": "المبيعات"}, "s": "w"}]',
    'row 3: its warning stays with it (error report)');
  -- Row 6: an existing member's data updated; e-mail, roles and account untouched.
  select * into v_row from platform.user_import_rows where import_id = i and row_number = 6;
  perform tests.assert_eq(v_row.result, 'updated', 'row 6 updated');
  perform tests.assert((select job_title_ar = 'مدير' and department_id = 'a3000000-0000-4000-8000-000000000001'
                        from platform.person_employment where person_id = 'a1000000-0000-4000-8000-000000000e01'),
    'row 6: job title and department changed');
  perform tests.assert_eq(v_row.before, '{"job_title_ar": "محاسب", "department_id": "a3000000-0000-4000-8000-000000000003"}'::jsonb,
    'row 6: the previous values kept for undo');
  perform tests.assert_eq((select string_agg(ra.role_code, ',') from platform.role_assignments ra
                           join platform.tenant_memberships m on m.id = ra.membership_id
                           where m.person_id = 'a1000000-0000-4000-8000-000000000e01'), 'learner',
    'row 6: roles of an existing member never change by import');
  perform tests.assert_eq((select data -> 'changed' from platform.audit_events where action = 'platform.user.updated'
                             and entity_id = 'a1000000-0000-4000-8000-000000000e01' and data ->> 'importId' = i::text),
    '["department_id", "job_title_ar"]'::jsonb, 'row 6: audited with the changed fields');
  -- Row 7: the Organization Admin may update a privileged member.
  perform tests.assert_eq((select result from platform.user_import_rows where import_id = i and row_number = 7), 'updated',
    'row 7: updated by the Organization Admin');
  -- Row 11: invited again; their record made active and kept for undo.
  select * into v_row from platform.user_import_rows where import_id = i and row_number = 11;
  perform tests.assert(v_row.result = 'added' and v_row.person_id = 'a1000000-0000-4000-8000-000000000e05'
                       and v_row.before = '{"status": "inactive", "job_title_ar": null}'::jsonb,
    'row 11: the existing record reused; its previous state kept');
  perform tests.assert((select status = 'active' from platform.persons where id = 'a1000000-0000-4000-8000-000000000e05'),
    'row 11: active again');
  -- Rows not written: their results.
  perform tests.assert_eq((select string_agg(row_number || ':' || result, ',' order by row_number)
                           from platform.user_import_rows where import_id = i and row_number in (4, 8, 9, 10, 18, 20)),
    '4:failed,8:skipped,9:skipped,10:skipped,18:failed,20:failed', 'errors fail, skipped rows are skipped');
  perform tests.assert_eq(private.user_import_result_counts(i) - array['failedCodes', 'skippedCodes', 'warningCodes'],
    '{"added": 5, "total": 19, "failed": 9, "skipped": 3, "updated": 2, "warned": 4, "reinvited": 1, "notProcessed": 0,
      "skippedExisting": 0, "addedWithWarnings": 3, "changedSinceReview": 1}'::jsonb,
    'result numbers');
end $$;

-- Invitations: scheduled at the pace (here: all at once) during the inviting phase, then sent by the
-- worker one at a time at the platform-wide pace (security review M2): due is not a burst.
update platform.user_imports set status = 'inviting' where id = 'a5000000-0000-4000-8000-0000000000d2';
do $$
declare
  i constant uuid := 'a5000000-0000-4000-8000-0000000000d2';
  v_ids uuid[];
  r record;
begin
  select array_agg(id) into v_ids from platform.invitations where import_id = i;
  perform tests.assert_eq(private.schedule_held_invitations(v_ids, interval '0 seconds'), 5, 'the import''s five invitations scheduled');
  perform tests.assert((select bool_and(send_at <= now()) from platform.invitations where import_id = i), 'all five due now');
  select * into r from private.user_import_release_next(i, interval '100 milliseconds', 1000, 100);
  perform tests.assert_eq(r.state, 'released', 'the first one is sent');
  select * into r from private.user_import_release_next(i, interval '100 milliseconds', 1000, 100);
  perform tests.assert(r.state = 'wait' and r.not_before > now(), 'the second one, due as well, waits for the pace');
  perform tests.assert((select next_attempt_at = r.not_before from platform.user_imports where id = i),
    'the import''s next attempt is the next slot');
  for n in 1..4 loop
    perform pg_sleep(0.12);
    select * into r from private.user_import_release_next(i, interval '100 milliseconds', 1000, 100);
    perform tests.assert_eq(r.state, 'released', format('one more after the pace (%s)', n));
  end loop;
  perform pg_sleep(0.12);
  perform tests.assert_eq((select x.state from private.user_import_release_next(i, interval '100 milliseconds', 1000, 100) x),
    'none', 'nothing left');
  perform tests.assert((select bool_and(not mail_held and send_at is null and released_at is not null
                                        and expires_at > now() + interval '6 days')
                        from platform.invitations where import_id = i), 'released: no longer held, sent time stamped, 7 days from now');
end $$;
update platform.user_imports set status = 'finished' where id = 'a5000000-0000-4000-8000-0000000000d2';

-- One invitee accepts; someone outside the import now reports to row 2's person; row 7 is edited by hand.
select pg_temp.become_owner();
do $$
begin
  perform tests.assert_eq((select count(*) from platform.event_outbox where type = 'com.entlaqa.platform.invitation.released'
                             and actor_type = 'system' and actor_job = 'tests.user_imports'
                             and subject in (select id from platform.invitations
                                             where import_id = 'a5000000-0000-4000-8000-0000000000d2')),
    5::bigint, 'one `invitation.released` event each for the mailer');
end $$;
update platform.invitations set token_hash = tests.token_hash('tok-imp-new2')
  where id = (select invitation_id from platform.user_import_rows where import_id = 'a5000000-0000-4000-8000-0000000000d2' and row_number = 3);
update platform.invitations set status = 'accepted', accepted_user_id = '00000000-0000-4000-8000-0000000000e1'
  where id = (select invitation_id from platform.user_import_rows where import_id = 'a5000000-0000-4000-8000-0000000000d2' and row_number = 3);
insert into platform.tenant_memberships (tenant_id, user_id, person_id, status)
  select 'a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000e1', person_id, 'active'
  from platform.user_import_rows where import_id = 'a5000000-0000-4000-8000-0000000000d2' and row_number = 3;
update platform.person_employment set manager_person_id =
    (select person_id from platform.user_import_rows where import_id = 'a5000000-0000-4000-8000-0000000000d2' and row_number = 2)
  where person_id = 'a1000000-0000-4000-8000-000000000e06';
update platform.persons set mobile_e164 = '+966500000007' where id = 'a1000000-0000-4000-8000-000000000e02';
-- The importer undoes the import.
select pg_temp.become_user('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
                           'a1000000-0000-4000-8000-0000000000a1');
update platform.user_imports set status = 'undoing', undo_reason = 'wrong_data' where id = 'a5000000-0000-4000-8000-0000000000d2';
select pg_temp.become_worker('a0000000-0000-4000-8000-000000000001');
do $$
declare
  i constant uuid := 'a5000000-0000-4000-8000-0000000000d2';
begin
  perform tests.assert_eq(private.user_import_undo_batch(i, 5), 5, 'undo in batches');
  perform tests.assert_eq(private.user_import_undo_batch(i, 5), 2, 'the rest');
  perform tests.assert_eq(private.user_import_undo_batch(i, 5), 0, 'done');
  perform tests.assert_fails(format($q$update platform.persons set removed_by_import_id = %L where id = %L$q$, i,
                                    (select person_id from platform.user_import_rows where import_id = i and row_number = 3)),
    array['42501'], 'a person with a membership is never removed, even by the undo of the import that added them');
  perform tests.assert_eq((select count(*) from platform.person_employment e
                           join platform.user_import_rows r on r.person_id = e.person_id
                           where r.import_id = i and r.undo_result = 'removed' and r.before is null), 2::bigint,
    'system jobs still see the removed people''s placements (audit, referential integrity)');
  perform tests.assert_eq((select string_agg(row_number || ':' || undo_result, ',' order by row_number)
                           from platform.user_import_rows where import_id = i and undo_result is not null),
    '2:kept_referenced,3:kept_accepted,6:restored,7:kept_changed,11:removed,17:removed,19:removed',
    'removed unless accepted or someone reports to them; restored unless changed since');
  perform tests.assert((select status = 'revoked' and revoked_by = '00000000-0000-4000-8000-0000000000a1'
                        from platform.invitations where id = (select invitation_id from platform.user_import_rows
                                                              where import_id = i and row_number = 17)),
    'a removed person''s invitation is revoked (by the member who asked for the undo): the link stops');
  perform tests.assert((select status = 'inactive' and removed_by_import_id = i and removed_at is not null
                        from platform.persons
                        where id = (select person_id from platform.user_import_rows where import_id = i and row_number = 17)),
    'their record is kept, inactive and marked removed by this import (audit, referential integrity only)');
  perform tests.assert_eq((select count(*) from platform.persons p join platform.user_import_rows r on r.person_id = p.id
                           where r.import_id = i and r.undo_result = 'removed' and p.removed_at is not null), 2::bigint,
    'both people the import created and the undo removed carry the marker');
  perform tests.assert((select removed_at is null from platform.persons where id = 'a1000000-0000-4000-8000-000000000e05'),
    'row 11: a record the import reused is put back, never marked removed');
  perform tests.assert((select status = 'inactive' and job_title_ar is null from platform.persons p
                        left join platform.person_employment e on e.person_id = p.id
                        where p.id = 'a1000000-0000-4000-8000-000000000e05'), 'row 11: the reused record is put back as it was');
  perform tests.assert((select job_title_ar = 'محاسب' and department_id = 'a3000000-0000-4000-8000-000000000003'
                        from platform.person_employment where person_id = 'a1000000-0000-4000-8000-000000000e01'),
    'row 6: previous values back');
  perform tests.assert_eq((select count(*) from platform.audit_events where data ->> 'importId' = i::text and (data ->> 'undo')::boolean),
    4::bigint, 'every removal and restore is audited');
end $$;
update platform.user_imports set status = 'undone' where id = 'a5000000-0000-4000-8000-0000000000d2';
-- Removing is the undo's alone; a removed person never changes again (TM-0003 T-IAM-47).
do $$
declare
  i constant uuid := 'a5000000-0000-4000-8000-0000000000d2';
  v_removed uuid := (select person_id from platform.user_import_rows where import_id = i and row_number = 17);
  v_kept uuid := (select person_id from platform.user_import_rows where import_id = i and row_number = 2);
begin
  perform tests.assert_fails(format($q$update platform.persons set removed_by_import_id = %L where id = %L$q$, i, v_kept),
    array['42501'],
    'a system job cannot remove a person outside the undo of the import that added them');
  perform tests.assert_fails(format($q$update platform.persons set display_name_ar = 'تغيير' where id = %L$q$, v_removed),
    array['42501'], 'a removed person is never changed again, not even by a system job');
  perform tests.assert_fails($q$insert into platform.persons (display_name_ar, email, removed_at, removed_by_import_id)
                                values ('مزيف', 'fake.removed@imp.test', now(), 'a5000000-0000-4000-8000-0000000000d2')$q$,
    array['42501'], 'a person is never created removed');
end $$;
-- As if they had never been added: the importer (and every user claim) no longer sees them.
select pg_temp.become_user('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
                           'a1000000-0000-4000-8000-0000000000a1');
do $$
declare
  i constant uuid := 'a5000000-0000-4000-8000-0000000000d2';
begin
  perform tests.assert_eq((select count(*) from platform.persons
                           where email in ('nomgr@imp.test', 'under.dup@imp.test')), 0::bigint,
    'removed people are invisible to user claims: users list, tabs, search, counts, profiles and pickers');
  perform tests.assert_eq((select count(*) from platform.persons where removed_at is not null), 0::bigint,
    'no removed person at all is visible to user claims');
  perform tests.assert_eq(tests.rows_affected(format($q$update platform.persons set display_name_ar = 'تعديل'
                                                       where removed_by_import_id = %L$q$, i)), 0::bigint,
    'nor can a user change them');
  perform tests.assert_fails($q$update platform.persons set removed_by_import_id = 'a5000000-0000-4000-8000-0000000000d2'
                                where id = 'a1000000-0000-4000-8000-000000000e01'$q$,
    array['42501'], 'a user (even an Organization Admin) cannot mark a person removed');
  -- Their placement is gone with them (re-review Low 3): no manager, department or reports-tree link.
  perform tests.assert_eq((select count(*) from platform.person_employment e
                           join platform.user_import_rows r on r.person_id = e.person_id
                           where r.import_id = i and r.undo_result = 'removed' and r.before is null), 0::bigint,
    'removed people''s placements are invisible to user claims');
  perform tests.assert_eq(tests.rows_affected(format($q$update platform.person_employment set job_title_ar = 'تعديل'
      where person_id in (select person_id from platform.user_import_rows
                          where import_id = %L and undo_result = 'removed' and before is null)$q$, i)),
    0::bigint, 'nor can a user change them');
  perform tests.assert((select count(*) from platform.person_employment) > 0, 'other placements stay visible');
  -- Nor invite them again: the invitation guard does not rely on the foreign key, which ignores RLS
  -- (re-review Low 2).
  perform tests.assert_fails(format($q$insert into platform.invitations (person_id, email, locale, primary_role)
      values (%L, 'nomgr@imp.test', 'ar', 'learner')$q$,
      (select person_id from platform.user_import_rows where import_id = i and row_number = 17)),
    array['23503'], 'a removed person cannot be invited (the person is not found)');
  -- Their e-mail is free again: the invite form creates a new person with it.
  perform tests.assert_eq(tests.rows_affected($q$insert into platform.persons (display_name_ar, email)
                                                 values ('تحت مكرر', 'under.dup@imp.test')$q$), 1::bigint,
    'the e-mail of a removed person can be invited again (a new record)');
end $$;
select pg_temp.become_owner();
-- A removed person can be imported again: a new record, as if never added.
select pg_temp.new_import('a5000000-0000-4000-8000-0000000000d3', '00000000-0000-4000-8000-0000000000a1',
                          'a1000000-0000-4000-8000-0000000000a1', 'f0a00000-0000-4000-8000-0000000000d3');
select pg_temp.stage('a5000000-0000-4000-8000-0000000000d3', 2, '{"email": "nomgr@imp.test", "first_name_ar": "بلا", "family_name_ar": "مدير"}');
select pg_temp.become_worker('a0000000-0000-4000-8000-000000000001');
select private.user_import_classify('a5000000-0000-4000-8000-0000000000d3');
do $$
begin
  perform tests.assert_eq(pg_temp.kind('a5000000-0000-4000-8000-0000000000d3', 2), 'new',
    'after the undo, the same file can be imported again');
  perform tests.assert((select target_person_id is null from platform.user_import_rows
                        where import_id = 'a5000000-0000-4000-8000-0000000000d3' and row_number = 2),
    'the removed record is not matched: the person is added as a new record');
end $$;
-- Run it: a new record; the removed one is never re-activated (PO decision 11: imports never reactivate).
update platform.user_imports set status = 'review' where id = 'a5000000-0000-4000-8000-0000000000d3';
select pg_temp.become_user('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
                           'a1000000-0000-4000-8000-0000000000a1');
update platform.user_imports set status = 'queued',
  options = '{"existing": "upsert", "defaultRole": "learner", "invitations": "hold"}'
  where id = 'a5000000-0000-4000-8000-0000000000d3';
select pg_temp.become_worker('a0000000-0000-4000-8000-000000000001');
update platform.user_imports set status = 'checking' where id = 'a5000000-0000-4000-8000-0000000000d3';
select private.user_import_recheck('a5000000-0000-4000-8000-0000000000d3');
update platform.user_imports set status = 'importing' where id = 'a5000000-0000-4000-8000-0000000000d3';
do $$
declare
  v_removed uuid := (select person_id from platform.user_import_rows
                     where import_id = 'a5000000-0000-4000-8000-0000000000d2' and row_number = 17);
begin
  perform tests.assert_eq(private.user_import_apply_batch('a5000000-0000-4000-8000-0000000000d3', 10), 1, 'the row is written');
  perform tests.assert((select result = 'added' and person_id <> v_removed from platform.user_import_rows
                        where import_id = 'a5000000-0000-4000-8000-0000000000d3' and row_number = 2),
    'a new record is added');
  perform tests.assert((select status = 'inactive' and removed_at is not null and removed_by_import_id = 'a5000000-0000-4000-8000-0000000000d2'
                        from platform.persons where id = v_removed),
    'the record removed by the earlier undo stays removed and inactive: a later import never re-activates it');
  perform tests.assert_eq((select count(*) from platform.persons where email = 'nomgr@imp.test' and removed_at is null),
    1::bigint, 'one live record with the e-mail: the new one');
end $$;
select pg_temp.become_owner();
rollback;

-- ---------------------------------------------------------------------------------------------------
-- An HR Manager's import: privileged members skipped; losing the role stops the run; update only.
-- ---------------------------------------------------------------------------------------------------
begin;
select pg_temp.new_import('a5000000-0000-4000-8000-0000000000d4', '00000000-0000-4000-8000-0000000000ab',
                          'a1000000-0000-4000-8000-0000000000ab', 'f0a00000-0000-4000-8000-0000000000d4');
select pg_temp.stage_file('a5000000-0000-4000-8000-0000000000d4');
select pg_temp.become_worker('a0000000-0000-4000-8000-000000000001');
select private.user_import_classify('a5000000-0000-4000-8000-0000000000d4');
update platform.user_imports set status = 'review' where id = 'a5000000-0000-4000-8000-0000000000d4';
select pg_temp.become_user('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
                           'a1000000-0000-4000-8000-0000000000ab');
update platform.user_imports set status = 'queued',
  options = '{"existing": "update_only", "defaultRole": "learner", "invitations": "hold"}'
  where id = 'a5000000-0000-4000-8000-0000000000d4';
select pg_temp.become_worker('a0000000-0000-4000-8000-000000000001');
update platform.user_imports set status = 'checking' where id = 'a5000000-0000-4000-8000-0000000000d4';
update platform.user_imports set status = 'importing' where id = 'a5000000-0000-4000-8000-0000000000d4';
do $$
declare
  i constant uuid := 'a5000000-0000-4000-8000-0000000000d4';
begin
  perform tests.assert_eq(private.user_import_apply_batch(i, 3), 3, 'first batch');
  perform tests.assert_eq((select string_agg(row_number || ':' || result || ':' || (result_issues -> 0 ->> 'c'), ',' order by row_number)
                           from platform.user_import_rows where import_id = i and result is not null),
    '2:skipped:NEW_SKIPPED_UPDATE_ONLY,6:updated:ROLES_IGNORED_EXISTING,7:skipped:PRIVILEGED_MEMBER',
    'update only: nobody new is added; an HR Manager''s import skips a privileged member');
end $$;
-- The HR Manager loses the role (an Organization Admin's change): the run stops adding people.
select pg_temp.become_owner();
delete from platform.role_assignments where role_code = 'hr_manager'
  and membership_id = (select id from platform.tenant_memberships where user_id = '00000000-0000-4000-8000-0000000000ab'
                         and tenant_id = 'a0000000-0000-4000-8000-000000000001');
select pg_temp.become_worker('a0000000-0000-4000-8000-000000000001');
do $$
begin
  perform tests.assert_fails($q$select private.user_import_apply_batch('a5000000-0000-4000-8000-0000000000d4', 3)$q$,
    array['JU001'], 'an importer who may no longer import: the run stops (JU001)');
end $$;
select pg_temp.become_owner();
rollback;

begin;
select pg_temp.new_import('a5000000-0000-4000-8000-0000000000d5', '00000000-0000-4000-8000-0000000000ab',
                          'a1000000-0000-4000-8000-0000000000ab', 'f0a00000-0000-4000-8000-0000000000d5');
select pg_temp.stage_file('a5000000-0000-4000-8000-0000000000d5');
select pg_temp.become_worker('a0000000-0000-4000-8000-000000000001');
select private.user_import_classify('a5000000-0000-4000-8000-0000000000d5');
update platform.user_imports set status = 'review' where id = 'a5000000-0000-4000-8000-0000000000d5';
select pg_temp.become_user('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
                           'a1000000-0000-4000-8000-0000000000ab');
update platform.user_imports set status = 'queued',
  options = '{"existing": "upsert", "defaultRole": "learner", "invitations": "hold"}'
  where id = 'a5000000-0000-4000-8000-0000000000d5';
select pg_temp.become_worker('a0000000-0000-4000-8000-000000000001');
update platform.user_imports set status = 'checking' where id = 'a5000000-0000-4000-8000-0000000000d5';
update platform.user_imports set status = 'importing' where id = 'a5000000-0000-4000-8000-0000000000d5';
do $$
declare
  i constant uuid := 'a5000000-0000-4000-8000-0000000000d5';
begin
  perform tests.assert(private.user_import_apply_batch(i, 50) > 0, 'one batch');
  perform tests.assert_eq((select result || ':' || (result_issues -> 0 ->> 'c') from platform.user_import_rows where import_id = i and row_number = 7),
    'skipped:PRIVILEGED_MEMBER', 'an HR Manager''s import never changes a privileged member''s record');
  perform tests.assert((select job_title_ar is null from platform.person_employment where person_id = 'a1000000-0000-4000-8000-000000000e02')
                       or not exists (select 1 from platform.person_employment where person_id = 'a1000000-0000-4000-8000-000000000e02'),
    'the privileged member''s record is unchanged');
  perform tests.assert_eq((select string_agg(distinct invited_by::text, ',') from platform.invitations where import_id = i),
    '00000000-0000-4000-8000-0000000000ab', 'the HR Manager is the inviter');
end $$;
-- Held invitations (invitations: hold) stay held; the worker schedules nothing unless the import sends.
do $$
declare
  i constant uuid := 'a5000000-0000-4000-8000-0000000000d5';
  v_ids uuid[];
begin
  select array_agg(id) into v_ids from platform.invitations where import_id = i;
  perform tests.assert_fails(format($q$select private.schedule_held_invitations(%L, interval '1 second')$q$, v_ids),
    array['42501'], 'the worker schedules only for an import sending its invitations');
end $$;
select pg_temp.become_owner();
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Sending: an importer who may no longer invite → the schedule is cleared, nothing is sent.
-- Sign-in (T-M2-09): a held invitation does not let a login that belongs nowhere sign in; a sent one does.
-- ---------------------------------------------------------------------------------------------------
begin;
select pg_temp.new_import('a5000000-0000-4000-8000-0000000000d6', '00000000-0000-4000-8000-0000000000ab',
                          'a1000000-0000-4000-8000-0000000000ab', 'f0a00000-0000-4000-8000-0000000000d6');
select pg_temp.stage('a5000000-0000-4000-8000-0000000000d6', 2, '{"email": "send1@imp.test", "first_name_ar": "إرسال", "family_name_ar": "أول"}');
select pg_temp.become_worker('a0000000-0000-4000-8000-000000000001');
select private.user_import_classify('a5000000-0000-4000-8000-0000000000d6');
update platform.user_imports set status = 'review' where id = 'a5000000-0000-4000-8000-0000000000d6';
select pg_temp.become_user('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
                           'a1000000-0000-4000-8000-0000000000ab');
update platform.user_imports set status = 'queued',
  options = '{"existing": "skip", "defaultRole": "learner", "invitations": "send"}'
  where id = 'a5000000-0000-4000-8000-0000000000d6';
select pg_temp.become_worker('a0000000-0000-4000-8000-000000000001');
update platform.user_imports set status = 'checking' where id = 'a5000000-0000-4000-8000-0000000000d6';
update platform.user_imports set status = 'importing' where id = 'a5000000-0000-4000-8000-0000000000d6';
select private.user_import_apply_batch('a5000000-0000-4000-8000-0000000000d6', 10);
update platform.user_imports set status = 'inviting' where id = 'a5000000-0000-4000-8000-0000000000d6';
select private.schedule_held_invitations(array(select id from platform.invitations where import_id = 'a5000000-0000-4000-8000-0000000000d6'),
                                         interval '0 seconds');
update platform.user_imports set status = 'finished' where id = 'a5000000-0000-4000-8000-0000000000d6';
select pg_temp.become_owner();
-- The HR Manager is demoted before the invitations go out.
delete from platform.role_assignments where role_code = 'hr_manager'
  and membership_id = (select id from platform.tenant_memberships where user_id = '00000000-0000-4000-8000-0000000000ab'
                         and tenant_id = 'a0000000-0000-4000-8000-000000000001');
select pg_temp.become_worker('a0000000-0000-4000-8000-000000000001');
do $$
declare
  i constant uuid := 'a5000000-0000-4000-8000-0000000000d6';
begin
  perform tests.assert_eq((select x.state from private.user_import_release_next(i, interval '100 milliseconds', 1000, 100) x),
    'not_allowed', 'the importer may no longer invite: nothing sent');
  perform tests.assert((select bool_and(mail_held and send_at is null) from platform.invitations where import_id = i),
    'the schedule is cleared: «لم تُرسل الدعوة»');
end $$;
select pg_temp.become_owner();
rollback;

begin;
-- A held invitation (another organization's import) for a deactivated login's address.
insert into platform.persons (id, tenant_id, display_name_ar, email)
  values ('b1000000-0000-4000-8000-000000000e03', 'b0000000-0000-4000-8000-000000000001', 'معطل في أ', 'deact@imp.test');
insert into platform.invitations (id, tenant_id, person_id, email, locale, primary_role, invited_by, import_id, mail_held)
  values ('b4000000-0000-4000-8000-000000000e03', 'b0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000e03',
          'deact@imp.test', 'ar', 'learner', '00000000-0000-4000-8000-0000000000b1', 'b5000000-0000-4000-8000-000000000001', true);
do $$
begin
  perform tests.assert(private.account_sign_in_refused('00000000-0000-4000-8000-000000000e03'),
    'a held invitation (not sent, no link) does not let the deactivated login sign in');
  update platform.invitations set send_at = now() - interval '1 second' where id = 'b4000000-0000-4000-8000-000000000e03';
  update platform.invitations set mail_held = false where id = 'b4000000-0000-4000-8000-000000000e03';
  perform tests.assert(not private.account_sign_in_refused('00000000-0000-4000-8000-000000000e03'),
    'once it is sent, the login may sign in to accept it (T-M2-07)');
end $$;
rollback;

-- People kept «لم تُرسل الدعوة» are sent their invitation from the users list at any time — also after the
-- import's data was deleted (7 days after it ended): the worker's claim still finds the due invitation.
begin;
update platform.user_imports set finished_at = now() - interval '9 days', data_purged_at = now()
  where id = 'a5000000-0000-4000-8000-000000000011';
select pg_temp.become_user('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
                           'a1000000-0000-4000-8000-0000000000a1');
do $$
begin
  perform tests.assert_eq(private.schedule_held_invitations(array['a4000000-0000-4000-8000-000000000e07']::uuid[],
                                                            interval '1 second'), 1, 'the admin sends the held invitation');
end $$;
select pg_temp.become_owner();
update platform.invitations set send_at = now() - interval '1 second' where id = 'a4000000-0000-4000-8000-000000000e07';
set local session authorization app_worker;
set local role authenticated;
select tests.set_claims(jsonb_build_object('role', 'system', 'job_id', 'tests.user_imports'));
do $$
declare
  r record;
begin
  select * into r from private.claim_user_import_work() where import_id = 'a5000000-0000-4000-8000-000000000011';
  perform tests.assert_eq(r.step, 'send', 'the import whose data is deleted is claimed to send its due invitation');
end $$;
select pg_temp.become_worker('a0000000-0000-4000-8000-000000000001');
do $$
begin
  perform tests.assert_eq((select x.state from private.user_import_release_next('a5000000-0000-4000-8000-000000000011',
                                                                               interval '100 milliseconds', 1000, 100) x),
    'released', 'and it is sent');
  perform tests.assert((select not mail_held and send_at is null from platform.invitations
                        where id = 'a4000000-0000-4000-8000-000000000e07'), 'released (the mailer gives it its link)');
end $$;
select pg_temp.become_owner();
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Sending at the platform-wide pace (security review M2): one send clock for every organization; overdue
-- invitations spaced out again, never a burst; a daily number of import invitations per organization,
-- lower on trial — above it they wait for the next day, never dropped.
-- ---------------------------------------------------------------------------------------------------
begin;
insert into platform.persons (id, tenant_id, display_name_ar, email) values
  ('a1000000-0000-4000-8000-000000000f11', 'a0000000-0000-4000-8000-000000000001', 'متأخر أول', 'late1@imp.test'),
  ('a1000000-0000-4000-8000-000000000f12', 'a0000000-0000-4000-8000-000000000001', 'متأخر ثان', 'late2@imp.test'),
  ('a1000000-0000-4000-8000-000000000f13', 'a0000000-0000-4000-8000-000000000001', 'متأخر ثالث', 'late3@imp.test'),
  ('b1000000-0000-4000-8000-000000000f11', 'b0000000-0000-4000-8000-000000000001', 'في المنشأة ب', 'in.b@imp.test');
insert into platform.invitations (id, tenant_id, person_id, email, locale, primary_role, invited_by, import_id, mail_held) values
  ('a4000000-0000-4000-8000-000000000f11', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000f11',
   'late1@imp.test', 'ar', 'learner', '00000000-0000-4000-8000-0000000000a1', 'a5000000-0000-4000-8000-000000000011', true),
  ('a4000000-0000-4000-8000-000000000f12', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000f12',
   'late2@imp.test', 'ar', 'learner', '00000000-0000-4000-8000-0000000000a1', 'a5000000-0000-4000-8000-000000000011', true),
  ('a4000000-0000-4000-8000-000000000f13', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000f13',
   'late3@imp.test', 'ar', 'learner', '00000000-0000-4000-8000-0000000000a1', 'a5000000-0000-4000-8000-000000000011', true),
  ('b4000000-0000-4000-8000-000000000f11', 'b0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000f11',
   'in.b@imp.test', 'ar', 'learner', '00000000-0000-4000-8000-0000000000b1', 'b5000000-0000-4000-8000-000000000001', true);
-- All overdue by an hour (e.g. the worker was down).
update platform.invitations set send_at = now() - interval '1 hour'
  where id in ('a4000000-0000-4000-8000-000000000e07', 'a4000000-0000-4000-8000-000000000f11',
               'a4000000-0000-4000-8000-000000000f12', 'a4000000-0000-4000-8000-000000000f13',
               'b4000000-0000-4000-8000-000000000f11');
select pg_temp.become_worker('a0000000-0000-4000-8000-000000000001');
do $$
declare
  r record;
begin
  select * into r from private.user_import_release_next('a5000000-0000-4000-8000-000000000011', interval '100 milliseconds', 3, 2);
  perform tests.assert_eq(r.state, 'released', 'tenant A: the first overdue invitation is sent');
  select * into r from private.user_import_release_next('a5000000-0000-4000-8000-000000000011', interval '100 milliseconds', 3, 2);
  perform tests.assert(r.state = 'wait' and r.not_before > now(),
    'the next overdue one waits for the pace: overdue invitations are spaced out again, not sent in a burst');
end $$;
select pg_temp.become_worker('b0000000-0000-4000-8000-000000000001');
do $$
declare
  r record;
begin
  select * into r from private.user_import_release_next('b5000000-0000-4000-8000-000000000001', interval '100 milliseconds', 3, 2);
  perform tests.assert_eq(r.state, 'wait', 'tenant B waits for the slot tenant A just took: one clock for the platform');
  perform pg_sleep(0.12);
  select * into r from private.user_import_release_next('b5000000-0000-4000-8000-000000000001', interval '100 milliseconds', 3, 2);
  perform tests.assert_eq(r.state, 'released', 'then it is tenant B''s turn');
end $$;
select pg_temp.become_worker('a0000000-0000-4000-8000-000000000001');
do $$
declare
  i constant uuid := 'a5000000-0000-4000-8000-000000000011';
  r record;
begin
  perform pg_sleep(0.12);
  perform tests.assert_eq((select x.state from private.user_import_release_next(i, interval '100 milliseconds', 3, 2) x),
    'released', 'tenant A: the second today');
  perform pg_sleep(0.12);
  perform tests.assert_eq((select x.state from private.user_import_release_next(i, interval '100 milliseconds', 3, 2) x),
    'released', 'the third today');
  perform pg_sleep(0.12);
  select * into r from private.user_import_release_next(i, interval '100 milliseconds', 3, 2);
  perform tests.assert(r.state = 'capped' and r.not_before = date_trunc('day', now(), 'UTC') + interval '1 day',
    'the daily number reached (3): the rest waits for the next day (UTC)');
  perform tests.assert((select next_attempt_at = r.not_before from platform.user_imports where id = i),
    'the import is not tried again before then');
  perform tests.assert_eq((select count(*) from platform.invitations where import_id = i and mail_held and send_at is not null),
    1::bigint, 'the invitation over the number stays scheduled: never dropped');
  perform tests.assert_fails(format($q$select * from private.user_import_release_next(%L, interval '1 second', 0, 2)$q$, i),
    array['22023'], 'the daily numbers are positive');
end $$;
-- On trial: the lower daily number applies.
select pg_temp.become_owner();
update platform.tenants set status = 'trial' where id = 'a0000000-0000-4000-8000-000000000001';
update platform.user_imports set next_attempt_at = now() where id = 'a5000000-0000-4000-8000-000000000011';
select pg_temp.become_worker('a0000000-0000-4000-8000-000000000001');
do $$
begin
  perform tests.assert_eq((select x.state from private.user_import_release_next('a5000000-0000-4000-8000-000000000011',
                                                                               interval '100 milliseconds', 1000, 3) x),
    'capped', 'an organization on trial: its lower daily number (3) is reached');
end $$;
select pg_temp.become_owner();
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Undo by an HR Manager (security review L1): members who hold a privileged role now keep their data; a
-- record the import invited again and that changed since is kept as it is.
-- ---------------------------------------------------------------------------------------------------
begin;
select pg_temp.run_import('a5000000-0000-4000-8000-0000000000d7', '00000000-0000-4000-8000-0000000000ab',
                          '10000000-0000-4000-8000-0000000000ab', 'a1000000-0000-4000-8000-0000000000ab',
                          'f0a00000-0000-4000-8000-0000000000d7',
                          '{"existing": "upsert", "defaultRole": "learner", "invitations": "hold"}');
do $$
begin
  perform tests.assert_eq((select string_agg(row_number || ':' || result, ',' order by row_number) from platform.user_import_rows
                           where import_id = 'a5000000-0000-4000-8000-0000000000d7' and result in ('added', 'updated')),
    '2:added,3:added,6:updated,11:added,17:added,19:added,20:added', 'the HR Manager''s import added and updated people');
end $$;
-- After the import: row 6's member is given a privileged role; row 11's record (invited again) is edited.
insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary)
  select tenant_id, id, 'finance_manager', false from platform.tenant_memberships
  where person_id = 'a1000000-0000-4000-8000-000000000e01';
update platform.persons set mobile_e164 = '+966500000011' where id = 'a1000000-0000-4000-8000-000000000e05';
select pg_temp.become_user('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
                           'a1000000-0000-4000-8000-0000000000ab');
update platform.user_imports set status = 'undoing', undo_reason = 'wrong_data' where id = 'a5000000-0000-4000-8000-0000000000d7';
select pg_temp.become_worker('a0000000-0000-4000-8000-000000000001');
do $$
declare
  i constant uuid := 'a5000000-0000-4000-8000-0000000000d7';
begin
  perform tests.assert_eq(private.user_import_undo_batch(i, 50), 7, 'one batch');
  perform tests.assert_eq(private.user_import_undo_batch(i, 50), 0, 'done');
  perform tests.assert_eq(pg_temp.undo_results(i), '2:removed,3:removed,6:kept_privileged,11:kept_changed,17:removed,19:removed,20:removed',
    'an HR Manager''s undo keeps the data of a member who now holds a privileged role, and a record invited again that changed since');
  perform tests.assert((select job_title_ar = 'مدير' from platform.person_employment
                        where person_id = 'a1000000-0000-4000-8000-000000000e01'),
    'row 6: the privileged member''s record is not changed by the undo');
  perform tests.assert((select i.status = 'pending' and p.status = 'active' and p.mobile_e164 = '+966500000011'
                        from platform.user_import_rows r
                        join platform.invitations i on i.id = r.invitation_id
                        join platform.persons p on p.id = r.person_id
                        where r.import_id = 'a5000000-0000-4000-8000-0000000000d7' and r.row_number = 11),
    'row 11: changed since the import, so kept as it is (its invitation included)');
end $$;
select pg_temp.become_owner();
rollback;

-- ---------------------------------------------------------------------------------------------------
-- An Organization Admin undoes an HR Manager's import whose importer is gone (Tech Lead decision 10 Oct
-- 2026, security review M1); the importer themselves no longer may.
-- ---------------------------------------------------------------------------------------------------
begin;
select pg_temp.run_import('a5000000-0000-4000-8000-0000000000d8', '00000000-0000-4000-8000-0000000000ab',
                          '10000000-0000-4000-8000-0000000000ab', 'a1000000-0000-4000-8000-0000000000ab',
                          'f0a00000-0000-4000-8000-0000000000d8',
                          '{"existing": "upsert", "defaultRole": "learner", "invitations": "hold"}');
-- Row 6's member now holds a privileged role; the HR Manager loses theirs.
insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary)
  select tenant_id, id, 'finance_manager', false from platform.tenant_memberships
  where person_id = 'a1000000-0000-4000-8000-000000000e01';
delete from platform.role_assignments where role_code = 'hr_manager'
  and membership_id = (select id from platform.tenant_memberships where user_id = '00000000-0000-4000-8000-0000000000ab'
                         and tenant_id = 'a0000000-0000-4000-8000-000000000001');
select pg_temp.become_user('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
                           'a1000000-0000-4000-8000-0000000000ab');
do $$
begin
  perform tests.assert_eq(tests.rows_affected($q$update platform.user_imports set status = 'undoing' where id = 'a5000000-0000-4000-8000-0000000000d8'$q$),
    0::bigint, 'an importer who may no longer import cannot undo their import (they no longer see the imports)');
end $$;
select pg_temp.become_user('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
                           'a1000000-0000-4000-8000-0000000000a1');
do $$
begin
  perform tests.assert_eq(tests.rows_affected($q$update platform.user_imports set status = 'undoing', undo_reason = 'wrong_file'
                                                 where id = 'a5000000-0000-4000-8000-0000000000d8'$q$),
    1::bigint, 'the Organization Admin undoes it');
end $$;
select pg_temp.become_worker('a0000000-0000-4000-8000-000000000001');
do $$
declare
  i constant uuid := 'a5000000-0000-4000-8000-0000000000d8';
begin
  perform tests.assert_eq(private.user_import_undo_batch(i, 50), 7, 'the undo runs although the importer is gone');
  perform tests.assert_eq(pg_temp.undo_results(i), '2:removed,3:removed,6:restored,11:removed,17:removed,19:removed,20:removed',
    'an Organization Admin''s undo restores privileged members too');
  perform tests.assert((select revoked_by = '00000000-0000-4000-8000-0000000000a1' from platform.invitations
                        where id = (select invitation_id from platform.user_import_rows where import_id = i and row_number = 17)),
    'the invitations are revoked by the Organization Admin who asked for the undo');
end $$;
select pg_temp.become_owner();
rollback;

-- ---------------------------------------------------------------------------------------------------
-- The member who asked for the undo is checked again for every batch (security review L1).
-- ---------------------------------------------------------------------------------------------------
begin;
select pg_temp.run_import('a5000000-0000-4000-8000-0000000000d9', '00000000-0000-4000-8000-0000000000ab',
                          '10000000-0000-4000-8000-0000000000ab', 'a1000000-0000-4000-8000-0000000000ab',
                          'f0a00000-0000-4000-8000-0000000000d9',
                          '{"existing": "upsert", "defaultRole": "learner", "invitations": "hold"}');
select pg_temp.become_user('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
                           'a1000000-0000-4000-8000-0000000000ab');
update platform.user_imports set status = 'undoing', undo_reason = 'other' where id = 'a5000000-0000-4000-8000-0000000000d9';
select pg_temp.become_worker('a0000000-0000-4000-8000-000000000001');
do $$
begin
  perform tests.assert_eq(private.user_import_undo_batch('a5000000-0000-4000-8000-0000000000d9', 2), 2, 'a first batch');
end $$;
select pg_temp.become_owner();
delete from platform.role_assignments where role_code = 'hr_manager'
  and membership_id = (select id from platform.tenant_memberships where user_id = '00000000-0000-4000-8000-0000000000ab'
                         and tenant_id = 'a0000000-0000-4000-8000-000000000001');
select pg_temp.become_worker('a0000000-0000-4000-8000-000000000001');
do $$
declare
  i constant uuid := 'a5000000-0000-4000-8000-0000000000d9';
begin
  perform tests.assert_eq(private.user_import_undo_batch(i, 2), -1,
    'the HR Manager lost the role: the undo goes no further (the worker ends it)');
  perform tests.assert_eq((select count(*) from platform.user_import_rows where import_id = i and undo_result is not null),
    2::bigint, 'nothing more was undone');
end $$;
select pg_temp.become_owner();
rollback;

-- ---------------------------------------------------------------------------------------------------
-- An import never gives a privileged role, which is why starting one needs no authenticator code
-- (TM-0003 D-IAM-01: the single-user flows ask for one only to give a privileged role; integration
-- T-M2-10 × T-M2-12). Even rows a defective or tampered worker stages with a privileged role — primary or
-- additional — fail at the invitation guard, for an Organization Admin's import too; only the ordinary
-- row is added, and no invitation of the import carries a privileged role.
-- ---------------------------------------------------------------------------------------------------
begin;
select pg_temp.new_import('a5000000-0000-4000-8000-0000000000da', '00000000-0000-4000-8000-0000000000a1',
                          'a1000000-0000-4000-8000-0000000000a1', 'f0a00000-0000-4000-8000-0000000000da');
select pg_temp.stage('a5000000-0000-4000-8000-0000000000da', 2, '{"email": "priv.primary@imp.test", "first_name_ar": "مميز",
  "family_name_ar": "أساسي", "primary_role": "hr_manager", "roles_given": true}');
select pg_temp.stage('a5000000-0000-4000-8000-0000000000da', 3, '{"email": "priv.extra@imp.test", "first_name_ar": "مميز",
  "family_name_ar": "إضافي", "primary_role": "learner", "additional_roles": ["auditor"], "roles_given": true}');
select pg_temp.stage('a5000000-0000-4000-8000-0000000000da', 4, '{"email": "priv.admin@imp.test", "first_name_ar": "مدير",
  "family_name_ar": "منشأة", "primary_role": "tenant_admin", "roles_given": true}');
select pg_temp.stage('a5000000-0000-4000-8000-0000000000da', 5, '{"email": "plain.new@imp.test", "first_name_ar": "عادي",
  "family_name_ar": "جديد"}');
select pg_temp.become_worker('a0000000-0000-4000-8000-000000000001');
select private.user_import_classify('a5000000-0000-4000-8000-0000000000da');
update platform.user_imports set status = 'review' where id = 'a5000000-0000-4000-8000-0000000000da';
select pg_temp.become_user('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
                           'a1000000-0000-4000-8000-0000000000a1');
update platform.user_imports set status = 'queued',
  options = '{"existing": "skip", "defaultRole": "learner", "invitations": "hold"}'
where id = 'a5000000-0000-4000-8000-0000000000da';
select pg_temp.become_worker('a0000000-0000-4000-8000-000000000001');
update platform.user_imports set status = 'checking' where id = 'a5000000-0000-4000-8000-0000000000da';
select private.user_import_recheck('a5000000-0000-4000-8000-0000000000da');
update platform.user_imports set status = 'importing' where id = 'a5000000-0000-4000-8000-0000000000da';
do $$
declare
  i constant uuid := 'a5000000-0000-4000-8000-0000000000da';
begin
  while private.user_import_apply_batch(i, 50) > 0 loop
  end loop;
  perform tests.assert_eq((select string_agg(row_number || ':' || result, ',' order by row_number)
                           from platform.user_import_rows where import_id = i),
    '2:failed,3:failed,4:failed,5:added', 'only the row without a privileged role is added');
  perform tests.assert_eq((select string_agg(r.row_number || ':' || (x ->> 'c') || ':' || (x ->> 's'), ','
                                             order by r.row_number)
                           from platform.user_import_rows r, jsonb_array_elements(r.result_issues) x
                           where r.import_id = i and r.result = 'failed'),
    '2:NOT_ALLOWED:e,3:NOT_ALLOWED:e,4:NOT_ALLOWED:e',
    'a privileged primary or additional role, the Organization Admin role: refused by the invitation guard');
  perform tests.assert_eq((select count(*) from platform.invitations v
                           where v.import_id = i
                             and exists (select 1 from platform.ref_roles r
                                         where r.code = any (array[v.primary_role] || v.additional_roles)
                                           and r.is_privileged)), 0::bigint,
    'no invitation of the import carries a privileged role');
  perform tests.assert_eq((select count(*) from platform.persons
                           where email in ('priv.primary@imp.test', 'priv.extra@imp.test', 'priv.admin@imp.test')),
    0::bigint, 'nobody was added for the refused rows');
end $$;
select pg_temp.become_owner();
rollback;

\echo '88_user_imports_flow_owner: ok'
