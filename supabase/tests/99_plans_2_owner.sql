-- db-test: run-as=owner
-- Plans, limits and the organization's status (WP-ADM-06, migration 20261027100000), the callers: the console
-- (plans, an organization's plan, status, trial and special limits) refuses everyone but a signed-in Super
-- Admin, validates its input in the database and audits every change (the platform's trail and the
-- organization's own); the Organization Admin sees the plan, status, limits and usage (read-only), nobody else
-- of the organization does; every member gets the features the organization has; the trial expiry is the
-- worker's alone; the organization's own e-mail provider and colours count only while its plan includes them.
-- Fixtures: 00_helpers_and_fixtures.sql, 95_platform_admin_owner.sql (Super Admin uP …f1, session …fa01).
-- Runs as the owner and switches to the login roles. Every block is rolled back.
\set ON_ERROR_STOP on

create function pg_temp.super_claims() returns jsonb language sql immutable as $$
  select tests.user_claims('00000000-0000-4000-8000-0000000000f1', '10000000-0000-4000-8000-00000000fa01', null);
$$;

-- ---------------------------------------------------------------------------------------------------
-- Everyone else is refused
-- ---------------------------------------------------------------------------------------------------
begin;
set local session authorization app_server;
set local role authenticated;
do $$
declare
  c record;
begin
  for c in
    select * from (values
      ('no claims', null::jsonb),
      ('Organization Admin of A', tests.ua_claims()),
      ('an account without organizations',
        tests.user_claims('00000000-0000-4000-8000-0000000000e1', '10000000-0000-4000-8000-0000000000e1', null)),
      ('the Super Admin with an expired session',
        tests.user_claims('00000000-0000-4000-8000-0000000000f1', '10000000-0000-4000-8000-00000000fa09', null)),
      ('system claims', jsonb_build_object('sub', '00000000-0000-4000-8000-0000000000f1', 'role', 'system',
        'session_id', '10000000-0000-4000-8000-00000000fa01', 'job_id', 'tests.job'))
    ) as v (who, claims)
  loop
    perform tests.set_claims(c.claims);
    perform tests.assert_fails($q$select * from private.platform_list_plans()$q$, array['42501'], c.who || ': no plans');
    perform tests.assert_fails($q$select * from private.platform_save_plan(null, 'Denied', null, 10, 1, '{}', null)$q$,
      array['42501'], c.who || ': cannot create a plan');
    perform tests.assert_fails($q$select * from private.platform_tenant_plans()$q$, array['42501'],
      c.who || ': no organizations'' plans');
    perform tests.assert_fails(
      $q$select private.platform_set_tenant_plan('a0000000-0000-4000-8000-000000000001', null, 'suspended', null, null, null)$q$,
      array['42501'], c.who || ': cannot suspend an organization');
    perform tests.assert_fails($q$select private.expire_trials()$q$, array['42501'], c.who || ': no trial expiry');
    perform tests.assert_privilege_denied($q$select * from private.plans$q$, c.who || ': no plans table');
    perform tests.assert_privilege_denied($q$select private.tenant_people_used('a0000000-0000-4000-8000-000000000001')$q$,
      c.who || ': no usage helper');
  end loop;
  -- The Organization Admin cannot change the plan columns directly either.
  perform tests.set_claims(tests.ua_claims());
  perform tests.assert_privilege_denied(
    $q$update platform.tenants set status = 'active', plan_id = null where id = 'a0000000-0000-4000-8000-000000000001'$q$,
    'the Organization Admin cannot change the plan or status');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- The Super Admin: plans
-- ---------------------------------------------------------------------------------------------------
begin;
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(pg_temp.super_claims());
do $$
declare
  r record;
  v_plan uuid;
  v_bad record;
begin
  select * into r from private.platform_save_plan(null, '  Starter  ', '  Small teams ', 50, 5,
                                                  array['courses', 'planning', 'courses'], null);
  v_plan := r.plan_id;
  perform tests.assert_eq(r.version, 1, 'created at version 1');
  select * into r from private.platform_list_plans() p where p.plan_id = v_plan;
  perform tests.assert(r.name = 'Starter' and r.description = 'Small teams' and r.max_people = 50 and r.max_storage_gb = 5
                       and r.features = array['planning', 'courses'] and r.tenant_count = 0,
    'trimmed; features once, in the product''s order');
  for v_bad in
    select * from (values
      ('name', $q$select * from private.platform_save_plan(null, '   ', null, null, null, null, null)$q$),
      ('name', $q$select * from private.platform_save_plan(null, repeat('n', 81), null, null, null, null, null)$q$),
      ('name', $q$select * from private.platform_save_plan(null, E'Bad\nname', null, null, null, null, null)$q$),
      ('description', $q$select * from private.platform_save_plan(null, 'Plan', repeat('d', 201), null, null, null, null)$q$),
      ('max_people', $q$select * from private.platform_save_plan(null, 'Plan', null, 0, null, null, null)$q$),
      ('max_storage_gb', $q$select * from private.platform_save_plan(null, 'Plan', null, null, 100001, null, null)$q$),
      ('features', $q$select * from private.platform_save_plan(null, 'Plan', null, null, null, array['payroll'], null)$q$),
      ('features', $q$select * from private.platform_save_plan(null, 'Plan', null, null, null, array[null::text], null)$q$),
      ('plan', $q$select * from private.platform_save_plan(gen_random_uuid(), 'Plan', null, null, null, null, 1)$q$)
    ) as v (field, sql)
  loop
    perform tests.assert_fails_state_like(v_bad.sql, 'JP001', v_bad.field, 'invalid ' || v_bad.field || ' refused');
  end loop;
  perform tests.assert_fails_state_like($q$select * from private.platform_save_plan(null, 'STARTER', null, null, null, null, null)$q$,
    'JP006', '%taken%', 'a plan name is unique whatever the case');
  select * into r from private.platform_save_plan(v_plan, 'Starter plus', null, null, 10, '{}', 1);
  perform tests.assert_eq(r.version, 2, 'an update makes a new version');
  perform tests.assert_fails_state_like(
    format($q$select * from private.platform_save_plan(%L, 'Starter', null, null, null, null, 1)$q$, v_plan),
    'JP007', '%someone else%', 'an update of an older version is refused');
  perform tests.assert_fails_state_like(
    format($q$select * from private.platform_save_plan(%L, 'Starter', null, null, null, null, null)$q$, v_plan),
    'JP007', '%someone else%', 'an update needs the version');
  select * into r from private.platform_list_plans() p where p.plan_id = v_plan;
  perform tests.assert(r.name = 'Starter plus' and r.description is null and r.max_people is null and r.max_storage_gb = 10
                       and r.features = '{}', 'the update saved');
end $$;
reset role;
reset session authorization;
do $$
begin
  perform tests.assert_eq((select string_agg(e.action || ':' || e.actor_user_id, ', ' order by e.occurred_at, e.action)
                           from private.platform_audit_events e where e.entity_type = 'plan'),
    'platform.plan.created:00000000-0000-4000-8000-0000000000f1, platform.plan.updated:00000000-0000-4000-8000-0000000000f1',
    'every plan change is in the platform''s trail');
  perform tests.assert((select e.data -> 'before' ->> 'name' = 'Starter' and e.data -> 'after' ->> 'name' = 'Starter plus'
                        from private.platform_audit_events e where e.action = 'platform.plan.updated'),
    'with before and after');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- The Super Admin: an organization's plan, status, trial and special limits
-- ---------------------------------------------------------------------------------------------------
begin;
insert into private.plans (id, name, max_people, max_storage_gb, features)
values ('e2000000-0000-4000-8000-000000000001', 'Growth', 200, 50, '{planning,courses}');
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(pg_temp.super_claims());
do $$
declare
  r record;
  v_bad record;
begin
  for v_bad in
    select * from (values
      ('tenant', $q$select private.platform_set_tenant_plan(gen_random_uuid(), null, 'active', null, null, null)$q$),
      ('plan', $q$select private.platform_set_tenant_plan('a0000000-0000-4000-8000-000000000001', gen_random_uuid(), 'active', null, null, null)$q$),
      ('status', $q$select private.platform_set_tenant_plan('a0000000-0000-4000-8000-000000000001', null, 'paused', null, null, null)$q$),
      ('status', $q$select private.platform_set_tenant_plan('a0000000-0000-4000-8000-000000000001', null, null, null, null, null)$q$),
      ('trial_ends_at', $q$select private.platform_set_tenant_plan('a0000000-0000-4000-8000-000000000001', null, 'trial', null, null, null)$q$),
      ('trial_ends_at', $q$select private.platform_set_tenant_plan('a0000000-0000-4000-8000-000000000001', null, 'active', now() + interval '1 day', null, null)$q$),
      ('trial_ends_at', $q$select private.platform_set_tenant_plan('a0000000-0000-4000-8000-000000000001', null, 'trial', now() - interval '1 day', null, null)$q$),
      ('trial_ends_at', $q$select private.platform_set_tenant_plan('a0000000-0000-4000-8000-000000000001', null, 'trial', now() + interval '2 years', null, null)$q$),
      ('max_people_override', $q$select private.platform_set_tenant_plan('a0000000-0000-4000-8000-000000000001', null, 'active', null, 0, null)$q$),
      ('max_storage_gb_override', $q$select private.platform_set_tenant_plan('a0000000-0000-4000-8000-000000000001', null, 'active', null, null, -1)$q$)
    ) as v (field, sql)
  loop
    perform tests.assert_fails_state_like(v_bad.sql, 'JP001', v_bad.field, 'invalid ' || v_bad.field || ' refused');
  end loop;
  -- Unchanged: nothing written.
  perform private.platform_set_tenant_plan('a0000000-0000-4000-8000-000000000001', null, 'active', null, null, null);
  perform private.platform_set_tenant_plan('a0000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001',
                                           'trial', now() + interval '30 days', 300, null);
  select * into r from private.platform_tenant_plans() t where t.tenant_id = 'a0000000-0000-4000-8000-000000000001';
  perform tests.assert(r.plan_name = 'Growth' and r.status = 'trial' and r.trial_ends_at > now() + interval '29 days'
                       and r.max_people_override = 300 and r.max_people = 300 and r.max_storage_gb = 50
                       and r.people_used >= 3 and r.storage_used_bytes >= 0,
    'the plan, the trial, the special limit winning over the plan''s, the usage');
  select * into r from private.platform_tenant_plans() t where t.tenant_id = 'b0000000-0000-4000-8000-000000000001';
  perform tests.assert(r.plan_id is null and r.status = 'active' and r.max_people is null, 'another organization unchanged');
  perform tests.assert_eq((select tenant_count from private.platform_list_plans() p
                           where p.plan_id = 'e2000000-0000-4000-8000-000000000001'), 1, 'the plan counts its organizations');
end $$;
reset role;
reset session authorization;
do $$
begin
  perform tests.assert((select t.plan_id = 'e2000000-0000-4000-8000-000000000001' and t.status = 'trial'
                        from platform.tenants t where t.id = 'a0000000-0000-4000-8000-000000000001'), 'saved');
  perform tests.assert_eq((select count(*) from private.platform_audit_events e
                           where e.action = 'platform.tenant.plan_changed' and e.tenant_id = 'a0000000-0000-4000-8000-000000000001'
                             and e.actor_user_id = '00000000-0000-4000-8000-0000000000f1'
                             and e.data -> 'before' ->> 'status' = 'active' and e.data -> 'after' ->> 'status' = 'trial'),
    1::bigint, 'one change in the platform''s trail (the unchanged call wrote nothing)');
  perform tests.assert_eq((select count(*) from platform.audit_events e
                           where e.action = 'platform.tenant.plan_changed' and e.tenant_id = 'a0000000-0000-4000-8000-000000000001'
                             and e.actor_user_id = '00000000-0000-4000-8000-0000000000f1' and e.actor_person_id is null),
    1::bigint, 'and in the organization''s own trail');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- The Organization Admin's view; what every member's organization has
-- ---------------------------------------------------------------------------------------------------
begin;
insert into private.plans (id, name, description, max_people, max_storage_gb, features)
values ('e2000000-0000-4000-8000-000000000002', 'Team', 'For one team', 25, 2, '{courses,bulk_import}');
update platform.tenants set plan_id = 'e2000000-0000-4000-8000-000000000002', status = 'trial',
                            trial_ends_at = now() + interval '10 days'
where id = 'a0000000-0000-4000-8000-000000000001';
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(tests.ua_claims());
do $$
declare
  r record;
begin
  select * into r from private.organization_plan();
  perform tests.assert(r.has_plan and r.plan_name = 'Team' and r.plan_description = 'For one team' and r.status = 'trial'
                       and r.trial_ends_at > now() + interval '9 days' and r.max_people = 25 and r.people_used >= 3
                       and r.max_storage_gb = 2 and r.storage_used_bytes >= 0 and r.features = array['courses', 'bulk_import'],
    'the Organization Admin sees the plan, the status, the limits and the usage');
  perform tests.assert_eq(private.current_tenant_features(), array['courses', 'bulk_import'], 'the organization''s features');
end $$;
select tests.set_claims(tests.uab_claims());
do $$
begin
  perform tests.assert_fails($q$select * from private.organization_plan()$q$, array['42501'],
    'the HR Manager does not see the plan');
  perform tests.assert_eq(private.current_tenant_features(), array['courses', 'bulk_import'],
    'every member gets the features (menus)');
end $$;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1',
                                          'b0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-0000000000b1'));
