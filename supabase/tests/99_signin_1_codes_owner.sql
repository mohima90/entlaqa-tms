-- db-test: run-as=owner
-- Sign in with an e-mailed code and remembered browsers (WP-ADM-05; FR-IAM-12; business flow
-- EP-AUTH-signin-extras, PO answers 21 and 23 Oct 2026). Runs as the owner and switches to the login roles
-- (app_server for the web app, app_worker for the job), as 68_security_owner.sql does. Every block is rolled
-- back. Covers: the same answer for any address (no enumeration), one request a minute per address, the
-- worker's account decision, the keyed hash (the code is stored nowhere in the clear), 10 minutes, single use,
-- 5 wrong tries, only the newest code works, no way to read the table, remembered browsers (strictest
-- organization wins, shortening applies at once, token binding), the reading and forgetting rules and
-- cross-tenant cases.
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------------------------------
-- Requests: the same answer for every address; at most one a minute per address
-- ---------------------------------------------------------------------------------------------------
begin;
delete from private.sign_in_codes;
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(null);
do $$
declare
  r record;
  v_ids uuid[] := '{}';
begin
  for r in select * from private.request_sign_in_code('ua@a.test') loop
    perform tests.assert(r.outcome = 'queued' and r.request_id is not null and r.retry_after = 0, 'a known address: queued, with an id');
    v_ids := v_ids || r.request_id;
  end loop;
  -- Unknown, suspended, without any membership, in another case / with spaces: the same answer, each with an id.
  for r in select * from private.request_sign_in_code('nobody@nowhere.test') loop
    perform tests.assert(r.outcome = 'queued' and r.request_id is not null and r.retry_after = 0, 'an unknown address: the same answer');
    v_ids := v_ids || r.request_id;
  end loop;
  for r in select * from private.request_sign_in_code('  USUS@a.test ') loop
    perform tests.assert(r.outcome = 'queued' and r.request_id is not null, 'a suspended member: the same answer');
    v_ids := v_ids || r.request_id;
  end loop;
  for r in select * from private.request_sign_in_code('unone@e.test') loop
    perform tests.assert(r.outcome = 'queued' and r.request_id is not null, 'an account without a membership: the same answer');
    v_ids := v_ids || r.request_id;
  end loop;
  perform tests.assert(cardinality(v_ids) = 4 and (select count(distinct x) from unnest(v_ids) x) = 4, 'four distinct request ids');
  -- Not an address at all: the same shape, nothing stored.
  for r in select * from private.request_sign_in_code('not an address') loop
    perform tests.assert(r.outcome = 'queued' and r.request_id is not null and r.retry_after = 0, 'garbage: the same answer');
  end loop;
  -- The second request within a minute: no new id, the seconds to wait (the same for known and unknown).
  for r in select * from private.request_sign_in_code('ua@a.test') loop
    perform tests.assert(r.outcome = 'too_soon' and r.request_id is null and r.retry_after between 1 and 60, 'a second code within a minute: too soon');
  end loop;
  for r in select * from private.request_sign_in_code('nobody@nowhere.test') loop
    perform tests.assert(r.outcome = 'too_soon' and r.request_id is null and r.retry_after between 1 and 60, 'an unknown address: too soon as well');
  end loop;
  perform tests.assert_privilege_denied($q$select * from private.sign_in_codes$q$, 'the table is not readable by the web app');
  perform tests.assert_privilege_denied($q$select * from private.sign_in_code_secret$q$, 'nor the key');
  perform tests.assert_privilege_denied($q$insert into private.sign_in_codes (mode, email) values ('code', 'x@y.test')$q$, 'nor writable');
  perform tests.assert_fails($q$select * from private.claim_sign_in_code_request()$q$, array['42501'], 'the web app does not lease requests');
  perform tests.assert_fails($q$select private.issue_sign_in_code(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), '123456', 'tokentokentokentoken')$q$,
    array['42501'], 'nor issue codes');
