-- db-test: run-as=owner
-- Shared rate limiter (T-M2-11), after 71_rate_limiter_app_server.sql: the hits purged every expired
-- counter (bounded retention without a job); the stored keys are HMAC-SHA-256 of the subjects under the
-- limiter's key — never the subject, an unkeyed hash of it, or anything readable; the worker's login role
-- and a session without the web app's login are refused. Then the test counters are removed (the
-- TypeScript integration tests use their own buckets).
\set ON_ERROR_STOP on

do $$
declare
  v_subject bytea;
begin
  perform tests.assert_eq((select count(*)::int from private.rate_limit_counters where bucket = 'tests.purge'), 0,
    'the hits removed every expired counter (20 per hit at most)');
  perform tests.assert(not exists (select 1 from private.rate_limit_counters where reset_at <= now() - interval '1 minute'),
    'no counter older than its window is left');
  perform tests.assert_eq((select hits from private.rate_limit_counters where bucket = 'tests.count'
                           and key_hash = private.rate_limit_key(sha256(convert_to('subject-2', 'UTF8')))), 1,
    'subject-2 counted once in tests.count (peeks did not count)');
  perform tests.assert(not exists (select 1 from private.rate_limit_counters where bucket = 'tests.count'
                                   and key_hash = private.rate_limit_key(sha256(convert_to('subject-1', 'UTF8')))),
    'subject-1 was cleared in tests.count');
  perform tests.assert_eq((select hits from private.rate_limit_counters where bucket = 'tests.single'), 2,
    'a refused hit is still recorded (capped at max + 1)');

  -- No raw or unkeyed key anywhere: each stored hash is the HMAC of its subject with the limiter's key.
  foreach v_subject in array array[sha256(convert_to('subject-1', 'UTF8')), sha256(convert_to('subject-2', 'UTF8')),
                                   sha256(convert_to('window', 'UTF8'))] loop
    perform tests.assert(not exists (select 1 from private.rate_limit_counters
                                     where key_hash in (v_subject, sha256(v_subject))),
      'neither a subject nor its plain SHA-256 is stored');
  end loop;
  perform tests.assert_eq(
    (select key_hash from private.rate_limit_counters where bucket = 'tests.other'),
    (select sha256(s.outer_key || sha256(s.inner_key || sha256(convert_to('subject-1', 'UTF8'))))
     from private.rate_limit_secret s),
    'key_hash = HMAC-SHA-256(limiter key, subject)');
  -- Every stored key is the keyed hash of one of the subjects used in 71 (nothing else was written).
  perform tests.assert(not exists (
      select 1 from private.rate_limit_counters c
      where c.bucket like 'tests.%'
        and c.key_hash not in (select private.rate_limit_key(sha256(convert_to(l, 'UTF8')))
                               from unnest(array['subject-1', 'subject-2', 'window']) l)),
    'every stored key is a keyed hash of a subject');
end $$;

-- The worker's login role is refused (the functions check session_user = app_server).
set session authorization app_worker;
begin;
set local role authenticated;
select tests.set_claims(jsonb_build_object('role', 'system', 'job_id', 'tests.rate_limit'));
select tests.assert_fails($$select private.rate_limit_hit('tests.args', sha256('\x01'::bytea), 3, 60)$$,
  array['42501'], 'app_worker may not count hits');
select tests.assert_fails($$select private.rate_limit_peek('tests.args', sha256('\x01'::bytea), 3)$$,
  array['42501'], 'app_worker may not peek');
select tests.assert_fails($$select private.rate_limit_clear('tests.args', sha256('\x01'::bytea))$$,
  array['42501'], 'app_worker may not clear');
commit;
reset session authorization;

-- Any other login acting as authenticated (here the test owner; on hosted Supabase e.g. its API role) is
-- refused too.
begin;
set local role authenticated;
select tests.assert_fails($$select private.rate_limit_hit('tests.args', sha256('\x01'::bytea), 3, 60)$$,
  array['42501'], 'only the web app''s login role may count hits');
commit;

delete from private.rate_limit_counters where bucket like 'tests.%';

\echo '72_rate_limiter_owner: ok'