do $$
declare
  r record;
begin
  select * into r from private.organization_plan();
  perform tests.assert(not r.has_plan and r.plan_name is null and r.max_people is null and r.max_storage_gb is null
                       and r.features = array['planning', 'needs_forms', 'courses', 'bulk_import', 'branding', 'email_integration'],
    'no plan: everything, no limits (the Organization Admin of B sees B only)');
end $$;
select tests.set_claims(null);
do $$
begin
  perform tests.assert_fails($q$select * from private.organization_plan()$q$, array['42501'], 'no claims: refused');
  perform tests.assert_fails($q$select private.current_tenant_features()$q$, array['42501'], 'no claims: no features');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Trials that ended: the worker suspends them
-- ---------------------------------------------------------------------------------------------------
begin;
update platform.tenants set trial_ends_at = now() + interval '1 hour' where id = 'd0000000-0000-4000-8000-000000000001';
update platform.tenants set status = 'trial', trial_ends_at = now() + interval '1 hour'
where id = 'a0000000-0000-4000-8000-000000000001';
-- D's trial ended a minute ago (owner: the date is in the past only for the test).
update platform.tenants set trial_ends_at = now() - interval '1 minute' where id = 'd0000000-0000-4000-8000-000000000001';
set local session authorization app_worker;
set local role authenticated;
select tests.set_claims(jsonb_build_object('role', 'system', 'job_id', 'tests.trials'));
do $$
begin
  perform tests.assert_eq(private.expire_trials(), 1, 'one trial ended');
  perform tests.assert_eq(private.expire_trials(), 0, 'and only once');
