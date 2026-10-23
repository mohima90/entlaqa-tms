-- db-test: run-as=owner
-- Profile photo, HR-only fields and grades (WP-ADM-04; FR-IAM-16, FR-IAM-01, FR-IAM-02; migrations
-- 20261025100000-100300): the permission and who holds it, the shape of the three new tables and their
-- checks, and the housekeeping of photo uploads. Runs as the superuser connection (fixtures: 00,
-- 65, 99_people_0).
\set ON_ERROR_STOP on

-- The permission «View and edit HR-only fields»: HR Manager and a custom role given it; never the Organization
-- Admin (PO answer 1), the L&D Manager or an Employee. Privileged, medium risk, whole organization only.
do $$
declare
  v_a constant uuid := 'a0000000-0000-4000-8000-000000000001';
begin
  perform tests.assert_eq((select risk || ':' || custom_role_use || ':' || privileged::text from platform.ref_permissions
                           where code = 'platform.person.hr_details'),
    'medium:organization_only:true', 'the permission is medium risk, organization-wide only and privileged');
  perform tests.assert_eq((select string_agg(role_code || ':' || scope, ',' order by role_code) from platform.ref_role_permissions
                           where permission_code = 'platform.person.hr_details'),
    'hr_manager:tenant', 'only the HR Manager holds it among the standard roles');
  perform tests.assert(private.member_has_permission(v_a, '00000000-0000-4000-8000-0000000000ab', 'platform.person.hr_details'),
    'uAB (HR Manager) holds it');
  perform tests.assert(private.member_has_permission(v_a, '00000000-0000-4000-8000-000000000c03', 'platform.person.hr_details'),
    'uS3 (custom role given it) holds it');
  perform tests.assert(not private.member_has_permission(v_a, '00000000-0000-4000-8000-0000000000a1', 'platform.person.hr_details'),
    'uA (Organization Admin) does NOT hold it');
  perform tests.assert(not private.member_has_permission(v_a, '00000000-0000-4000-8000-000000000c09', 'platform.person.hr_details'),
    'the second Organization Admin neither');
  perform tests.assert(not private.member_has_permission(v_a, '00000000-0000-4000-8000-000000000c06', 'platform.person.hr_details'),
    'the L&D Manager neither');
  perform tests.assert(not private.member_has_permission(v_a, '00000000-0000-4000-8000-000000000c01', 'platform.person.hr_details'),
    'an Employee neither');
  perform tests.assert(private.role_is_privileged(v_a, 'custom_a0000000b001'),
    'a custom role holding it is privileged: only the Organization Admin gives it');
  -- Grade managers: HR Manager and Organization Admin (platform.user.update), nobody else.
  perform tests.assert(private.member_has_permission(v_a, '00000000-0000-4000-8000-0000000000a1', 'platform.user.update')
                       and private.member_has_permission(v_a, '00000000-0000-4000-8000-0000000000ab', 'platform.user.update')
                       and not private.member_has_permission(v_a, '00000000-0000-4000-8000-000000000c06', 'platform.user.update'),
    'HR and the Organization Admin manage grades, the L&D Manager does not');
end $$;

-- The new tables: tenant-owned, RLS forced, no anon, the grants the design needs and no more.
do $$
declare
  v_t text;
