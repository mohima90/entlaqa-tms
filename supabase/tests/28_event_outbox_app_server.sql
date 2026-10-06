-- db-test: run-as=app_server
-- Domain-event outbox and inbox under USER claims (ADR 0004 §1, §5; T-M2-06a): a request inserts events
-- for its own tenant only, with the actor taken from its claims; it can neither read nor change events,
-- and never touches the inbox. Runs CONNECTED AS app_server. Each block is rolled back, except the
-- one committed event checked by 33_event_tables_app_queue.sql (actor stamped from the claims).
\set ON_ERROR_STOP on

do $$ begin perform tests.assert(session_user = 'app_server', 'must run connected as app_server'); end $$;

begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
do $$
begin
  perform tests.assert_eq(tests.rows_affected($q$insert into platform.event_outbox (type, subject, data, actor_type, actor_id, dispatched_at)
      values ('com.entlaqa.platform.test.happened', 'a1000000-0000-4000-8000-0000000000a2', '{"n": 1}',
              'system', 'b1000000-0000-4000-8000-0000000000b1', now())$q$),
    1::bigint, 'user: inserts an event for the own tenant');
  perform tests.assert_rls_violation($q$insert into platform.event_outbox (tenant_id, type) values ('b0000000-0000-4000-8000-000000000001', 'com.entlaqa.platform.test.happened')$q$,
    'user: an event for tenant B is rejected by RLS');
  perform tests.assert_privilege_denied($q$select count(*) from platform.event_outbox$q$,
    'user: cannot read the outbox (append-only, ADR 0004)');
  perform tests.assert_privilege_denied($q$update platform.event_outbox set dispatched_at = now()$q$,
    'user: cannot mark events dispatched');
  perform tests.assert_privilege_denied($q$delete from platform.event_outbox$q$,
    'user: cannot delete events');
  perform tests.assert_fails($q$insert into platform.event_outbox (type) values ('platform.test.happened')$q$,
    array['23514'], 'type must be com.entlaqa.<module>.<entity>.<action>');
  perform tests.assert_fails($q$insert into platform.event_outbox (type, data) values ('com.entlaqa.platform.test.happened', '[1]')$q$,
    array['23514'], 'data must be a JSON object');
  -- The inbox belongs to jobs: a user request can neither record nor read processed events.
  perform tests.assert_rls_violation($q$insert into platform.event_inbox (subscriber, event_id) values ('test.subscriber', gen_random_uuid())$q$,
    'user: cannot write the inbox');
  perform tests.assert_eq(tests.count_rows('platform.event_inbox'), 0::bigint, 'user: reads no inbox rows');
end $$;
reset role;
rollback;

\echo '28_event_outbox_app_server: ok'

-- Committed for 33_event_tables_app_queue.sql: forged actor fields are replaced by the verified subject.
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
insert into platform.event_outbox (type, actor_type, actor_id, dispatched_at)
  values ('com.entlaqa.platform.test.user_stamped', 'system', 'b1000000-0000-4000-8000-0000000000b1', now());
commit;
