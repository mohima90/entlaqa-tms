-- db-test: run-as=app_worker
-- private.session_tenants() answers only app_server (the request path). Runs CONNECTED AS app_worker.
\set ON_ERROR_STOP on
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ad', null));
do $$
begin
  perform tests.assert_eq((select count(*) from private.session_tenants()), 0::bigint,
    'session_tenants returns nothing under app_worker');
end $$;
rollback;
\echo '53_session_tenants_app_worker: ok'
