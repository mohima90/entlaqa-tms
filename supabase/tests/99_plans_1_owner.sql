-- db-test: run-as=owner
-- Plans, limits and the organization's status (WP-ADM-06, migrations 20261027100000–100100): the guard role and
-- what it may reach; a feature the plan does not include is held by nobody (member_permissions) and refused
-- where it is written (bulk import, branding, own e-mail provider); the people limit refuses an invitation, a
-- new account or a reactivation over the limit (each person once; expired invitations and suspended members do
-- not count; the organization's own limit wins over the plan's; no plan, no limit), the storage limit a new
-- file over the limit; another organization is never affected. Runs as the owner and switches to the login
-- roles. Every block is rolled back.
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------------------------------
-- The role and its reach (catalog)
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  v_list text;
  v_role text;
begin
  perform tests.assert(not (select rolbypassrls or rolcanlogin or rolsuper or rolinherit or rolcreaterole or rolcreatedb
                            from pg_roles where rolname = 'plan_guard'),
    'plan_guard must be NOLOGIN NOINHERIT and not BYPASSRLS / superuser / createrole / createdb');
  perform tests.assert(not exists (select 1 from pg_auth_members m join pg_roles u on u.oid = m.member
                                   where m.roleid = 'plan_guard'::regrole and (m.inherit_option or m.set_option)
                                     and not u.rolsuper and u.rolname <> current_user),
    'nobody acts as plan_guard');
  perform tests.assert(not has_schema_privilege('plan_guard', 'private', 'CREATE')
                       and not has_schema_privilege('plan_guard', 'platform', 'CREATE')
                       and not exists (select 1 from pg_class c where c.relowner = 'plan_guard'::regrole),
    'plan_guard creates and owns no relations');
  select string_agg(format('%s%s', p.oid::regprocedure, case when p.prosecdef then ' (definer)' else '' end), ', '
                    order by p.oid::regprocedure::text collate "C") into v_list
  from pg_proc p where p.proowner = 'plan_guard'::regrole;
  perform tests.assert_eq(v_list,
    'private.current_tenant_features() (definer), private.enforce_people_limit() (definer), '
    'private.enforce_plan_feature() (definer), private.enforce_storage_limit() (definer), '
    'private.expire_trials() (definer), private.organization_plan() (definer), '
    'private.platform_list_plans() (definer), '
    'private.platform_save_plan(uuid,text,text,integer,integer,text[],integer) (definer), '
    'private.platform_set_tenant_plan(uuid,uuid,text,timestamp with time zone,integer,integer) (definer), '
    'private.platform_tenant_plans() (definer), private.tenant_has_feature(uuid,text) (definer), '
    'private.tenant_limits(uuid), private.tenant_people_used(uuid), '
    'private.tenant_plan_features(uuid) (definer), private.tenant_storage_used(uuid)',
    'plan_guard owns the plan functions only');
  perform tests.assert((select bool_and(exists (select 1 from unnest(p.proconfig) c where c in ('search_path=""', 'search_path=')))
                        from pg_proc p where p.proowner = 'plan_guard'::regrole),
    'every plan function has an empty search_path');
  -- EXECUTE: exactly who needs each function.
  for v_list in
    select format('%s → %s', p.oid::regprocedure, string_agg(distinct case when a.grantee = 0 then 'PUBLIC'
                                                                         else pg_get_userbyid(a.grantee) end, ',' order by
                                                                    case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end))
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.proowner = 'plan_guard'::regrole and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner
    group by p.oid
  loop
    perform tests.assert(v_list in (
      'private.current_tenant_features() → authenticated',
      'private.organization_plan() → authenticated',
      'private.platform_list_plans() → authenticated',
      'private.platform_save_plan(uuid,text,text,integer,integer,text[],integer) → authenticated',
      'private.platform_set_tenant_plan(uuid,uuid,text,timestamp with time zone,integer,integer) → authenticated',
      'private.platform_tenant_plans() → authenticated',
      'private.expire_trials() → authenticated',
      'private.tenant_has_feature(uuid,text) → email_guard',
      'private.tenant_plan_features(uuid) → authenticated,email_guard,file_guard,invitation_guard,membership_guard,rate_limit_guard,tenant_guard'),
      format('unexpected EXECUTE: %s', v_list));
  end loop;
  foreach v_role in array array['authenticated', 'email_guard', 'file_guard', 'invitation_guard', 'membership_guard',
                                'rate_limit_guard', 'tenant_guard'] loop
    perform tests.assert(has_function_privilege(v_role, 'private.member_permissions(uuid,uuid)', 'execute')
                         = has_function_privilege(v_role, 'private.tenant_plan_features(uuid)', 'execute')
                         and has_function_privilege(v_role, 'private.permission_feature(text)', 'execute'),
      format('%s: whoever calls member_permissions calls its plan filter', v_role));
  end loop;
  perform tests.assert(not has_function_privilege('authenticated', 'private.tenant_people_used(uuid)', 'execute')
                       and not has_function_privilege('authenticated', 'private.tenant_limits(uuid)', 'execute')
                       and not has_function_privilege('authenticated', 'private.tenant_has_feature(uuid,text)', 'execute'),
    'the usage and limit helpers are internal');
  -- The plans: plan_guard alone; the organization's plan columns: plan_guard alone changes them.
  foreach v_role in array array['anon', 'authenticated', 'service_role', 'app_server', 'app_worker', 'app_queue',
                                'tenant_guard', 'invitation_guard', 'platform_admin_guard', 'email_guard',
                                'file_guard', 'membership_guard', 'inline_mail_guard'] loop
    perform tests.assert(not has_table_privilege(v_role, 'private.plans', 'select')
                         and not has_table_privilege(v_role, 'private.plans', 'insert')
                         and not has_table_privilege(v_role, 'private.plans', 'update'),
      format('%s must not reach private.plans', v_role));
    perform tests.assert(not has_column_privilege(v_role, 'platform.tenants', 'plan_id', 'update')
                         and not has_column_privilege(v_role, 'platform.tenants', 'status', 'update')
                         and not has_column_privilege(v_role, 'platform.tenants', 'trial_ends_at', 'update')
                         and not has_column_privilege(v_role, 'platform.tenants', 'max_people_override', 'update')
                         and not has_column_privilege(v_role, 'platform.tenants', 'max_storage_gb_override', 'update'),
      format('%s must not change an organization''s plan or status', v_role));
  end loop;
  perform tests.assert(not has_table_privilege('plan_guard', 'private.plans', 'delete')
                       and not has_table_privilege('plan_guard', 'platform.tenants', 'insert')
                       and not has_table_privilege('plan_guard', 'platform.tenants', 'delete')
                       and not has_column_privilege('plan_guard', 'platform.tenants', 'name_ar', 'update')
                       and not has_column_privilege('plan_guard', 'platform.tenants', 'slug', 'update')
                       and not has_table_privilege('plan_guard', 'platform.invitations', 'update')
                       and not has_table_privilege('plan_guard', 'platform.tenant_memberships', 'update')
                       and not has_column_privilege('plan_guard', 'platform.invitations', 'email', 'select')
                       and not has_column_privilege('plan_guard', 'platform.invitations', 'invite_code', 'select')
                       and not has_column_privilege('plan_guard', 'platform.files', 'object_key', 'select')
                       and not has_column_privilege('plan_guard', 'platform.files', 'original_name', 'select')
                       and not has_table_privilege('plan_guard', 'private.platform_audit_events', 'select'),
    'plan_guard deletes no plan, changes no name, invitation or membership, reads no address, code or file name');
