-- db-test: run-as=owner
-- Invitations (T-M2-07, FR-IAM-03), checked as the owner: the acceptance committed by
-- 36_invitations_app_server.sql wrote its domain event with the new member as actor; the lifecycle holds
-- for every role (final states, immutable purpose); acceptance only before expiry. Each block rolled back.
\set ON_ERROR_STOP on

begin;
do $$
declare
  n integer;
begin
  perform tests.assert_eq((select row(tenant_id, actor_type, actor_id, subject, data)::text from platform.event_outbox
                           where type = 'com.entlaqa.platform.invitation.accepted'),
    row('a0000000-0000-4000-8000-000000000001'::uuid, 'user', '00000000-0000-4000-8000-0000000000f4'::uuid,
        'a4000000-0000-4000-8000-000000000004'::uuid, '{}'::jsonb)::text,
    'invitation.accepted: thin event of the organization, actor = the new member');
  perform tests.assert_eq((select count(*) from platform.event_outbox where type = 'com.entlaqa.platform.invitation.accepted'),
    1::bigint, 'exactly one acceptance event (the rolled-back ones left nothing)');
  perform tests.assert_eq(
    (select count(*) from platform.tenant_memberships where user_id = '00000000-0000-4000-8000-0000000000a1'
       and tenant_id = 'b0000000-0000-4000-8000-000000000001'),
    0::bigint, 'the rolled-back caller acceptance left no membership');

  -- Final states never change, for any role.
  perform tests.assert_fails($q$update platform.invitations set status = 'pending', accepted_at = null, accepted_user_id = null where id = 'a4000000-0000-4000-8000-000000000004'$q$,
    array['23514'], 'accepted is final');
  perform tests.assert_fails($q$update platform.invitations set status = 'pending', revoked_at = null where id = 'a4000000-0000-4000-8000-000000000003'$q$,
    array['23514'], 'revoked is final');
  perform tests.assert_fails($q$update platform.invitations set email = 'other@a.test' where id = 'a4000000-0000-4000-8000-000000000001'$q$,
    array['23514'], 'the e-mail of an invitation never changes');
  perform tests.assert_fails($q$update platform.invitations set primary_role = 'tenant_admin' where id = 'a4000000-0000-4000-8000-000000000001'$q$,
    array['23514'], 'the roles of an invitation never change');
  perform tests.assert_fails($q$update platform.invitations set send_count = 0 where id = 'a4000000-0000-4000-8000-000000000001'$q$,
    array['23514'], 'the send count changes only with a new token');
  perform tests.assert_fails($q$insert into platform.invitations (tenant_id, person_id, email, locale, primary_role, invited_by, status) values ('a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000e6', 'notoken@a.test', 'ar', 'learner', '00000000-0000-4000-8000-0000000000a1', 'accepted')$q$,
    array['23514'], 'an invitation starts pending');
  -- No resend request beyond the e-mail limit (also for platform operations): a4…06 gets its 4 e-mails.
  for n in 1..4 loop
    update platform.invitations set token_hash = tests.token_hash('own-' || n) where id = 'a4000000-0000-4000-8000-000000000006';
  end loop;
  perform tests.assert_fails($q$update platform.invitations set resend_requested_at = now() where id = 'a4000000-0000-4000-8000-000000000006'$q$,
    array['23514'], 'no resend request once all 4 e-mails went out');
  -- Acceptance only before expiry (also for platform operations).
  perform tests.assert_fails($q$update platform.invitations set status = 'accepted', accepted_user_id = gen_random_uuid() where id = 'a4000000-0000-4000-8000-000000000002'$q$,
    array['23514'], 'an expired invitation cannot be accepted');
  -- The link, acceptance and sign-up gate functions are owned by invitation_guard and run as it.
  perform tests.assert_eq((select string_agg(distinct pg_get_userbyid(proowner), ',') from pg_proc
                           where proname in ('invitation_by_token', 'invitation_link', 'accept_invitation_as_caller',
                                             'apply_invitation_acceptance', 'invitation_allows_signup')),
    'invitation_guard', 'owner of the acceptance functions');
end $$;
rollback;

\echo '38_invitations_owner: ok'
