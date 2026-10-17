-- db-test: run-as=owner
-- Needs-form fixtures (T-M3-10) for 99_needs_forms_1_app_server.sql and 99_needs_forms_2_owner.sql, committed
-- as platform operations: in tenant A an L&D Manager uLnd (…71, session sLnd …71, person a1…71) and a Training
-- Coordinator uTc (…72, session …72, person a1…72). Forms: 00_helpers_and_fixtures.sql (the seeded default
-- form of every tenant; «Fixture form» a7…01 / b7…01).
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000071', 'lnd@a.test'),
  ('00000000-0000-4000-8000-000000000072', 'coordinator@a.test');
insert into auth.sessions (id, user_id, not_after) values
  ('10000000-0000-4000-8000-000000000071', '00000000-0000-4000-8000-000000000071', null),
  ('10000000-0000-4000-8000-000000000072', '00000000-0000-4000-8000-000000000072', null);
insert into platform.persons (id, tenant_id, display_name_ar, display_name_en, email) values
  ('a1000000-0000-4000-8000-000000000071', 'a0000000-0000-4000-8000-000000000001', 'مدير التعلم', 'L&D Manager', 'lnd@a.test'),
  ('a1000000-0000-4000-8000-000000000072', 'a0000000-0000-4000-8000-000000000001', 'منسق التدريب', 'Coordinator', 'coordinator@a.test');
insert into platform.tenant_memberships (tenant_id, user_id, person_id, status) values
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000071', 'a1000000-0000-4000-8000-000000000071', 'active'),
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000072', 'a1000000-0000-4000-8000-000000000072', 'active');
insert into platform.session_context (session_id, user_id, active_tenant_id) values
  ('10000000-0000-4000-8000-000000000071', '00000000-0000-4000-8000-000000000071', 'a0000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000072', '00000000-0000-4000-8000-000000000072', 'a0000000-0000-4000-8000-000000000001');
insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary)
select m.tenant_id, m.id, r.role_code, true
from (values ('00000000-0000-4000-8000-000000000071'::uuid, 'training_manager'),
             ('00000000-0000-4000-8000-000000000072', 'training_coordinator')) as r (user_id, role_code)
join platform.tenant_memberships m on m.tenant_id = 'a0000000-0000-4000-8000-000000000001' and m.user_id = r.user_id;

do $$
begin
  perform tests.assert(private.member_has_permission('a0000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000071', 'tms.needs_form.manage'), 'the L&D Manager designs needs forms');
  perform tests.assert(not private.member_has_permission('a0000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000072', 'tms.needs_form.manage'), 'the Training Coordinator does not');
  perform tests.assert(private.member_has_permission('a0000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000072', 'tms.needs_form.read'), 'the Training Coordinator reads them');
  perform tests.assert(not private.member_has_permission('a0000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-0000000000a1', 'tms.needs_form.read'), 'the Organization Admin holds no training permission');
  -- Who can give what (PO, 17 Oct 2026; migration 20261020200000): the HR Manager (uAB) holds no needs-form
  -- permission and still gives the L&D Manager and Training Coordinator roles (ordinary roles).
  perform tests.assert(not private.member_has_permission('a0000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-0000000000ab', 'tms.needs_form.read'), 'the HR Manager holds no needs-form permission');
  perform tests.assert(private.member_may_give_roles('a0000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-0000000000ab', array['training_manager']),
    'the HR Manager gives the L&D Manager role');
  perform tests.assert(private.member_may_give_roles('a0000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-0000000000ab', array['training_coordinator']),
    'the HR Manager gives the Training Coordinator role');
  perform tests.assert(private.member_may_give_roles('a0000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-0000000000ab', array['department_head']), 'the HR Manager still gives ordinary roles');
  perform tests.assert(not private.member_may_give_roles('a0000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-0000000000ab', array['hr_manager']), 'still no privileged role');
  perform tests.assert(not private.member_may_give_roles('a0000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000071', array['learner']), 'the L&D Manager gives no role');
end $$;

\echo '99_needs_forms_0_fixtures: ok'