end $$;
set local session authorization default;
do $$
begin
  perform tests.assert_eq((select count(*) from private.sign_in_codes), 4::bigint, 'four requests stored, none for garbage');
  perform tests.assert_eq((select count(*) from private.sign_in_codes where mode = 'code' and state = 'requested' and code_hash is null and link_token is null), 4::bigint,
    'all waiting for the worker, no code anywhere yet');
end $$;
-- Other login roles: refused.
set local session authorization app_worker;
set local role authenticated;
select tests.set_claims(jsonb_build_object('role', 'system', 'job_id', 'tests.sic'));
do $$
begin
  perform tests.assert_fails($q$select * from private.request_sign_in_code('ua@a.test')$q$, array['42501'], 'the worker does not queue requests');
  perform tests.assert_fails($q$select * from private.verify_sign_in_code(gen_random_uuid(), 'ua@a.test', '123456')$q$, array['42501'], 'nor check codes');
  perform tests.assert_privilege_denied($q$select * from private.sign_in_codes$q$, 'the table is not readable by the worker');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- The worker's decision (only a job may lease): who gets a code, in which organization and language
-- ---------------------------------------------------------------------------------------------------
begin;
delete from private.sign_in_codes;
insert into private.sign_in_codes (id, mode, email, created_at) values
  ('11111111-0000-4000-8000-000000000001', 'code', 'ua@a.test', now() - interval '5 minutes'),
  ('11111111-0000-4000-8000-000000000002', 'code', 'nobody@nowhere.test', now() - interval '4 minutes'),
  ('11111111-0000-4000-8000-000000000003', 'code', 'usus@a.test', now() - interval '3 minutes'),
  ('11111111-0000-4000-8000-000000000004', 'code', 'unone@e.test', now() - interval '2 minutes'),
  ('11111111-0000-4000-8000-000000000005', 'code', 'uab@ab.test', now() - interval '1 minute');
set local session authorization app_worker;
set local role authenticated;
select tests.set_claims(null);
do $$
begin
  perform tests.assert_fails($q$select * from private.claim_sign_in_code_request()$q$, array['42501'], 'no claims: refused');
end $$;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-000000000001'));
do $$
begin
  perform tests.assert_fails($q$select * from private.claim_sign_in_code_request()$q$, array['42501'], 'user claims: refused');
end $$;
select tests.set_claims(jsonb_build_object('role', 'system'));
do $$
begin
  perform tests.assert_fails($q$select * from private.claim_sign_in_code_request()$q$, array['42501'], 'system claims without a job: refused');
end $$;
select tests.set_claims(jsonb_build_object('role', 'system', 'job_id', 'tests.sic'));
do $$
declare
  r record;
  v_got text[] := '{}';
begin
  loop
    select * into r from private.claim_sign_in_code_request();
    exit when r.id is null;
    -- uAB belongs to A and B: the organization is the most recently used one (either is right here).
    v_got := v_got || concat_ws('|', r.mode, r.outcome, coalesce(r.email, ''),
                                case when r.email = 'uab@ab.test' and r.tenant_id in ('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001')
                                     then 'a0000000-0000-4000-8000-000000000001' else coalesce(r.tenant_id::text, '') end,
                                coalesce(r.locale, ''), r.attempts::text);
    exit when cardinality(v_got) > 10;
  end loop;
  perform tests.assert_eq(v_got, array[
    'code|send|ua@a.test|a0000000-0000-4000-8000-000000000001|ar|1',
    'code|unknown_account||||1',
    'code|no_membership||||1',
    'code|no_membership||||1',
    'code|send|uab@ab.test|a0000000-0000-4000-8000-000000000001|ar|1'], 'oldest first: send / unknown / suspended / no membership / two organizations');
  perform tests.assert_eq((select count(*) from private.claim_sign_in_code_request()), 0::bigint, 'leased requests are not handed out twice');
  perform tests.assert(private.retry_sign_in_code_request('11111111-0000-4000-8000-000000000001'), 'put back for a later attempt');
  perform tests.assert(not private.retry_sign_in_code_request(gen_random_uuid()), 'unknown request: false');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- The life of a code: issue, check, tries, single use, expiry, only the newest works
