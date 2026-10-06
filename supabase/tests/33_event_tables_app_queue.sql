-- db-test: run-as=app_queue
-- The job runner role (ADR 0005 §2; T-M2-06a): reads the outbox of every tenant to dispatch it and may
-- only mark pending events dispatched; it reads no business table, writes no event, and is not a member
-- of authenticated. Runs CONNECTED AS app_queue. Each block is rolled back.
\set ON_ERROR_STOP on

do $$
begin
  perform tests.assert(session_user = 'app_queue', 'must run connected as app_queue');
  perform tests.assert(not pg_has_role('app_queue', 'authenticated', 'MEMBER'), 'app_queue is not a member of authenticated');
  perform tests.assert((select pg_get_userbyid(nspowner) from pg_namespace where nspname = 'graphile_worker') = 'app_queue',
    'app_queue owns the graphile_worker schema');
end $$;

begin;
do $$
begin
  -- Events committed by the fixtures (tenant B, platform operation), 28 (user) and 29 (system job).
  perform tests.assert_eq((select count(distinct tenant_id) from platform.event_outbox where dispatched_at is null), 2::bigint,
    'app_queue: sees pending events of every tenant');
  perform tests.assert_eq((select actor_type || ':' || actor_id::text from platform.event_outbox
                           where type = 'com.entlaqa.platform.test.user_stamped'),
    'user:00000000-0000-4000-8000-0000000000a1', 'user event: actor stamped from the claims, forged values ignored');
  perform tests.assert_eq((select actor_type || ':' || coalesce(actor_id::text, '-') from platform.event_outbox
                           where type = 'com.entlaqa.platform.test.system_stamped'),
    'system:-', 'job event: system actor, no user');
  perform tests.assert_eq((select actor_type from platform.event_outbox where type = 'com.entlaqa.platform.test.fixture'),
    'platform', 'platform operation: platform actor');
  perform tests.assert_eq(tests.rows_affected($q$update platform.event_outbox set dispatched_at = now() where dispatched_at is null$q$),
    3::bigint, 'app_queue: marks pending events dispatched');
  perform tests.assert_eq(tests.rows_affected($q$update platform.event_outbox set dispatched_at = now()$q$),
    0::bigint, 'app_queue: cannot touch an event already dispatched');
  perform tests.assert_privilege_denied($q$update platform.event_outbox set data = '{}'$q$,
    'app_queue: cannot change an event');
  perform tests.assert_privilege_denied($q$insert into platform.event_outbox (tenant_id, type) values ('a0000000-0000-4000-8000-000000000001', 'com.entlaqa.platform.test.happened')$q$,
    'app_queue: cannot write events');
  perform tests.assert_privilege_denied($q$delete from platform.event_outbox$q$, 'app_queue: cannot delete events');
  perform tests.assert_privilege_denied($q$select count(*) from platform.persons$q$, 'app_queue: reads no business table');
  perform tests.assert_privilege_denied($q$select count(*) from platform.event_inbox$q$, 'app_queue: no access to the inbox');
  perform tests.assert_privilege_denied($q$set role authenticated$q$, 'app_queue: cannot become authenticated');
end $$;
rollback;

\echo '33_event_tables_app_queue: ok'
