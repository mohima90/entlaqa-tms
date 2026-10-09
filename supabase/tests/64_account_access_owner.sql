-- db-test: run-as=owner
-- The Auth ban queue, worker side (FR-IAM-05, T-M2-09): what a lease says to do — ban an account that signs
-- in nowhere, unban one we banned once it signs in somewhere again, leave everything else alone (accounts
-- banned by someone else while they sign in somewhere; accounts already banned by us) — and the lease,
-- finish and retry rules. The worker functions answer only the app_worker LOGIN with system claims: each
-- block sets up the queue as the owner, then acts as the worker connects (SET LOCAL SESSION AUTHORIZATION
-- app_worker, role authenticated, system claims without tenant). Every block is rolled back; the last part
-- removes the fixtures of 62_member_deactivation_owner.sql again (committed).
--   uX  active in A and B          uR   active in A          uP  active in A (privileged)
--   uS  deactivated in A only      uSP  deactivated in A     uN  no membership, pending invitation in A
--   uC  (00) active only in suspended tenant C               uNone (00) no membership, no invitation
\set ON_ERROR_STOP on

-- As the worker: session user app_worker, role authenticated, system claims of a platform job.
create or replace function pg_temp.become_worker(p_claims jsonb default jsonb_build_object('role', 'system', 'job_id', 'tests.account_access'))
returns void language plpgsql as $$
begin
  set local session authorization app_worker;
  set local role authenticated;
  perform tests.set_claims(p_claims);
end $$;
create or replace function pg_temp.become_owner() returns void language plpgsql as $$
begin
  reset role;
  reset session authorization;
end $$;
-- Every lease until the queue has nothing due: user|action|attempts, in lease order.
create or replace function pg_temp.lease_all() returns text[] language plpgsql as $$
declare
  v_out text[] := '{}';
  v_row record;
begin
  for i in 1..50 loop
    select * into v_row from private.claim_account_access_check();
    exit when v_row.user_id is null;
    v_out := v_out || format('%s|%s|%s', v_row.user_id, v_row.action, v_row.attempts);
  end loop;
  return v_out;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- What each lease says
-- ---------------------------------------------------------------------------------------------------
begin;
insert into private.account_access_checks (user_id, requested_at) values
  ('9d000000-0000-4000-8000-000000000001', now() - interval '10 minutes'),  -- uX: active in A and B → none
  ('9d000000-0000-4000-8000-000000000004', now() - interval '9 minutes'),   -- uS: signs in nowhere → ban
  ('9d000000-0000-4000-8000-000000000002', now() - interval '8 minutes'),   -- uR: active, banned by us → unban
  ('9d000000-0000-4000-8000-000000000007', now() - interval '7 minutes'),   -- uN: invited, not ours → none
  ('00000000-0000-4000-8000-0000000000c1', now() - interval '6 minutes'),   -- uC: only a suspended tenant → ban
  ('9d000000-0000-4000-8000-000000000005', now() - interval '5 minutes'),   -- uSP: banned by us already → none
  ('9d000000-0000-4000-8000-000000000003', now() - interval '4 minutes'),   -- uP: active, banned by others → none
  ('00000000-0000-4000-8000-0000000000e1', now() - interval '3 minutes'),   -- uNone: banned by others for 15 min → ban
  ('00000000-0000-4000-8000-0000000000a1', now() + interval '1 minute');    -- uA: not due yet
update private.account_access_checks set not_before = now() + interval '1 minute'
where user_id = '00000000-0000-4000-8000-0000000000a1';
insert into private.account_bans (user_id) values
  ('9d000000-0000-4000-8000-000000000002'), ('9d000000-0000-4000-8000-000000000005');
update auth.users set banned_until = now() + interval '876000 hours'
where id in ('9d000000-0000-4000-8000-000000000002', '9d000000-0000-4000-8000-000000000005');
update auth.users set banned_until = now() + interval '15 minutes'
where id in ('9d000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000e1');
select pg_temp.become_worker();
do $$
begin
  perform tests.assert(session_user = 'app_worker' and current_user = 'authenticated', 'acting as the worker connects');
  perform tests.assert_eq(pg_temp.lease_all(), array[
    '9d000000-0000-4000-8000-000000000001|none|1',
    '9d000000-0000-4000-8000-000000000004|ban|1',
    '9d000000-0000-4000-8000-000000000002|unban|1',
    '9d000000-0000-4000-8000-000000000007|none|1',
    '00000000-0000-4000-8000-0000000000c1|ban|1',
    '9d000000-0000-4000-8000-000000000005|none|1',
    '9d000000-0000-4000-8000-000000000003|none|1',
    '00000000-0000-4000-8000-0000000000e1|ban|1'],
    'oldest first, each decided from the account''s memberships, invitations and bans; not-due checks wait');
  perform tests.assert_eq(pg_temp.lease_all(), '{}'::text[], 'leased checks are not handed out twice');
  perform tests.assert_privilege_denied($q$select * from private.account_access_checks$q$,
    'the queue itself is not readable by the worker (only through the functions)');
  perform tests.assert_fails($q$select private.account_should_be_banned('9d000000-0000-4000-8000-000000000004')$q$,
    array['42501'], 'the decision is not callable directly');
  perform tests.assert_fails($q$select private.queue_account_access_check('9d000000-0000-4000-8000-000000000004')$q$,
    array['42501'], 'jobs do not queue checks directly');
  perform tests.assert_fails($q$select private.reactivate_membership('9d100000-0000-4000-8000-0000000000a5')$q$,
    array['42501'], 'jobs do not reactivate members');