-- ---------------------------------------------------------------------------------------------------
begin;
delete from private.sign_in_codes;
delete from platform.audit_events where action = 'platform.auth.sign_in_code_sent';
insert into private.sign_in_codes (id, mode, email) values
  ('22222222-0000-4000-8000-000000000001', 'code', 'ua@a.test'),
  ('22222222-0000-4000-8000-000000000002', 'code', 'nobody@nowhere.test');
set local session authorization app_worker;
set local role authenticated;
select tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001', 'tests.sic'));
do $$
begin
  perform tests.assert_fails($q$select private.issue_sign_in_code('22222222-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-000000000001', '12345', 'tokentokentokentoken')$q$,
    array['22023'], 'a code must be six digits');
  perform tests.assert_fails($q$select private.issue_sign_in_code('22222222-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-000000000001', '123456', 'short')$q$,
    array['22023'], 'and come with a real token');
  perform tests.assert(private.issue_sign_in_code('22222222-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1',
                                                  'a0000000-0000-4000-8000-000000000001', '123456', 'tokentokentokentoken'), 'the code is issued');
  perform tests.assert(not private.issue_sign_in_code('22222222-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1',
                                                      'a0000000-0000-4000-8000-000000000001', '654321', 'tokentokentokentoken'), 'an issued request is not issued again');
  -- The unknown address: no code, but the row looks like any other.
  perform tests.assert(private.sign_in_code_dead_end('22222222-0000-4000-8000-000000000002'), 'the dead end is recorded');
end $$;
set local session authorization default;
do $$
begin
  perform tests.assert_eq((select count(*) from platform.audit_events where action = 'platform.auth.sign_in_code_sent' and tenant_id = 'a0000000-0000-4000-8000-000000000001'),
    1::bigint, 'code sent is audited in the organization');
  perform tests.assert_eq((select data::text from platform.audit_events where action = 'platform.auth.sign_in_code_sent'), '{"method": "email_code"}', 'without the code or the address');
  -- Only a keyed hash: not a plain SHA-256 of the code, and the code appears nowhere in the row.
  perform tests.assert((select code_hash is not null and code_hash <> sha256('123456'::bytea) and code_hash <> sha256(('22222222-0000-4000-8000-000000000001:123456')::bytea)
                        from private.sign_in_codes where id = '22222222-0000-4000-8000-000000000001'), 'only a keyed hash is stored');
  perform tests.assert((select position('123456' in c::text) = 0 from private.sign_in_codes c where id = '22222222-0000-4000-8000-000000000001'), 'the code is in no column');
  perform tests.assert((select code_hash is null and state = 'issued' and expires_at = created_at + interval '10 minutes'
                        from private.sign_in_codes where id = '22222222-0000-4000-8000-000000000002'), 'an unknown address: nothing can match, same expiry rule');
  perform tests.assert((select expires_at > now() + interval '9 minutes 50 seconds' and expires_at <= now() + interval '10 minutes'
                        from private.sign_in_codes where id = '22222222-0000-4000-8000-000000000001'), 'valid for 10 minutes');
end $$;
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(null);
do $$
declare
  r record;
