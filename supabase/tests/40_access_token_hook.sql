-- db-test: run-as=owner
-- (d) Custom Access Token Hook (ADR 0002 §3). Runs as the superuser connection, executing the hook
-- as supabase_auth_admin (the role Supabase Auth uses).
\set ON_ERROR_STOP on
begin;

create function pg_temp.hook(p_user uuid, p_session uuid, p_extra jsonb default '{}'::jsonb) returns jsonb
language sql as $$
  select private.custom_access_token_hook(jsonb_build_object(
    'user_id', p_user,
    'authentication_method', 'password',
    'claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1', 'session_id', p_session) || p_extra))
$$;

set local role supabase_auth_admin;

do $$
declare
  v jsonb;
begin
  -- Active membership, active tenant → tenant_id + person_id for THIS session.
  v := pg_temp.hook('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1');
  perform tests.assert_eq(v -> 'claims' ->> 'tenant_id', 'a0000000-0000-4000-8000-000000000001', 'active member gets tenant_id');
  perform tests.assert_eq(v -> 'claims' ->> 'person_id', 'a1000000-0000-4000-8000-0000000000a1', 'active member gets person_id');
  perform tests.assert_eq(v -> 'claims' ->> 'aal', 'aal1', 'other claims are preserved');
  perform tests.assert_eq(v ->> 'user_id', '00000000-0000-4000-8000-0000000000a1', 'event fields are preserved');

  -- Trial tenant is allowed.
  v := pg_temp.hook('00000000-0000-4000-8000-0000000000d1', '10000000-0000-4000-8000-0000000000d1');
  perform tests.assert_eq(v -> 'claims' ->> 'tenant_id', 'd0000000-0000-4000-8000-000000000001', 'trial tenant gets tenant_id');

  -- No claim for: invited, suspended membership, suspended tenant, no session context, unknown session.
  v := pg_temp.hook('00000000-0000-4000-8000-0000000000a2', '10000000-0000-4000-8000-0000000000a2');
  perform tests.assert(not (v -> 'claims' ? 'tenant_id'), 'invited membership → no tenant_id');
  v := pg_temp.hook('00000000-0000-4000-8000-0000000000a3', '10000000-0000-4000-8000-0000000000a3');
  perform tests.assert(not (v -> 'claims' ? 'tenant_id'), 'suspended membership → no tenant_id');
  v := pg_temp.hook('00000000-0000-4000-8000-0000000000c1', '10000000-0000-4000-8000-0000000000c1');
  perform tests.assert(not (v -> 'claims' ? 'tenant_id'), 'suspended tenant → no tenant_id');
  v := pg_temp.hook('00000000-0000-4000-8000-0000000000e1', '10000000-0000-4000-8000-0000000000e1');
  perform tests.assert(not (v -> 'claims' ? 'tenant_id'), 'no session context → no tenant_id');
  v := pg_temp.hook('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000ab');
  perform tests.assert(not (v -> 'claims' ? 'tenant_id'), 'another user''s session → no tenant_id');
  v := pg_temp.hook('00000000-0000-4000-8000-0000000000a1', null);
  perform tests.assert(not (v -> 'claims' ? 'tenant_id'), 'missing session_id → no tenant_id');

  -- Incoming tenant_id / person_id claims are always discarded.
  v := pg_temp.hook('00000000-0000-4000-8000-0000000000e1', '10000000-0000-4000-8000-0000000000e1',
    jsonb_build_object('tenant_id', 'b0000000-0000-4000-8000-000000000001', 'person_id', 'b1000000-0000-4000-8000-0000000000b1'));
  perform tests.assert(not (v -> 'claims' ? 'tenant_id') and not (v -> 'claims' ? 'person_id'),
    'spoofed tenant_id/person_id claims are removed');
  v := pg_temp.hook('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
    jsonb_build_object('tenant_id', 'b0000000-0000-4000-8000-000000000001'));
  perform tests.assert_eq(v -> 'claims' ->> 'tenant_id', 'a0000000-0000-4000-8000-000000000001', 'spoofed tenant_id is replaced');
end $$;
reset role;

-- The claim follows the SESSION: a user in two tenants gets different claims per session.
update platform.session_context set active_tenant_id = 'b0000000-0000-4000-8000-000000000001'
  where session_id = '10000000-0000-4000-8000-0000000000ac';
set local role supabase_auth_admin;
do $$
begin
  perform tests.assert_eq(pg_temp.hook('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab') -> 'claims' ->> 'tenant_id',
    'a0000000-0000-4000-8000-000000000001', 'session 1 acts in tenant A');
  perform tests.assert_eq(pg_temp.hook('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ac') -> 'claims' ->> 'tenant_id',
    'b0000000-0000-4000-8000-000000000001', 'session 2 acts in tenant B');
  perform tests.assert_eq(pg_temp.hook('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ac') -> 'claims' ->> 'person_id',
    'b1000000-0000-4000-8000-0000000000ab', 'person_id matches the session''s tenant');
end $$;
reset role;

-- Roles other than supabase_auth_admin cannot run the hook.
set local role authenticated;
do $$
begin
  perform tests.assert_fails($q$select private.custom_access_token_hook('{}'::jsonb)$q$, array['42501'],
    'authenticated cannot execute the hook');
end $$;
reset role;

-- Claims set under any other login role (e.g. PostgREST's authenticator, or this superuser session)
-- are not accepted by current_tenant_id() (ADR 0002 §6a).
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-000000000001'));
do $$
begin
  perform tests.assert(private.current_tenant_id() is null, 'valid user claims under a non-app_server login → NULL');
  perform tests.assert_eq((select count(*) from platform.persons), 0::bigint, 'and zero rows');
end $$;
reset role;

rollback;
\echo '40_access_token_hook: ok'
