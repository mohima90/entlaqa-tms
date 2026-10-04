-- db-test: run-as=app_worker
-- Branches and departments under SYSTEM claims (withSystemTx jobs, T-M2-01): the tree rules apply and
-- no person is ever stamped, even if a person_id is smuggled into the system claims.
-- Runs CONNECTED AS app_worker. Each block is rolled back.
\set ON_ERROR_STOP on

begin;
set local role authenticated;
select tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001')
  || jsonb_build_object('person_id', 'b1000000-0000-4000-8000-0000000000b1'));
do $$
begin
  perform tests.assert_eq(private.current_tenant_id(), 'a0000000-0000-4000-8000-000000000001'::uuid,
    'system claims resolve tenant A under app_worker');
  insert into platform.departments (code, name_ar, parent_id, created_by)
  values ('JOB', 'قسم من مهمة', 'a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1');
  perform tests.assert((select created_by is null and updated_by is null from platform.departments where code = 'JOB'),
    'system claims: created_by/updated_by stay NULL (person_id ignored outside user claims)');
  update platform.departments set deleted_at = now() where code = 'JOB';
  perform tests.assert((select deleted_by is null from platform.departments where code = 'JOB'),
    'system claims: deleted_by stays NULL');
  perform tests.assert_fails($q$update platform.departments set parent_id = 'a3000000-0000-4000-8000-000000000002' where code = 'TD'$q$,
    array['23514'], 'system claims: tree rules still apply (cycle)');
end $$;
rollback;

\echo '22_org_structure_app_worker: ok'
