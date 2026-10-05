-- Sample people for the users-pages E2E (infra/docker/smoke.sh, T-M2-04): run as postgres after the
-- smoke organization is provisioned. :admin_user is the provisioned Organization Admin. Sample data only.
\set ON_ERROR_STOP on
begin;
create temporary table seed_ctx on commit drop as
  select m.tenant_id, m.person_id as admin_person
  from platform.tenant_memberships m where m.user_id = :'admin_user';

insert into platform.branches (tenant_id, code, name_ar, name_en, is_headquarters)
  select tenant_id, 'RUH', 'فرع الرياض', 'Riyadh branch', true from seed_ctx;
insert into platform.departments (tenant_id, code, name_ar, name_en, head_person_id)
  select tenant_id, 'TRN', 'التدريب والتطوير', 'Training and development', admin_person from seed_ctx;
insert into platform.departments (tenant_id, code, name_ar, name_en, parent_id)
  select s.tenant_id, 'ACD', 'الأكاديمية', 'Academy', d.id
  from seed_ctx s join platform.departments d on d.tenant_id = s.tenant_id and d.code = 'TRN';

-- Login accounts for the sample members (they never sign in).
insert into auth.users (id, email, aud, role) values
  ('5eed0000-0000-4000-8000-000000000001', 'sample.sara@sovereign.example', 'authenticated', 'authenticated'),
  ('5eed0000-0000-4000-8000-000000000002', 'sample.khalid@sovereign.example', 'authenticated', 'authenticated');

insert into platform.persons (id, tenant_id, display_name_ar, display_name_en, email, employee_number, mobile_e164)
  select '5eed1000-0000-4000-8000-000000000001'::uuid, tenant_id, 'سارة عبدالله القحطاني', 'Sarah Abdullah Alqahtani',
         'sample.sara@sovereign.example', 'EMP-1187', '+966551234567' from seed_ctx
  union all
  select '5eed1000-0000-4000-8000-000000000002'::uuid, tenant_id, 'خالد إبراهيم الشهري', null,
         'sample.khalid@sovereign.example', 'EMP-2040', null from seed_ctx;

insert into platform.tenant_memberships (tenant_id, user_id, person_id, status)
  select tenant_id, '5eed0000-0000-4000-8000-000000000001'::uuid, '5eed1000-0000-4000-8000-000000000001'::uuid, 'active' from seed_ctx
  union all
  select tenant_id, '5eed0000-0000-4000-8000-000000000002'::uuid, '5eed1000-0000-4000-8000-000000000002'::uuid, 'invited' from seed_ctx;

insert into platform.person_employment (tenant_id, person_id, department_id, branch_id, manager_person_id, job_title_ar, job_title_en, hire_on)
  select s.tenant_id, '5eed1000-0000-4000-8000-000000000001', d.id, b.id, s.admin_person, 'أخصائية تدريب', 'Training specialist', '2024-03-03'
  from seed_ctx s
  join platform.departments d on d.tenant_id = s.tenant_id and d.code = 'ACD'
  join platform.branches b on b.tenant_id = s.tenant_id and b.code = 'RUH';

insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary)
  select m.tenant_id, m.id, r.code, r.is_primary
  from platform.tenant_memberships m,
       (values ('training_coordinator', true), ('learner', false)) as r (code, is_primary)
  where m.user_id = '5eed0000-0000-4000-8000-000000000001';
commit;
