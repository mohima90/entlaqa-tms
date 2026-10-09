-- db-test: run-as=app_server
-- Shared rate limiter and sign-in protection (ADR 0011 §4, T-M2-11) as the web app calls them: inside
-- `set local role authenticated` without claims (packages/platform-db/src/rate-limit.ts), the Organization
-- Admin functions with the admin's claims. Generic counters (counting, refusal with the time left, a full
-- window from the hit that used the budget up, peek, clear, independent buckets and keys, a new window
-- after the old one ended); sign-in (counted before Auth, refunds, trusted browsers, password reset);
-- Organization Admin lock state and unlock; the lockout e-mail request; argument checks; no direct access
-- to the keys, counters or trusted browsers. Committed; the stored state is checked in
-- 72_rate_limiter_owner.sql. Concurrency (parallel hits and sign-in checks of one key on separate
-- connections): packages/platform-db src/rate-limit.integration.test.ts.
\set ON_ERROR_STOP on

do $$ begin perform tests.assert(session_user = 'app_server', 'must run connected as app_server'); end $$;

begin;
set local role authenticated;
select tests.set_claims(null);

do $$
declare
  s1 constant bytea := sha256(convert_to('subject-1', 'UTF8'));
  s2 constant bytea := sha256(convert_to('subject-2', 'UTF8'));
  r record;
  v_ref text;
begin
  -- First (before any hit purges expired counters): a window that ended — fixture of 70, used up, ended a
  -- second ago — does not count, and the next hit starts a new window on the same row.
  select * into r from private.rate_limit_peek('tests.window', sha256(convert_to('window', 'UTF8')), 3);
  perform tests.assert(r.allowed and r.remaining = 3, 'peek: an ended window does not count');
  select * into r from private.rate_limit_hit('tests.window', sha256(convert_to('window', 'UTF8')), 3, 60);
  perform tests.assert(r.allowed and r.remaining = 2, 'hit: a new window after the old one ended');

  -- Three hits allowed, the fourth refused; the third (budget used up) starts a full 900-second window.
  select * into r from private.rate_limit_hit('tests.count', s1, 3, 900);
  perform tests.assert(r.allowed and r.remaining = 2 and r.retry_after_seconds = 0, 'first hit: allowed, 2 left');
  v_ref := r.key_ref;
  perform tests.assert(v_ref ~ '^rk_[0-9a-f]{24}$', 'key_ref: rk_ and 24 hex characters');
  select * into r from private.rate_limit_hit('tests.count', s1, 3, 900);
  perform tests.assert(r.allowed and r.remaining = 1, 'second hit: allowed, 1 left');
  select * into r from private.rate_limit_hit('tests.count', s1, 3, 900);
  perform tests.assert(r.allowed and r.remaining = 0 and r.retry_after_seconds between 899 and 900,
    'third hit: allowed, none left, the next is refused for a full window');
  select * into r from private.rate_limit_hit('tests.count', s1, 3, 900);
  perform tests.assert(not r.allowed and r.remaining = 0 and r.retry_after_seconds between 1 and 900,
    'fourth hit: refused, with the seconds left');
  perform tests.assert_eq(r.key_ref, v_ref, 'the same key keeps its reference');
  for i in 1..5 loop
    select * into r from private.rate_limit_hit('tests.count', s1, 3, 900);
  end loop;
  perform tests.assert(not r.allowed and r.retry_after_seconds between 1 and 900,
    'hits beyond the limit stay refused (and do not move the end of the window)');

  -- Peek: the same verdict without counting.
  select * into r from private.rate_limit_peek('tests.count', s1, 3);
  perform tests.assert(not r.allowed and r.retry_after_seconds between 1 and 900 and r.key_ref = v_ref,
    'peek: refused while the key is used up');
  select * into r from private.rate_limit_peek('tests.count', s2, 3);
  perform tests.assert(r.allowed and r.remaining = 3 and r.retry_after_seconds = 0, 'peek: an unknown key is allowed');
  select * into r from private.rate_limit_peek('tests.count', s2, 3);
  perform tests.assert(r.remaining = 3, 'peek does not count');

  -- Keys and buckets are independent; one subject has one reference in every bucket (log correlation).
  select * into r from private.rate_limit_hit('tests.count', s2, 3, 900);
  perform tests.assert(r.allowed and r.remaining = 2 and r.key_ref <> v_ref, 'another subject has its own counter');
  select * into r from private.rate_limit_hit('tests.other', s1, 3, 900);
  perform tests.assert(r.allowed and r.remaining = 2, 'another bucket has its own counter');
  perform tests.assert_eq(r.key_ref, v_ref, 'one subject, one reference across buckets');

  -- Clear: the key starts again.
  perform private.rate_limit_clear('tests.count', s1);
  select * into r from private.rate_limit_peek('tests.count', s1, 3);
  perform tests.assert(r.allowed and r.remaining = 3, 'clear: the key is forgotten');
  select * into r from private.rate_limit_peek('tests.other', s1, 3);
  perform tests.assert(r.remaining = 2, 'clear forgets one bucket only');

  -- A limit of one: the first hit uses it up.
  select * into r from private.rate_limit_hit('tests.single', s1, 1, 30);
  perform tests.assert(r.allowed and r.remaining = 0 and r.retry_after_seconds between 29 and 30, 'max 1: first allowed');
  select * into r from private.rate_limit_hit('tests.single', s1, 1, 30);
  perform tests.assert(not r.allowed, 'max 1: second refused');
