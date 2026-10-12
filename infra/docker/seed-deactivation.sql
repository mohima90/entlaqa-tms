-- Sample members for the deactivate / reactivate E2E (infra/docker/smoke.sh, T-M2-09): run as postgres after
-- seed-users.sql. :deact_user (Reem) is a Line Manager with a direct report (Yasser, no account) who heads
-- the Quality department — her deactivation hands both over; :second_user (Huda) is a Learner with nothing
-- to hand over. Both are real logins (create-user.mjs). Faisal is an Auditor (a privileged role) with a
-- bare login row (he never signs in): deactivating him needs an authenticator code. Sample data only.
\set ON_ERROR_STOP on
begin;
create temporary table seed_ctx on commit drop as
  select m.tenant_id, m.person_id as admin_person
  from platform.tenant_memberships m where m.user_id = :'admin_user';

insert into platform.persons (id, tenant_id, display_name_ar, display_name_en, email, employee_number)
  select '5eed1000-0000-4000-8000-0000000000d1'::uuid, tenant_id, 'ريم ناصر العتيبي', 'Reem Nasser Alotaibi',
         :'deact_email', 'EMP-4101' from seed_ctx
  union all
  select '5eed1000-0000-4000-8000-0000000000d2'::uuid, tenant_id, 'هدى علي القرني', 'Huda Ali Alqarni',
         :'second_email', 'EMP-4102' from seed_ctx
  union all
  select '5eed1000-0000-4000-8000-0000000000d3'::uuid, tenant_id, 'ياسر محمد الغامدي', 'Yasser Mohammed Alghamdi',
         null, 'EMP-4103' from seed_ctx
  union all
  select '5eed1000-0000-4000-8000-0000000000d4'::uuid, tenant_id, 'فيصل عمر الحربي', 'Faisal Omar Alharbi',
         'sample.faisal@sovereign.example', 'EMP-4104' from seed_ctx;

insert into auth.users (id, email, aud, role) values
  ('5eed0000-0000-4000-8000-0000000000d4', 'sample.faisal@sovereign.example', 'authenticated', 'authenticated');

insert into platform.tenant_memberships (tenant_id, user_id, person_id, status)
  select tenant_id, :'deact_user'::uuid, '5eed1000-0000-4000-8000-0000000000d1'::uuid, 'active' from seed_ctx
  union all
  select tenant_id, :'second_user'::uuid, '5eed1000-0000-4000-8000-0000000000d2'::uuid, 'active' from seed_ctx
  union all
  select tenant_id, '5eed0000-0000-4000-8000-0000000000d4'::uuid, '5eed1000-0000-4000-8000-0000000000d4'::uuid, 'active'
  from seed_ctx;

-- Reem and Huda report to the Organization Admin; Yasser reports to Reem.
insert into platform.person_employment (tenant_id, person_id, department_id, manager_person_id)
  select s.tenant_id, p.id, d.id, case when p.id = '5eed1000-0000-4000-8000-0000000000d3'
                                       then '5eed1000-0000-4000-8000-0000000000d1'::uuid
                                       else s.admin_person end
  from seed_ctx s
  join platform.departments d on d.tenant_id = s.tenant_id and d.code = 'TRN'
  join platform.persons p on p.tenant_id = s.tenant_id
   and p.id in ('5eed1000-0000-4000-8000-0000000000d1', '5eed1000-0000-4000-8000-0000000000d2',
                '5eed1000-0000-4000-8000-0000000000d3');

-- Reem heads Quality.
insert into platform.departments (tenant_id, code, name_ar, name_en, parent_id, head_person_id)
  select s.tenant_id, 'QLT', 'الجودة', 'Quality', d.id, '5eed1000-0000-4000-8000-0000000000d1'::uuid
  from seed_ctx s join platform.departments d on d.tenant_id = s.tenant_id and d.code = 'TRN';

insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary)
  select m.tenant_id, m.id, r.code, r.is_primary
  from platform.tenant_memberships m
  join (values (:'deact_user'::uuid, 'line_manager', true),
               (:'deact_user'::uuid, 'learner', false),
               (:'second_user'::uuid, 'learner', true),
               ('5eed0000-0000-4000-8000-0000000000d4'::uuid, 'auditor', true)) as r (user_id, code, is_primary)
    on r.user_id = m.user_id;
commit;
