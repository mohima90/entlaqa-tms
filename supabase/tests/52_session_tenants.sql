-- db-test: run-as=app_server
-- private.session_tenants() (T-M1-D03): the organizations of the CURRENT valid session only — before any
-- tenant is selected (claims without tenant_id). Runs CONNECTED AS app_server.
\set ON_ERROR_STOP on

begin;
set local role authenticated;

-- uAB, session 3 (no tenant selected yet): active memberships in A and B, ordered by Arabic name.
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ad', null));
do $$
begin
  perform tests.assert_eq(
    (select array_agg(tenant_id order by name_ar) from private.session_tenants()),
    array['a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001']::uuid[],
    'uAB sees exactly tenants A and B');
  perform tests.assert_eq((select name_ar from private.session_tenants() limit 1), 'المنشأة أ', 'Arabic name is returned');
end $$;

-- uA (one membership): only A.
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', null));
do $$
begin
  perform tests.assert_eq((select array_agg(tenant_id) from private.session_tenants()),
    array['a0000000-0000-4000-8000-000000000001']::uuid[], 'uA sees only A');
end $$;

-- Expired session, someone else's session, and malformed claims: nothing.
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a9', null));
do $$ begin perform tests.assert_eq((select count(*) from private.session_tenants()), 0::bigint, 'expired session: none'); end $$;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000b1', null));
do $$ begin perform tests.assert_eq((select count(*) from private.session_tenants()), 0::bigint, 'session of another user: none'); end $$;
select tests.set_claims('{"role":"authenticated","sub":"not-a-uuid"}'::jsonb);
do $$ begin perform tests.assert_eq((select count(*) from private.session_tenants()), 0::bigint, 'malformed claims: none'); end $$;
select tests.set_claims(null);
do $$ begin perform tests.assert_eq((select count(*) from private.session_tenants()), 0::bigint, 'no claims: none'); end $$;

-- Invited / suspended members, suspended tenant (C), and a user without memberships: nothing.
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a2', '10000000-0000-4000-8000-0000000000a2', null));
do $$ begin perform tests.assert_eq((select count(*) from private.session_tenants()), 0::bigint, 'invited member: none'); end $$;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a3', '10000000-0000-4000-8000-0000000000a3', null));
do $$ begin perform tests.assert_eq((select count(*) from private.session_tenants()), 0::bigint, 'suspended member: none'); end $$;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000c1', '10000000-0000-4000-8000-0000000000c1', null));
do $$ begin perform tests.assert_eq((select count(*) from private.session_tenants()), 0::bigint, 'suspended tenant: none'); end $$;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000e1', '10000000-0000-4000-8000-0000000000e1', null));
do $$ begin perform tests.assert_eq((select count(*) from private.session_tenants()), 0::bigint, 'no memberships: none'); end $$;

-- Trial tenant (D) is allowed.
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000d1', '10000000-0000-4000-8000-0000000000d1', null));
do $$ begin perform tests.assert_eq((select array_agg(tenant_id) from private.session_tenants()),
  array['d0000000-0000-4000-8000-000000000001']::uuid[], 'trial tenant D is listed'); end $$;

-- System claims are refused (wrong claim kind for this function).
select tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001'));
do $$ begin perform tests.assert_eq((select count(*) from private.session_tenants()), 0::bigint, 'system claims: none'); end $$;

reset role;
rollback;

\echo '52_session_tenants: ok'