end $$;

-- ---------------------------------------------------------------------------------------------------
-- Features: a feature the plan does not include is held by nobody
-- ---------------------------------------------------------------------------------------------------
begin;
-- uAB: HR Manager of A (tms.course.read, tms.course_cost.read and platform permissions).
insert into private.plans (id, name, features) values
  ('e1000000-0000-4000-8000-000000000001', 'Basic', '{}'),
  ('e1000000-0000-4000-8000-000000000002', 'With courses', '{courses}');
do $$
declare
  v_before text[] := private.member_permissions('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000ab');
  v_after text[];
begin
  perform tests.assert('tms.course.read' = any (v_before) and 'platform.user.invite' = any (v_before),
    'fixture: the HR Manager holds course and people permissions');
  perform tests.assert_eq(private.tenant_plan_features('a0000000-0000-4000-8000-000000000001'), null::text[],
    'no plan: no feature list (everything)');
  update platform.tenants set plan_id = 'e1000000-0000-4000-8000-000000000001' where id = 'a0000000-0000-4000-8000-000000000001';
  v_after := private.member_permissions('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000ab');
  perform tests.assert(not (v_after && array['tms.course.read', 'tms.course_cost.read']),
    'a plan without courses: nobody holds the course permissions');
  perform tests.assert_eq(v_after, array(select c from unnest(v_before) c where c not like 'tms.%' order by c),
    'the always-included permissions stay');
  perform tests.assert(not private.member_has_permission('a0000000-0000-4000-8000-000000000001',
                                                         '00000000-0000-4000-8000-0000000000ab', 'tms.course.read'),
    'member_has_permission follows the plan');
  perform tests.assert('tms.course.read' = any (private.member_permissions('b0000000-0000-4000-8000-000000000001',
                                                                          '00000000-0000-4000-8000-0000000000ab'))
                       or not ('tms.course.read' = any (v_before)),
    'another organization is not affected');
  update platform.tenants set plan_id = 'e1000000-0000-4000-8000-000000000002' where id = 'a0000000-0000-4000-8000-000000000001';
  perform tests.assert_eq(private.member_permissions('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000ab'),
    v_before, 'a plan with courses: everything again');
  perform tests.assert(private.tenant_has_feature('a0000000-0000-4000-8000-000000000001', 'courses')
                       and not private.tenant_has_feature('a0000000-0000-4000-8000-000000000001', 'planning')
                       and private.tenant_has_feature('b0000000-0000-4000-8000-000000000001', 'planning'),
    'tenant_has_feature: the plan''s features; everything without a plan');
  perform tests.assert_eq(private.permission_feature('tms.plan_cycle.manage'), 'planning', 'planning permissions');
  perform tests.assert_eq(private.permission_feature('tms.needs_form.read'), 'needs_forms', 'needs form permissions');
  perform tests.assert_eq(private.permission_feature('tms.course_cost.read'), 'courses', 'course permissions');
  perform tests.assert_eq(private.permission_feature('platform.user.invite'), null::text, 'platform permissions: always');
  perform tests.assert_check_constraint($q$insert into private.plans (name, features) values ('Odd', '{payroll}')$q$,
    'plans_features_check', 'only the known features');
  perform tests.assert_fails($q$insert into private.plans (name) values ('basic')$q$, array['23505'],
    'plan names are unique whatever the case');
  perform tests.assert_fails($q$delete from private.plans where id = 'e1000000-0000-4000-8000-000000000002'$q$,
    array['23503'], 'a plan an organization is on cannot be removed');