begin
  select * into r from private.verify_sign_in_code('22222222-0000-4000-8000-000000000001', 'ua@a.test', '000000');
  perform tests.assert(r.outcome = 'wrong' and r.link_token is null, 'a wrong code: wrong, no token');
  select * into r from private.verify_sign_in_code('22222222-0000-4000-8000-000000000001', 'someone@else.test', '123456');
  perform tests.assert(r.outcome = 'expired' and r.link_token is null, 'the right code for another typed address: expired (no tries used)');
  select * into r from private.verify_sign_in_code(gen_random_uuid(), 'ua@a.test', '123456');
  perform tests.assert(r.outcome = 'expired', 'an unknown request: expired');
  perform tests.assert_fails($q$select * from private.verify_sign_in_code('22222222-0000-4000-8000-000000000001', 'ua@a.test', '12345')$q$, array['22023'], 'five digits are not a code');
  select * into r from private.verify_sign_in_code('22222222-0000-4000-8000-000000000001', 'UA@a.test ', '123456');
  perform tests.assert(r.outcome = 'ok' and r.link_token = 'tokentokentokentoken', 'the right code: ok, the token once');
  select * into r from private.verify_sign_in_code('22222222-0000-4000-8000-000000000001', 'ua@a.test', '123456');
  perform tests.assert(r.outcome = 'expired' and r.link_token is null, 'single use: the same code again is expired');
  -- The unknown address behaves like a real one: wrong four times, locked on the fifth, never ok.
  for i in 1..4 loop
    select * into r from private.verify_sign_in_code('22222222-0000-4000-8000-000000000002', 'nobody@nowhere.test', '123456');
    perform tests.assert(r.outcome = 'wrong', format('unknown address: wrong, try %s', i));
  end loop;
  select * into r from private.verify_sign_in_code('22222222-0000-4000-8000-000000000002', 'nobody@nowhere.test', '123456');
  perform tests.assert(r.outcome = 'locked' and r.link_token is null, 'unknown address: locked on the fifth');
  select * into r from private.verify_sign_in_code('22222222-0000-4000-8000-000000000002', 'nobody@nowhere.test', '123456');
  perform tests.assert(r.outcome = 'locked', 'and stays locked');
end $$;
rollback;

begin;
delete from private.sign_in_codes;
insert into private.sign_in_codes (id, mode, email) values
  ('33333333-0000-4000-8000-000000000001', 'code', 'ua@a.test');
set local session authorization app_worker;
set local role authenticated;
select tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001', 'tests.sic'));
select private.issue_sign_in_code('33333333-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1',
                                  'a0000000-0000-4000-8000-000000000001', '482913', 'tokentokentokentoken');
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(null);
do $$
declare
  r record;
begin
  for i in 1..4 loop
    select * into r from private.verify_sign_in_code('33333333-0000-4000-8000-000000000001', 'ua@a.test', '111111');
    perform tests.assert(r.outcome = 'wrong', format('wrong code %s of 4', i));
  end loop;
  select * into r from private.verify_sign_in_code('33333333-0000-4000-8000-000000000001', 'ua@a.test', '111111');
  perform tests.assert(r.outcome = 'locked' and r.link_token is null, '5 wrong tries kill the code');
  select * into r from private.verify_sign_in_code('33333333-0000-4000-8000-000000000001', 'ua@a.test', '482913');
  perform tests.assert(r.outcome = 'locked' and r.link_token is null, 'even the right code is refused afterwards');
end $$;
set local session authorization default;
do $$
begin
  perform tests.assert((select link_token is null and tries = 5 and state = 'locked' from private.sign_in_codes where id = '33333333-0000-4000-8000-000000000001'),
    'the token is gone with the code');
end $$;
rollback;

-- Expiry and "only the newest code works".
begin;
delete from private.sign_in_codes;
insert into private.sign_in_codes (id, mode, email, created_at) values
  ('44444444-0000-4000-8000-000000000001', 'code', 'ua@a.test', now() - interval '2 minutes'),
  ('44444444-0000-4000-8000-000000000002', 'code', 'ua@a.test', now() - interval '1 minute');
set local session authorization app_worker;
set local role authenticated;
select tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001', 'tests.sic'));
select private.issue_sign_in_code('44444444-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1',
                                  'a0000000-0000-4000-8000-000000000001', '111222', 'firsttokenfirsttoken');
