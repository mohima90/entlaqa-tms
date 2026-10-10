-- db-test: run-as=owner
-- User imports end to end (T-M2-12, FR-IAM-04, BRD §10.4): the dry run (private.user_import_classify) on a
-- file that meets every rule of the approved design, the run in batches with the fresh check, held
-- invitations of the importer scheduled and sent, an HR Manager's limits, an importer who loses the role
-- mid-run, the sign-in rule for held invitations (T-M2-09) and the undo. The owner connection switches
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
  perform tests.assert(v_row.department_id = 'a3000000-0000-4000-8000-000000000c01' and v_row.branch_id = 'a2000000-0000-4000-8000-000000000001'
                       and v_row.manager_person_id = 'a1000000-0000-4000-8000-000000000c06' and v_row.manager_row is null,
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
    'a1000000-0000-4000-8000-000000000c05'::uuid, 'row 11: their record is reused');
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
  perform tests.assert((select department_id = 'a3000000-0000-4000-8000-000000000c01' and branch_id = 'a2000000-0000-4000-8000-000000000001'
                               and manager_person_id = 'a1000000-0000-4000-8000-000000000c06' and hire_on = '2024-03-03'
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
                        from platform.person_employment where person_id = 'a1000000-0000-4000-8000-000000000c01'),
    'row 6: job title and department changed');
  perform tests.assert_eq(v_row.before, '{"job_title_ar": "محاسب", "department_id": "a3000000-0000-4000-8000-000000000003"}'::jsonb,
    'row 6: the previous values kept for undo');
  perform tests.assert_eq((select string_agg(ra.role_code, ',') from platform.role_assignments ra
                           join platform.tenant_memberships m on m.id = ra.membership_id
                           where m.person_id = 'a1000000-0000-4000-8000-000000000c01'), 'learner',
    'row 6: roles of an existing member never change by import');
  perform tests.assert_eq((select data -> 'changed' from platform.audit_events where action = 'platform.user.updated'
                             and entity_id = 'a1000000-0000-4000-8000-000000000c01' and data ->> 'importId' = i::text),
    '["department_id", "job_title_ar"]'::jsonb, 'row 6: audited with the changed fields');
  -- Row 7: the Organization Admin may update a privileged member.
  perform tests.assert_eq((select result from platform.user_import_rows where import_id = i and row_number = 7), 'updated',
    'row 7: updated by the Organization Admin');
  -- Row 11: invited again; their record made active and kept for undo.
  select * into v_row from platform.user_import_rows where import_id = i and row_number = 11;
  perform tests.assert(v_row.result = 'added' and v_row.person_id = 'a1000000-0000-4000-8000-000000000c05'
                       and v_row.before = '{"status": "inactive", "job_title_ar": null}'::jsonb,
    'row 11: the existing record reused; its previous state kept');
  perform tests.assert((select status = 'active' from platform.persons where id = 'a1000000-0000-4000-8000-000000000c05'),
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

-- Invitations: scheduled at the pace (here: at once) during the inviting phase, then sent by the worker.
update platform.user_imports set status = 'inviting' where id = 'a5000000-0000-4000-8000-0000000000d2';
do $$
declare
  i constant uuid := 'a5000000-0000-4000-8000-0000000000d2';
  v_ids uuid[];
begin
  select array_agg(id) into v_ids from platform.invitations where import_id = i;
  perform tests.assert_eq(private.schedule_held_invitations(v_ids, interval '0 seconds'), 5, 'the import''s five invitations scheduled');
  perform tests.assert_eq(private.user_import_release_due(i, 4), 4, 'due ones sent, at most the batch');
  perform tests.assert_eq(private.user_import_release_due(i, 4), 1, 'then the rest');
  perform tests.assert_eq(private.user_import_release_due(i, 4), 0, 'nothing left');
  perform tests.assert((select bool_and(not mail_held and send_at is null and expires_at > now() + interval '6 days')
                        from platform.invitations where import_id = i), 'released: no longer held, 7 days from now');
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
  where person_id = 'a1000000-0000-4000-8000-000000000c06';
update platform.persons set mobile_e164 = '+966500000007' where id = 'a1000000-0000-4000-8000-000000000c02';
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
  perform tests.assert_eq((select string_agg(row_number || ':' || undo_result, ',' order by row_number)
                           from platform.user_import_rows where import_id = i and undo_result is not null),
    '2:kept_referenced,3:kept_accepted,6:restored,7:kept_changed,11:removed,17:removed,19:removed',
    'removed unless accepted or someone reports to them; restored unless changed since');
  perform tests.assert((select status = 'revoked' and revoked_by = '00000000-0000-4000-8000-0000000000a1'
                        from platform.invitations where id = (select invitation_id from platform.user_import_rows
                                                              where import_id = i and row_number = 17)),
    'a removed person''s invitation is revoked (by the member who asked for the undo): the link stops');
  perform tests.assert((select status = 'inactive' from platform.persons
                        where id = (select person_id from platform.user_import_rows where import_id = i and row_number = 17)),
    'their record is kept, inactive');
  perform tests.assert((select status = 'inactive' and job_title_ar is null from platform.persons p
                        left join platform.person_employment e on e.person_id = p.id
                        where p.id = 'a1000000-0000-4000-8000-000000000c05'), 'row 11: the reused record is put back as it was');
  perform tests.assert((select job_title_ar = 'محاسب' and department_id = 'a3000000-0000-4000-8000-000000000003'
                        from platform.person_employment where person_id = 'a1000000-0000-4000-8000-000000000c01'),
    'row 6: previous values back');
  perform tests.assert_eq((select count(*) from platform.audit_events where data ->> 'importId' = i::text and (data ->> 'undo')::boolean),
    4::bigint, 'every removal and restore is audited');
end $$;
update platform.user_imports set status = 'undone' where id = 'a5000000-0000-4000-8000-0000000000d2';
select pg_temp.become_owner();
-- A removed person can be imported again: invited again with the same record.
select pg_temp.new_import('a5000000-0000-4000-8000-0000000000d3', '00000000-0000-4000-8000-0000000000a1',
                          'a1000000-0000-4000-8000-0000000000a1', 'f0a00000-0000-4000-8000-0000000000d3');
select pg_temp.stage('a5000000-0000-4000-8000-0000000000d3', 2, '{"email": "nomgr@imp.test", "first_name_ar": "بلا", "family_name_ar": "مدير"}');
select pg_temp.become_worker('a0000000-0000-4000-8000-000000000001');
select private.user_import_classify('a5000000-0000-4000-8000-0000000000d3');
do $$
begin
  perform tests.assert_eq(pg_temp.kind('a5000000-0000-4000-8000-0000000000d3', 2), 'new',
    'after the undo, the same file can be imported again');
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
  perform tests.assert((select job_title_ar is null from platform.person_employment where person_id = 'a1000000-0000-4000-8000-000000000c02')
                       or not exists (select 1 from platform.person_employment where person_id = 'a1000000-0000-4000-8000-000000000c02'),
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
  perform tests.assert_eq(private.user_import_release_due(i, 10), -1, 'the importer may no longer invite: nothing sent');
  perform tests.assert((select bool_and(mail_held and send_at is null) from platform.invitations where import_id = i),
    'the schedule is cleared: «لم تُرسل الدعوة»');
end $$;
select pg_temp.become_owner();
rollback;

begin;
-- A held invitation (another organization's import) for a deactivated login's address.
insert into platform.persons (id, tenant_id, display_name_ar, email)
  values ('b1000000-0000-4000-8000-000000000c03', 'b0000000-0000-4000-8000-000000000001', 'معطل في أ', 'deact@imp.test');
insert into platform.invitations (id, tenant_id, person_id, email, locale, primary_role, invited_by, import_id, mail_held)
  values ('b4000000-0000-4000-8000-000000000c03', 'b0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000c03',
          'deact@imp.test', 'ar', 'learner', '00000000-0000-4000-8000-0000000000b1', 'b5000000-0000-4000-8000-000000000001', true);
do $$
begin
  perform tests.assert(private.account_sign_in_refused('00000000-0000-4000-8000-000000000c03'),
    'a held invitation (not sent, no link) does not let the deactivated login sign in');
  update platform.invitations set send_at = now() - interval '1 second' where id = 'b4000000-0000-4000-8000-000000000c03';
  update platform.invitations set mail_held = false where id = 'b4000000-0000-4000-8000-000000000c03';
  perform tests.assert(not private.account_sign_in_refused('00000000-0000-4000-8000-000000000c03'),
    'once it is sent, the login may sign in to accept it (T-M2-07)');
end $$;
rollback;

\echo '88_user_imports_flow_owner: ok'