end $$;
rollback;

-- Where the features without a permission of their own are written: refused for a member, not for the worker.
begin;
insert into private.plans (id, name, features) values ('e1000000-0000-4000-8000-000000000003', 'No extras', '{planning,courses,needs_forms}');
update platform.tenants set plan_id = 'e1000000-0000-4000-8000-000000000003' where id = 'a0000000-0000-4000-8000-000000000001';
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(tests.ua_claims());
do $$
begin
  perform tests.assert_fails_state_like(
    $q$update platform.tenant_branding set primary_color = '#1E3A5F', secondary_color = '#2C5282', email_action_color = '#1E3A5F', email_link_color = '#1E3A5F'$q$,
    'JL003', '%not in the organization''s plan%', 'branding not in the plan: the Organization Admin cannot change it');
  perform tests.assert_eq(private.current_tenant_features(), array['planning', 'courses', 'needs_forms'],
    'what the organization has (the plan''s features)');
end $$;
reset role;
reset session authorization;
-- The worker (no user) updating the same row is not refused.
select tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001'));
update platform.tenant_branding set website_url = 'https://a.example.test' where tenant_id = 'a0000000-0000-4000-8000-000000000001';
select tests.set_claims(tests.ua_claims());
do $$
begin
  perform tests.assert_fails_state_like(
    $q$insert into private.tenant_email_settings (tenant_id, provider, credentials_sealed, from_name, from_address) values ('a0000000-0000-4000-8000-000000000001', 'resend', 'v1.abcdefghijkl.' || repeat('A', 64), 'Tenant A', 'hr@a.test')$q$,
    'JL003', '%not in the organization''s plan%', 'own e-mail provider not in the plan: refused');
  perform tests.assert_fails_state_like(
    $q$insert into platform.user_imports (tenant_id, created_by) values ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1')$q$,
    'JL003', '%not in the organization''s plan%', 'bulk import not in the plan: refused');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- People limit
