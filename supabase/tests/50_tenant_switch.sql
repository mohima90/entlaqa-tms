-- db-test: run-as=app_server
-- Tenant switch (ADR 0002 §3): private.switch_active_tenant() updates session_context ONLY for the
-- calling session, and only into a tenant with an active membership. Runs CONNECTED AS app_server.
\set ON_ERROR_STOP on

begin;
set local role authenticated;
-- uAB, session 1 (acting in A), switches to B.
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab', 'a0000000-0000-4000-8000-000000000001'));
do $$
begin
  perform tests.assert(private.switch_active_tenant('b0000000-0000-4000-8000-000000000001'), 'member of B can switch session 1 to B');
  perform tests.assert(not private.switch_active_tenant('c0000000-0000-4000-8000-000000000001'), 'cannot switch to a tenant without membership');
  perform tests.assert(not private.switch_active_tenant('d0000000-0000-4000-8000-000000000001'), 'cannot switch to a tenant without membership (trial)');
  perform tests.assert(not private.switch_active_tenant(null), 'null tenant is rejected');
end $$;
reset role;
-- Verify through a system view of the rows (superuser-free: check via the hook-visible state as the
-- same session after switching claims to tenant B).
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab', 'b0000000-0000-4000-8000-000000000001'));
do $$
begin
  perform tests.assert_eq((select active_tenant_id from platform.session_context),
    'b0000000-0000-4000-8000-000000000001'::uuid, 'session 1 now acts in B');
end $$;
reset role;
-- The token issued before the switch (session 1, tenant A) stops working immediately (security review
-- L1): the database requires session_context.active_tenant_id = tenant_id for user claims.
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab', 'a0000000-0000-4000-8000-000000000001'));
do $$
declare
  r record;
begin
  perform tests.assert(private.current_tenant_id() is null, 'stale pre-switch tenant A claim is refused');
  for r in select * from tests.tenant_tables() loop
    perform tests.assert_eq(tests.count_rows(r.table_name), 0::bigint,
      format('%s: stale pre-switch claim must read zero rows', r.table_name));
  end loop;
end $$;
reset role;
-- Session 2 of the same user is unchanged (still A).
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ac', 'a0000000-0000-4000-8000-000000000001'));
do $$
begin
  perform tests.assert_eq((select active_tenant_id from platform.session_context),
    'a0000000-0000-4000-8000-000000000001'::uuid, 'session 2 is unaffected by the switch of session 1');
  perform tests.assert_eq(private.current_tenant_id(), 'a0000000-0000-4000-8000-000000000001'::uuid,
    'session 2 keeps acting in A');
end $$;
reset role;
rollback;

-- First tenant selection (positive): session sAB3 of uAB has no session_context row yet. Selecting a
-- tenant with an active membership INSERTS the row for this session only; the new tenant claim then
-- resolves, and a claim for the other tenant does not.
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ad', null));
do $$
begin
  perform tests.assert_eq((select count(*) from platform.session_context), 0::bigint, 'no session_context row before the first selection');
  perform tests.assert(private.switch_active_tenant('b0000000-0000-4000-8000-000000000001'), 'first selection of tenant B succeeds');
end $$;
reset role;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ad', 'b0000000-0000-4000-8000-000000000001'));
do $$
begin
  perform tests.assert_eq(private.current_tenant_id(), 'b0000000-0000-4000-8000-000000000001'::uuid, 'the new session now acts in B');
  perform tests.assert_eq((select count(*) from platform.session_context), 1::bigint, 'exactly one row was inserted');
  perform tests.assert_eq((select user_id from platform.session_context),
    '00000000-0000-4000-8000-0000000000ab'::uuid, 'the row belongs to the caller');
end $$;
reset role;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ad', 'a0000000-0000-4000-8000-000000000001'));
do $$
begin
  perform tests.assert(private.current_tenant_id() is null, 'a tenant A claim for that session is refused');
end $$;
reset role;
-- The other sessions of the same user are unchanged.
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab', 'a0000000-0000-4000-8000-000000000001'));
do $$
begin
  perform tests.assert_eq(private.current_tenant_id(), 'a0000000-0000-4000-8000-000000000001'::uuid, 'session 1 still acts in A');
end $$;
reset role;
rollback;

-- First tenant selection (negative cases): no membership, expired session, invited member.
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000e1', '10000000-0000-4000-8000-0000000000e1', null));
do $$
begin
  perform tests.assert(not private.switch_active_tenant('a0000000-0000-4000-8000-000000000001'),
    'a user without membership cannot select tenant A');
end $$;
reset role;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a9', null));
do $$
begin
  perform tests.assert(not private.switch_active_tenant('a0000000-0000-4000-8000-000000000001'),
    'an expired session cannot switch');
end $$;
reset role;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a2', '10000000-0000-4000-8000-0000000000a2', null));
do $$
begin
  perform tests.assert(not private.switch_active_tenant('a0000000-0000-4000-8000-000000000001'),
    'an invited (not active) member cannot switch');
end $$;
reset role;
rollback;

\echo '50_tenant_switch: ok'