end $$;

-- Sign-in (counted BEFORE Auth is asked; security review T-M2-11). Small budgets: client attempts 8,
-- client failures 6, account 3, trusted browser 2 (each per 900 s). Subjects: clients c1–c4, accounts
-- x/y/z (labels), browser d1. The calls below are what the web app does for each attempt: check, then —
-- only when Auth accepted the password — succeeded.
do $$
declare
  c1 constant bytea := sha256(convert_to('client-1', 'UTF8'));
  c2 constant bytea := sha256(convert_to('client-2', 'UTF8'));
  c3 constant bytea := sha256(convert_to('client-3', 'UTF8'));
  c4 constant bytea := sha256(convert_to('client-4', 'UTF8'));
  x constant bytea := sha256(convert_to('account-x', 'UTF8'));
  y constant bytea := sha256(convert_to('account-y', 'UTF8'));
  z constant bytea := sha256(convert_to('account-z', 'UTF8'));
  d1 constant bytea := sha256(convert_to('device-1', 'UTF8'));
  r record;
  v_until timestamptz;
begin
  -- An unknown browser on account x: three attempts reach Auth (the third uses the budget up), the
  -- fourth is refused before Auth — and gives the client's provisional failure back.
  select * into r from private.rate_limit_sign_in_check(c1, x, null, 8, 900, 6, 900, 3, 900, 2, 900);
  perform tests.assert(r.allowed and r.refused_by is null and r.remaining = 2 and r.client_remaining = 5
                       and not r.trusted and r.retry_after_seconds = 0, 'check 1: allowed, 2 account failures left');
  perform tests.assert(r.subject_ref ~ '^rk_[0-9a-f]{24}$' and r.client_ref ~ '^rk_[0-9a-f]{24}$'
                       and r.subject_ref <> r.client_ref, 'check: references of the account and the client');
  select * into r from private.rate_limit_sign_in_check(c1, x, null, 8, 900, 6, 900, 3, 900, 2, 900);
  perform tests.assert(r.allowed and r.remaining = 1 and r.client_remaining = 4, 'check 2: allowed, 1 left');
  select * into r from private.rate_limit_sign_in_check(c1, x, null, 8, 900, 6, 900, 3, 900, 2, 900);
  perform tests.assert(r.allowed and r.remaining = 0 and r.client_remaining = 3,
    'check 3: the attempt that uses the budget up still reaches Auth');
  select * into r from private.rate_limit_sign_in_check(c1, x, null, 8, 900, 6, 900, 3, 900, 2, 900);
  perform tests.assert(not r.allowed and r.refused_by = 'sign_in.account_failures'
                       and r.retry_after_seconds between 899 and 900 and r.client_remaining = 3,
    'check 4: refused for the account (a full window from the 3rd failure); the client''s failure is given back');
  -- Another client is refused too: the lock is the account's.
  select * into r from private.rate_limit_sign_in_check(c2, x, null, 8, 900, 6, 900, 3, 900, 2, 900);
  perform tests.assert(not r.allowed and r.refused_by = 'sign_in.account_failures', 'the lock holds for every client');

  -- A right password on account y from client c1 with browser d1: the provisional client failure is
  -- refunded, y's run ends, and d1 is trusted for y for 30 days.
  select * into r from private.rate_limit_sign_in_check(c1, y, d1, 8, 900, 6, 900, 3, 900, 2, 900);
  perform tests.assert(r.allowed and not r.trusted and r.client_remaining = 2, 'y: an unknown browser');
  v_until := private.rate_limit_sign_in_succeeded(c1, y, d1, false, 30);
  perform tests.assert(v_until between now() + interval '30 days' - interval '1 minute' and now() + interval '30 days',
    'succeeded: the browser is trusted for 30 days');
  select * into r from private.rate_limit_sign_in_check(c1, y, d1, 8, 900, 6, 900, 3, 900, 2, 900);
  perform tests.assert(r.allowed and r.trusted and r.remaining = 1 and r.client_remaining = 2,
    'y with d1: trusted (counted against the browser''s budget of 2); the success did not count for the client');
  perform private.rate_limit_sign_in_succeeded(c1, y, d1, true, 30);
  -- d1 is trusted for y only: account x stays locked for it.
  select * into r from private.rate_limit_sign_in_check(c1, x, d1, 8, 900, 6, 900, 3, 900, 2, 900);
  perform tests.assert(not r.allowed and not r.trusted and r.refused_by = 'sign_in.account_failures',
    'a browser trusted by another account is an unknown browser here');

  -- Account z: d1 signs in once (trusted), then z is locked by failures from other browsers; d1 still gets
  -- its own budget (2), the lock stays for everyone else, and d1's success does not end it.
  select * into r from private.rate_limit_sign_in_check(c3, z, d1, 8, 900, 6, 900, 3, 900, 2, 900);
  perform private.rate_limit_sign_in_succeeded(c3, z, d1, r.trusted, 30);
  for i in 1..3 loop
    select * into r from private.rate_limit_sign_in_check(c4, z, null, 8, 900, 6, 900, 3, 900, 2, 900);
    perform tests.assert(r.allowed, format('z: failure %s from an unknown browser reaches Auth', i));
  end loop;
  select * into r from private.rate_limit_sign_in_check(c4, z, null, 8, 900, 6, 900, 3, 900, 2, 900);
  perform tests.assert(not r.allowed and r.refused_by = 'sign_in.account_failures', 'z is locked');
  select * into r from private.rate_limit_sign_in_check(c3, z, d1, 8, 900, 6, 900, 3, 900, 2, 900);
  perform tests.assert(r.allowed and r.trusted and r.remaining = 1, 'z locked: the trusted browser still gets through');
  select * into r from private.rate_limit_sign_in_check(c3, z, d1, 8, 900, 6, 900, 3, 900, 2, 900);
  perform tests.assert(r.allowed and r.trusted and r.remaining = 0, 'trusted browser: its 2nd failure');
  select * into r from private.rate_limit_sign_in_check(c3, z, d1, 8, 900, 6, 900, 3, 900, 2, 900);
  perform tests.assert(not r.allowed and r.trusted and r.refused_by = 'sign_in.device_failures',
    'the trusted browser has its own budget (2 per window)');
  perform private.rate_limit_sign_in_succeeded(c3, z, d1, true, 30);
  select * into r from private.rate_limit_sign_in_check(c3, z, d1, 8, 900, 6, 900, 3, 900, 2, 900);
  perform tests.assert(r.allowed and r.trusted, 'a success ends the trusted browser''s run');
  select * into r from private.rate_limit_sign_in_check(c4, z, null, 8, 900, 6, 900, 3, 900, 2, 900);
  perform tests.assert(not r.allowed and r.refused_by = 'sign_in.account_failures',
    'the trusted browser''s success does not end the account''s lock');

  -- A completed password reset: the lock ends and every trusted browser is forgotten.
  perform tests.assert_eq(private.rate_limit_sign_in_reset(z), 1, 'reset: one trusted browser forgotten');
  select * into r from private.rate_limit_sign_in_check(c3, z, d1, 8, 900, 6, 900, 3, 900, 2, 900);
  perform tests.assert(r.allowed and not r.trusted and r.remaining = 2, 'after a reset: unlocked, d1 no longer trusted');

  -- Client budgets: successes never count as failures; every attempt counts as an attempt.
  for i in 1..5 loop
    select * into r from private.rate_limit_sign_in_check(c2, sha256(convert_to('ok-' || i, 'UTF8')), null,
                                                          8, 900, 6, 900, 3, 900, 2, 900);
    perform private.rate_limit_sign_in_succeeded(c2, sha256(convert_to('ok-' || i, 'UTF8')), d1, false, 30);
  end loop;
  perform tests.assert(r.allowed and r.client_remaining = 5, 'successes are refunded (c2 had one refused attempt)');
  -- c2 had 1 attempt on x, now 6 → 7th and 8th attempts allowed, the 9th refused (attempts budget 8).
  select * into r from private.rate_limit_sign_in_check(c2, sha256(convert_to('spray-1', 'UTF8')), null, 8, 900, 6, 900, 3, 900, 2, 900);
  perform tests.assert(r.allowed, 'c2: 7th attempt');
  select * into r from private.rate_limit_sign_in_check(c2, sha256(convert_to('spray-2', 'UTF8')), null, 8, 900, 6, 900, 3, 900, 2, 900);
  perform tests.assert(r.allowed, 'c2: 8th attempt');
  select * into r from private.rate_limit_sign_in_check(c2, sha256(convert_to('spray-3', 'UTF8')), null, 8, 900, 6, 900, 3, 900, 2, 900);
  perform tests.assert(not r.allowed and r.refused_by = 'sign_in.client_attempts' and r.retry_after_seconds between 1 and 900,
    'c2: the 9th attempt is refused (attempts per client)');
  -- Failures per client (password spraying across accounts; a wide attempt budget here): c4 has 3 of 6
  -- (the attempts the locked account z refused were given back); three more reach Auth, then the client is
  -- refused.
  select * into r from private.rate_limit_sign_in_check(c4, sha256(convert_to('spray-4', 'UTF8')), null, 100, 900, 6, 900, 3, 900, 2, 900);
  perform tests.assert(r.allowed and r.client_remaining = 2, 'c4: 4th failure');
  select * into r from private.rate_limit_sign_in_check(c4, sha256(convert_to('spray-5', 'UTF8')), null, 100, 900, 6, 900, 3, 900, 2, 900);
  perform tests.assert(r.allowed and r.client_remaining = 1, 'c4: 5th failure');
  select * into r from private.rate_limit_sign_in_check(c4, sha256(convert_to('spray-6', 'UTF8')), null, 100, 900, 6, 900, 3, 900, 2, 900);
  perform tests.assert(r.allowed and r.client_remaining = 0, 'c4: 6th failure');
  select * into r from private.rate_limit_sign_in_check(c4, sha256(convert_to('spray-7', 'UTF8')), null, 100, 900, 6, 900, 3, 900, 2, 900);
  perform tests.assert(not r.allowed and r.refused_by = 'sign_in.client_failures' and r.retry_after_seconds between 1 and 900,
    'c4: the 7th is refused (failures per client), whatever the account');

  -- At most 10 trusted browsers per account (checked in 72): 12 browsers sign in to account w.
  for i in 1..12 loop
    perform private.rate_limit_sign_in_succeeded(c1, sha256(convert_to('account-w', 'UTF8')),
                                                 sha256(convert_to('browser-' || i, 'UTF8')), false, 30);
  end loop;
  -- The expired trusted browser of 70 trusts nothing.
  select * into r from private.rate_limit_sign_in_check(c1, sha256(convert_to('purged-account', 'UTF8')),
                                                        sha256(convert_to('purged-device', 'UTF8')), 100, 900, 100, 900, 3, 900, 2, 900);
  perform tests.assert(r.allowed and not r.trusted, 'an expired trust is no trust');