select private.issue_sign_in_code('44444444-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000a1',
                                  'a0000000-0000-4000-8000-000000000001', '333444', 'secondtokensecondtoken');
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(null);
do $$
declare
  r record;
begin
  select * into r from private.verify_sign_in_code('44444444-0000-4000-8000-000000000001', 'ua@a.test', '111222');
  perform tests.assert(r.outcome = 'expired' and r.link_token is null, 'only the newest code works: the older one is gone');
end $$;
set local session authorization default;
update private.sign_in_codes set expires_at = now() - interval '1 second' where id = '44444444-0000-4000-8000-000000000002';
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(null);
do $$
declare
  r record;
begin
  select * into r from private.verify_sign_in_code('44444444-0000-4000-8000-000000000002', 'ua@a.test', '333444');
  perform tests.assert(r.outcome = 'expired' and r.link_token is null, 'after 10 minutes: expired, even with the right code');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Remembered browsers: the setting, the strictest organization, binding, use and revocation
-- ---------------------------------------------------------------------------------------------------
begin;
delete from private.sign_in_codes;
-- Organization A remembers for 14 days, B has it Off (the default): uA (member of A only) can remember.
update platform.security_policies set remembered_browser_days = 14 where tenant_id = 'a0000000-0000-4000-8000-000000000001';
set local session authorization app_server;
set local role authenticated;
-- A tenant-less session (no organization selected yet), as right after a code sign-in.
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', null));
do $$
declare
  v_hash bytea := sha256('browser-token-one'::bytea);
begin
  perform tests.assert_fails($q$select private.remember_browser('\x0102'::bytea, 'Chrome on Windows')$q$, array['42501'], 'a token hash must be 32 bytes');
  perform tests.assert_eq(private.remember_browser(v_hash, 'Chrome on Windows'), 1::integer, 'uA: remembered in organization A');
  perform tests.assert_eq(private.remember_browser(v_hash, 'Chrome on Windows'), 1::integer, 'again: the same row is renewed');
end $$;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ad', null));
do $$
declare
  v_hash bytea := sha256('browser-token-two'::bytea);
begin
  -- uAB belongs to A (14 days) and B (Off): the strictest wins - nothing is remembered.
  perform tests.assert_eq(private.remember_browser(v_hash, 'Firefox on Linux'), 0::integer, 'one organization with Off: nothing remembered');
end $$;
select tests.set_claims(null);
do $$
begin
  perform tests.assert_fails($q$select private.remember_browser(sha256('x'::bytea), 'x')$q$, array['42501'], 'no claims: refused');
end $$;
set local session authorization default;
do $$
begin
  perform tests.assert_eq((select count(*) from platform.remembered_browsers), 1::bigint, 'one remembered browser in total');
  perform tests.assert((select expires_at between now() + interval '13 days 23 hours' and now() + interval '14 days' and label = 'Chrome on Windows'
                        and person_id = 'a1000000-0000-4000-8000-0000000000a1' and tenant_id = 'a0000000-0000-4000-8000-000000000001'
                        from platform.remembered_browsers), '14 days, bound to the person and the organization');
  perform tests.assert((select token_hash <> convert_to('browser-token-one', 'UTF8') from platform.remembered_browsers), 'only the hash of the token');
  perform tests.assert_eq((select count(*) from platform.audit_events where action = 'platform.auth.browser_remembered'), 2::bigint, 'remembering (and renewing) is audited');
  perform tests.assert_eq((select count(distinct data::text) from platform.audit_events where action = 'platform.auth.browser_remembered'), 1::bigint, 'always the same data');
  perform tests.assert_eq((select min(data::text) from platform.audit_events where action = 'platform.auth.browser_remembered'), '{"method": "email_code"}', 'without browser data');
  perform tests.assert(private.remembered_browser_ok('00000000-0000-4000-8000-0000000000a1', sha256('browser-token-one'::bytea)), 'the browser is remembered for uA');
  perform tests.assert(not private.remembered_browser_ok('00000000-0000-4000-8000-0000000000a1', sha256('browser-token-other'::bytea)), 'another token is not');
  perform tests.assert(not private.remembered_browser_ok('00000000-0000-4000-8000-0000000000ab', sha256('browser-token-one'::bytea)), 'nor for another account (bound to the person)');
  perform tests.assert(not private.remembered_browser_ok(null, sha256('browser-token-one'::bytea)), 'null is not');
