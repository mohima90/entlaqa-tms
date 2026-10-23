-- db-test: run-as=app_server
-- Profile photo, HR-only fields and grades as the web app sees them (WP-ADM-04; FR-IAM-16, FR-IAM-01,
-- FR-IAM-02; business flow EP-PEOPLE-photo-hr-fields, PO answers 21 and 23 Oct 2026). Runs CONNECTED AS
-- app_server (fixtures: 00, 65, 99_people_0): who reads and writes HR-only fields, who manages and who sees
-- grades, and the publishing, replacing, removing and delivery of photos. Cross-tenant cases throughout.
\set ON_ERROR_STOP on

do $$ begin perform tests.assert(session_user = 'app_server', 'must run connected as app_server'); end $$;

-- ---------------------------------------------------------------------------------------------------
-- HR-only fields: the person (read-only) and permission holders (read and write); nobody else
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
do $$
declare
  v_s1 constant uuid := 'a1000000-0000-4000-8000-000000000c01';
  v_ua constant uuid := 'a1000000-0000-4000-8000-0000000000a1';
  v_uab constant uuid := 'a1000000-0000-4000-8000-0000000000ab';
begin
  -- The HR Manager: every row of the organization (fixtures: uA, uAB), none of tenant B.
  perform tests.set_claims(tests.people_claims('uab'));
  perform tests.assert_eq((select count(*) from platform.person_hr_details), 2::bigint, 'HR Manager reads the HR details of A');
  perform tests.assert_eq((select count(*) from platform.person_hr_details where tenant_id <> 'a0000000-0000-4000-8000-000000000001'), 0::bigint,
    'never another organization''s');
  -- … writes them for anyone: an employee, and the privileged Organization Admin (BR-PPL-f).
  perform tests.assert_eq(tests.rows_affected(format($q$insert into platform.person_hr_details (person_id, gender, birth_date, employment_category) values (%L, 'female', date '1995-07-01', 'professional')$q$, v_s1)),
    1::bigint, 'HR Manager fills an employee''s HR details');
  perform tests.assert_eq((select updated_by::text || ':' || version::text from platform.person_hr_details where person_id = v_s1),
    v_uab::text || ':1', 'stamped from the claims');
  perform tests.assert_eq(tests.rows_affected(format($q$update platform.person_hr_details set employment_category = 'management' where person_id = %L$q$, v_ua)),
    1::bigint, 'HR Manager changes the Organization Admin''s HR details (they give no access)');
  perform tests.assert_eq((select version from platform.person_hr_details where person_id = v_ua), 2, 'version increments');
  -- A first save that races another one (the row now exists) updates instead of failing on the key.
  perform tests.assert_eq(tests.rows_affected(format($q$insert into platform.person_hr_details (person_id, gender) values (%L, 'male') on conflict (tenant_id, person_id) do update set gender = excluded.gender$q$, v_ua)),
    1::bigint, 'insert ... on conflict updates the existing row');
  perform tests.assert_eq((select gender from platform.person_hr_details where person_id = v_ua), 'male', 'and keeps one row per person');
  -- A person of tenant B or a tenant named by the caller: refused.
  perform tests.assert_fails($q$insert into platform.person_hr_details (person_id, gender) values ('b1000000-0000-4000-8000-0000000000b9', 'male')$q$,
    array['23503'], 'a person of another organization (composite foreign key)');
  perform tests.assert_privilege_denied($q$insert into platform.person_hr_details (tenant_id, person_id, gender) values ('b0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-0000000000b9', 'male')$q$,
    'the organization is not insertable');
  perform tests.assert_eq(tests.rows_affected($q$update platform.person_hr_details set gender = 'male' where tenant_id = 'b0000000-0000-4000-8000-000000000001'$q$),
    0::bigint, 'RLS filters tenant B''s rows on update');
  perform tests.assert_privilege_denied($q$delete from platform.person_hr_details$q$, 'no delete');

  -- The HR assistant (custom role with the permission): the same as HR.
  perform tests.set_claims(tests.people_claims('s3'));
  perform tests.assert_eq((select count(*) from platform.person_hr_details), 3::bigint, 'the custom role holder reads them all');
  perform tests.assert_eq(tests.rows_affected(format($q$update platform.person_hr_details set gender = 'male' where person_id = %L$q$, v_s1)),
    1::bigint, 'and changes them');

  -- The Organization Admin does not hold the permission: only their own row, read-only.
  perform tests.set_claims(tests.people_claims('ua'));
  perform tests.assert_eq((select count(*) from platform.person_hr_details), 1::bigint, 'the Organization Admin reads their own row only');
  perform tests.assert_eq((select person_id from platform.person_hr_details), v_ua, 'which is their own');
  perform tests.assert_eq(tests.rows_affected(format($q$update platform.person_hr_details set gender = 'female' where person_id = %L$q$, v_uab)),
    0::bigint, 'the Organization Admin cannot change HR details of others');
  perform tests.assert_eq(tests.rows_affected(format($q$update platform.person_hr_details set gender = 'female' where person_id = %L$q$, v_ua)),
    0::bigint, 'nor their own (no permission)');
  perform tests.assert_rls_violation(format($q$insert into platform.person_hr_details (person_id, gender) values (%L, 'male')$q$, 'a1000000-0000-4000-8000-000000000c04'),
    'the Organization Admin cannot fill HR details');

  -- The L&D Manager and an Employee: nothing of others; an employee sees their own and cannot change it.
  perform tests.set_claims(tests.people_claims('m3'));
  perform tests.assert_eq((select count(*) from platform.person_hr_details), 0::bigint, 'the L&D Manager reads none');
  perform tests.assert_rls_violation(format($q$insert into platform.person_hr_details (person_id, gender) values (%L, 'male')$q$, 'a1000000-0000-4000-8000-000000000c04'),
    'the L&D Manager cannot fill HR details');
  perform tests.set_claims(tests.people_claims('s1'));
  perform tests.assert_eq((select count(*) from platform.person_hr_details), 1::bigint, 'an employee reads their own HR details');
  perform tests.assert_eq((select person_id from platform.person_hr_details), v_s1, 'only their own');
  perform tests.assert_eq(tests.rows_affected(format($q$update platform.person_hr_details set gender = 'female' where person_id = %L$q$, v_s1)),
    0::bigint, 'and cannot change them');
  perform tests.set_claims(tests.people_claims('s2'));
  perform tests.assert_eq((select count(*) from platform.person_hr_details), 0::bigint, 'an employee without a row sees none');
  perform tests.assert_rls_violation(format($q$insert into platform.person_hr_details (person_id, gender) values (%L, 'male')$q$, 'a1000000-0000-4000-8000-000000000c02'),
    'an employee cannot fill their own HR details');
  -- Tenant B: its own row only, none of A's.
  perform tests.set_claims(tests.people_claims('ub'));
  perform tests.assert_eq((select person_id::text from platform.person_hr_details), 'b1000000-0000-4000-8000-0000000000b1',
    'tenant B''s Organization Admin: their own row only, none of A''s');
