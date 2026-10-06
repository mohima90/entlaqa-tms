-- db-test: run-as=app_worker
-- Message delivery log under SYSTEM claims (ADR 0008 §7; T-M2-06b): a job queues an e-mail for its own
-- tenant, claims it, records the outcome; content and the plain address go once the delivery is final;
-- the lifecycle and what is sent cannot be bent. Runs CONNECTED AS app_worker. Each block is rolled back.
\set ON_ERROR_STOP on

do $$ begin perform tests.assert(session_user = 'app_worker', 'must run connected as app_worker'); end $$;

begin;
set local role authenticated;
select tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001', 'platform.events.deliver'));
do $$
declare
  v_id uuid;
  v_row platform.message_deliveries;
  queue_sql constant text := $q$insert into platform.message_deliveries
      (template, template_version, locale, recipient_person_id, destination, destination_masked, subject, html_body, text_body)
      values ('platform.invitation', 1, 'ar', 'a1000000-0000-4000-8000-0000000000a1', 'sara@tenant-a.example',
              's***@tenant-a.example', 'دعوة', '<p>مرحبًا</p>', 'مرحبًا') returning id$q$;
begin
  execute queue_sql into v_id;
  perform tests.assert_eq(tests.count_rows('platform.message_deliveries'), 2::bigint,
    'system: sees its own tenant''s deliveries only (the fixtures hold one each of tenants A, B and C)');
  select * into v_row from platform.message_deliveries where id = v_id;
  perform tests.assert_eq(v_row.status || ':' || v_row.attempts, 'queued:0', 'a delivery starts queued');

  -- Claim, temporary failure back to queued, claim again, sent: content and address removed.
  perform tests.assert_eq(tests.rows_affected(format($q$update platform.message_deliveries set status = 'sending', attempts = attempts + 1 where id = %L$q$, v_id)),
    1::bigint, 'claim');
  perform tests.assert_eq(tests.rows_affected(format($q$update platform.message_deliveries set status = 'queued', error_code = 'PROVIDER_UNAVAILABLE' where id = %L$q$, v_id)),
    1::bigint, 'a temporary failure returns it to the queue');
  perform tests.assert_fails(format($q$update platform.message_deliveries set attempts = 0 where id = %L$q$, v_id),
    array['23514'], 'attempts only grow');
  perform tests.assert_fails(format($q$update platform.message_deliveries set destination = 'attacker@evil.example' where id = %L$q$, v_id),
    array['23514'], 'the address cannot change');
  perform tests.assert_fails(format($q$update platform.message_deliveries set html_body = '<a href="https://evil.example">x</a>' where id = %L$q$, v_id),
    array['23514'], 'the content cannot change');
  perform tests.assert_fails(format($q$update platform.message_deliveries set id = gen_random_uuid() where id = %L$q$, v_id),
    array['23514'], 'the id (idempotency key) cannot change');
  perform tests.assert_fails(format($q$update platform.message_deliveries set status = 'sent', sent_at = now(), provider = 'resend' where id = %L$q$, v_id),
    array['23514'], 'a sent delivery keeps no content');
  perform tests.assert_eq(tests.rows_affected(format($q$update platform.message_deliveries set status = 'sent', sent_at = now(), provider = 'resend',
      provider_message_id = 'msg_1', error_code = null, destination = null, subject = null, html_body = null, text_body = null where id = %L$q$, v_id)),
    1::bigint, 'sent: outcome recorded, content removed');
  perform tests.assert_fails(format($q$update platform.message_deliveries set status = 'queued' where id = %L$q$, v_id),
    array['23514'], 'a finished delivery never changes');
  select * into v_row from platform.message_deliveries where id = v_id;
  perform tests.assert_eq(v_row.destination_masked || ':' || v_row.template || ':' || v_row.locale,
    's***@tenant-a.example:platform.invitation:ar', 'the log keeps template, language and masked address');

  -- Inserts start clean; tenant B is out of reach.
  perform tests.assert_fails($q$insert into platform.message_deliveries (template, template_version, locale, destination, destination_masked, subject, html_body, text_body, status)
      values ('platform.invitation', 1, 'ar', 'a@x.example', 'a***@x.example', 's', 'h', 't', 'sent')$q$,
    array['23514'], 'a delivery cannot be inserted as sent');
  perform tests.assert_fails($q$insert into platform.message_deliveries (template, template_version, locale, destination, destination_masked, subject, html_body, text_body)
      values ('platform.invitation', 1, 'fr', 'a@x.example', 'a***@x.example', 's', 'h', 't')$q$,
    array['23514'], 'Arabic or English only');
  perform tests.assert_fails($q$insert into platform.message_deliveries (template, template_version, locale, destination, destination_masked, subject, html_body, text_body)
      values ('platform.invitation', 1, 'ar', 'not-an-address', 'a***', 's', 'h', 't')$q$,
    array['23514'], 'the destination is an e-mail address');
  perform tests.assert_fails($q$insert into platform.message_deliveries (template, template_version, locale, recipient_person_id, destination, destination_masked, subject, html_body, text_body)
      values ('platform.invitation', 1, 'ar', 'b1000000-0000-4000-8000-0000000000b1', 'a@x.example', 'a***@x.example', 's', 'h', 't')$q$,
    array['23503', '42501'], 'the recipient must be a person of the same tenant');
  perform tests.assert_rls_violation($q$insert into platform.message_deliveries (tenant_id, template, template_version, locale, destination, destination_masked, subject, html_body, text_body)
      values ('b0000000-0000-4000-8000-000000000001', 'platform.invitation', 1, 'ar', 'a@x.example', 'a***@x.example', 's', 'h', 't')$q$,
    'system: a delivery for tenant B is rejected by RLS');
  perform tests.assert_eq(tests.rows_affected($q$update platform.message_deliveries set status = 'suppressed', error_code = 'X1',
      destination = null, subject = null, html_body = null, text_body = null where tenant_id = 'b0000000-0000-4000-8000-000000000001'$q$),
    0::bigint, 'system: cannot touch tenant B''s deliveries');
  perform tests.assert_privilege_denied($q$delete from platform.message_deliveries$q$, 'nobody deletes deliveries (retention job later)');
  -- An active organization's jobs finish deliveries through RLS, never through the discard function.
  perform tests.assert(not private.discard_inactive_tenant_delivery('a8000000-0000-4000-8000-000000000001'),
    'system (active tenant): the discard function does nothing');
  perform tests.assert_eq((select status from platform.message_deliveries where id = 'a8000000-0000-4000-8000-000000000001'),
    'queued', 'the active tenant''s delivery is untouched');