end $$;

-- A request from the remembered browser needs no code; from another browser it does.
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(null);
do $$
declare
  r record;
begin
  select * into r from private.request_sign_in_code('ua@a.test', sha256('browser-token-other'::bytea));
  perform tests.assert(r.outcome = 'queued', 'an unknown browser: a code is sent');
end $$;
set local session authorization default;
delete from private.sign_in_codes;
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(null);
do $$
declare
  r record;
begin
  select * into r from private.request_sign_in_code('ua@a.test', sha256('browser-token-one'::bytea));
  perform tests.assert(r.outcome = 'remembered' and r.request_id is not null, 'the remembered browser: no code');
  perform set_config('tests.remembered_id', r.request_id::text, true);
  -- Not ready until the worker minted the token.
  select * into r from private.take_remembered_sign_in(current_setting('tests.remembered_id')::uuid, 'ua@a.test', sha256('browser-token-one'::bytea));
  perform tests.assert(r.outcome = 'pending' and r.link_token is null, 'pending until the worker is done');
  select * into r from private.take_remembered_sign_in(current_setting('tests.remembered_id')::uuid, 'ua@a.test', sha256('browser-token-other'::bytea));
  perform tests.assert(r.outcome = 'gone', 'another browser cannot take it (bound to the browser)');
  select * into r from private.take_remembered_sign_in(current_setting('tests.remembered_id')::uuid, 'someone@else.test', sha256('browser-token-one'::bytea));
  perform tests.assert(r.outcome = 'gone', 'nor for another address');
end $$;
set local session authorization app_worker;
set local role authenticated;
select tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001', 'tests.sic'));
do $$
declare
  r record;
begin
  select * into r from private.claim_sign_in_code_request();
  perform tests.assert(r.mode = 'remembered' and r.outcome = 'send' and r.user_id = '00000000-0000-4000-8000-0000000000a1', 'the worker sees a remembered request for uA');
  perform tests.assert(private.issue_sign_in_code(r.id, r.user_id, r.tenant_id, null, 'rememberedtokenremembered'), 'token minted, no code');
end $$;
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(null);
do $$
declare
  r record;
begin
  select * into r from private.take_remembered_sign_in(current_setting('tests.remembered_id')::uuid, 'ua@a.test', sha256('browser-token-one'::bytea));
  perform tests.assert(r.outcome = 'ok' and r.link_token = 'rememberedtokenremembered', 'taken once');
  select * into r from private.take_remembered_sign_in(current_setting('tests.remembered_id')::uuid, 'ua@a.test', sha256('browser-token-one'::bytea));
  perform tests.assert(r.outcome = 'gone', 'only once');
end $$;
set local session authorization default;
do $$
begin
  perform tests.assert((select last_used_at is not null from platform.remembered_browsers), 'last use recorded');
  perform tests.assert_eq((select count(*) from platform.audit_events where action = 'platform.auth.sign_in_code_sent'), 0::bigint, 'no "code sent" for a remembered browser');
end $$;

-- Shortening or switching off applies at once; the browser's own date too.
update platform.security_policies set remembered_browser_days = 0 where tenant_id = 'a0000000-0000-4000-8000-000000000001';
do $$
begin
  perform tests.assert(not private.remembered_browser_ok('00000000-0000-4000-8000-0000000000a1', sha256('browser-token-one'::bytea)), 'switched off: no longer remembered');