end $$;
rollback;

-- Generic check as the HR Manager (the Organization Admin is exempt in 20_isolation.sql): sees own organization's
-- rows only, cannot touch tenant B's.
begin;
set local role authenticated;
do $$
begin
  perform tests.set_claims(tests.people_claims('uab'));
  perform tests.assert((select count(*) from platform.person_hr_details) > 0, 'HR Manager sees A''s HR details');
  perform tests.assert_eq((select count(*) from platform.person_hr_details where tenant_id <> 'a0000000-0000-4000-8000-000000000001'), 0::bigint,
    'and no other organization''s');
  perform tests.assert_eq(tests.rows_affected($q$delete from platform.person_grades where tenant_id = 'b0000000-0000-4000-8000-000000000001'$q$), 0::bigint,
    'person_grades: HR cannot delete tenant B''s rows');
  perform tests.assert((select count(*) from platform.person_grades) > 0, 'HR Manager sees A''s grade assignments');
  perform tests.assert_eq((select count(*) from platform.person_grades where tenant_id <> 'a0000000-0000-4000-8000-000000000001'), 0::bigint,
    'and no other organization''s');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Grades: managed by HR and the Organization Admin; the codes are read by every member
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
do $$
declare
  v_s2 constant uuid := 'a1000000-0000-4000-8000-000000000c02';
  v_ua constant uuid := 'a1000000-0000-4000-8000-0000000000a1';