-- ---------------------------------------------------------------------------------------------------
begin;
insert into platform.persons (id, tenant_id, display_name_ar, display_name_en, email) values
  ('a1000000-0000-4000-8000-00000000e101', 'a0000000-0000-4000-8000-000000000001', 'أول', 'First', 'first@a.test'),
  ('a1000000-0000-4000-8000-00000000e102', 'a0000000-0000-4000-8000-000000000001', 'ثان', 'Second', 'second@a.test'),
  ('a1000000-0000-4000-8000-00000000e103', 'a0000000-0000-4000-8000-000000000001', 'ثالث', 'Third', 'third@a.test'),
  ('b1000000-0000-4000-8000-00000000e101', 'b0000000-0000-4000-8000-000000000001', 'ب', 'B one', 'one@b.test');
create function pg_temp.invite(p_id uuid, p_person uuid, p_email text, p_tenant uuid default 'a0000000-0000-4000-8000-000000000001')
returns void language sql as $$
  insert into platform.invitations (id, tenant_id, person_id, email, locale, primary_role, invited_by)
  values (p_id, p_tenant, p_person, p_email, 'en', 'learner',
          case when p_tenant = 'a0000000-0000-4000-8000-000000000001' then '00000000-0000-4000-8000-0000000000a1'::uuid
               else '00000000-0000-4000-8000-0000000000b1'::uuid end);
$$;
do $$
declare
  v_used integer := private.tenant_people_used('a0000000-0000-4000-8000-000000000001');
  v_plan uuid;
