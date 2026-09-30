-- db-test: run-as=app_worker
-- Tenant switch is refused for any login other than app_server. Runs CONNECTED AS app_worker.
\set ON_ERROR_STOP on
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab', 'a0000000-0000-4000-8000-000000000001'));
do $$
begin
  perform tests.assert(not private.switch_active_tenant('b0000000-0000-4000-8000-000000000001'),
    'switch_active_tenant is refused under app_worker');
end $$;
rollback;
\echo '51_tenant_switch_app_worker: ok'
