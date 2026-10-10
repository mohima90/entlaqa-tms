-- db-test: run-as=owner
-- Shared rate limiter and sign-in protection (T-M2-11), after 71_rate_limiter_app_server.sql: the calls
-- purged every expired counter and trusted browser (bounded retention without a job); the stored keys are
-- HMAC-SHA-256 of the subjects under the counter key — never the subject, an unkeyed hash of it, or
-- anything readable — and the log references come from the other key; at most 10 trusted browsers per
-- account, only tokens the web app minted, opt-in trust and renewal, the password reset and My profile
-- change; the database derives an account's subject exactly as the web app does; the lockout and unlock
-- e-mail requests are queued once and answered by the worker; the worker's login role and a session
-- without the web app's login are refused; key rotation replaces exactly one row and restarts everything.
-- Then the test state is removed (the TypeScript integration tests use their own buckets).
\set ON_ERROR_STOP on

do $$
declare
  v_subject bytea;
begin
  perform tests.assert_eq((select count(*)::int from private.rate_limit_counters where bucket = 'tests.purge'), 0,
    'the calls removed every expired counter (20 per call at most)');
  perform tests.assert(not exists (select 1 from private.rate_limit_counters where reset_at <= now() - interval '1 minute'),
    'no counter older than its window is left');
  perform tests.assert(not exists (select 1 from private.sign_in_trusted_devices where expires_at <= now()),
    'the expired trusted browser was removed');
  perform tests.assert_eq((select hits from private.rate_limit_counters where bucket = 'tests.count'
                           and key_hash = private.rate_limit_key(sha256(convert_to('subject-2', 'UTF8')))), 1,
    'subject-2 counted once in tests.count');
  perform tests.assert_eq((select hits from private.rate_limit_counters where bucket = 'tests.count'
                           and key_hash = private.rate_limit_key(sha256(convert_to('subject-1', 'UTF8')))), 1,
    'subject-1 started again in tests.count after it was cleared');
  perform tests.assert_eq((select hits from private.rate_limit_counters where bucket = 'tests.single'), 2,
    'a refused hit is still recorded (capped at max + 1)');

  -- No raw or unkeyed key anywhere: each stored hash is the HMAC of its subject with the counter key.
  foreach v_subject in array array[sha256(convert_to('subject-1', 'UTF8')), sha256(convert_to('subject-2', 'UTF8')),
                                   sha256(convert_to('window', 'UTF8')), sha256(convert_to('account-x', 'UTF8')),
                                   sha256(convert_to('client-1', 'UTF8')), sha256(convert_to('device-1', 'UTF8'))] loop
    perform tests.assert(not exists (select 1 from private.rate_limit_counters
                                     where key_hash in (v_subject, sha256(v_subject)))
                         and not exists (select 1 from private.sign_in_trusted_devices
                                         where v_subject in (account_key, device_key)
                                            or sha256(v_subject) in (account_key, device_key)),
      'neither a subject nor its plain SHA-256 is stored');
  end loop;
  perform tests.assert_eq(
    (select key_hash from private.rate_limit_counters where bucket = 'tests.other'),
    (select sha256(s.outer_key || sha256(s.inner_key || sha256(convert_to('subject-1', 'UTF8'))))
     from private.rate_limit_secret s),
    'key_hash = HMAC-SHA-256(counter key, subject)');
  -- The log reference is the LOG key's HMAC: no prefix of any stored key.
  perform tests.assert_eq(private.rate_limit_ref(sha256(convert_to('subject-1', 'UTF8'))),
    (select 'rk_' || encode(substr(sha256(s.log_outer_key || sha256(s.log_inner_key || sha256(convert_to('subject-1', 'UTF8')))), 1, 12), 'hex')
     from private.rate_limit_secret s),
    'log reference = rk_ + 12 bytes of HMAC-SHA-256(log key, subject)');
  perform tests.assert(not exists (
      select 1 from private.rate_limit_counters c
      where 'rk_' || encode(substr(c.key_hash, 1, 12), 'hex') = private.rate_limit_ref(sha256(convert_to('subject-1', 'UTF8')))),
    'a log reference is no prefix of a stored key');
  -- Every stored key of a generic test bucket is the keyed hash of one of the subjects used in 71.
  perform tests.assert(not exists (
      select 1 from private.rate_limit_counters c
      where c.bucket like 'tests.%'
        and c.key_hash not in (select private.rate_limit_key(sha256(convert_to(l, 'UTF8')))
                               from unnest(array['subject-1', 'subject-2', 'window']) l)),
    'every stored key is a keyed hash of a subject');

  -- Trusted browsers: keyed hashes of the account and of the browser; at most 10 per account (the ones
  -- trusted longest); only tokens the web app minted; a password reset kept the browser that completed it
  -- (fresh-2) and forgot account z's others; unticked sign-ins trusted nothing and renewed nothing; a My
  -- profile password change forgot account p's others.
  perform tests.assert_eq(
    (select count(*)::int from private.sign_in_trusted_devices
     where account_key = private.rate_limit_key(sha256(convert_to('account-w', 'UTF8')))), 10,
    'at most 10 trusted browsers per account');
  perform tests.assert(exists (select 1 from private.sign_in_trusted_devices
                               where account_key = private.rate_limit_key(sha256(convert_to('account-y', 'UTF8')))
                                 and device_key = private.rate_limit_key(sha256(convert_to('device-1', 'UTF8')))
                                 and expires_at > now() + interval '29 days'),
    'device-1 is trusted for account y (keyed hashes, 30 days)');
  perform tests.assert(not exists (select 1 from private.sign_in_trusted_devices
                                   where device_key in (private.rate_limit_key(sha256(convert_to('device-unknown', 'UTF8'))),
                                                        private.rate_limit_key(sha256(convert_to('device-2', 'UTF8'))))),
    'a token the server never issued is trusted for no account');
  perform tests.assert_eq(
    (select string_agg(encode(device_key, 'hex'), ',') from private.sign_in_trusted_devices
     where account_key = private.rate_limit_key(sha256(convert_to('account-z', 'UTF8')))),
    encode(private.rate_limit_key(sha256(convert_to('fresh-2', 'UTF8'))), 'hex'),
    'after the password reset, account z trusts the browser that completed it, and no other');
  perform tests.assert(exists (select 1 from private.sign_in_trusted_devices
                               where account_key = private.rate_limit_key(sha256(convert_to('account-z', 'UTF8')))
                                 and expires_at > now() + interval '29 days'),
    'a ticked reset trusted for 30 days, and a later unticked one did not shorten it');
  perform tests.assert(exists (select 1 from private.sign_in_trusted_devices
                               where account_key = private.rate_limit_key(sha256(convert_to('account-k', 'UTF8')))
                                 and device_key = private.rate_limit_key(sha256(convert_to('device-1', 'UTF8')))
                                 and expires_at between now() + interval '23 hours' and now() + interval '24 hours'),
    'an unticked reset trusts its browser for 24 hours only (security re-review N1)');
  perform tests.assert(not exists (select 1 from private.sign_in_trusted_devices
                                   where account_key in (private.rate_limit_key(sha256(convert_to('account-q', 'UTF8'))),
                                                         private.rate_limit_key(sha256(convert_to('account-p', 'UTF8'))))),
    'an unticked sign-in trusted nothing; forgetting the others left account p none');
  perform tests.assert(exists (select 1 from private.sign_in_trusted_devices
                               where account_key = private.rate_limit_key(sha256(convert_to('renewed-account', 'UTF8')))
                                 and expires_at > now() + interval '29 days')
                       and exists (select 1 from private.sign_in_trusted_devices
                                   where account_key = private.rate_limit_key(sha256(convert_to('kept-account', 'UTF8')))
                                     and expires_at between now() + interval '9 days' and now() + interval '11 days'),
    'a ticked sign-in renewed the trust, an unticked one did not');

  -- The account subject in SQL equals the web app's (auth-limits.ts accountSubject; same vectors in
  -- packages/platform-identity/src/auth-limits.test.ts), with Auth's lower-casing of İ and Σ.
  perform tests.assert_eq(encode(private.rate_limit_account_subject(' UAB@ab.test '), 'hex'),
    '9bab03365a6941124a7dbf7a28cc5eecec8ca5be63308d0317659ce517831db4',
    'the database derives an account''s subject exactly as the web app');
  perform tests.assert_eq(private.rate_limit_normalize_email(U&' D\0130MA\03A3@X.TEST '), U&'dima\03C3@x.test',
    'İ → i and Σ → σ (Go''s simple case mapping, as Auth stores the address)');
  perform tests.assert_eq(private.rate_limit_account_subject(U&'\0130A@A.TEST'), private.rate_limit_account_subject('ia@a.test'),
    'İ and i: one subject');
  perform tests.assert_eq(private.rate_limit_account_subject(U&'\212Aate@x.test'), private.rate_limit_account_subject('kate@x.test'),
    'the Kelvin sign K is K (NFC), as Go lower-cases it');
  -- Guard: whatever is not printable ASCII after normalisation shares one subject (no account has such an
  -- address; the same vector in auth-limits.test.ts).
  perform tests.assert_eq(encode(private.rate_limit_account_subject(U&'\0131@x.test'), 'hex'),
    '4644ee3cbaf840b60dad525e47034dcf9c671f09a383121efc87556f94acf4cc',
    'a non-ASCII address: the shared subject (same vector as the web app)');
  perform tests.assert_eq(private.rate_limit_account_subject(U&'\03A3@x.test'), private.rate_limit_account_subject(U&'\0131@x.test'),
    'every non-ASCII address: one subject');
  perform tests.assert(private.rate_limit_account_subject(U&'\0131@x.test') <> private.rate_limit_account_subject('i@x.test'),
    'a dotless ı is no i (Go does not map it either)');

  -- The lockout e-mail requests of 71: one for the account (repeat dropped), one for the unknown address
  -- (the worker sends nothing for it), none for an invalid address or duration.
  perform tests.assert_eq(
    (select string_agg(concat_ws('|', kind, email, lock_minutes::text), ', ' order by email)
     from private.account_mail_requests where kind = 'account_locked'),
    'account_locked|nobody@nowhere.test|15, account_locked|uab@ab.test|15',
    'lockout e-mail requests: one per address, as typed (lower-case), with the lock''s minutes');
  perform tests.assert_check_constraint(
    $q$insert into private.account_mail_requests (kind, email) values ('account_locked', 'x@a.test')$q$,
    'account_mail_requests_shape_check', 'an account_locked request states the lock''s minutes');
  -- The unlock notices of 71: three unlocks of uAB's account in A, one waiting request (the account, A).
  perform tests.assert_eq(
    (select string_agg(concat_ws('|', kind, user_id::text, tenant_id::text), ', ')
     from private.account_mail_requests where kind = 'sign_in_unlocked'),
    'sign_in_unlocked|00000000-0000-4000-8000-0000000000ab|a0000000-0000-4000-8000-000000000001',
    'unlock notices: one waiting request per account, in the unlocking organization');
  perform tests.assert_check_constraint(
    $q$insert into private.account_mail_requests (kind, user_id) values ('sign_in_unlocked', '00000000-0000-4000-8000-0000000000ab')$q$,
    'account_mail_requests_shape_check', 'an unlock notice names the organization');