end $$;

-- Sign-in arguments.
select tests.assert_fails($$select * from private.rate_limit_sign_in_check(sha256('\x01'::bytea), sha256('\x02'::bytea), '\x01'::bytea, 8, 900, 6, 900, 3, 900, 2, 900)$$,
  array['22023'], 'a browser subject is a 32-byte hash');
select tests.assert_fails($$select * from private.rate_limit_sign_in_check(sha256('\x01'::bytea), convert_to('x@example.test', 'UTF8'), null, 8, 900, 6, 900, 3, 900, 2, 900)$$,
  array['22023'], 'a readable account key is refused');
select tests.assert_fails($$select * from private.rate_limit_sign_in_check(sha256('\x01'::bytea), sha256('\x02'::bytea), null, 8, 900, 6, 900, 0, 900, 2, 900)$$,
  array['22023'], 'every budget must be positive');
select tests.assert_fails($$select * from private.rate_limit_sign_in_check(sha256('\x01'::bytea), sha256('\x02'::bytea), null, 8, 900, 6, 900, 3, 900, 2, 86401)$$,
  array['22023'], 'every window at most a day');
select tests.assert_fails($$select private.rate_limit_sign_in_succeeded(sha256('\x01'::bytea), sha256('\x02'::bytea), null, false, 30)$$,
  array['22023'], 'a successful sign-in names the browser');
