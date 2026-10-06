-- db-test: run-as=app_worker
-- Outbox and inbox under SYSTEM claims (background jobs, ADR 0004 §5; T-M2-06a): a job emits events as
-- the system actor and records processed events for its own tenant only, once per subscriber.
-- Runs CONNECTED AS app_worker. Each block is rolled back.
\set ON_ERROR_STOP on

do $$ begin perform tests.assert(session_user = 'app_worker', 'must run connected as app_worker'); end $$;

begin;
set local role authenticated;
select tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001', 'platform.events.deliver'));
do $$
declare
  v_event uuid := gen_random_uuid();
begin
  perform tests.assert_eq(tests.rows_affected($q$insert into platform.event_outbox (type) values ('com.entlaqa.platform.test.happened')$q$),
    1::bigint, 'system: emits an event for its tenant');
  perform tests.assert_rls_violation($q$insert into platform.event_outbox (tenant_id, type) values ('b0000000-0000-4000-8000-000000000001', 'com.entlaqa.platform.test.happened')$q$,
    'system: an event for tenant B is rejected by RLS');
  perform tests.assert_eq(tests.rows_affected(format($q$insert into platform.event_inbox (subscriber, event_id) values ('test.subscriber', %L)$q$, v_event)),
    1::bigint, 'system: records a processed event');
  perform tests.assert_eq(tests.rows_affected(format($q$insert into platform.event_inbox (subscriber, event_id) values ('test.subscriber', %L) on conflict do nothing$q$, v_event)),
    0::bigint, 'system: the same event is recorded once per subscriber');
  perform tests.assert_rls_violation(format($q$insert into platform.event_inbox (tenant_id, subscriber, event_id) values ('b0000000-0000-4000-8000-000000000001', 'test.subscriber', %L)$q$, gen_random_uuid()),
    'system: an inbox row for tenant B is rejected by RLS');
  perform tests.assert_fails(format($q$insert into platform.event_inbox (subscriber, event_id) values ('Bad Name', %L)$q$, gen_random_uuid()),
    array['23514'], 'subscriber names are lower-case identifiers');
  perform tests.assert_eq(tests.count_rows('platform.event_inbox'), 1::bigint, 'system: reads its own inbox rows');
end $$;
reset role;
rollback;

\echo '29_event_tables_app_worker: ok'

-- Committed for 33_event_tables_app_queue.sql: a job's event carries the system actor.
begin;
set local role authenticated;
select tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001', 'platform.events.deliver'));
insert into platform.event_outbox (type, actor_type, actor_id)
  values ('com.entlaqa.platform.test.system_stamped', 'user', '00000000-0000-4000-8000-0000000000a1');
commit;