end $$;

-- The worker answers them: the known account is written in its organization's language with the lock's
-- minutes; the unknown address gets nothing; the unlock notice goes to the account in the unlocking
-- organization.
set session authorization app_worker;
begin;
set local role authenticated;
select tests.set_claims(jsonb_build_object('role', 'system', 'job_id', 'tests.account_locked'));
do $$
declare
  r record;
  v_got text[] := '{}';
begin
  for i in 1..3 loop
    select * into r from private.claim_account_mail_request();
    v_got := v_got || concat_ws('|', r.kind, r.outcome, coalesce(r.email, ''), coalesce(r.locale, ''),
                                coalesce(r.tenant_id::text, ''), coalesce(r.lock_minutes::text, ''));
    perform private.finish_account_mail_request(r.id);
  end loop;
  perform tests.assert_eq(array_to_string((select array_agg(g order by g) from unnest(v_got) g), ', '),
    'account_locked|send|uab@ab.test|ar|a0000000-0000-4000-8000-000000000001|15, account_locked|unknown_account||||, '
    'sign_in_unlocked|send|uab@ab.test|ar|a0000000-0000-4000-8000-000000000001|',
    'the worker: the known account is written (lock minutes), the unknown address is not; the unlock notice in A');
end $$;
commit;

-- The worker's login role is refused by the limiter (the functions check session_user = app_server).
begin;
set local role authenticated;
select tests.set_claims(jsonb_build_object('role', 'system', 'job_id', 'tests.rate_limit'));
select tests.assert_fails($$select private.rate_limit_hit('tests.args', sha256('\x01'::bytea), 3, 60)$$,
  array['42501'], 'app_worker may not count hits');