select tests.assert_fails($$select private.rate_limit_sign_in_succeeded(sha256('\x01'::bytea), sha256('\x02'::bytea), sha256('\x03'::bytea), false, 0)$$,
  array['22023'], 'a browser is trusted for at least a day');
select tests.assert_fails($$select private.rate_limit_sign_in_reset(null)$$, array['22023'], 'reset: an account subject');

-- Generic arguments: a bucket name, a 32-byte subject (never a readable key), 1–1,000,000 hits, 1–86,400 s.
select tests.assert_fails($$select private.rate_limit_hit('Bad Bucket', sha256('\x01'::bytea), 3, 60)$$,
  array['22023'], 'invalid bucket name');
select tests.assert_fails($$select private.rate_limit_hit(null, sha256('\x01'::bytea), 3, 60)$$,
  array['22023'], 'null bucket');
select tests.assert_fails($$select private.rate_limit_hit('tests.args', convert_to('someone@example.test', 'UTF8'), 3, 60)$$,
  array['22023'], 'a readable key is refused (subject must be a 32-byte hash)');
select tests.assert_fails($$select private.rate_limit_peek('tests.args', null, 3)$$, array['22023'], 'null subject');
select tests.assert_fails($$select private.rate_limit_clear('tests.args', '\x00'::bytea)$$, array['22023'], 'short subject');
select tests.assert_fails($$select private.rate_limit_hit('tests.args', sha256('\x01'::bytea), 0, 60)$$,
  array['22023'], 'max_hits must be positive');
