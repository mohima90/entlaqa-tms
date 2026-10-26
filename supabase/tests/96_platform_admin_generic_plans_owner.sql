-- db-test: run-as=owner
-- «Create organization» on a busy database (FR-ADM-17, WP-ADM-06; migration 20261103100500): with cached
-- GENERIC plans — what a pooled production connection uses after a few executions — the Super Admin creates an
-- organization, its default needs form is seeded (the field guard's subqueries are privilege-checked then),
-- and it starts on a plan, as a trial or active, in the same transaction as the console does. Before the
-- migration this failed with 42501 on tms.needs_form_fields in production only (custom plans fold the guard's
-- UPDATE-only subquery away). Fixtures: 00_helpers_and_fixtures.sql, 95_platform_admin_owner.sql (Super Admin
-- uP …f1, valid session …fa01). Runs as the owner and switches to app_server. Rolled back.
\set ON_ERROR_STOP on

begin;
set local plan_cache_mode = force_generic_plan;
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000f1', '10000000-0000-4000-8000-00000000fa01', null));
do $$
declare
  v_plan uuid;
  v_tenant uuid;
  r record;
begin
  select p.plan_id into v_plan from private.platform_save_plan(null, 'Generic plans', null, 10, 1, '{}', null) p;
  for r in
    select * from (values ('generic-a', 'en', 'trial'), ('generic-b', 'ar', 'active')) as v (slug, locale, status)
  loop
    select t.tenant_id into v_tenant
    from private.platform_create_tenant(r.slug, 'منظمة', 'Organization', r.slug || '@example.test',
                                        null, null, 'Mona', 'Ahmed', r.locale) t;
    perform private.platform_set_tenant_plan(v_tenant, v_plan, r.status,
                                             case when r.status = 'trial' then now() + interval '30 days' end, null, null);
  end loop;
end $$;
reset role;
reset session authorization;
do $$
declare
  r record;
begin
  for r in
    select t.slug, t.status, p.name as plan_name,
           (select count(*) from tms.needs_form_fields f where f.tenant_id = t.id) as fields
    from platform.tenants t left join private.plans p on p.id = t.plan_id
    where t.slug in ('generic-a', 'generic-b')
  loop
    perform tests.assert_eq(r.fields, 10::bigint, r.slug || ': the default needs form is seeded (ten fields)');
    perform tests.assert_eq(r.plan_name, 'Generic plans', r.slug || ': on its plan');
    perform tests.assert_eq(r.status, case r.slug when 'generic-a' then 'trial' else 'active' end, r.slug || ': its status');
  end loop;
  perform tests.assert((select count(*) = 2 from platform.tenants where slug in ('generic-a', 'generic-b')),
    'both organizations were created');
end $$;
rollback;