select tests.assert_fails($$select private.rate_limit_clear('tests.args', sha256('\x01'::bytea))$$,
  array['42501'], 'app_worker may not clear');
select tests.assert_fails($$select * from private.rate_limit_sign_in_check(sha256('\x01'::bytea), sha256('\x02'::bytea), null, 8, 900, 6, 900, 3, 900, 2, 900)$$,
  array['42501'], 'app_worker may not check sign-ins');
select tests.assert_fails($$select * from private.rate_limit_sign_in_succeeded(sha256('\x01'::bytea), sha256('\x02'::bytea), null, sha256('\x03'::bytea), false, true, 30)$$,
  array['42501'], 'app_worker may not trust browsers');
select tests.assert_fails($$select private.rate_limit_sign_in_not_checked(sha256('\x02'::bytea), null, false)$$,
  array['42501'], 'app_worker may not give sign-in failures back');
select tests.assert_fails($$select * from private.rate_limit_sign_in_reset(sha256('\x02'::bytea), null, sha256('\x03'::bytea), 30)$$,
  array['42501'], 'app_worker may not reset');
select tests.assert_fails($$select private.rate_limit_forget_other_devices(sha256('\x02'::bytea), null)$$,
  array['42501'], 'app_worker may not forget trusted browsers');
select tests.assert_fails($$select private.request_account_locked_mail('x@a.test', 15)$$,
  array['42501'], 'app_worker may not request lockout e-mails');