end $$;
update platform.security_policies set remembered_browser_days = 7 where tenant_id = 'a0000000-0000-4000-8000-000000000001';
do $$
begin
  perform tests.assert(private.remembered_browser_ok('00000000-0000-4000-8000-0000000000a1', sha256('browser-token-one'::bytea)), '7 days: still within them');
end $$;
-- A password change or reset forgets every remembered browser at once (the marker of the stored hash changes).
update auth.users set encrypted_password = 'a-new-password-hash' where id = '00000000-0000-4000-8000-0000000000a1';
do $$
begin
  perform tests.assert(not private.remembered_browser_ok('00000000-0000-4000-8000-0000000000a1', sha256('browser-token-one'::bytea)),
    'a new password: no browser is remembered any more');
end $$;
update auth.users set encrypted_password = null where id = '00000000-0000-4000-8000-0000000000a1';
update platform.remembered_browsers set created_at = now() - interval '8 days', expires_at = now() + interval '6 days';
do $$
begin
  perform tests.assert(not private.remembered_browser_ok('00000000-0000-4000-8000-0000000000a1', sha256('browser-token-one'::bytea)),
    'shortened to 7 days: a browser remembered 8 days ago is no longer');
end $$;
update platform.remembered_browsers set created_at = now() - interval '2 days', expires_at = now() - interval '1 second' + interval '0 seconds';
do $$
begin
  perform tests.assert(not private.remembered_browser_ok('00000000-0000-4000-8000-0000000000a1', sha256('browser-token-one'::bytea)), 'past its own date: no longer');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Remembered browsers: who reads, who forgets, cross-tenant, deactivation
-- ---------------------------------------------------------------------------------------------------
begin;
update platform.security_policies set remembered_browser_days = 30
where tenant_id in ('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001');
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ad', null));
do $$
begin
  perform tests.assert_eq(private.remember_browser(sha256('uab-browser'::bytea), 'Safari on macOS'), 2::integer, 'both organizations remember: two rows (strictest = 30 days each)');
end $$;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', null));
do $$
begin
  perform tests.assert_eq(private.remember_browser(sha256('ua-browser'::bytea), 'Chrome on Windows'), 1::integer, 'uA: one row');
end $$;
-- uA in organization A: sees only their own row, never a hash.
select tests.set_claims(tests.ua_claims());
do $$
begin
  perform tests.assert_eq((select count(*) from platform.remembered_browsers), 1::bigint, 'uA reads their own row only');
  perform tests.assert_eq((select user_id from platform.remembered_browsers), '00000000-0000-4000-8000-0000000000a1'::uuid, 'which is theirs');
  perform tests.assert_privilege_denied($q$select token_hash from platform.remembered_browsers$q$, 'the hash is not readable');
  perform tests.assert_privilege_denied($q$insert into platform.remembered_browsers (tenant_id, user_id, person_id, token_hash, expires_at) values ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-0000000000a1', sha256('x'::bytea), now() + interval '1 day')$q$,
    'nobody inserts directly');
  perform tests.assert_privilege_denied($q$update platform.remembered_browsers set expires_at = now() + interval '30 days'$q$, 'nor extends a browser');
  perform tests.assert_eq(tests.rows_affected($q$delete from platform.remembered_browsers where user_id = '00000000-0000-4000-8000-0000000000ab'$q$), 0::bigint, 'uA cannot forget another member''s browsers directly');
  -- The Organization Admin forgets a member's browsers (the permission of «End sessions»).
  perform tests.assert_eq(private.forget_member_remembered_browsers('a1000000-0000-4000-8000-0000000000ab'), 1::integer, 'the Organization Admin forgets uAB''s browsers in A');
  perform tests.assert_eq(private.forget_member_remembered_browsers('b1000000-0000-4000-8000-0000000000ab'), 0::integer, 'a person of another organization: nothing is forgotten (only this organization''s rows)');