end $$;
reset role;
rollback;

-- Suspended tenant C: its job cannot reach the delivery through RLS, but discards it (content removed).
begin;
set local role authenticated;
select tests.set_claims(tests.system_claims('c0000000-0000-4000-8000-000000000001', 'platform.events.deliver'));
do $$
begin
  perform tests.assert_eq(tests.count_rows('platform.message_deliveries'), 0::bigint,
    'system (suspended tenant): RLS hides every delivery');
  perform tests.assert(not private.discard_inactive_tenant_delivery('b8000000-0000-4000-8000-000000000001'),
    'system (suspended tenant): cannot discard another tenant''s delivery');
  -- The row turns suppressed; its check constraint guarantees content and address are gone (the
  -- end-to-end case in packages/platform-notifications/src/jobs/email.integration.test.ts reads it back).
  perform tests.assert(private.discard_inactive_tenant_delivery('c8000000-0000-4000-8000-000000000001'),
    'system (suspended tenant): discards its waiting delivery');
  perform tests.assert(not private.discard_inactive_tenant_delivery('c8000000-0000-4000-8000-000000000001'),
    'a discarded delivery is final: a repeat does nothing');
end $$;
reset role;
rollback;

-- Claims that are not a job's: nothing is discarded.
begin;
set local role authenticated;
select tests.set_claims(jsonb_build_object('role', 'system', 'tenant_id', 'c0000000-0000-4000-8000-000000000001'));
do $$ begin
  perform tests.assert(not private.discard_inactive_tenant_delivery('c8000000-0000-4000-8000-000000000001'),
    'system claims without a job id: nothing discarded');
end $$;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000c1', '10000000-0000-4000-8000-0000000000c1',
  'c0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-0000000000c1'));
do $$ begin
  perform tests.assert(not private.discard_inactive_tenant_delivery('c8000000-0000-4000-8000-000000000001'),
    'user claims: nothing discarded');
end $$;
reset role;
rollback;

\echo '34_message_deliveries_app_worker: ok'
