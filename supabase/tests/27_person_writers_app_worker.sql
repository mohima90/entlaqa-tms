-- db-test: run-as=app_worker
-- System jobs (HR sync) keep maintaining the directory under the person write guard (TM-0004 F-PEO-01).
-- Runs CONNECTED AS app_worker.
\set ON_ERROR_STOP on

begin;
set local role authenticated;
select tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001'));
do $$
begin
  perform tests.assert_eq(tests.rows_affected($q$update platform.persons set employee_number = 'SYNC-1' where id = 'a1000000-0000-4000-8000-0000000000ab'$q$),
    1::bigint, 'system job: updates a person');
  perform tests.assert_eq(tests.rows_affected($q$update platform.person_employment set job_title_ar = 'من نظام الموارد البشرية' where person_id = 'a1000000-0000-4000-8000-0000000000ab'$q$),
    1::bigint, 'system job: updates a placement');
  perform tests.assert_eq(tests.rows_affected($q$insert into platform.persons (display_name_ar) values ('من المزامنة')$q$),
    1::bigint, 'system job: creates a person');
end $$;
rollback;

\echo '27_person_writers_app_worker: ok'