end $$;
select pg_temp.become_owner();
rollback;

-- An expired invitation no longer keeps an account without membership unbanned; nor does one of a
-- suspended organization.
begin;
insert into private.account_access_checks (user_id) values ('9d000000-0000-4000-8000-000000000007');
update platform.invitations set expires_at = now() - interval '1 minute' where id = '9d400000-0000-4000-8000-000000000001';
select pg_temp.become_worker();
do $$
begin
  perform tests.assert_eq(pg_temp.lease_all(), array['9d000000-0000-4000-8000-000000000007|ban|1'],
    'expired invitation: ban');
end $$;
select pg_temp.become_owner();
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Finish: the record of our bans; a newer change while the worker was busy is decided again at once
-- ---------------------------------------------------------------------------------------------------
begin;
insert into private.account_access_checks (user_id) values ('9d000000-0000-4000-8000-000000000004');
do $$
declare
  v_lease record;
  v_requested timestamptz;
begin
  perform pg_temp.become_worker();
  select * into v_lease from private.claim_account_access_check();
  perform tests.assert_eq(v_lease.action, 'ban', 'uS signs in nowhere: ban');
  -- Meanwhile (before Auth answered) uS is reactivated: the membership change renews the check.
  perform pg_temp.become_owner();
  update platform.persons set status = 'active' where id = '9d100000-0000-4000-8000-0000000000a5';
  update platform.tenant_memberships set status = 'active' where user_id = '9d000000-0000-4000-8000-000000000004';
  perform pg_temp.become_worker();
  perform tests.assert(not private.finish_account_access_check(v_lease.user_id, v_lease.requested_at, 'banned'),
    'the ban is recorded, but the check stays: a newer change asked for it');
  perform tests.assert_eq(pg_temp.lease_all(), array['9d000000-0000-4000-8000-000000000004|unban|1'],
    'decided again at once: we banned it and it signs in again → unban');
  perform pg_temp.become_owner();
  perform tests.assert(exists (select 1 from private.account_bans where user_id = '9d000000-0000-4000-8000-000000000004'),
    'the ban that Auth applied is recorded as ours');
  select requested_at into v_requested from private.account_access_checks
  where user_id = '9d000000-0000-4000-8000-000000000004';
  perform pg_temp.become_worker();
  perform tests.assert(private.finish_account_access_check('9d000000-0000-4000-8000-000000000004', v_requested, 'unbanned'),
    'finished: the check is removed');
  perform pg_temp.become_owner();
  perform tests.assert(not exists (select 1 from private.account_bans where user_id = '9d000000-0000-4000-8000-000000000004')
                       and not exists (select 1 from private.account_access_checks where user_id = '9d000000-0000-4000-8000-000000000004'),
    'unbanned: no longer ours, nothing waits');
end $$;
rollback;

-- Outcomes: gone removes our record; unchanged and refused keep it; anything else is refused.
begin;
insert into private.account_bans (user_id) values ('9d000000-0000-4000-8000-000000000002'), ('9d000000-0000-4000-8000-000000000003');
insert into private.account_access_checks (user_id, requested_at) values
  ('9d000000-0000-4000-8000-000000000002', '2026-10-11 10:00:00+00'),
  ('9d000000-0000-4000-8000-000000000003', '2026-10-11 10:00:00+00');
select pg_temp.become_worker();
do $$
begin
  perform tests.assert(private.finish_account_access_check('9d000000-0000-4000-8000-000000000002', '2026-10-11 10:00:00+00', 'gone'),
    'gone: finished');
  perform tests.assert(private.finish_account_access_check('9d000000-0000-4000-8000-000000000003', '2026-10-11 10:00:00+00', 'refused'),
    'refused: finished (the worker logs it)');
  perform tests.assert_fails($q$select private.finish_account_access_check('9d000000-0000-4000-8000-000000000003', now(), 'deleted')$q$,
    array['22023'], 'an unknown outcome is refused');
  perform tests.assert_fails($q$select private.finish_account_access_check(null, now(), 'banned')$q$,
    array['22023'], 'no account: refused');