select tests.assert_fails($$select private.rate_limit_hit('tests.args', sha256('\x01'::bytea), 3, 0)$$,
  array['22023'], 'window must be positive');
select tests.assert_fails($$select private.rate_limit_hit('tests.args', sha256('\x01'::bytea), 3, 86401)$$,
  array['22023'], 'window at most a day (bounded retention)');
select tests.assert_fails($$select private.rate_limit_peek('tests.args', sha256('\x01'::bytea), 1000001)$$,
  array['22023'], 'max_hits at most a million');

-- Without claims, the Organization Admin functions refuse.
select tests.assert_fails($$select * from private.member_sign_in_lock('a1000000-0000-4000-8000-0000000000ab', 3)$$,
  array['42501'], 'lock state: a signed-in member only');
select tests.assert_fails($$select private.unlock_member_sign_in('a1000000-0000-4000-8000-0000000000ab')$$,
  array['42501'], 'unlock: a signed-in member only');

-- The lockout e-mail request (20261013090100): unconditional, one waiting request per address (checked
-- in 72), nothing for an invalid address or duration.
select private.request_account_locked_mail(' UAB@ab.test ', 15);
select private.request_account_locked_mail('uab@ab.test', 15);
select private.request_account_locked_mail('nobody@nowhere.test', 15);
select private.request_account_locked_mail('not an address', 15);
select private.request_account_locked_mail('uab2@ab.test', 0);

-- No direct access: neither the keys, nor the counters, nor the trusted browsers, nor the helpers.
select tests.assert_privilege_denied('select * from private.rate_limit_secret', 'app_server cannot read the limiter keys');
select tests.assert_privilege_denied('select * from private.rate_limit_counters', 'app_server cannot read the counters');
select tests.assert_privilege_denied('select * from private.sign_in_trusted_devices', 'app_server cannot read trusted browsers');
select tests.assert_privilege_denied($$delete from private.rate_limit_counters$$, 'app_server cannot delete counters');
select tests.assert_privilege_denied($$select private.rate_limit_key(sha256('\x01'::bytea))$$,
  'app_server cannot compute keyed hashes itself');