end $$;
reset role;
reset session authorization;
do $$
begin
  perform tests.assert((select status = 'suspended' and trial_ends_at is null from platform.tenants
                        where id = 'd0000000-0000-4000-8000-000000000001'), 'the ended trial is suspended');
  perform tests.assert((select status = 'trial' and trial_ends_at is not null from platform.tenants
                        where id = 'a0000000-0000-4000-8000-000000000001'), 'a running trial is not');
  perform tests.assert_eq((select count(*) from private.platform_audit_events
                           where action = 'platform.tenant.trial_ended' and tenant_id = 'd0000000-0000-4000-8000-000000000001'),
    1::bigint, 'in the platform''s trail');
  perform tests.assert_eq((select count(*) from platform.audit_events
                           where action = 'platform.tenant.trial_ended' and tenant_id = 'd0000000-0000-4000-8000-000000000001'),
    1::bigint, 'and in the organization''s');
end $$;
rollback;

begin;
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(jsonb_build_object('role', 'system', 'job_id', 'tests.trials'));
do $$
begin
  perform tests.assert_fails($q$select private.expire_trials()$q$, array['42501'], 'the web app does not end trials');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- The organization's own e-mail provider and colours: only while its plan includes them
-- ---------------------------------------------------------------------------------------------------
begin;
insert into private.tenant_email_settings (tenant_id, provider, credentials_sealed, from_name, from_address, enabled, status,
                                           verified_at)