select tests.assert_fails($$select private.sign_in_account_in_tenant('ua@a.test', 'a0000000-0000-4000-8000-000000000001')$$,
  array['42501'], 'app_worker may not ask about memberships by address');
select tests.assert_fails($$select private.rate_limit_give_back('tests.args', sha256('\x01'::bytea))$$,
  array['42501'], 'app_worker may not give hits back');
commit;
reset session authorization;

-- Any other login acting as authenticated (here the test owner; on hosted Supabase e.g. its API role) is
-- refused too.
begin;
set local role authenticated;
select tests.assert_fails($$select private.rate_limit_hit('tests.args', sha256('\x01'::bytea), 3, 60)$$,
  array['42501'], 'only the web app''s login role may count hits');
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
                                          'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
select tests.assert_fails($$select private.unlock_member_sign_in('a1000000-0000-4000-8000-0000000000ab', 3)$$,
  array['42501'], 'only the web app''s login role may unlock, even with an admin''s claims');
commit;

-- Key rotation (owner): exactly one row replaced, every counter and trusted browser restarts.
do $$
declare
  v_before bytea := (select inner_key from private.rate_limit_secret);
  v_log_before bytea := (select log_inner_key from private.rate_limit_secret);
begin
  perform private.rotate_rate_limit_keys();
  perform tests.assert((select inner_key <> v_before and log_inner_key <> v_log_before and count(*) over () = 1
                        from private.rate_limit_secret),
    'rotation replaced both keys of the one row');
  perform tests.assert_eq((select count(*)::int from private.rate_limit_counters), 0, 'rotation: counters restart');
  perform tests.assert_eq((select count(*)::int from private.sign_in_trusted_devices), 0,
    'rotation: trusted browsers are forgotten');
end $$;
-- Without its one row, rotation refuses (and changes nothing).
begin;
delete from private.rate_limit_secret;
select tests.assert_fails($$select private.rotate_rate_limit_keys()$$, array['55000'],
  'rotation asserts exactly one key row');
rollback;

\echo '72_rate_limiter_owner: ok'
