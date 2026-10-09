-- db-test: run-as=app_server
-- Shared rate limiter (ADR 0011 §4, T-M2-11) as the web app calls it: inside `set local role
-- authenticated` without claims (packages/platform-db/src/rate-limit.ts). Counting, refusal with the time
-- left, a full window from the hit that used the budget up, peek without counting, clear, independent
-- buckets and keys, a new window after the old one ended, argument checks, and no direct access to the
-- secret or the counters. Committed; the stored state is checked in 72_rate_limiter_owner.sql.
-- Concurrency (parallel hits of one key on separate connections): packages/platform-db
-- src/rate-limit.integration.test.ts.
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
  perform tests.assert(v_ref ~ '^rk_[0-9a-f]{24}$', 'key_ref: rk_ and 24 hex characters (a keyed hash prefix)');
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

-- Arguments: a bucket name, a 32-byte subject (never a readable key), 1–1,000,000 hits, 1–86,400 seconds.
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

-- No direct access: neither the secret, nor the counters, nor the key function.
select tests.assert_privilege_denied('select * from private.rate_limit_secret', 'app_server cannot read the limiter key');
select tests.assert_privilege_denied('select * from private.rate_limit_counters', 'app_server cannot read the counters');
select tests.assert_privilege_denied($$delete from private.rate_limit_counters$$, 'app_server cannot delete counters');
select tests.assert_privilege_denied($$select private.rate_limit_key(sha256('\x01'::bytea))$$,
  'app_server cannot compute keyed hashes itself');
commit;

-- Outside `set role authenticated` the login role itself (NOINHERIT, no privileges) cannot call it.
select tests.assert_fails($$select private.rate_limit_hit('tests.args', sha256('\x01'::bytea), 3, 60)$$,
  array['42501'], 'app_server without the authenticated role has no access');

\echo '71_rate_limiter_app_server: ok'
