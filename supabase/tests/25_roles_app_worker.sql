-- db-test: run-as=app_worker
-- Role assignments under SYSTEM claims (T-M2-03): platform jobs are not subject to the actor rules, but
-- the last-admin rule still holds. Runs CONNECTED AS app_worker.
\set ON_ERROR_STOP on

begin;
set local role authenticated;
select tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001'));
do $$
begin
  perform tests.assert_eq(tests.rows_affected($q$insert into platform.role_assignments (membership_id, role_code) select id, 'mentor' from platform.tenant_memberships where user_id = '00000000-0000-4000-8000-0000000000a2' and tenant_id = 'a0000000-0000-4000-8000-000000000001'$q$),
    1::bigint, 'system job: can give a role');
  perform tests.assert((select created_by is null from platform.role_assignments where role_code = 'mentor'),
    'system job: no person stamped');
  perform tests.assert_fails($q$delete from platform.role_assignments where role_code = 'tenant_admin'$q$,
    array['23514'], 'system job: cannot remove the last Organization Admin');
end $$;
rollback;

\echo '25_roles_app_worker: ok'