values ('a0000000-0000-4000-8000-000000000001', 'resend', 'v1.abcdefghijkl.' || repeat('A', 64), 'Tenant A', 'hr@a.test',
        true, 'verified', now())
on conflict (tenant_id) do update set enabled = true, status = 'verified', verified_at = now();
update platform.tenant_branding set primary_color = '#1E3A5F', secondary_color = '#2C5282', email_action_color = '#1E3A5F',
                                    email_link_color = '#1E3A5F'
where tenant_id = 'a0000000-0000-4000-8000-000000000001';
insert into private.plans (id, name, features) values ('e2000000-0000-4000-8000-000000000003', 'Plain', '{courses}');
-- The sign-in page's look (review M3): the organization's own colours only while the plan includes branding.
set local session authorization app_server;
set local role authenticated;
do $$
begin
  perform tests.assert_eq((select primary_color from private.public_tenant_brand('tenant-a')), '#1E3A5F',
    'no plan: the organization''s own look on its sign-in page');
end $$;
reset role;
reset session authorization;
update platform.tenants set plan_id = 'e2000000-0000-4000-8000-000000000003' where id = 'a0000000-0000-4000-8000-000000000001';
set local session authorization app_server;
set local role authenticated;
do $$
begin
  perform tests.assert_eq((select primary_color from private.public_tenant_brand('tenant-a')), null::text,
    'branding not in the plan: the Jadarat look on the sign-in page');