begin
  foreach v_t in array array['platform.grades', 'platform.person_grades', 'platform.person_hr_details', 'platform.person_photos'] loop
    perform tests.assert((select relrowsecurity and relforcerowsecurity from pg_class where oid = v_t::regclass),
      v_t || ': RLS enabled and forced');
    perform tests.assert(not has_table_privilege('anon', v_t, 'select, insert, update, delete')
                         and not has_table_privilege('public', v_t, 'select, insert, update, delete'),
      v_t || ': nothing for anon or PUBLIC');
    perform tests.assert((select count(*) from pg_policy where polrelid = v_t::regclass and polname = 'tenant_isolation') = 1,
      v_t || ': tenant_isolation');
  end loop;
  -- Photos: members read the facts, never the bytes; nobody writes directly (file_guard's functions only).
  perform tests.assert(has_column_privilege('authenticated', 'platform.person_photos', 'sha256', 'select')
                       and has_column_privilege('authenticated', 'platform.person_photos', 'content', 'select'),
    'person_photos: facts and bytes are granted - the row policy (private.actor_sees_person) gates both');
  perform tests.assert((select count(*) from pg_policies where schemaname = 'platform' and tablename = 'person_photos'
                          and policyname = 'person_photos_read'
                          and qual like '%actor_sees_person%') = 1,
    'person_photos: the read policy asks who may see the person (BR-PPL-d)');
  perform tests.assert(not (select p.prosecdef from pg_proc p where p.oid = 'private.person_photo_content(uuid)'::regprocedure)
                       and not (select p.prosecdef from pg_proc p where p.oid = 'private.actor_sees_person(uuid,uuid)'::regprocedure),
    'photo reading is SECURITY INVOKER (row security applies to the caller)');
  perform tests.assert(not has_function_privilege('anon', 'private.actor_sees_person(uuid,uuid)', 'execute')
                       and not has_function_privilege('public', 'private.actor_sees_person(uuid,uuid)', 'execute')
                       and not has_function_privilege('anon', 'private.person_photo_content(uuid)', 'execute')
                       and not has_function_privilege('public', 'private.person_photo_content(uuid)', 'execute'),
    'photo reading: not callable by anon or PUBLIC');
  perform tests.assert(not has_table_privilege('authenticated', 'platform.person_photos', 'insert, update, delete')
                       and not has_any_column_privilege('authenticated', 'platform.person_photos', 'insert, update'),
    'person_photos: no direct writes');
  -- HR details: no delete, the person and organization are not updatable.
  perform tests.assert(not has_table_privilege('authenticated', 'platform.person_hr_details', 'delete')
                       and not has_column_privilege('authenticated', 'platform.person_hr_details', 'person_id', 'update')
                       and not has_column_privilege('authenticated', 'platform.person_hr_details', 'tenant_id', 'insert'),
    'person_hr_details: no delete, person and organization fixed');
  perform tests.assert(not has_column_privilege('authenticated', 'platform.grades', 'tenant_id', 'insert')
                       and not has_column_privilege('authenticated', 'platform.grades', 'tenant_id', 'update'),
    'grades: the organization is never named by the caller');
  for v_t in select unnest(array['private.publish_profile_photo(uuid,text,bigint,text,bytea)', 'private.remove_profile_photo()']) loop
    perform tests.assert((select p.prosecdef and pg_get_userbyid(p.proowner) = 'file_guard' from pg_proc p where p.oid = v_t::regprocedure),
      v_t || ': SECURITY DEFINER owned by file_guard');
    perform tests.assert(not has_function_privilege('anon', v_t, 'execute') and not has_function_privilege('public', v_t, 'execute'),
      v_t || ': not callable by anon or PUBLIC');
  end loop;
  -- The photo purpose: no scan, 2 MB, images only.
  perform tests.assert_eq((select scan_required::text || ':' || max_bytes::text || ':' || bucket from platform.file_purposes
                           where purpose = 'platform.profile_photo'), 'false:2097152:images', 'profile photo purpose: no scan, 2 MB');
end $$;

-- Checks on the values (as the owner: the rules of the data itself).
begin;
do $$
declare
  v_a constant uuid := 'a0000000-0000-4000-8000-000000000001';
  v_p constant uuid := 'a1000000-0000-4000-8000-000000000c04';
begin
  perform tests.assert_check_constraint(format($q$insert into platform.person_hr_details (tenant_id, person_id, gender) values (%L, %L, 'other')$q$, v_a, v_p),
    'person_hr_details_gender_check', 'gender: male or female');
  perform tests.assert_check_constraint(format($q$insert into platform.person_hr_details (tenant_id, person_id, employment_category) values (%L, %L, 'executive')$q$, v_a, v_p),
    'person_hr_details_category_check', 'category: the fixed four');
  perform tests.assert_check_constraint(format($q$insert into platform.person_hr_details (tenant_id, person_id, birth_date) values (%L, %L, current_date + 1)$q$, v_a, v_p),
    'person_hr_details_birth_date_check', 'date of birth in the future');
  perform tests.assert_check_constraint(format($q$insert into platform.person_hr_details (tenant_id, person_id, birth_date) values (%L, %L, date '1899-12-31')$q$, v_a, v_p),
    'person_hr_details_birth_date_check', 'date of birth before 1900');
  perform tests.assert_eq(tests.rows_affected(format($q$insert into platform.person_hr_details (tenant_id, person_id, gender, birth_date, employment_category) values (%L, %L, 'female', date '1990-02-28', 'operational')$q$, v_a, v_p)),
    1::bigint, 'a complete valid row');
  -- A person's record is fixed.
  perform tests.assert_fails(format($q$update platform.person_hr_details set person_id = 'a1000000-0000-4000-8000-000000000c05' where person_id = %L$q$, v_p),
    array['42501'], 'the person of HR details cannot change');
  -- Grade codes: letters, digits and punctuation; unique ignoring case; no spaces, no punctuation only.
  perform tests.assert_eq(tests.rows_affected(format($q$insert into platform.grades (tenant_id, code) values (%L, '#7'), (%L, 'G-7'), (%L, 'م٣'), (%L, '12.5')$q$, v_a, v_a, v_a, v_a)),
    4::bigint, 'codes may carry punctuation and Arabic letters');
  perform tests.assert_fails(format($q$insert into platform.grades (tenant_id, code) values (%L, 'g7')$q$, v_a),
    array['23505'], 'g7 is the same grade as G7');
  perform tests.assert_fails(format($q$insert into platform.grades (tenant_id, code) values (%L, '#7')$q$, v_a),
    array['23505'], 'a code is unique in the organization');
  perform tests.assert_eq(tests.rows_affected(format($q$insert into platform.grades (tenant_id, code) values ('b0000000-0000-4000-8000-000000000001', 'G7')$q$)),
    1::bigint, 'the same code in another organization is fine');
  perform tests.assert_check_constraint(format($q$insert into platform.grades (tenant_id, code) values (%L, 'G 7')$q$, v_a), 'grades_code_check', 'no spaces inside');
  perform tests.assert_check_constraint(format($q$insert into platform.grades (tenant_id, code) values (%L, ' G9')$q$, v_a), 'grades_code_check', 'no leading space');
  perform tests.assert_check_constraint(format($q$insert into platform.grades (tenant_id, code) values (%L, '---')$q$, v_a), 'grades_code_check', 'punctuation only says nothing');
  perform tests.assert_check_constraint(format($q$insert into platform.grades (tenant_id, code) values (%L, '')$q$, v_a), 'grades_code_check', 'not empty');
  perform tests.assert_check_constraint(format($q$insert into platform.grades (tenant_id, code) values (%L, 'ABCDEFGHIJKLM')$q$, v_a), 'grades_code_check', 'at most 12 characters');
  perform tests.assert_check_constraint(format($q$insert into platform.grades (tenant_id, code) values (%L, 'G%s7')$q$, v_a, chr(8238)), 'grades_code_check', 'no bidi override');
  perform tests.assert_check_constraint(format($q$insert into platform.grades (tenant_id, code) values (%L, 'G%s7')$q$, v_a, chr(9)), 'grades_code_check', 'no control characters');
  -- A grade people hold is not deleted; one nobody holds is.
  perform tests.assert_fails_state_like($q$delete from platform.grades where id = 'a8100000-0000-4000-8000-000000000001'$q$, 'JG001', '%held by 1 person%',
    'a grade people hold cannot be deleted');
  perform tests.assert_eq(tests.rows_affected(format($q$delete from platform.grades where tenant_id = %L and code = '12.5'$q$, v_a)), 1::bigint,
    'an unused grade is deleted');
  -- Another organization's grade is never a person's grade.
  perform tests.assert_fails(format($q$insert into platform.person_grades (tenant_id, person_id, grade_id) values (%L, %L, 'b8100000-0000-4000-8000-000000000001')$q$, v_a, v_p),
    array['23503'], 'a grade of another organization (composite foreign key)');
end $$;
rollback;

-- Housekeeping of photo uploads (the rule of 20261023100600, with person_photos): the raw object of an accepted
-- photo goes once its copy exists; an abandoned upload goes after a day; a deleted one at once.
begin;
alter table platform.files disable trigger files_transition;
update platform.files set status = 'accepted', status_reason = 'scan_not_required', detected_mime = 'image/png',
       size_bytes = octet_length(tests.brand_png()), sha256 = encode(sha256(tests.brand_png()), 'hex')
where id = 'f0a30000-0000-4000-8000-0000000000a1';
update platform.files set uploaded_at = now() - interval '2 days', created_at = now() - interval '2 days'
where id = 'f0a30000-0000-4000-8000-0000000000a3';
update platform.files set status = 'deleted', deleted_at = now() where id = 'f0a30000-0000-4000-8000-0000000000a2';
alter table platform.files enable trigger files_transition;
do $$
declare
  v_action text;
begin
  select private.file_housekeeping_action(f) into v_action from platform.files f where f.id = 'f0a30000-0000-4000-8000-0000000000a1';
  perform tests.assert_eq(coalesce(v_action, 'none'), 'none', 'an accepted photo without a copy keeps its object (nothing serves it yet)');
  insert into platform.person_photos (tenant_id, person_id, file_id, content_type, content, byte_size, sha256)
  values ('a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000c01', 'f0a30000-0000-4000-8000-0000000000a1',
          'image/png', tests.brand_png(), octet_length(tests.brand_png()), encode(sha256(tests.brand_png()), 'hex'));
  select private.file_housekeeping_action(f) into v_action from platform.files f where f.id = 'f0a30000-0000-4000-8000-0000000000a1';
  perform tests.assert_eq(v_action, 'remove_object', 'an accepted photo with its copy: the raw object is removed');
  select private.file_housekeeping_action(f) into v_action from platform.files f where f.id = 'f0a30000-0000-4000-8000-0000000000a3';
  perform tests.assert_eq(v_action, 'purge', 'an upload never published, older than a day: purged');
  select private.file_housekeeping_action(f) into v_action from platform.files f where f.id = 'f0a30000-0000-4000-8000-0000000000a2';
  perform tests.assert_eq(v_action, 'remove_object', 'a deleted photo: its object is removed');
end $$;
rollback;

\echo '99_people_1_owner: ok'
