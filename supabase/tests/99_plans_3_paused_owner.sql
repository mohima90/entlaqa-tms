-- db-test: run-as=owner
-- A suspended organization (WP-ADM-06, migration 20261027100200): its Organization Admin (platform.tenant.manage)
-- still signs in and chooses it, and acts there in the state 'paused' — no organization for any other function
-- (private.current_tenant_id() is null), only the plan view answers; everyone else of the organization is
-- refused with the «paused» message; a cancelled organization refuses everyone with the neutral message; an
-- active organization is unchanged. Fixtures: 00_helpers_and_fixtures.sql — tenant C (suspended) with uC
-- (active member, session sC acting in C). Runs as the owner and switches to the login roles. Every block is
-- rolled back.
\set ON_ERROR_STOP on

create function pg_temp.uc_claims() returns jsonb language sql immutable as $$
  select tests.user_claims('00000000-0000-4000-8000-0000000000c1', '10000000-0000-4000-8000-0000000000c1',
                           'c0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-0000000000c1');
$$;
create function pg_temp.hook(p_user uuid, p_session uuid) returns jsonb language sql as $$
  select private.custom_access_token_hook(jsonb_build_object(
    'user_id', p_user, 'claims', jsonb_build_object('sub', p_user, 'session_id', p_session, 'role', 'authenticated')));
$$;

-- ---------------------------------------------------------------------------------------------------
-- A member without platform.tenant.manage: refused, «paused»
-- ---------------------------------------------------------------------------------------------------
begin;
insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary)
select m.tenant_id, m.id, 'learner', true from platform.tenant_memberships m
where m.tenant_id = 'c0000000-0000-4000-8000-000000000001' and m.user_id = '00000000-0000-4000-8000-0000000000c1';
do $$
begin
  perform tests.assert(private.account_sign_in_refused('00000000-0000-4000-8000-0000000000c1'),
    'an Employee of a suspended organization cannot sign in');
  perform tests.assert(private.account_access_paused('00000000-0000-4000-8000-0000000000c1'), 'their access is paused');
  perform tests.assert_eq(pg_temp.hook('00000000-0000-4000-8000-0000000000c1', '10000000-0000-4000-8000-0000000000c1')
                          -> 'error' ->> 'message', 'Access to this organization is paused.',
    'the hook says «paused» (the web app shows Access paused)');
  perform tests.assert_eq(array(select private.paused_admin_tenants('00000000-0000-4000-8000-0000000000c1')), '{}'::uuid[],
    'not a paused admin');
end $$;
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(pg_temp.uc_claims());
do $$
begin
  perform tests.assert_eq((select state from private.session_access_state()), 'invalid', 'no session state there');
  perform tests.assert_eq((select count(*) from private.session_tenants()), 0::bigint, 'no organization to choose');
  perform tests.assert(not private.switch_active_tenant('c0000000-0000-4000-8000-000000000001'), 'cannot act there');
  perform tests.assert_fails($q$select * from private.organization_plan()$q$, array['42501'], 'no plan view');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- The Organization Admin: signs in, acts there paused, sees the plan only
-- ---------------------------------------------------------------------------------------------------
begin;
insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary)
select m.tenant_id, m.id, 'tenant_admin', true from platform.tenant_memberships m
where m.tenant_id = 'c0000000-0000-4000-8000-000000000001' and m.user_id = '00000000-0000-4000-8000-0000000000c1';
do $$
declare
  v_event jsonb := pg_temp.hook('00000000-0000-4000-8000-0000000000c1', '10000000-0000-4000-8000-0000000000c1');