select tests.assert_privilege_denied($$select private.rate_limit_account_subject('ua@a.test')$$,
  'app_server cannot call the helpers');
select tests.assert_privilege_denied($$select private.rotate_rate_limit_keys()$$, 'app_server cannot rotate the keys');
commit;

-- An account locked by failures (uAB: 'uab@ab.test', subject as the web app derives it), then the
-- Organization Admin of A (uA) sees the lock of their member and ends it.
begin;
set local role authenticated;
select tests.set_claims(null);
do $$
declare
  v_uab constant bytea := sha256(convert_to(E'jadarat.rate-limit.v1\naccount\nuab@ab.test', 'UTF8'));
  r record;
begin
  for i in 1..4 loop
    select * into r from private.rate_limit_sign_in_check(sha256(convert_to('client-admin', 'UTF8')), v_uab, null,
                                                          100, 900, 100, 900, 3, 900, 10, 900);
  end loop;
  perform tests.assert(not r.allowed and r.refused_by = 'sign_in.account_failures', 'uAB is locked');
end $$;
commit;

begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
                                          'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
do $$
declare
  r record;
begin
  select * into r from private.member_sign_in_lock('a1000000-0000-4000-8000-0000000000ab', 3);
  perform tests.assert(r.locked and r.retry_after_seconds between 1 and 900, 'Organization Admin: uAB is locked');
  select * into r from private.member_sign_in_lock('a1000000-0000-4000-8000-0000000000ab', 5);
  perform tests.assert(not r.locked and r.retry_after_seconds = 0, 'with a budget of 5, 3 failures are no lock');
  select * into r from private.member_sign_in_lock('a1000000-0000-4000-8000-0000000000a1', 3);
  perform tests.assert(not r.locked, 'uA is not locked');
  -- A person of another organization is unknown here (the same answer as "not locked": no existence leak).
  select * into r from private.member_sign_in_lock('b1000000-0000-4000-8000-0000000000b1', 3);
  perform tests.assert(not r.locked, 'another organization''s member: not visible');
  perform tests.assert(not private.unlock_member_sign_in('b1000000-0000-4000-8000-0000000000ab'),
    'another organization''s membership of the same account cannot be unlocked from here');
  perform tests.assert(private.unlock_member_sign_in('a1000000-0000-4000-8000-0000000000ab'), 'unlock: there was a lock');
  select * into r from private.member_sign_in_lock('a1000000-0000-4000-8000-0000000000ab', 3);
  perform tests.assert(not r.locked, 'unlocked');
  perform tests.assert(not private.unlock_member_sign_in('a1000000-0000-4000-8000-0000000000ab'), 'nothing left to unlock');
end $$;
commit;

-- An HR Manager (uAB) and a learner (uInv) of A may not; the Organization Admin of B may not reach A.
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
                                          'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000ab'));
select tests.assert_fails($$select * from private.member_sign_in_lock('a1000000-0000-4000-8000-0000000000a1', 3)$$,
  array['42501'], 'an HR Manager may not see sign-in locks');
select tests.assert_fails($$select private.unlock_member_sign_in('a1000000-0000-4000-8000-0000000000a1')$$,
  array['42501'], 'an HR Manager may not unlock');
commit;
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1',
                                          'b0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-0000000000b1'));
do $$
declare
  r record;
begin
  select * into r from private.member_sign_in_lock('b1000000-0000-4000-8000-0000000000b9', 3);
  perform tests.assert(not r.locked, 'a person without an account is not locked');
  perform tests.assert(not private.unlock_member_sign_in('a1000000-0000-4000-8000-0000000000a1'),
    'the Organization Admin of B cannot reach a member of A');
end $$;
commit;

-- Outside `set role authenticated` the login role itself (NOINHERIT, no privileges) cannot call it.
select tests.assert_fails($$select private.rate_limit_hit('tests.args', sha256('\x01'::bytea), 3, 60)$$,
  array['42501'], 'app_server without the authenticated role has no access');

\echo '71_rate_limiter_app_server: ok'
