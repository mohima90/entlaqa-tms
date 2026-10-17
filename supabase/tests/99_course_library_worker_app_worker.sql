-- db-test: run-as=app_worker
-- Course library (T-M3-03): background jobs (system claims under app_worker) read their organization's
-- library — later planning jobs need it — and never change it; another organization's rows stay invisible.
\set ON_ERROR_STOP on

do $$ begin perform tests.assert(session_user = 'app_worker', 'must run connected as app_worker'); end $$;

begin;
set local role authenticated;
select tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001'));
do $$
begin
  perform tests.assert_eq(private.current_tenant_id(), 'a0000000-0000-4000-8000-000000000001'::uuid,
    'system claims resolve tenant A under app_worker');
  perform tests.assert_eq((select count(*) from tms.courses), 2::bigint, 'a job reads its organization''s courses');
  perform tests.assert_eq((select count(*) from tms.courses where tenant_id <> 'a0000000-0000-4000-8000-000000000001'),
    0::bigint, 'and no other organization''s');
  perform tests.assert_fails_like($q$insert into tms.courses (code, title_en, title_ar, delivery_type, duration_hours, max_participants) values ('JOB-1', 'Job', 'مهمة', 'classroom', 1, 10)$q$,
    'only signed-in members change the course library', 'a job cannot add a course');
  perform tests.assert_fails_like($q$update tms.courses set status = 'active' where id = 'a7100000-0000-4000-8000-000000000002'$q$,
    'only signed-in members change the course library', 'a job cannot restore a course');
  perform tests.assert_fails_like($q$insert into tms.course_categories (name_en, name_ar) values ('Job', 'مهمة')$q$,
    'only signed-in members change the course library', 'a job cannot add a category');
end $$;
rollback;

\echo '99_course_library_worker_app_worker: ok'