end $$;
reset role;
reset session authorization;
update platform.tenants set plan_id = null where id = 'a0000000-0000-4000-8000-000000000001';
-- The Auth e-mail route (reachable by the mail guards only): the same plan conditions as the worker's route.
do $$
begin
  perform tests.assert((select prosrc like '%s.enabled and s.status = ''verified'' and private.tenant_has_feature(t.id, ''email_integration'')%'
                               and prosrc like '%platform.tenant_branding b on b.tenant_id = t.id and private.tenant_has_feature(t.id, ''branding'')%'
                        from pg_proc where oid = 'private.auth_mail_route(uuid)'::regprocedure),
    'auth_mail_route: the organization''s provider and colours only while the plan includes them');
end $$;
set local session authorization app_worker;
set local role authenticated;
select tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001', 'tests.mail'));
do $$
begin
  perform tests.assert_eq((select r.tenant_enabled from private.email_route() r), true,
    'no plan: the worker''s sender uses the organization''s provider');
end $$;
reset role;
reset session authorization;
update platform.tenants set plan_id = 'e2000000-0000-4000-8000-000000000003' where id = 'a0000000-0000-4000-8000-000000000001';
set local session authorization app_worker;
set local role authenticated;
select tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001', 'tests.mail'));
do $$
begin
  perform tests.assert_eq((select r.tenant_enabled from private.email_route() r), false,
    'the worker''s sender: the platform''s sender too');
end $$;
rollback;
