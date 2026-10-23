-- db-test: run-as=owner
-- Fixtures for 99_people_1…3 (WP-ADM-04: profile photo, HR-only fields, grades), committed as platform
-- operations. They reuse the users of 65_security_fixtures_owner.sql (tenant A):
--   uS1 …c01 Employee   (person a1…c01): reports to uM2, holds grade 7, has two photo uploads (…p1, …p2)
--   uS2 …c02 Employee   (person a1…c02): sits in OPS, holds grade G7, has a photo upload (…p3)
--   uS3 …c03 «HR assistant» (custom role holding platform.person.hr_details, organization-wide)
--   uM1 …c04 Employee   no relation to anyone: sees nobody's grade
--   uM2 …c05 Employee   the manager of uS1
--   uM4 …c08 Employee   head of the unit OPS (department a3…03)
--   uM3 …c06 L&D Manager, uA2 …c09 second Organization Admin, uAB HR Manager, uA Organization Admin (00)
-- Photo uploads are written as `uploaded` (the write guard starts files as pending_upload: off for the insert),
-- each with Storage's object and its reported size (tests.brand_png(), 99_branding_0).
\set ON_ERROR_STOP on

-- The claims of the people above (user, session, person), by short name.
create or replace function tests.people_claims(p_who text) returns jsonb
language sql immutable as $$
  select case p_who
    when 'ua'  then tests.ua_claims()
    when 'uab' then tests.uab_claims()
    when 'a2'  then tests.user_claims('00000000-0000-4000-8000-000000000c09', '10000000-0000-4000-8000-000000000c91', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000c09')
    when 's1'  then tests.user_claims('00000000-0000-4000-8000-000000000c01', '10000000-0000-4000-8000-000000000c11', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000c01')
    when 's2'  then tests.user_claims('00000000-0000-4000-8000-000000000c02', '10000000-0000-4000-8000-000000000c21', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000c02')
    when 's3'  then tests.user_claims('00000000-0000-4000-8000-000000000c03', '10000000-0000-4000-8000-000000000c31', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000c03')
    when 'm1'  then tests.user_claims('00000000-0000-4000-8000-000000000c04', '10000000-0000-4000-8000-000000000c41', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000c04')
    when 'm2'  then tests.user_claims('00000000-0000-4000-8000-000000000c05', '10000000-0000-4000-8000-000000000c51', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000c05')
    when 'm3'  then tests.user_claims('00000000-0000-4000-8000-000000000c06', '10000000-0000-4000-8000-000000000c61', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000c06')
    when 'm4'  then tests.user_claims('00000000-0000-4000-8000-000000000c08', '10000000-0000-4000-8000-000000000c81', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000c08')
    when 'ub'  then tests.user_claims('00000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1', 'b0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-0000000000b1')
  end
$$;

begin;
-- The HR assistant: a custom role with the HR-only permission and the whole organization as its scope.
insert into platform.custom_roles (id, tenant_id, code, name_en, name_ar, description, data_scope) values
  ('a6000000-0000-4000-8000-0000000000b1', 'a0000000-0000-4000-8000-000000000001', 'custom_a0000000b001',
   'HR assistant', 'مساعد الموارد البشرية', null, 'organization');
insert into platform.custom_role_permissions (tenant_id, custom_role_id, permission_code) values
  ('a0000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-0000000000b1', 'platform.person.hr_details');
update platform.role_assignments ra set role_code = 'custom_a0000000b001'
from platform.tenant_memberships m
where m.id = ra.membership_id and m.tenant_id = 'a0000000-0000-4000-8000-000000000001'
  and m.user_id = '00000000-0000-4000-8000-000000000c03';

-- Placement: uS1 reports to uM2; uS2 sits in OPS, whose head is uM4.
insert into platform.person_employment (tenant_id, person_id, department_id, manager_person_id) values
  ('a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000c01', null, 'a1000000-0000-4000-8000-000000000c05'),
  ('a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000c02', 'a3000000-0000-4000-8000-000000000003', null);
update platform.departments set head_person_id = 'a1000000-0000-4000-8000-000000000c08'
where id = 'a3000000-0000-4000-8000-000000000003';

-- Grades: uS1 holds 7, uS2 holds G7 (uAB keeps the fixtures' G7, tenant B's uB holds its 7).
insert into platform.person_grades (tenant_id, person_id, grade_id) values
  ('a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000c01', 'a8100000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000c02', 'a8100000-0000-4000-8000-000000000002');

-- Photo uploads.
alter table platform.files disable trigger files_transition;
insert into platform.files (id, tenant_id, bucket, object_key, purpose, owner_module, owner_entity_type, owner_entity_id,
    original_name, declared_mime, declared_size, size_bytes, status, retention_class, created_by_user, upload_expires_at,
    uploaded_at)
select f.id, f.tenant_id, 'images',
       f.tenant_id::text || '/platform/person/' || f.person::text || '/' || f.id::text,
       f.purpose, 'platform', 'person', f.person, f.name, 'image/png', octet_length(tests.brand_png()),
       octet_length(tests.brand_png()), 'uploaded', 'owner_lifetime', f.uploader, now() + interval '15 minutes', now()
from (values
  -- uS1's two uploads (the second replaces the first)
  ('f0a30000-0000-4000-8000-0000000000a1'::uuid, 'a0000000-0000-4000-8000-000000000001'::uuid, 'a1000000-0000-4000-8000-000000000c01'::uuid, 'platform.profile_photo', 'first.png', '00000000-0000-4000-8000-000000000c01'::uuid),
  ('f0a30000-0000-4000-8000-0000000000a2', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000c01', 'platform.profile_photo', 'second.png', '00000000-0000-4000-8000-000000000c01'),
  -- uS2's upload
  ('f0a30000-0000-4000-8000-0000000000a3', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000c02', 'platform.profile_photo', 'other.png', '00000000-0000-4000-8000-000000000c02'),
  -- uS1 uploaded it, but for uS2's record (the owner entity is another person)
  ('f0a30000-0000-4000-8000-0000000000a4', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000c02', 'platform.profile_photo', 'forged.png', '00000000-0000-4000-8000-000000000c01'),
  -- uS1's upload of another purpose (a branding logo) under their own person
  ('f0a30000-0000-4000-8000-0000000000a5', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000c01', 'platform.brand_logo', 'logo.png', '00000000-0000-4000-8000-000000000c01'),
  -- tenant B: uB's upload
  ('f0b30000-0000-4000-8000-0000000000b1', 'b0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-0000000000b1', 'platform.profile_photo', 'b.png', '00000000-0000-4000-8000-0000000000b1')
) as f (id, tenant_id, person, purpose, name, uploader);
alter table platform.files enable trigger files_transition;
insert into storage.objects (bucket_id, name, owner, metadata)
select 'images', f.object_key, f.created_by_user, jsonb_build_object('size', octet_length(tests.brand_png()), 'mimetype', 'image/png')
from platform.files f where f.id::text like 'f0_30000-0000-4000-8000-0000000000%' and f.bucket = 'images' and f.status = 'uploaded';
commit;

\echo '99_people_0_fixtures_owner: ok'
