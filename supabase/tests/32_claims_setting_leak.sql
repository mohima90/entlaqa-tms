-- db-test: run-as=app_server
-- Claims-setting leak across pooled transactions (security review S1). Supabase's auth.jwt()/auth.uid()
-- read the legacy `request.jwt.claim` / `request.jwt.claim.sub` settings BEFORE `request.jwt.claims`.
-- A SESSION-level SET of those settings survives COMMIT, so on a pooled connection it would leak into
-- the next user's transactions. Our policies and helpers read ONLY the transaction-local
-- `request.jwt.claims` (private.request_claims()), so leaked legacy settings have no effect.
-- Runs CONNECTED AS app_server (the shim's auth.jwt()/auth.uid() mirror Supabase's definitions).
\set ON_ERROR_STOP on

-- A buggy or hostile code path leaves uA's (valid, tenant A) claims behind at SESSION level.
select set_config('request.jwt.claim',
  tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
    'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1')::text, false);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', false);

-- The next unit of work on this connection is uB's, in tenant B.
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1',
  'b0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-0000000000b1'));
do $$
declare
  r record;
  v_foreign bigint;
begin
  -- Control: Supabase's helpers WOULD return the leaked identity (this is the attack).
  perform tests.assert_eq(auth.jwt() ->> 'tenant_id', 'a0000000-0000-4000-8000-000000000001',
    'control: auth.jwt() prefers the leaked legacy request.jwt.claim');
  perform tests.assert_eq(auth.uid(), '00000000-0000-4000-8000-0000000000a1'::uuid,
    'control: auth.uid() prefers the leaked legacy request.jwt.claim.sub');

  perform tests.assert_eq(private.current_tenant_id(), 'b0000000-0000-4000-8000-000000000001'::uuid,
    'current_tenant_id() reads request.jwt.claims only');
  perform tests.assert_eq(private.request_user_id(), '00000000-0000-4000-8000-0000000000b1'::uuid,
    'request_user_id() reads request.jwt.claims only');
  for r in select * from tests.readable_tenant_tables() loop
    execute format('select count(*) from %s where %I <> %L', r.table_name, r.tenant_column, 'b0000000-0000-4000-8000-000000000001')
      into v_foreign;
    perform tests.assert_eq(v_foreign, 0::bigint, format('%s: leaked legacy claims must not expose tenant A', r.table_name));
  end loop;
  perform tests.assert_eq((select session_id from platform.session_context),
    '10000000-0000-4000-8000-0000000000b1'::uuid, 'session_context: only uB''s own session is visible');
  perform tests.assert_eq(tests.rows_affected($q$insert into platform.audit_events (actor_user_id, actor_person_id, action) values ('00000000-0000-4000-8000-0000000000b1', 'b1000000-0000-4000-8000-0000000000b1', 'platform.test.recorded')$q$),
    1::bigint, 'audit_events: the real subject is the actor');
  perform tests.assert_rls_violation($q$insert into platform.audit_events (actor_user_id, action) values ('00000000-0000-4000-8000-0000000000a1', 'platform.test.forged')$q$,
    'audit_events: the leaked subject cannot be used as actor');
end $$;
rollback;

-- A transaction WITHOUT claims must not fall back to the leaked legacy claims.
begin;
set local role authenticated;
select tests.set_claims(null);
do $$
declare
  r record;
begin
  perform tests.assert(private.request_claims() is null, 'no request.jwt.claims → no claims');
  perform tests.assert(private.current_tenant_id() is null, 'leaked legacy claims never resolve a tenant');
  for r in select * from tests.readable_tenant_tables() loop
    perform tests.assert_eq(tests.count_rows(r.table_name), 0::bigint,
      format('%s: leaked legacy claims must read zero rows', r.table_name));
  end loop;
end $$;
rollback;

-- Malformed request.jwt.claims never raise (claims helpers fail closed).
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{not json', true);
do $$
begin
  perform tests.assert(private.request_claims() is null, 'malformed claims → NULL');
  perform tests.assert(private.current_tenant_id() is null, 'malformed claims → no tenant');
end $$;
rollback;

reset request.jwt.claim;
reset request.jwt.claim.sub;
\echo '32_claims_setting_leak: ok'