begin
  perform tests.assert(v_used >= 3, 'fixture: tenant A counts its active and invited members');
  -- No plan: no limit.
  perform pg_temp.invite('a4000000-0000-4000-8000-00000000e101', 'a1000000-0000-4000-8000-00000000e101', 'first@a.test');
  perform tests.assert_eq(private.tenant_people_used('a0000000-0000-4000-8000-000000000001'), v_used + 1,
    'a pending invitation counts');
  v_used := v_used + 1;
  insert into private.plans (name, max_people) values ('Exactly full', v_used) returning id into v_plan;
  update platform.tenants set plan_id = v_plan where id = 'a0000000-0000-4000-8000-000000000001';
  perform tests.assert_fails_state_like(
    $q$select pg_temp.invite('a4000000-0000-4000-8000-00000000e102', 'a1000000-0000-4000-8000-00000000e102', 'second@a.test')$q$,
    'JL001', '%people limit%', 'full: a new person cannot be invited');
  -- Another organization (no plan) is not affected.
  perform pg_temp.invite('b4000000-0000-4000-8000-00000000e101', 'b1000000-0000-4000-8000-00000000e101', 'one@b.test',
                         'b0000000-0000-4000-8000-000000000001');
  -- An expired invitation no longer counts: room for one more.
  update platform.invitations set expires_at = now() - interval '1 minute' where id = 'a4000000-0000-4000-8000-00000000e101';
  perform tests.assert_eq(private.tenant_people_used('a0000000-0000-4000-8000-000000000001'), v_used - 1,
    'an expired invitation does not count');
  perform pg_temp.invite('a4000000-0000-4000-8000-00000000e102', 'a1000000-0000-4000-8000-00000000e102', 'second@a.test');
  -- Renewing the expired one would take a place again: refused while full.
  perform tests.assert_fails_state_like(
    $q$update platform.invitations set expires_at = now() + interval '7 days' where id = 'a4000000-0000-4000-8000-00000000e101'$q$,
    'JL001', '%people limit%', 'full: an expired invitation cannot be renewed');
  -- Reactivating a suspended member takes a place: refused while full.
  perform tests.assert_fails_state_like(
    $q$update platform.tenant_memberships set status = 'active' where user_id = '00000000-0000-4000-8000-0000000000a3' and tenant_id = 'a0000000-0000-4000-8000-000000000001'$q$,
    'JL001', '%people limit%', 'full: a suspended member cannot be reactivated');
  -- The organization's own limit wins over the plan's.
  update platform.tenants set max_people_override = v_used + 1 where id = 'a0000000-0000-4000-8000-000000000001';
  update platform.tenant_memberships set status = 'active'
  where user_id = '00000000-0000-4000-8000-0000000000a3' and tenant_id = 'a0000000-0000-4000-8000-000000000001';
  perform tests.assert_fails_state_like(
    $q$select pg_temp.invite('a4000000-0000-4000-8000-00000000e103', 'a1000000-0000-4000-8000-00000000e103', 'third@a.test')$q$,
    'JL001', '%people limit%', 'the special limit is reached too');
  -- A lowered limit keeps everyone already counted.
  update platform.tenants set max_people_override = 1 where id = 'a0000000-0000-4000-8000-000000000001';
  perform tests.assert_eq(private.tenant_people_used('a0000000-0000-4000-8000-000000000001'), v_used + 1,
    'nobody is removed when the limit is lowered');
  -- An account for a person already counted (the invitation accepted) is not a new person.
  insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000e102', 'second@a.test');
  insert into platform.tenant_memberships (tenant_id, user_id, person_id, status)
  values ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000e102',
          'a1000000-0000-4000-8000-00000000e102', 'active');
  perform tests.assert_eq(private.tenant_people_used('a0000000-0000-4000-8000-000000000001'), v_used + 1,
    'the invited person''s account is the same person');
  -- Another organization is not affected; no plan, no limit.
  update platform.tenants set plan_id = null, max_people_override = null where id = 'a0000000-0000-4000-8000-000000000001';
  perform pg_temp.invite('a4000000-0000-4000-8000-00000000e103', 'a1000000-0000-4000-8000-00000000e103', 'third@a.test');
end $$;
rollback;

-- Two invitations at once cannot both take the last place: the check waits for the other one (lock).
begin;
insert into private.plans (id, name, max_people) values ('e1000000-0000-4000-8000-000000000009', 'Lock', 1000);
update platform.tenants set plan_id = 'e1000000-0000-4000-8000-000000000009' where id = 'a0000000-0000-4000-8000-000000000001';
insert into platform.persons (id, tenant_id, display_name_ar, display_name_en, email) values
  ('a1000000-0000-4000-8000-00000000e109', 'a0000000-0000-4000-8000-000000000001', 'قفل', 'Lock', 'lock@a.test');
