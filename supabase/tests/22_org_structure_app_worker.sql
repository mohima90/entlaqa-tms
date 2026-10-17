-- db-test: run-as=app_worker
-- Branches and departments under SYSTEM claims (withSystemTx jobs, T-M2-01): jobs read the structure but
-- never write it — since S-M1 (20261020210000) units and branches are written by members holding
-- platform.org.manage only (the user import never creates them, PO decision 12; an HR sync would get its own
-- rule when it ships). Runs CONNECTED AS app_worker. Each block is rolled back.
\set ON_ERROR_STOP on

begin;
set local role authenticated;
select tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001')
  || jsonb_build_object('person_id', 'b1000000-0000-4000-8000-0000000000b1'));
do $$
begin
  perform tests.assert_eq(private.current_tenant_id(), 'a0000000-0000-4000-8000-000000000001'::uuid,
    'system claims resolve tenant A under app_worker');
  perform tests.assert((select count(*) from platform.departments) > 0 and (select count(*) from platform.branches) > 0,
    'system claims: jobs read the structure');
  perform tests.assert_rls_violation($q$insert into platform.departments (code, name_ar, parent_id, created_by) values ('JOB', 'قسم من مهمة', 'a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1')$q$,
    'system claims: no unit is added by a job');
  perform tests.assert_eq(tests.rows_affected($q$update platform.departments set deleted_at = now() where code = 'OPS'$q$),
    0::bigint, 'system claims: no unit is changed by a job');
  perform tests.assert_rls_violation($q$insert into platform.branches (code, name_ar) values ('JOB', 'فرع من مهمة')$q$,
    'system claims: no branch is added by a job');
  perform tests.assert_eq(tests.rows_affected($q$update platform.branches set name_ar = 'x' where code = 'JED'$q$),
    0::bigint, 'system claims: no branch is changed by a job');
end $$;
rollback;

\echo '22_org_structure_app_worker: ok'
