-- db-test: run-as=app_worker
-- (ADR 0002 §6a/§7) System-actor claims are accepted only under app_worker; user claims are not.
-- Runs CONNECTED AS app_worker.
\set ON_ERROR_STOP on

do $$ begin perform tests.assert(session_user = 'app_worker', 'must run connected as app_worker'); end $$;

begin;
set local role authenticated;
select tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001', 'notifications.dispatch'));
do $$
declare
  r record;
  v_foreign bigint;
begin
  perform tests.assert_eq(private.current_tenant_id(), 'a0000000-0000-4000-8000-000000000001'::uuid,
    'system claims under app_worker resolve the job tenant');
  perform tests.assert((select count(*) from platform.persons) > 0, 'system actor reads its tenant');
  for r in select * from tests.readable_tenant_tables() loop
    execute format('select count(*) from %s where %I <> %L', r.table_name, r.tenant_column, 'a0000000-0000-4000-8000-000000000001')
      into v_foreign;
    perform tests.assert_eq(v_foreign, 0::bigint, format('%s: system actor must not see other tenants', r.table_name));
  end loop;
  -- System actors write audit events with a NULL user actor.
  perform tests.assert_eq(tests.rows_affected($q$insert into platform.audit_events (action) values ('platform.job.completed')$q$),
    1::bigint, 'system actor may append audit events for its tenant');
  perform tests.assert_rls_violation($q$insert into platform.audit_events (tenant_id, action) values ('b0000000-0000-4000-8000-000000000001', 'platform.job.forged')$q$,
    'system actor cannot write into another tenant');
  perform tests.assert_rls_violation($q$insert into platform.audit_events (actor_person_id, action) values ('a1000000-0000-4000-8000-0000000000a1', 'platform.job.forged')$q$,
    'system actor cannot attribute an audit event to a person');
end $$;
rollback;

-- No temporary tables (TEMPORARY is revoked from PUBLIC): the cases are a VALUES list.

do $$
declare
  c record;
  r record;
begin
  for c in
    select * from (values
      ('system claims for a suspended tenant', tests.system_claims('c0000000-0000-4000-8000-000000000001')),
      ('system claims without job_id', jsonb_build_object('role', 'system', 'tenant_id', 'a0000000-0000-4000-8000-000000000001')),
      ('system claims with blank job_id', tests.system_claims('a0000000-0000-4000-8000-000000000001', '  ')),
      ('valid user claims under app_worker',
        tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-000000000001')),
      ('no claims', null::jsonb)) as v (label, claims)
  loop
    set local role authenticated;
    perform tests.set_claims(c.claims);
    perform tests.assert(private.current_tenant_id() is null, format('current_tenant_id() must be NULL for: %s', c.label));
    for r in select * from tests.readable_tenant_tables() loop
      perform tests.assert_eq(tests.count_rows(r.table_name), 0::bigint, format('%s: %s must read zero rows', r.table_name, c.label));
    end loop;
    reset role;
  end loop;
end $$;

do $$
begin
  perform tests.assert_privilege_denied('select count(*) from platform.persons',
    'app_worker without set role must not read tenant tables');
end $$;

\echo '31_claim_validation_app_worker: ok'