end $$;
-- uB (organization B, no user permission): sees nothing of A, cannot forget A's members.
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1', 'b0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-0000000000b1'));
do $$
begin
  perform tests.assert_eq((select count(*) from platform.remembered_browsers), 0::bigint, 'uB sees no browsers of organization A (nor their own: none)');
  -- B's administrator acts on B's rows only: a person of A is out of reach (nothing is forgotten there).
  perform tests.assert_eq(private.forget_member_remembered_browsers('a1000000-0000-4000-8000-0000000000a1'), 0::integer, 'uB cannot forget a person of A');
end $$;
-- uA forgets their own.
select tests.set_claims(tests.ua_claims());
do $$
begin
  perform tests.assert_eq(tests.rows_affected($q$delete from platform.remembered_browsers$q$), 1::bigint, 'uA forgets their own browser');
end $$;
set local session authorization default;
do $$
begin
  perform tests.assert_eq((select string_agg(tenant_id::text || ':' || user_id::text, ',') from platform.remembered_browsers),
    'b0000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-0000000000ab', 'only uAB''s row of organization B is left (A''s administrator never reached it)');
end $$;
-- Deactivation: a member who is no longer active loses the browsers of that organization.
insert into platform.remembered_browsers (tenant_id, user_id, person_id, token_hash, password_marker, expires_at)
select v.tenant_id, v.user_id, v.person_id, sha256('d1'::bytea), pm.marker, now() + interval '1 day'
from (values
  ('a0000000-0000-4000-8000-000000000001'::uuid, '00000000-0000-4000-8000-0000000000ab'::uuid, 'a1000000-0000-4000-8000-0000000000ab'::uuid),
  ('b0000000-0000-4000-8000-000000000001'::uuid, '00000000-0000-4000-8000-0000000000ab'::uuid, 'b1000000-0000-4000-8000-0000000000ab'::uuid)) v (tenant_id, user_id, person_id)
join private.auth_password_marker pm on pm.id = v.user_id;
update platform.tenant_memberships set status = 'suspended'
where tenant_id = 'a0000000-0000-4000-8000-000000000001' and user_id = '00000000-0000-4000-8000-0000000000ab';
do $$
begin
  perform tests.assert_eq((select count(*) from platform.remembered_browsers where tenant_id = 'a0000000-0000-4000-8000-000000000001'), 0::bigint, 'deactivated in A: the browsers of A are gone');
  perform tests.assert((select count(*) >= 1 from platform.remembered_browsers where tenant_id = 'b0000000-0000-4000-8000-000000000001'), 'B''s stay');
end $$;
rollback;

-- At most 10 per person and organization: the oldest go.
begin;
update platform.security_policies set remembered_browser_days = 7 where tenant_id = 'a0000000-0000-4000-8000-000000000001';
insert into platform.remembered_browsers (tenant_id, user_id, person_id, token_hash, password_marker, created_at, expires_at)
select 'a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-0000000000a1',
       sha256(('old' || i)::bytea), (select marker from private.auth_password_marker where id = '00000000-0000-4000-8000-0000000000a1'),
       now() - make_interval(hours => i), now() + interval '1 day'
from generate_series(1, 10) i;
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', null));
do $$
begin
  perform tests.assert_eq(private.remember_browser(sha256('newest'::bytea), 'Edge on Windows'), 1::integer, 'the eleventh browser is remembered');
end $$;
set local session authorization default;
do $$
begin
  perform tests.assert_eq((select count(*) from platform.remembered_browsers), 10::bigint, 'at most 10');
  perform tests.assert((select count(*) = 0 from platform.remembered_browsers where token_hash = sha256('old10'::bytea)), 'the oldest went');
  perform tests.assert((select count(*) = 1 from platform.remembered_browsers where token_hash = sha256('newest'::bytea)), 'the newest stays');
end $$;
rollback;

\echo '99_signin_1_codes_owner: ok'
