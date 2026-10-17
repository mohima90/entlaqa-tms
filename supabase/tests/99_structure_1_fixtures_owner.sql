-- db-test: run-as=owner
-- Fixtures for 99_structure_2_app_server.sql (EP-ORG; FR-ADM-05, FR-IAM-08; T-M3-02 / T-M3-09), committed
-- as platform operations:
--   tenant A  custom role custom_a000000c9001 «Branch L&D» — data scope «A department» (`departments`),
--             people read; held by nobody yet
--             a4…c9 pending invitation for scope@a.test with that role and the unit OPS ('tok-scope'), invited
--             by the Organization Admin uA; account uScope signed up after the e-mail (session sScope)
-- And the default level of a newly provisioned organization (rolled back).
\set ON_ERROR_STOP on

insert into platform.custom_roles (id, tenant_id, code, name_en, name_ar, description, data_scope) values
  ('a6000000-0000-4000-8000-0000000000c9', 'a0000000-0000-4000-8000-000000000001', 'custom_a000000c9001',
   'Branch L&D', 'تعلم الفرع', null, 'departments');
insert into platform.custom_role_permissions (tenant_id, custom_role_id, permission_code) values
  ('a0000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-0000000000c9', 'platform.user.read'),
  ('a0000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-0000000000c9', 'platform.org.read');

insert into platform.persons (id, tenant_id, display_name_ar, display_name_en, email) values
  ('a1000000-0000-4000-8000-0000000000c9', 'a0000000-0000-4000-8000-000000000001', 'نطاق', 'Scope', 'scope@a.test');
insert into platform.invitations (id, tenant_id, person_id, email, locale, primary_role, additional_roles, invited_by,
                                  scope_unit_id) values
  ('a4000000-0000-4000-8000-0000000000c9', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000c9',
   'scope@a.test', 'en', 'custom_a000000c9001', '{}', '00000000-0000-4000-8000-0000000000a1',
   'a3000000-0000-4000-8000-000000000003');
update platform.invitations set token_hash = tests.token_hash('tok-scope') where id = 'a4000000-0000-4000-8000-0000000000c9';
insert into auth.users (id, email, created_at) values
  ('00000000-0000-4000-8000-0000000000c9', 'scope@a.test', clock_timestamp() + interval '1 second');  -- uScope
insert into auth.sessions (id, user_id, not_after) values
  ('10000000-0000-4000-8000-0000000000c9', '00000000-0000-4000-8000-0000000000c9', null);            -- sScope

-- A newly provisioned organization starts with ONE level, Department / «إدارة» (tenant trigger; the Super
-- Admin console's path: 95_platform_admin_owner.sql).
begin;
insert into platform.tenants (id, slug, name_ar, name_en, status)
values ('e0000000-0000-4000-8000-0000000000c9', 'tenant-levels', 'منشأة المستويات', 'Levels', 'active');
do $$
begin
  perform tests.assert_eq((select string_agg(l.ordinal || ':' || l.name_en || ':' || l.name_ar, ',' order by l.ordinal)
                           from platform.structure_levels l where l.tenant_id = 'e0000000-0000-4000-8000-0000000000c9'),
    '1:Department:إدارة', 'a new organization starts with one level, Department / إدارة');
  insert into platform.departments (id, tenant_id, code, name_ar)
  values ('e3000000-0000-4000-8000-0000000000c9', 'e0000000-0000-4000-8000-0000000000c9', 'TOP', 'أعلى');
  perform tests.assert_eq((select level_ordinal from platform.departments where id = 'e3000000-0000-4000-8000-0000000000c9'),
    1::smallint, 'a top unit is at level 1');
  perform tests.assert_fails($q$insert into platform.departments (tenant_id, code, name_ar, parent_id) values ('e0000000-0000-4000-8000-0000000000c9', 'SUB', 'فرعي', 'e3000000-0000-4000-8000-0000000000c9')$q$,
    array['JO001'], 'with one level, no unit sits under another (platform operations too)');
end $$;
rollback;

\echo '99_structure_1_fixtures_owner: ok'