begin
  perform tests.assert(not private.account_sign_in_refused('00000000-0000-4000-8000-0000000000c1'),
    'the Organization Admin of a suspended organization signs in');
  perform tests.assert_eq(array(select private.paused_admin_tenants('00000000-0000-4000-8000-0000000000c1')),
    array['c0000000-0000-4000-8000-000000000001'::uuid], 'a paused admin of C');
  perform tests.assert(v_event ? 'claims' and not (v_event ? 'error'), 'a token');
  perform tests.assert_eq(v_event -> 'claims' ->> 'tenant_id', 'c0000000-0000-4000-8000-000000000001',
    'with the organization (the session acts there)');
end $$;
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(pg_temp.uc_claims());
do $$
declare
  r record;
begin
  perform tests.assert_eq((select state from private.session_access_state()), 'paused', 'the session is paused there');
  perform tests.assert_eq(private.current_tenant_id(), null::uuid, 'no organization for anything else');
  perform tests.assert((select not active from private.request_session_facts()), 'no action may run');
  perform tests.assert_eq((select string_agg(tenant_id::text, ',') from private.session_tenants()),
    'c0000000-0000-4000-8000-000000000001', 'the organization can be chosen');
  perform tests.assert(private.switch_active_tenant('c0000000-0000-4000-8000-000000000001'), 'and acted in (paused)');
  select * into r from private.organization_plan();
  perform tests.assert(r.status = 'suspended' and not r.has_plan, 'the plan view answers: the organization is suspended');
  perform tests.assert_fails($q$select private.current_tenant_features()$q$, array['42501'], 'menus: nothing');
  perform tests.assert_eq((select count(*) from platform.persons), 0::bigint, 'no organization data');
end $$;
-- The MFA states stay.
reset role;
reset session authorization;
update platform.security_policies set mfa_mode = 'required_all', mfa_grace_days = 0, mfa_required_since = now() - interval '1 day'
where tenant_id = 'c0000000-0000-4000-8000-000000000001';
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(pg_temp.uc_claims());
do $$
begin
  perform tests.assert_eq((select state from private.session_access_state()), 'mfa_enrol',
    'the organization''s MFA rule still applies before the paused state');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Cancelled: nobody, the neutral message; active organizations unchanged
-- ---------------------------------------------------------------------------------------------------
begin;
insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary)
select m.tenant_id, m.id, 'tenant_admin', true from platform.tenant_memberships m
where m.tenant_id = 'c0000000-0000-4000-8000-000000000001' and m.user_id = '00000000-0000-4000-8000-0000000000c1';
update platform.tenants set status = 'cancelled' where id = 'c0000000-0000-4000-8000-000000000001';
do $$
begin
  perform tests.assert(private.account_sign_in_refused('00000000-0000-4000-8000-0000000000c1'), 'cancelled: refused');
  perform tests.assert(not private.account_access_paused('00000000-0000-4000-8000-0000000000c1'), 'not «paused»');
  perform tests.assert_eq(pg_temp.hook('00000000-0000-4000-8000-0000000000c1', '10000000-0000-4000-8000-0000000000c1')
                          -> 'error' ->> 'message', 'Sign-in is not available for this account.', 'the neutral message');
  -- Tenant A's Organization Admin: unchanged.
  perform tests.assert(not private.account_sign_in_refused('00000000-0000-4000-8000-0000000000a1'), 'A: signs in');
  perform tests.assert_eq(pg_temp.hook('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1')
                          -> 'claims' ->> 'tenant_id', 'a0000000-0000-4000-8000-000000000001', 'A: the organization claim');
end $$;
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(pg_temp.uc_claims());
do $$
begin
  perform tests.assert_eq((select state from private.session_access_state()), 'invalid', 'cancelled: no session there');
  perform tests.assert_fails($q$select * from private.organization_plan()$q$, array['42501'], 'cancelled: no plan view');
end $$;
select tests.set_claims(tests.ua_claims());
do $$
begin
  perform tests.assert_eq((select state from private.session_access_state()) <> 'paused', true, 'A: never paused');
  perform tests.assert_eq(private.current_tenant_id(), 'a0000000-0000-4000-8000-000000000001'::uuid, 'A: its organization');
end $$;
rollback;
