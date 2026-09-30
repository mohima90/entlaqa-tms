-- db-test: run-as=app_server
-- (ADR 0002 §6a, Verification 3a) Forged or invalid claims under app_server read zero rows.
-- Runs CONNECTED AS app_server.
\set ON_ERROR_STOP on

do $$ begin perform tests.assert(session_user = 'app_server', 'must run connected as app_server'); end $$;


do $$
declare
  c record;
  r record;
  v_tenant uuid;
begin
  -- No temporary tables (TEMPORARY is revoked from PUBLIC): the cases are a VALUES list.
  for c in
    select * from (values
        ('valid user claims (control)',
          tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-000000000001'),
          'a0000000-0000-4000-8000-000000000001'::uuid),
        ('valid trial-tenant claims (control)',
          tests.user_claims('00000000-0000-4000-8000-0000000000d1', '10000000-0000-4000-8000-0000000000d1', 'd0000000-0000-4000-8000-000000000001'),
          'd0000000-0000-4000-8000-000000000001'),
        ('forged tenant_id: no membership in tenant B',
          tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', 'b0000000-0000-4000-8000-000000000001'), null),
        ('unknown session_id',
          tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-00000000ffff', 'a0000000-0000-4000-8000-000000000001'), null),
        ('expired session_id',
          tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a9', 'a0000000-0000-4000-8000-000000000001'), null),
        ('session of another user',
          tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000ab', 'a0000000-0000-4000-8000-000000000001'), null),
        ('missing session_id',
          tests.user_claims('00000000-0000-4000-8000-0000000000a1', null, 'a0000000-0000-4000-8000-000000000001'), null),
        ('invited (not active) membership',
          tests.user_claims('00000000-0000-4000-8000-0000000000a2', '10000000-0000-4000-8000-0000000000a2', 'a0000000-0000-4000-8000-000000000001'), null),
        ('suspended membership',
          tests.user_claims('00000000-0000-4000-8000-0000000000a3', '10000000-0000-4000-8000-0000000000a3', 'a0000000-0000-4000-8000-000000000001'), null),
        ('suspended tenant',
          tests.user_claims('00000000-0000-4000-8000-0000000000c1', '10000000-0000-4000-8000-0000000000c1', 'c0000000-0000-4000-8000-000000000001'), null),
        ('user without any membership',
          tests.user_claims('00000000-0000-4000-8000-0000000000e1', '10000000-0000-4000-8000-0000000000e1', 'a0000000-0000-4000-8000-000000000001'), null),
        ('system claims under app_server', tests.system_claims('a0000000-0000-4000-8000-000000000001'), null),
        ('service_role claims', jsonb_build_object('role', 'service_role', 'tenant_id', 'a0000000-0000-4000-8000-000000000001'), null),
        ('malformed tenant_id',
          jsonb_build_object('role', 'authenticated', 'sub', '00000000-0000-4000-8000-0000000000a1',
            'session_id', '10000000-0000-4000-8000-0000000000a1', 'tenant_id', 'tenant-a'), null),
        ('malformed sub',
          jsonb_build_object('role', 'authenticated', 'sub', 'x'' or 1=1 --',
            'session_id', '10000000-0000-4000-8000-0000000000a1', 'tenant_id', 'a0000000-0000-4000-8000-000000000001'), null),
        ('tenant claim differs from the session''s active tenant (stale token after a switch)',
          tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ac', 'b0000000-0000-4000-8000-000000000001'), null),
        ('session without an active tenant (no session_context row)',
          tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ad', 'a0000000-0000-4000-8000-000000000001'), null),
        ('claims are not an object', '"authenticated"'::jsonb, null::uuid)) as v (label, claims, expected_tenant)
  loop
    set local role authenticated;
    perform tests.set_claims(c.claims);
    v_tenant := private.current_tenant_id();
    perform tests.assert_eq(v_tenant, c.expected_tenant, format('current_tenant_id() for: %s', c.label));
    for r in select * from tests.tenant_tables() loop
      if c.expected_tenant is null then
        perform tests.assert_eq(tests.count_rows(r.table_name), 0::bigint,
          format('%s: %s must read zero rows', r.table_name, c.label));
      end if;
    end loop;
    reset role;
  end loop;
end $$;

\echo '30_claim_validation_app_server: ok'