end $$;
select pg_temp.become_owner();
do $$
begin
  perform tests.assert_eq((select array_agg(user_id::text) from private.account_bans
                           where user_id in ('9d000000-0000-4000-8000-000000000002', '9d000000-0000-4000-8000-000000000003')),
    array['9d000000-0000-4000-8000-000000000003'], 'gone removes the record; refused keeps it');
end $$;
rollback;

-- Retry: back-off from 15 s up to an hour, never given up.
begin;
insert into private.account_access_checks (user_id) values ('9d000000-0000-4000-8000-000000000004');
select pg_temp.become_worker();
do $$
declare
  v_lease record;
begin
  select * into v_lease from private.claim_account_access_check();
  perform tests.assert_eq(private.retry_account_access_check(v_lease.user_id), 1, 'first retry after attempt 1');
  select * into v_lease from private.claim_account_access_check();
  perform tests.assert(v_lease.user_id is null, 'not due during the back-off');
  perform tests.assert_eq(private.retry_account_access_check('9d000000-0000-4000-8000-0000000000ff'), 0,
    'an unknown check: nothing to put back');
end $$;
select pg_temp.become_owner();
do $$
begin
  perform tests.assert((select not_before between now() + interval '14 seconds' and now() + interval '16 seconds'
                               and leased_until is null
                        from private.account_access_checks where user_id = '9d000000-0000-4000-8000-000000000004'),
    'first back-off: 15 seconds');
  update private.account_access_checks set attempts = 40 where user_id = '9d000000-0000-4000-8000-000000000004';
end $$;
select pg_temp.become_worker();
do $$ begin perform tests.assert_eq(private.retry_account_access_check('9d000000-0000-4000-8000-000000000004'), 40, 'still retried'); end $$;
select pg_temp.become_owner();
do $$
begin
  perform tests.assert((select not_before between now() + interval '59 minutes' and now() + interval '61 minutes'
                        from private.account_access_checks where user_id = '9d000000-0000-4000-8000-000000000004'),
    'the back-off stops at an hour');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Wrong callers under the worker login
-- ---------------------------------------------------------------------------------------------------
begin;
insert into private.account_access_checks (user_id) values ('9d000000-0000-4000-8000-000000000004');
select pg_temp.become_worker(null);
do $$
begin
  perform tests.assert_fails($q$select * from private.claim_account_access_check()$q$, array['42501'], 'no claims: refused');
  perform tests.assert_fails($q$select private.finish_account_access_check('9d000000-0000-4000-8000-000000000004', now(), 'banned')$q$,
    array['42501'], 'no claims: no finish');
  perform tests.assert_fails($q$select private.retry_account_access_check('9d000000-0000-4000-8000-000000000004')$q$,
    array['42501'], 'no claims: no retry');
end $$;
select pg_temp.become_owner();
select pg_temp.become_worker(jsonb_build_object('role', 'system'));
do $$
begin
  perform tests.assert_fails($q$select * from private.claim_account_access_check()$q$, array['42501'], 'system claims without a job: refused');
end $$;
select pg_temp.become_owner();
select pg_temp.become_worker(tests.user_claims('9d000000-0000-4000-8000-000000000002', '9d200000-0000-4000-8000-000000000005',
                                               'a0000000-0000-4000-8000-000000000001'));
do $$
begin
  perform tests.assert_fails($q$select * from private.claim_account_access_check()$q$, array['42501'], 'user claims: refused');
end $$;
select pg_temp.become_owner();
-- A job of one organization (system claims with a tenant) is still a job: allowed (the queue has no tenant).
select pg_temp.become_worker(tests.system_claims('a0000000-0000-4000-8000-000000000001'));
do $$
begin
  perform tests.assert_eq(pg_temp.lease_all(), array['9d000000-0000-4000-8000-000000000004|ban|1'], 'a tenant job may lease too');
end $$;
select pg_temp.become_owner();
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Remove the fixtures of 62 (committed): the accounts (their memberships, roles, sessions, checks and
-- bans go with them), people, placements, departments, the invitation and the helpers.
-- ---------------------------------------------------------------------------------------------------
delete from platform.invitations where id = '9d400000-0000-4000-8000-000000000001';
delete from auth.users where id::text like '9d000000-%';
delete from platform.person_employment where person_id::text like '9d100000-%';
delete from platform.departments where id::text like '9d300000-%';
delete from platform.persons where id::text like '9d100000-%';
delete from private.account_access_checks;
delete from private.account_bans;
drop function tests.t09_as(text, text);
drop function tests.t09_deactivate(uuid);
do $$
begin
  perform tests.assert(not exists (select 1 from platform.tenant_memberships where user_id::text like '9d000000-%')
                       and not exists (select 1 from platform.session_context where user_id::text like '9d000000-%'),
    'fixtures removed');
end $$;

\echo '64_account_access_owner: ok'