insert into platform.invitations (tenant_id, person_id, email, locale, primary_role, invited_by)
values ('a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000e109', 'lock@a.test', 'en', 'learner',
        '00000000-0000-4000-8000-0000000000a1');
do $$
begin
  perform tests.assert(exists (select 1 from pg_locks l
                               where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.granted
                                 and ((l.classid::bigint << 32) | l.objid::bigint)
                                     = pg_catalog.hashtextextended('platform.people_limit:a0000000-0000-4000-8000-000000000001', 0)),
    'the people check holds the organization''s lock until the end of the transaction');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Storage limit
-- ---------------------------------------------------------------------------------------------------
begin;
insert into private.plans (id, name, max_storage_gb) values ('e1000000-0000-4000-8000-000000000004', 'One GB', 1);
-- A member's uploads (the claims of tenant A's Organization Admin).
select tests.set_claims(tests.ua_claims());
do $$
declare
  v_used bigint := private.tenant_storage_used('a0000000-0000-4000-8000-000000000001');
begin
  perform tests.file_fixture('a8000000-0000-4000-8000-00000000e101', 'a0000000-0000-4000-8000-000000000001',
                             '00000000-0000-4000-8000-0000000000a1', 'clean');
  perform tests.assert_eq(private.tenant_storage_used('a0000000-0000-4000-8000-000000000001'), v_used + 20,
    'a stored file counts by its size');
  perform tests.file_fixture('a8000000-0000-4000-8000-00000000e102', 'a0000000-0000-4000-8000-000000000001',
                             '00000000-0000-4000-8000-0000000000a1', 'deleted');
  perform tests.file_fixture('a8000000-0000-4000-8000-00000000e103', 'a0000000-0000-4000-8000-000000000001',
                             '00000000-0000-4000-8000-0000000000a1', 'pending_upload', '1 hour');
  perform tests.assert_eq(private.tenant_storage_used('a0000000-0000-4000-8000-000000000001'), v_used + 20,
    'deleted files and abandoned uploads do not count');
  update platform.tenants set plan_id = 'e1000000-0000-4000-8000-000000000004' where id = 'a0000000-0000-4000-8000-000000000001';
  -- Fill the organization up to its limit (owner: a declared size of what is left).
  -- (Test only, rolled back: one file as big as what is left, above the purpose's size limit.)
  alter table platform.files disable trigger files_transition;
  alter table platform.files drop constraint files_size_check;
  update platform.files set declared_size = 1073741824 - v_used, size_bytes = 1073741824 - v_used
  where id = 'a8000000-0000-4000-8000-00000000e101';
  alter table platform.files enable trigger files_transition;
  perform tests.assert_eq(private.tenant_storage_used('a0000000-0000-4000-8000-000000000001'), 1073741824::bigint, 'full');
  perform tests.assert_fails_state_like(
    $q$select tests.file_fixture('a8000000-0000-4000-8000-00000000e104', 'a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'pending_upload')$q$,
    'JL002', '%storage limit%', 'full: a new file is refused');
  -- The worker's own file (no user: an import's report) is not refused.
  perform tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001'));
  perform tests.file_fixture('a8000000-0000-4000-8000-00000000e105', 'a0000000-0000-4000-8000-000000000001',
                             '00000000-0000-4000-8000-0000000000a1', 'pending_upload');
  perform tests.set_claims(tests.ua_claims());
  perform tests.file_fixture('b8000000-0000-4000-8000-00000000e104', 'b0000000-0000-4000-8000-000000000001',
                             '00000000-0000-4000-8000-0000000000b1', 'pending_upload');
  update platform.tenants set max_storage_gb_override = 2 where id = 'a0000000-0000-4000-8000-000000000001';
  perform tests.file_fixture('a8000000-0000-4000-8000-00000000e104', 'a0000000-0000-4000-8000-000000000001',
                             '00000000-0000-4000-8000-0000000000a1', 'pending_upload');
end $$;
rollback;