begin
  -- Every member reads the codes of their own organization.
  perform tests.set_claims(tests.people_claims('m3'));
  perform tests.assert_eq((select count(*) from platform.grades), 2::bigint, 'the L&D Manager reads the list (7, G7)');
  -- … but cannot change it.
  perform tests.assert_rls_violation($q$insert into platform.grades (code) values ('X1')$q$, 'the L&D Manager cannot add a grade');
  perform tests.assert_eq(tests.rows_affected($q$update platform.grades set code = 'Z' where code = '7'$q$), 0::bigint, 'nor rename one');
  perform tests.assert_eq(tests.rows_affected($q$delete from platform.grades$q$), 0::bigint, 'nor delete one');
  perform tests.set_claims(tests.people_claims('s1'));
  perform tests.assert_rls_violation($q$insert into platform.grades (code) values ('X1')$q$, 'an employee cannot add a grade');
  -- HR adds, renames and tries to delete.
  perform tests.set_claims(tests.people_claims('uab'));
  perform tests.assert_eq(tests.rows_affected($q$insert into platform.grades (code) values ('#8'), ('G-9')$q$), 2::bigint, 'HR adds grades with punctuation');
  perform tests.assert_fails($q$insert into platform.grades (code) values ('g7')$q$, array['23505'], 'a duplicate (any case) is refused');
  perform tests.assert_eq(tests.rows_affected($q$update platform.grades set code = '8' where code = '#8'$q$), 1::bigint, 'HR renames a grade');
  perform tests.assert_eq((select version from platform.grades where code = '8'), 2, 'stamped');
  perform tests.assert_fails_state_like($q$delete from platform.grades where code = 'G7'$q$, 'JG001', '%held by%',
    'a grade people still hold is not deleted');
  perform tests.assert_eq(tests.rows_affected($q$delete from platform.grades where code = '8'$q$), 1::bigint, 'an unused one is deleted');
  perform tests.assert_privilege_denied($q$insert into platform.grades (tenant_id, code) values ('b0000000-0000-4000-8000-000000000001', 'EVIL')$q$, 'never names the organization');
  perform tests.assert_eq(tests.rows_affected($q$update platform.grades set code = 'EVIL' where tenant_id = 'b0000000-0000-4000-8000-000000000001'$q$), 0::bigint,
    'RLS filters tenant B''s grades');
  -- The Organization Admin manages the list too (PO 23 Oct 2026 #4).
  perform tests.set_claims(tests.people_claims('ua'));
  perform tests.assert_eq(tests.rows_affected($q$insert into platform.grades (code) values ('A1')$q$), 1::bigint, 'the Organization Admin adds a grade');
  perform tests.assert_eq(tests.rows_affected($q$delete from platform.grades where code = 'A1'$q$), 1::bigint, 'and deletes it');
  -- Tenant B sees its own list only.
  perform tests.set_claims(tests.people_claims('ub'));
  perform tests.assert_eq((select string_agg(code, ',') from platform.grades), '7', 'tenant B reads its own grade only');

  -- Setting a person's grade: HR and the Organization Admin (also for a privileged member); nobody else.
  perform tests.set_claims(tests.people_claims('uab'));
  perform tests.assert_eq(tests.rows_affected(format($q$insert into platform.person_grades (person_id, grade_id) values (%L, 'a8100000-0000-4000-8000-000000000002')$q$, v_ua)),
    1::bigint, 'HR sets the grade of the Organization Admin (a privileged member)');
  perform tests.assert_eq(tests.rows_affected(format($q$insert into platform.person_grades (person_id, grade_id) values (%L, 'a8100000-0000-4000-8000-000000000001') on conflict (tenant_id, person_id) do update set grade_id = excluded.grade_id$q$, v_ua)),
    1::bigint, 'a first assignment that races another one updates instead of failing');
  perform tests.assert_eq((select count(*) from platform.person_grades where person_id = v_ua), 1::bigint, 'one grade per person');
  perform tests.assert_eq(tests.rows_affected(format($q$update platform.person_grades set grade_id = 'a8100000-0000-4000-8000-000000000001' where person_id = %L$q$, v_s2)),
    1::bigint, 'HR changes an employee''s grade');
  perform tests.assert_eq(tests.rows_affected(format($q$delete from platform.person_grades where person_id = %L$q$, v_s2)), 1::bigint, 'and clears it');
  perform tests.assert_fails(format($q$insert into platform.person_grades (person_id, grade_id) values (%L, 'b8100000-0000-4000-8000-000000000001')$q$, v_s2),
    array['23503'], 'a grade of another organization (composite foreign key)');
  perform tests.assert_fails($q$insert into platform.person_grades (person_id, grade_id) values ('b1000000-0000-4000-8000-0000000000b9', 'a8100000-0000-4000-8000-000000000001')$q$,
    array['23503'], 'a person of another organization (composite foreign key)');
  perform tests.assert_privilege_denied($q$update platform.person_grades set person_id = 'a1000000-0000-4000-8000-000000000c04'$q$, 'the person of an assignment is fixed');
  perform tests.set_claims(tests.people_claims('ua'));
  perform tests.assert_eq(tests.rows_affected(format($q$insert into platform.person_grades (person_id, grade_id) values (%L, 'a8100000-0000-4000-8000-000000000001')$q$, v_s2)),
    1::bigint, 'the Organization Admin sets a grade');
  perform tests.set_claims(tests.people_claims('m3'));
  perform tests.assert_rls_violation(format($q$insert into platform.person_grades (person_id, grade_id) values (%L, 'a8100000-0000-4000-8000-000000000001')$q$, 'a1000000-0000-4000-8000-000000000c04'),
    'the L&D Manager cannot set grades');
  perform tests.set_claims(tests.people_claims('s1'));
  perform tests.assert_rls_violation(format($q$insert into platform.person_grades (person_id, grade_id) values (%L, 'a8100000-0000-4000-8000-000000000002')$q$, 'a1000000-0000-4000-8000-000000000c01'),
    'an employee cannot set their own grade (it is held already: HR sets it, an insert is refused)');
  perform tests.assert_eq(tests.rows_affected($q$update platform.person_grades set grade_id = 'a8100000-0000-4000-8000-000000000002'$q$), 0::bigint,
    'nor change it');
end $$;
rollback;

-- Who SEES a grade: the person, HR, the Organization Admin, the managers above them and the heads of their
-- unit (fixtures: uS1 holds 7 and reports to uM2; uS2 holds G7 in OPS, headed by uM4; uAB holds G7).
begin;
set local role authenticated;
do $$
declare
  v_s1 constant uuid := 'a1000000-0000-4000-8000-000000000c01';
  v_s2 constant uuid := 'a1000000-0000-4000-8000-000000000c02';
begin
  perform tests.set_claims(tests.people_claims('s1'));
  perform tests.assert_eq((select string_agg(person_id::text, ',') from platform.person_grades), v_s1::text, 'an employee sees their own grade only');
  perform tests.set_claims(tests.people_claims('s2'));
  perform tests.assert_eq((select string_agg(person_id::text, ',') from platform.person_grades), v_s2::text, 'another employee: theirs only');
  perform tests.set_claims(tests.people_claims('m2'));
  perform tests.assert_eq((select string_agg(person_id::text, ',') from platform.person_grades), v_s1::text, 'the manager sees the grade of their report');
  perform tests.set_claims(tests.people_claims('m4'));
  perform tests.assert_eq((select string_agg(person_id::text, ',') from platform.person_grades), v_s2::text, 'the head of the unit sees the grade of its member');
  perform tests.set_claims(tests.people_claims('m1'));
  perform tests.assert_eq((select count(*) from platform.person_grades), 0::bigint, 'a stranger sees none');
  perform tests.set_claims(tests.people_claims('m3'));
  perform tests.assert_eq((select count(*) from platform.person_grades), 0::bigint, 'the L&D Manager sees none');
  perform tests.set_claims(tests.people_claims('s3'));
  perform tests.assert_eq((select count(*) from platform.person_grades), 0::bigint, 'the HR-details role without user.update sees none (not a grade role)');
  perform tests.set_claims(tests.people_claims('uab'));
  perform tests.assert_eq((select count(*) from platform.person_grades), 3::bigint, 'HR sees all of A (uAB, uS1, uS2)');
  perform tests.set_claims(tests.people_claims('ua'));
  perform tests.assert_eq((select count(*) from platform.person_grades), 3::bigint, 'the Organization Admin sees all of A');
  perform tests.set_claims(tests.people_claims('ub'));
  perform tests.assert_eq((select count(*) from platform.person_grades), 1::bigint, 'tenant B''s Organization Admin sees B''s only');
  perform tests.assert_eq((select count(*) from platform.person_grades where tenant_id <> 'b0000000-0000-4000-8000-000000000001'), 0::bigint, 'none of A''s');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Photos: publish (own upload only), replace (the old one deleted), remove, deliver
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
do $$
declare
  v_png constant bytea := tests.brand_png();
  v_sha constant text := encode(sha256(tests.brand_png()), 'hex');
  v_size constant bigint := octet_length(tests.brand_png());
  r record;
begin
  -- uS1 publishes their first upload: accepted, a copy, named in the answer.
  perform tests.set_claims(tests.people_claims('s1'));
  select * into r from private.publish_profile_photo('f0a30000-0000-4000-8000-0000000000a1', v_sha, v_size, 'image/png', v_png);
  perform tests.assert_eq(r.file_name || ':' || r.replaced::text, 'first.png:false', 'first photo: name returned, nothing replaced');
  perform tests.assert_eq((select status from platform.files where id = 'f0a30000-0000-4000-8000-0000000000a1'), 'accepted', 'the upload is accepted (no scan)');
  perform tests.assert_eq((select file_id from platform.person_photos where person_id = 'a1000000-0000-4000-8000-000000000c01'),
    'f0a30000-0000-4000-8000-0000000000a1'::uuid, 'a copy exists for uS1');
  -- Idempotent: the same file again changes nothing.
  perform tests.assert_eq((select replaced from private.publish_profile_photo('f0a30000-0000-4000-8000-0000000000a1', v_sha, v_size, 'image/png', v_png)),
    false, 'publishing the same file again replaces nothing');
  -- A member reads a photo only for a person they may see (BR-PPL-d); the person always their own.
  perform tests.assert_eq((select sha256 from platform.person_photos where person_id = 'a1000000-0000-4000-8000-000000000c01'), v_sha, 'the SHA-256 is readable (cache key)');
  perform tests.assert_eq((select content from platform.person_photos where person_id = 'a1000000-0000-4000-8000-000000000c01'), v_png,
    'the person reads their own bytes through the table');
  perform tests.assert_privilege_denied($q$insert into platform.person_photos (person_id, file_id, content_type, content, byte_size, sha256) values ('a1000000-0000-4000-8000-000000000c01', 'f0a30000-0000-4000-8000-0000000000a2', 'image/png', '\x89504e47', 4, repeat('a', 64))$q$,
    'no direct insert');
  perform tests.assert_privilege_denied($q$delete from platform.person_photos$q$, 'no direct delete');

  -- Refusals: someone else's upload, an upload for someone else's record, another purpose, another organization.
  perform tests.assert_fails_state_like(format('select * from private.publish_profile_photo(%L, %L, %s, %L, %L::bytea)', 'f0a30000-0000-4000-8000-0000000000a3', v_sha, v_size, 'image/png', v_png),
    'JP001', '%not a usable upload%', 'not another person''s upload');
  perform tests.assert_fails_state_like(format('select * from private.publish_profile_photo(%L, %L, %s, %L, %L::bytea)', 'f0a30000-0000-4000-8000-0000000000a4', v_sha, v_size, 'image/png', v_png),
    'JP001', '%not a usable upload%', 'not an upload made for another person''s record (own photo only)');
  perform tests.assert_fails_state_like(format('select * from private.publish_profile_photo(%L, %L, %s, %L, %L::bytea)', 'f0a30000-0000-4000-8000-0000000000a5', v_sha, v_size, 'image/png', v_png),
    'JP001', '%not a usable upload%', 'not a file of another purpose');
  perform tests.assert_fails_state_like(format('select * from private.publish_profile_photo(%L, %L, %s, %L, %L::bytea)', 'f0b30000-0000-4000-8000-0000000000b1', v_sha, v_size, 'image/png', v_png),
    'JP001', '%not a usable upload%', 'not another organization''s file');
  perform tests.assert_fails_state_like(format('select * from private.publish_profile_photo(%L, %L, %s, %L, %L::bytea)', gen_random_uuid(), v_sha, v_size, 'image/png', v_png),
    'JP001', '%not a usable upload%', 'not an unknown file');
  -- The bytes must be the stored object's and an allowed type.
  perform tests.assert_fails_state_like(format('select * from private.publish_profile_photo(%L, %L, %s, %L, %L::bytea)', 'f0a30000-0000-4000-8000-0000000000a2', v_sha, v_size, 'image/svg+xml', v_png),
    'JB003', '%not an allowed image type%', 'no SVG');
  perform tests.assert_fails_state_like(format('select * from private.publish_profile_photo(%L, %L, %s, %L, %L::bytea)', 'f0a30000-0000-4000-8000-0000000000a2', v_sha, v_size, 'image/webp', v_png),
    'JB002', '%differs from the stored file%', 'a PNG is not a WebP');
  perform tests.assert_fails_state_like(format('select * from private.publish_profile_photo(%L, %L, %s, %L, %L::bytea)', 'f0a30000-0000-4000-8000-0000000000a2', v_sha, v_size + 1, 'image/png', v_png),
    'JB002', '%differs from the stored file%', 'a size that is not the stored object''s');
  perform tests.assert_fails_state_like(format('select * from private.publish_profile_photo(%L, %L, %s, %L, %L::bytea)', 'f0a30000-0000-4000-8000-0000000000a2', 'nothex', v_size, 'image/png', v_png),
    'JB002', '%differs from the stored file%', 'a malformed hash');
  perform tests.assert_fails_state_like(format('select * from private.publish_profile_photo(%L, %L, %s, %L, %L::bytea)', 'f0a30000-0000-4000-8000-0000000000a2', v_sha, v_size, 'image/png', '\x00112233'::bytea),
    'JB002', '%differs from the stored file%', 'bytes without a PNG signature');
  perform tests.assert_eq((select count(*) from platform.person_photos where person_id = 'a1000000-0000-4000-8000-000000000c01'), 1::bigint, 'the failed attempts left the photo as it was');

  -- Replace: the second upload, the first file deleted and its copy gone.
  select * into r from private.publish_profile_photo('f0a30000-0000-4000-8000-0000000000a2', v_sha, v_size, 'image/png', v_png);
  perform tests.assert_eq(r.file_name || ':' || r.replaced::text, 'second.png:true', 'replacing names the new file and says so');
  perform tests.assert_eq((select status from platform.files where id = 'f0a30000-0000-4000-8000-0000000000a1'), 'deleted', 'the old photo file is deleted');
  perform tests.assert_eq((select file_id from platform.person_photos where person_id = 'a1000000-0000-4000-8000-000000000c01'),
    'f0a30000-0000-4000-8000-0000000000a2'::uuid, 'the copy is the new one');
  perform tests.assert_eq((select count(*) from platform.person_photos where person_id = 'a1000000-0000-4000-8000-000000000c01'), 1::bigint, 'one photo per person');

  -- Delivery follows who may see the person (BR-PPL-d, security review M1): the person, a member with
  -- platform.user.read for the whole organization, one whose scoped read covers the person; nobody else.
  perform tests.assert_eq((select count(*) from private.person_photo_content('a1000000-0000-4000-8000-000000000c01')), 1::bigint, 'the person gets their own photo');
  perform tests.set_claims(tests.people_claims('m3'));
  perform tests.assert_eq((select count(*) from private.person_photo_content('a1000000-0000-4000-8000-000000000c01')), 1::bigint, 'an organization-wide reader gets the bytes');
  perform tests.assert_eq((select content from private.person_photo_content('a1000000-0000-4000-8000-000000000c01')), v_png, 'the bytes of the copy');
  perform tests.assert_eq((select count(*) from platform.person_photos where person_id = 'a1000000-0000-4000-8000-000000000c01'), 1::bigint, 'and the row');
  perform tests.assert_eq((select count(*) from private.person_photo_content('a1000000-0000-4000-8000-000000000c02')), 0::bigint, 'nothing for a person without a photo');
  -- uS2 has a photo too (inside OPS).
  perform tests.set_claims(tests.people_claims('s2'));
  perform tests.assert_eq((select replaced from private.publish_profile_photo('f0a30000-0000-4000-8000-0000000000a3', v_sha, v_size, 'image/png', v_png)),
    false, 'uS2 publishes a photo');
  -- uM1 (custom role, data scope «A department» = OPS): uS2 sits in OPS, uS1 in no unit.
  perform tests.set_claims(tests.people_claims('m1'));
  perform tests.assert_eq((select count(*) from private.person_photo_content('a1000000-0000-4000-8000-000000000c02')), 1::bigint, 'a department-limited member gets a photo inside the unit');
  perform tests.assert_eq((select count(*) from platform.person_photos where person_id = 'a1000000-0000-4000-8000-000000000c02'), 1::bigint, 'and sees its row');
  perform tests.assert_eq((select count(*) from private.person_photo_content('a1000000-0000-4000-8000-000000000c01')), 0::bigint, 'a department-limited member is refused a photo outside the unit');
  perform tests.assert_eq((select count(*) from platform.person_photos where person_id = 'a1000000-0000-4000-8000-000000000c01'), 0::bigint, 'and does not even see its row (version, size, hash)');
  perform tests.assert_eq((select count(*) from platform.person_photos), 1::bigint, 'only the photos inside the unit are visible');
  -- uM2 (custom role, data scope «My team»): uS1 reports to uM2, uS2 does not.
  perform tests.set_claims(tests.people_claims('m2'));
  perform tests.assert_eq((select count(*) from private.person_photo_content('a1000000-0000-4000-8000-000000000c01')), 1::bigint, 'a team-limited member gets a direct report''s photo');
  perform tests.assert_eq((select count(*) from private.person_photo_content('a1000000-0000-4000-8000-000000000c02')), 0::bigint, 'and not that of someone outside the team');
  -- uM4 (an Employee: own data only) sees nobody else's photo, not even in the unit they head.
  perform tests.set_claims(tests.people_claims('m4'));
  perform tests.assert_eq((select count(*) from private.person_photo_content('a1000000-0000-4000-8000-000000000c02')), 0::bigint, 'an Employee does not get a colleague''s photo');
  perform tests.assert_eq((select count(*) from platform.person_photos), 0::bigint, 'nor their rows');
  -- uS2 removes theirs again (the remaining checks start from uS1's photo alone).
  perform tests.set_claims(tests.people_claims('s2'));
  perform tests.assert_eq((select file_name from private.remove_profile_photo()), 'other.png', 'uS2 removes their photo');
  perform tests.set_claims(tests.people_claims('ub'));
  perform tests.assert_eq((select count(*) from private.person_photo_content('a1000000-0000-4000-8000-000000000c01')), 0::bigint, 'never to another organization');
  perform tests.assert_eq((select count(*) from private.person_photo_content('b1000000-0000-4000-8000-0000000000b1')), 1::bigint, 'B reads B''s own photo (fixture)');
  perform tests.set_claims(jsonb_build_object('role', 'system', 'tenant_id', 'a0000000-0000-4000-8000-000000000001', 'job_id', 'tests.photo'));
  perform tests.assert_eq((select count(*) from private.person_photo_content('a1000000-0000-4000-8000-000000000c01')), 0::bigint, 'never to a job or a claim-less caller');
  perform tests.assert_fails(format('select * from private.publish_profile_photo(%L, %L, %s, %L, %L::bytea)', 'f0a30000-0000-4000-8000-0000000000a3', v_sha, v_size, 'image/png', v_png),
    array['42501'], 'a job cannot publish a photo');

  -- uS2 cannot remove uS1's photo (remove works on the caller's own only); uS2 has none: nothing happens.
  perform tests.set_claims(tests.people_claims('s2'));
  perform tests.assert_eq((select count(*) from private.remove_profile_photo()), 0::bigint, 'removing when there is no photo changes nothing');
  perform tests.set_claims(tests.people_claims('m3'));
  perform tests.assert_eq((select count(*) from platform.person_photos where person_id = 'a1000000-0000-4000-8000-000000000c01'), 1::bigint, 'uS1''s photo is untouched');
  -- Remove: own photo, file deleted, name returned.
  perform tests.set_claims(tests.people_claims('s1'));
  perform tests.assert_eq((select file_name from private.remove_profile_photo()), 'second.png', 'remove returns the file name');
  perform tests.assert_eq((select count(*) from platform.person_photos where person_id = 'a1000000-0000-4000-8000-000000000c01'), 0::bigint, 'the copy is gone');
  perform tests.assert_eq((select status from platform.files where id = 'f0a30000-0000-4000-8000-0000000000a2'), 'deleted', 'the file is deleted');
  perform tests.assert_eq((select count(*) from private.remove_profile_photo()), 0::bigint, 'a second removal does nothing');
  -- The generic checks: the photo list of tenant A's people never holds B's.
  perform tests.assert_eq((select count(*) from platform.person_photos where tenant_id <> 'a0000000-0000-4000-8000-000000000001'), 0::bigint, 'only A''s photos');
end $$;
rollback;

\echo '99_people_2_app_server: ok'
