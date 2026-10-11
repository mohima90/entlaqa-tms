-- db-test: run-as=app_server
-- Shared rate limiter and sign-in protection (ADR 0011 §4, T-M2-11) as the web app calls them: inside
-- `set local role authenticated` without claims (packages/platform-db/src/rate-limit.ts), the Organization
-- Admin functions with the admin's claims. Generic counters (counting, refusal with the time left, a full
-- window from the hit that used the budget up, clear, give back, independent buckets and keys, a new window
-- after the old one ended); sign-in (counted before Auth, refunds, Auth's own refusal, opt-in trusted
-- browsers — a token the server knows or a fresh one, renewal on ticked sign-ins only —, password reset,
-- forgetting the other browsers); Organization Admin lock state and unlock (active members only, 3 a day,
-- the owner's notice); the lockout e-mail request; argument checks; no direct access to the keys, counters
-- or trusted browsers. Committed; the stored state is checked in 72_rate_limiter_owner.sql. Concurrency
-- (parallel hits and sign-in checks of one key on separate connections): packages/platform-db
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
  -- second ago — does not count: the next hit starts a new window on the same row.
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

  -- Keys and buckets are independent; one subject has one reference in every bucket (log correlation).
  select * into r from private.rate_limit_hit('tests.count', s2, 3, 900);
  perform tests.assert(r.allowed and r.remaining = 2 and r.key_ref <> v_ref, 'another subject has its own counter');
  select * into r from private.rate_limit_hit('tests.other', s1, 3, 900);
  perform tests.assert(r.allowed and r.remaining = 2, 'another bucket has its own counter');
  perform tests.assert_eq(r.key_ref, v_ref, 'one subject, one reference across buckets');

  -- Clear: the key starts again (one bucket only).
  perform private.rate_limit_clear('tests.count', s1);
  select * into r from private.rate_limit_hit('tests.count', s1, 3, 900);
  perform tests.assert(r.allowed and r.remaining = 2, 'clear: the key is forgotten');
  select * into r from private.rate_limit_hit('tests.other', s1, 3, 900);
  perform tests.assert(r.remaining = 1, 'clear forgets one bucket only');

  -- Give back (failures-only counting, e.g. authenticator codes): one hit back; the last one removes the
  -- counter; an unknown key is a no-op.
  for i in 1..3 loop
    perform private.rate_limit_hit('tests.give_back', s1, 5, 900);
  end loop;
  perform private.rate_limit_give_back('tests.give_back', s1);
  select * into r from private.rate_limit_hit('tests.give_back', s1, 5, 900);
  perform tests.assert(r.remaining = 2, 'give back: one hit less (3 − 1 + 1 = 3 of 5)');
  for i in 1..4 loop
    perform private.rate_limit_give_back('tests.give_back', s1);
  end loop;
  select * into r from private.rate_limit_hit('tests.give_back', s1, 5, 900);
  perform tests.assert(r.remaining = 4, 'give back: never below zero');

  -- A limit of one: the first hit uses it up.
  select * into r from private.rate_limit_hit('tests.single', s1, 1, 30);
  perform tests.assert(r.allowed and r.remaining = 0 and r.retry_after_seconds between 29 and 30, 'max 1: first allowed');
  select * into r from private.rate_limit_hit('tests.single', s1, 1, 30);
  perform tests.assert(not r.allowed, 'max 1: second refused');
end $$;

-- Sign-in (counted BEFORE Auth is asked; security review T-M2-11). Small budgets: client attempts 8,
-- client failures 6, account 3, trusted browser 2 (each per 900 s); clients c5/c6 with wide client budgets.
-- Subjects: clients c1–c6, browser tokens d1, d2, f1–f3 (labels); accounts x/k/429/spray-* that never
-- sign in (labels), and the accounts that do — y, z, q, p, w, renewed, kept, ok-1…5 — with the address
-- subjects of their Auth users (fixtures of 70, rl-*@a.test): succeeded gets the user of the token Auth
-- issued, and that user's address must give the account (integration review hardening). The calls below are
-- what the web app does for each attempt: check, then — only when Auth accepted the password —
-- succeeded (p_remember: «تذكّر هذا المتصفح» ticked; the fresh token the app minted for this request).
do $$
declare
  c1 constant bytea := sha256(convert_to('client-1', 'UTF8'));
  c2 constant bytea := sha256(convert_to('client-2', 'UTF8'));
  c3 constant bytea := sha256(convert_to('client-3', 'UTF8'));
  c4 constant bytea := sha256(convert_to('client-4', 'UTF8'));
  c5 constant bytea := sha256(convert_to('client-5', 'UTF8'));
  x constant bytea := sha256(convert_to('account-x', 'UTF8'));
  y constant bytea := tests.rate_limit_account('rl-y@a.test');
  z constant bytea := tests.rate_limit_account('rl-z@a.test');
  q constant bytea := tests.rate_limit_account('rl-q@a.test');
  p constant bytea := tests.rate_limit_account('rl-p@a.test');
  w constant bytea := tests.rate_limit_account('rl-w@a.test');
  renewed constant bytea := tests.rate_limit_account('rl-renewed@a.test');
  kept constant bytea := tests.rate_limit_account('rl-kept@a.test');
  uy constant uuid := '00000000-0000-4000-8000-000000007101';
  uz constant uuid := '00000000-0000-4000-8000-000000007102';
  uq constant uuid := '00000000-0000-4000-8000-000000007103';
  up constant uuid := '00000000-0000-4000-8000-000000007104';
  uw constant uuid := '00000000-0000-4000-8000-000000007105';
  urenewed constant uuid := '00000000-0000-4000-8000-000000007106';
  ukept constant uuid := '00000000-0000-4000-8000-000000007107';
  d1 constant bytea := sha256(convert_to('device-1', 'UTF8'));
  d2 constant bytea := sha256(convert_to('device-2', 'UTF8'));
  dx constant bytea := sha256(convert_to('device-unknown', 'UTF8'));
  f1 constant bytea := sha256(convert_to('fresh-1', 'UTF8'));
  f2 constant bytea := sha256(convert_to('fresh-2', 'UTF8'));
  f3 constant bytea := sha256(convert_to('fresh-3', 'UTF8'));
  r record;
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

  -- Account y from client c1, a browser without a token, «تذكّر هذا المتصفح» ticked: the provisional client
  -- failure is refunded, y's run ends, and the app's fresh token (d1) is trusted for y for 30 days.
  select * into r from private.rate_limit_sign_in_check(c1, y, null, 8, 900, 6, 900, 3, 900, 2, 900);
  perform tests.assert(r.allowed and not r.trusted and r.client_remaining = 2, 'y: an unknown browser');
  select * into r from private.rate_limit_sign_in_succeeded(c1, y, null, d1, false, true, 30, uy, null, false, 15);
  perform tests.assert(r.device = 'fresh'
                       and r.trusted_until between now() + interval '30 days' - interval '1 minute' and now() + interval '30 days',
    'succeeded, ticked: the fresh token is trusted for 30 days');
  select * into r from private.rate_limit_sign_in_check(c1, y, d1, 8, 900, 6, 900, 3, 900, 2, 900);
  perform tests.assert(r.allowed and r.trusted and r.remaining = 1 and r.client_remaining = 2,
    'y with d1: trusted (counted against the browser''s budget of 2); the success did not count for the client');
  select * into r from private.rate_limit_sign_in_succeeded(c1, y, d1, f1, true, true, 30, uy, null, false, 15);
  perform tests.assert(r.device = 'presented', 'a trusted browser keeps its token');
  -- d1 is trusted for y only: account x stays locked for it.
  select * into r from private.rate_limit_sign_in_check(c1, x, d1, 8, 900, 6, 900, 3, 900, 2, 900);
  perform tests.assert(not r.allowed and not r.trusted and r.refused_by = 'sign_in.account_failures',
    'a browser trusted by another account is an unknown browser here');

  -- A token the server never issued (dx) is never trusted: the fresh one is, and the browser gets it.
  select * into r from private.rate_limit_sign_in_check(c5, y, dx, 100, 900, 100, 900, 3, 900, 2, 900);
  perform tests.assert(r.allowed and not r.trusted, 'an unknown token');
  select * into r from private.rate_limit_sign_in_succeeded(c5, y, dx, f1, false, true, 30, uy, null, false, 15);
  perform tests.assert(r.device = 'fresh', 'an unknown presented token is replaced by the fresh one');
  select * into r from private.rate_limit_sign_in_check(c5, y, dx, 100, 900, 100, 900, 3, 900, 2, 900);
  perform tests.assert(not r.trusted, 'the unknown token stays untrusted');
  select * into r from private.rate_limit_sign_in_check(c5, y, f1, 100, 900, 100, 900, 3, 900, 2, 900);
  perform tests.assert(r.trusted, 'the fresh token is trusted');
  perform private.rate_limit_sign_in_succeeded(c5, y, f1, f2, true, false, 30, uy, null, false, 15);

  -- Trust is opt-in: an unticked sign-in trusts nothing, and returns no token.
  select * into r from private.rate_limit_sign_in_check(c5, q, null, 100, 900, 100, 900, 3, 900, 2, 900);
  select * into r from private.rate_limit_sign_in_succeeded(c5, q, null, f3, false, false, 30, uq, null, false, 15);
  perform tests.assert(r.trusted_until is null and r.device is null, 'unticked: nothing is trusted');
  select * into r from private.rate_limit_sign_in_check(c5, q, f3, 100, 900, 100, 900, 3, 900, 2, 900);
  perform tests.assert(r.allowed and not r.trusted and r.remaining = 2,
    'unticked: the fresh token was not trusted (and the success ended q''s run)');
  -- Renewal: a ticked sign-in of a trusted browser renews its 30 days (fixture: 10 left); an unticked one
  -- leaves the trust as it is (checked in 72) — it still holds until it ends.
  select * into r from private.rate_limit_sign_in_check(c5, renewed,
                                                        sha256(convert_to('renewed-device', 'UTF8')), 100, 900, 100, 900, 3, 900, 2, 900);
  perform tests.assert(r.trusted, 'renewed-device is trusted');
  select * into r from private.rate_limit_sign_in_succeeded(c5, renewed,
                                                            sha256(convert_to('renewed-device', 'UTF8')), f3, true, true, 30, urenewed, null, false, 15);
  perform tests.assert(r.device = 'presented' and r.trusted_until > now() + interval '29 days',
    'ticked: the trust is renewed for 30 days');
  select * into r from private.rate_limit_sign_in_check(c5, kept,
                                                        sha256(convert_to('kept-device', 'UTF8')), 100, 900, 100, 900, 3, 900, 2, 900);
  select * into r from private.rate_limit_sign_in_succeeded(c5, kept,
                                                            sha256(convert_to('kept-device', 'UTF8')), f3, true, false, 30, ukept, null, false, 15);
  perform tests.assert(r.trusted_until is null and r.device is null, 'unticked by a trusted browser: no renewal');
  select * into r from private.rate_limit_sign_in_check(c5, kept,
                                                        sha256(convert_to('kept-device', 'UTF8')), 100, 900, 100, 900, 3, 900, 2, 900);
  perform tests.assert(r.trusted, 'unticked by a trusted browser: still trusted until its trust ends');

  -- Auth refused before comparing the password (its own rate limit): the account's provisional failure
  -- is given back, the client's stays.
  select * into r from private.rate_limit_sign_in_check(c5, sha256(convert_to('account-429', 'UTF8')), null,
                                                        100, 900, 100, 900, 3, 900, 2, 900);
  perform tests.assert(r.remaining = 2, 'account-429: first failure');
  perform private.rate_limit_sign_in_not_checked(sha256(convert_to('account-429', 'UTF8')), null, false);
  select * into r from private.rate_limit_sign_in_check(c5, sha256(convert_to('account-429', 'UTF8')), null,
                                                        100, 900, 100, 900, 3, 900, 2, 900);
  perform tests.assert(r.remaining = 2, 'not compared: the account''s failure was given back');

  -- Account z: d1 signs in (ticked) — the server knows d1 (trusted by y), so the browser keeps it: one
  -- cookie for every account. Then z is locked by failures from other browsers; d1 still gets its own
  -- budget (2), the lock stays for everyone else, and d1's success does not end it.
  select * into r from private.rate_limit_sign_in_check(c3, z, d1, 8, 900, 6, 900, 3, 900, 2, 900);
  select * into r from private.rate_limit_sign_in_succeeded(c3, z, d1, f2, r.trusted, true, 30, uz, null, false, 15);
  perform tests.assert(r.device = 'presented', 'a token the server knows (another account''s) is reused');
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
  perform private.rate_limit_sign_in_succeeded(c3, z, d1, f2, true, true, 30, uz, null, false, 15);
  select * into r from private.rate_limit_sign_in_check(c3, z, d1, 8, 900, 6, 900, 3, 900, 2, 900);
  perform tests.assert(r.allowed and r.trusted and r.remaining = 1 and r.client_remaining = 4,
    'a success ends the trusted browser''s run');
  -- Auth's own refusal on the trusted path: the browser's provisional failure is given back, the client's
  -- stays.
  perform private.rate_limit_sign_in_not_checked(z, d1, true);
  select * into r from private.rate_limit_sign_in_check(c3, z, d1, 8, 900, 6, 900, 3, 900, 2, 900);
  perform tests.assert(r.allowed and r.trusted and r.remaining = 1 and r.client_remaining = 3,
    'not compared: the browser''s failure was given back, the client''s was not');
  select * into r from private.rate_limit_sign_in_check(c4, z, null, 8, 900, 6, 900, 3, 900, 2, 900);
  perform tests.assert(not r.allowed and r.refused_by = 'sign_in.account_failures',
    'the trusted browser''s success does not end the account''s lock');

  -- A completed password reset from a browser with a token the server never issued (d2), «تذكّر هذا
  -- المتصفح» NOT ticked on the reset page (the web app passes 1 day): the lock ends, the browser gets the
  -- fresh token (f2) and is trusted for 24 hours only (security re-review N1), every other browser (d1) is
  -- forgotten.
  select * into r from private.rate_limit_sign_in_reset(z, d2, f2, 1);
  perform tests.assert(r.revoked = 1 and r.device = 'fresh'
                       and r.trusted_until between now() + interval '24 hours' - interval '1 minute' and now() + interval '24 hours',
    'reset, unticked: d1 forgotten, the fresh token trusted for 24 hours');
  select * into r from private.rate_limit_sign_in_check(c3, z, d1, 8, 900, 6, 900, 3, 900, 2, 900);
  perform tests.assert(r.allowed and not r.trusted and r.remaining = 2, 'after a reset: unlocked, d1 no longer trusted');
  select * into r from private.rate_limit_sign_in_check(c3, z, f2, 8, 900, 6, 900, 3, 900, 2, 900);
  perform tests.assert(r.allowed and r.trusted, 'after a reset: the browser that completed it is trusted');
  -- A reset from that (known) browser, ticked (30 days): it keeps its token and forgets nothing else (there
  -- is nothing else); its trust now lasts 30 days.
  select * into r from private.rate_limit_sign_in_reset(z, f2, f3, 30);
  perform tests.assert(r.revoked = 0 and r.device = 'presented' and r.trusted_until > now() + interval '29 days',
    'reset from a trusted browser, ticked: it keeps its token, trusted for 30 days');
  -- Unticked again: a longer trust is never shortened (72: still 30 days).
  select * into r from private.rate_limit_sign_in_reset(z, f2, f3, 1);
  perform tests.assert(r.device = 'presented' and r.trusted_until > now() + interval '29 days',
    'reset, unticked, from a browser trusted for 30 days: its trust is kept');
  -- One cookie serves every account: an unticked reset of account k from d1 (trusted by y for 30 days)
  -- trusts d1 for k for 24 hours, but the cookie must keep living for y's 30 days (72 checks k's 24 hours).
  select * into r from private.rate_limit_sign_in_reset(sha256(convert_to('account-k', 'UTF8')), d1, f3, 1);
  perform tests.assert(r.device = 'presented' and r.revoked = 0 and r.trusted_until > now() + interval '29 days',
    'the cookie lives as long as the longest trust of its token (any account)');

  -- After a password change on My profile: every other trusted browser is forgotten.
  perform private.rate_limit_sign_in_succeeded(c5, p, null, sha256(convert_to('p-1', 'UTF8')), false, true, 30, up, null, false, 15);
  perform private.rate_limit_sign_in_succeeded(c5, p, null, sha256(convert_to('p-2', 'UTF8')), false, true, 30, up, null, false, 15);
  perform tests.assert_eq(private.rate_limit_forget_other_devices(p, sha256(convert_to('p-1', 'UTF8'))), 1,
    'forget the others: one browser forgotten');
  select * into r from private.rate_limit_sign_in_check(c5, p, sha256(convert_to('p-1', 'UTF8')), 100, 900, 100, 900, 3, 900, 2, 900);
  perform tests.assert(r.trusted, 'the current browser stays trusted');
  select * into r from private.rate_limit_sign_in_check(c5, p, sha256(convert_to('p-2', 'UTF8')), 100, 900, 100, 900, 3, 900, 2, 900);
  perform tests.assert(not r.trusted, 'the other browser is forgotten');
  perform tests.assert_eq(private.rate_limit_forget_other_devices(p, null), 1,
    'a browser without a token: every trusted browser is forgotten');

  -- Client budgets: successes never count as failures; every attempt counts as an attempt.
  for i in 1..5 loop
    select * into r from private.rate_limit_sign_in_check(c2, tests.rate_limit_account('rl-ok-' || i || '@a.test'), null,
                                                          8, 900, 6, 900, 3, 900, 2, 900);
    perform private.rate_limit_sign_in_succeeded(c2, tests.rate_limit_account('rl-ok-' || i || '@a.test'), null, d1, false, false, 30,
                                                 ('00000000-0000-4000-8000-00000000711' || i)::uuid, null, false, 15);
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

  -- At most 10 trusted browsers per account (checked in 72): 12 browsers sign in to account w, ticked.
  for i in 1..12 loop
    perform private.rate_limit_sign_in_succeeded(c1, w, null,
                                                 sha256(convert_to('browser-' || i, 'UTF8')), false, true, 30, uw, null, false, 15);
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
select tests.assert_fails($$select * from private.rate_limit_sign_in_succeeded(sha256('\x01'::bytea), sha256('\x02'::bytea), null, null, false, true, 30, '00000000-0000-4000-8000-0000000000a1', null, false, 15)$$,
  array['22023'], 'remembering a browser needs the fresh token');
select tests.assert_fails($$select * from private.rate_limit_sign_in_succeeded(sha256('\x01'::bytea), sha256('\x02'::bytea), null, sha256('\x03'::bytea), true, false, 30, '00000000-0000-4000-8000-0000000000a1', null, false, 15)$$,
  array['22023'], 'a trusted browser presented its token');
select tests.assert_fails($$select * from private.rate_limit_sign_in_succeeded(sha256('\x01'::bytea), sha256('\x02'::bytea), null, sha256('\x03'::bytea), false, null, 30, '00000000-0000-4000-8000-0000000000a1', null, false, 15)$$,
  array['22023'], 'say whether to remember the browser');
select tests.assert_fails($$select * from private.rate_limit_sign_in_succeeded(sha256('\x01'::bytea), sha256('\x02'::bytea), null, sha256('\x03'::bytea), false, true, 0, '00000000-0000-4000-8000-0000000000a1', null, false, 15)$$,
  array['22023'], 'a browser is trusted for at least a day');
select tests.assert_fails($$select private.rate_limit_sign_in_not_checked(sha256('\x02'::bytea), null, true)$$,
  array['22023'], 'not compared: a trusted browser presented its token');
select tests.assert_fails($$select * from private.rate_limit_sign_in_reset(null, null, sha256('\x03'::bytea), 30)$$,
  array['22023'], 'reset: an account subject');
select tests.assert_fails($$select * from private.rate_limit_sign_in_reset(sha256('\x02'::bytea), null, null, 30)$$,
  array['22023'], 'reset: the fresh token');
select tests.assert_fails($$select private.rate_limit_forget_other_devices(null, null)$$,
  array['22023'], 'forget the others: an account subject');

-- Generic arguments: a bucket name, a 32-byte subject (never a readable key), 1–1,000,000 hits, 1–86,400 s.
select tests.assert_fails($$select private.rate_limit_hit('Bad Bucket', sha256('\x01'::bytea), 3, 60)$$,
  array['22023'], 'invalid bucket name');
select tests.assert_fails($$select private.rate_limit_hit(null, sha256('\x01'::bytea), 3, 60)$$,
  array['22023'], 'null bucket');
select tests.assert_fails($$select private.rate_limit_hit('tests.args', convert_to('someone@example.test', 'UTF8'), 3, 60)$$,
  array['22023'], 'a readable key is refused (subject must be a 32-byte hash)');
select tests.assert_fails($$select private.rate_limit_give_back('tests.args', null)$$, array['22023'], 'null subject');
select tests.assert_fails($$select private.rate_limit_clear('tests.args', '\x00'::bytea)$$, array['22023'], 'short subject');
select tests.assert_fails($$select private.rate_limit_hit('tests.args', sha256('\x01'::bytea), 0, 60)$$,
  array['22023'], 'max_hits must be positive');
select tests.assert_fails($$select private.rate_limit_hit('tests.args', sha256('\x01'::bytea), 3, 0)$$,
  array['22023'], 'window must be positive');
select tests.assert_fails($$select private.rate_limit_hit('tests.args', sha256('\x01'::bytea), 3, 86401)$$,
  array['22023'], 'window at most a day (bounded retention)');
select tests.assert_fails($$select private.rate_limit_hit('tests.args', sha256('\x01'::bytea), 1000001, 60)$$,
  array['22023'], 'max_hits at most a million');

-- Whether a typed address is an active member of the host's organization (its lockout policy applies to
-- its members only): uA is an active member of A (active tenant), not of B; the invited, suspended and
-- revoked members of A are not active; tenant C is suspended; an unknown address is no member. The
-- address is normalised like the account's subject (72 checks the normalisation itself).
do $$
begin
  perform tests.assert(private.sign_in_account_in_tenant(' UA@a.test ', 'a0000000-0000-4000-8000-000000000001'),
    'an active member of A (address as typed)');
  perform tests.assert(not private.sign_in_account_in_tenant('ua@a.test', 'b0000000-0000-4000-8000-000000000001'),
    'not a member of B');
  perform tests.assert(not private.sign_in_account_in_tenant('uinv@a.test','a0000000-0000-4000-8000-000000000001')
                       and not private.sign_in_account_in_tenant('usus@a.test', 'a0000000-0000-4000-8000-000000000001')
                       and not private.sign_in_account_in_tenant('urev@a.test', 'a0000000-0000-4000-8000-000000000001'),
    'invited, suspended or revoked: not an active member');
  perform tests.assert(not private.sign_in_account_in_tenant('uc@c.test', 'c0000000-0000-4000-8000-000000000001'),
    'a suspended organization has no active members');
  perform tests.assert(not private.sign_in_account_in_tenant('nobody@nowhere.test', 'a0000000-0000-4000-8000-000000000001')
                       and not private.sign_in_account_in_tenant(null, 'a0000000-0000-4000-8000-000000000001')
                       and not private.sign_in_account_in_tenant('ua@a.test', null),
    'unknown address or no organization: no member');
end $$;

-- Without claims, the Organization Admin functions refuse.
select tests.assert_fails($$select * from private.member_sign_in_lock('a1000000-0000-4000-8000-0000000000ab', 3)$$,
  array['42501'], 'lock state: a signed-in member only');
select tests.assert_fails($$select private.unlock_member_sign_in('a1000000-0000-4000-8000-0000000000ab', 3)$$,
  array['42501'], 'unlock: a signed-in member only');

-- The lockout e-mail request (20261013090100): unconditional, one waiting request per address (checked
-- in 72), nothing for an invalid address or duration.
select private.request_account_locked_mail(' UAB@ab.test ', 15);
select private.request_account_locked_mail('uab@ab.test', 15);
select private.request_account_locked_mail('nobody@nowhere.test', 15);
select private.request_account_locked_mail('not an address', 15);
select private.request_account_locked_mail('uab2@ab.test', 0);

-- The "wrong codes after your password" request (integration review M1): without claims (the limiter's own
-- transaction), one waiting request per account (checked in 72), nothing for an unknown account or an
-- invalid duration; a user is required.
select private.request_mfa_code_locked_mail('00000000-0000-4000-8000-0000000000ab', 15);
select private.request_mfa_code_locked_mail('00000000-0000-4000-8000-0000000000ab', 15);
select private.request_mfa_code_locked_mail('00000000-0000-4000-8000-00000000dead', 15);
select private.request_mfa_code_locked_mail('00000000-0000-4000-8000-0000000000a1', 0);
select private.request_mfa_code_locked_mail('00000000-0000-4000-8000-0000000000a1', 1441);
select tests.assert_fails($$select private.request_mfa_code_locked_mail(null, 15)$$, array['42501'],
  'the "wrong codes" notice names its account');

-- No direct access: neither the keys, nor the counters, nor the trusted browsers, nor the helpers, nor the
-- unlock notice (requested by the unlock itself only).
select tests.assert_privilege_denied('select * from private.rate_limit_secret', 'app_server cannot read the limiter keys');
select tests.assert_privilege_denied('select * from private.rate_limit_counters', 'app_server cannot read the counters');
select tests.assert_privilege_denied('select * from private.sign_in_trusted_devices', 'app_server cannot read trusted browsers');
select tests.assert_privilege_denied($$delete from private.rate_limit_counters$$, 'app_server cannot delete counters');
select tests.assert_privilege_denied($$select private.rate_limit_key(sha256('\x01'::bytea))$$,
  'app_server cannot compute keyed hashes itself');
select tests.assert_privilege_denied($$select private.rate_limit_account_subject('ua@a.test')$$,
  'app_server cannot call the helpers');
select tests.assert_privilege_denied($$select private.rate_limit_choose_device(sha256('\x01'::bytea))$$,
  'app_server cannot ask whether a token is known');
select tests.assert_privilege_denied($$select private.rotate_rate_limit_keys()$$, 'app_server cannot rotate the keys');
select tests.assert_privilege_denied($$select private.request_sign_in_unlocked_mail('00000000-0000-4000-8000-0000000000ab')$$,
  'app_server cannot request the unlock notice itself');
commit;

-- With claims, the "wrong codes" notice is only ever for the signed-in user (integration review M1).
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
                                          'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
select tests.assert_fails($$select private.request_mfa_code_locked_mail('00000000-0000-4000-8000-0000000000ab', 15)$$,
  array['42501'], 'with claims: never for another account');
select private.request_mfa_code_locked_mail('00000000-0000-4000-8000-0000000000a1', 15);
rollback;

-- «تذكّر هذا المتصفح» for an account with an authenticator app (integration review L4 and its re-review):
-- the database decides at the password step that the account has an app and keeps the tick for the
-- session's sign-in code; only a session the database sees at AAL2 through a confirmed app with a fresh
-- code (T-M2-10 fixtures of 65: uA2 …c09 / sA2 …c91 at AAL2; uM1 …c04 / sM1 …c41 signed in with the password
-- only; uA has no app) gets the browser trusted, once. Rolled back.
begin;
set local role authenticated;
do $$
declare
  v_session_a2 constant bytea := sha256(convert_to(
    'jadarat.rate-limit.v1' || chr(10) || 'session' || chr(10) || '10000000-0000-4000-8000-000000000c91', 'UTF8'));
  v_session_m1 constant bytea := sha256(convert_to(
    'jadarat.rate-limit.v1' || chr(10) || 'session' || chr(10) || '10000000-0000-4000-8000-000000000c41', 'UTF8'));
  v_account_a2 constant bytea := sha256(convert_to(
    'jadarat.rate-limit.v1' || chr(10) || 'account' || chr(10) || 'ua2@a.test', 'UTF8'));
  v_account_m1 constant bytea := sha256(convert_to(
    'jadarat.rate-limit.v1' || chr(10) || 'account' || chr(10) || 'um1@a.test', 'UTF8'));
  v_account_a constant bytea := sha256(convert_to(
    'jadarat.rate-limit.v1' || chr(10) || 'account' || chr(10) || 'ua@a.test', 'UTF8'));
  v_fresh constant bytea := sha256(convert_to('tests.trust-after-code', 'UTF8'));
  v_a2 constant jsonb := tests.user_claims('00000000-0000-4000-8000-000000000c09', '10000000-0000-4000-8000-000000000c91',
                                           'a0000000-0000-4000-8000-000000000001');
  v_m1 constant jsonb := tests.user_claims('00000000-0000-4000-8000-000000000c04', '10000000-0000-4000-8000-000000000c41',
                                           'a0000000-0000-4000-8000-000000000001');
  r record;
begin
  -- The shared vector (auth-limits.test.ts): the session subject the web app sends.
  perform tests.assert_eq(encode(v_session_a2, 'hex'),
    '291dc6033ad349160f5b283a29178503019810558330ae234b920e2209aa8e6f', 'the session subject (same vector as the web app)');
  -- At the password step (no claims, the limiter's own transaction), «تذكّر هذا المتصفح» ticked. The
  -- database decides whether the account has an app, whatever the caller says (re-review): uA2 has a
  -- confirmed app — although the caller says Auth named none, nothing is trusted and the tick waits for the
  -- session's code.
  perform tests.set_claims(null);
  select * into r from private.rate_limit_sign_in_succeeded(sha256(convert_to('client-l4', 'UTF8')), v_account_a2, null,
                                                            v_fresh, false, true, 30,
                                                            '00000000-0000-4000-8000-000000000c09', v_session_a2,
                                                            false, 15);
  perform tests.assert(r.trusted_until is null and r.device is null and r.waits_for_code,
    'a user with an authenticator app: the password alone trusts nothing, even when the caller claims no app');
  -- uM1 (a verified app too) signs in with the password only; Auth named its app.
  select * into r from private.rate_limit_sign_in_succeeded(sha256(convert_to('client-l4', 'UTF8')), v_account_m1, null,
                                                            v_fresh, false, true, 30,
                                                            '00000000-0000-4000-8000-000000000c04', v_session_m1,
                                                            true, 15);
  perform tests.assert(r.trusted_until is null and r.waits_for_code, 'Auth named the app: the tick waits for the code');
  -- A user the web app could not verify: no trust either (fail safe).
  select * into r from private.rate_limit_sign_in_succeeded(sha256(convert_to('client-l4', 'UTF8')), v_account_a, null,
                                                            v_fresh, false, true, 30, null, null, false, 15);
  perform tests.assert(r.trusted_until is null and r.waits_for_code, 'no verified user: nothing is trusted');
  -- The token's user must be the account that signed in (integration review hardening): uA (no app) with
  -- the subject of another account without an app (rl-y@a.test), a user Auth does not know, and a user
  -- without an address (7108) are each treated as an account with an app — nothing is trusted, the tick
  -- waits for the session's code.
  select * into r from private.rate_limit_sign_in_succeeded(sha256(convert_to('client-l4', 'UTF8')),
                                                            tests.rate_limit_account('rl-y@a.test'), null,
                                                            v_fresh, false, true, 30,
                                                            '00000000-0000-4000-8000-0000000000a1', null, false, 15);
  perform tests.assert(r.trusted_until is null and r.device is null and r.waits_for_code,
    'another account''s user: the password alone trusts nothing, the tick waits for the code');
  select * into r from private.rate_limit_sign_in_succeeded(sha256(convert_to('client-l4', 'UTF8')), v_account_a, null,
                                                            v_fresh, false, true, 30,
                                                            '00000000-0000-4000-8000-0000000071ff', null, false, 15);
  perform tests.assert(r.trusted_until is null and r.waits_for_code, 'a user Auth does not know: nothing is trusted');
  select * into r from private.rate_limit_sign_in_succeeded(sha256(convert_to('client-l4', 'UTF8')), v_account_a, null,
                                                            v_fresh, false, true, 30,
                                                            '00000000-0000-4000-8000-000000007108', null, false, 15);
  perform tests.assert(r.trusted_until is null and r.waits_for_code, 'a user without an address: nothing is trusted');
  select * into r from private.rate_limit_sign_in_check(sha256(convert_to('client-l4', 'UTF8')),
                                                        tests.rate_limit_account('rl-y@a.test'), v_fresh,
                                                        100, 900, 100, 900, 5, 900, 10, 900);
  perform tests.assert(not r.trusted, 'the mismatched account does not trust the browser');
  -- uA has no authenticator app: trusted at the password step, as before.
  select * into r from private.rate_limit_sign_in_succeeded(sha256(convert_to('client-l4', 'UTF8')), v_account_a, null,
                                                            v_fresh, false, true, 30,
                                                            '00000000-0000-4000-8000-0000000000a1', null, false, 15);
  perform tests.assert(r.device = 'fresh' and r.trusted_until > now() + interval '29 days' and not r.waits_for_code,
    'a user without an app: trusted for 30 days at the password step');
  perform tests.assert_fails(format('select * from private.rate_limit_sign_in_succeeded(%L::bytea, %L::bytea, null, %L::bytea, false, true, 30, null, %L::bytea, false, 61)',
                                    sha256(convert_to('client-l4', 'UTF8')), v_account_a2, v_fresh, v_session_a2),
    array['22023'], 'the tick waits at most 60 minutes');
  perform tests.assert_fails(format('select * from private.rate_limit_sign_in_succeeded(%L::bytea, %L::bytea, null, %L::bytea, false, true, 30, null, %L::bytea, null, 15)',
                                    sha256(convert_to('client-l4', 'UTF8')), v_account_a2, v_fresh, v_session_a2),
    array['22023'], 'say whether Auth named an app');
  perform tests.assert_fails('select * from private.rate_limit_trust_after_code(null, sha256(''\x01''::bytea), 30)',
    array['42501'], 'trusting after a code needs the session''s claims');
  select * into r from private.rate_limit_sign_in_check(sha256(convert_to('client-l4', 'UTF8')), v_account_a2, v_fresh,
                                                        100, 900, 100, 900, 5, 900, 10, 900);
  perform tests.assert(not r.trusted, 'after the password alone the browser is not trusted');
  -- uM1 signed in with the password only (its Auth session is aal1): a token CLAIMING aal2 and a fresh code is
  -- not enough — no browser is trusted (the database checks Auth's own session level and the app).
  perform tests.set_claims(v_m1 || tests.fresh_code());
  perform tests.assert(not exists (select 1 from private.rate_limit_trust_after_code(null, v_fresh, 30)),
    'password only: no trusted browser, whatever the token claims');
  -- uA2's code is older than the step-up age: nothing.
  perform tests.set_claims(v_a2 || tests.fresh_code(interval '20 minutes'));
  perform tests.assert(not exists (select 1 from private.rate_limit_trust_after_code(null, v_fresh, 30)),
    'an old code trusts nothing');
  -- uA2's code just passed: the fresh token is trusted for the account, 30 days — once.
  perform tests.set_claims(v_a2 || tests.fresh_code());
  select * into r from private.rate_limit_trust_after_code(null, v_fresh, 30);
  perform tests.assert(r.device = 'fresh' and r.trusted_until between now() + interval '29 days 23 hours'
                                                                  and now() + interval '30 days 1 hour',
    'after the sign-in code: the browser is trusted for 30 days');
  perform tests.assert(not exists (select 1 from private.rate_limit_trust_after_code(null, v_fresh, 30)),
    'the tick is used up');
  perform tests.set_claims(null);
  select * into r from private.rate_limit_sign_in_check(sha256(convert_to('client-l4', 'UTF8')), v_account_a2, v_fresh,
                                                        100, 900, 100, 900, 5, 900, 10, 900);
  perform tests.assert(r.trusted, 'the browser is now trusted for that account');
end $$;
rollback;

-- Accounts locked by failures (uAB 'uab@ab.test' and the former member uRev 'urev@a.test', subjects as the
-- web app derives them), then the Organization Admin of A (uA) sees the lock of their member and ends it.
begin;
set local role authenticated;
select tests.set_claims(null);
do $$
declare
  v_uab constant bytea := sha256(convert_to(E'jadarat.rate-limit.v1\naccount\nuab@ab.test', 'UTF8'));
  v_urev constant bytea := sha256(convert_to(E'jadarat.rate-limit.v1\naccount\nurev@a.test', 'UTF8'));
  r record;
begin
  for i in 1..4 loop
    select * into r from private.rate_limit_sign_in_check(sha256(convert_to('client-admin', 'UTF8')), v_uab, null,
                                                          100, 900, 100, 900, 3, 900, 10, 900);
  end loop;
  perform tests.assert(not r.allowed and r.refused_by = 'sign_in.account_failures', 'uAB is locked');
  for i in 1..4 loop
    select * into r from private.rate_limit_sign_in_check(sha256(convert_to('client-admin', 'UTF8')), v_urev, null,
                                                          100, 900, 100, 900, 3, 900, 10, 900);
  end loop;
  perform tests.assert(not r.allowed and r.refused_by = 'sign_in.account_failures', 'uRev is locked');
end $$;
commit;

begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
                                          'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
do $$
declare
  v_uab constant bytea := sha256(convert_to(E'jadarat.rate-limit.v1\naccount\nuab@ab.test', 'UTF8'));
  v_urev constant bytea := sha256(convert_to(E'jadarat.rate-limit.v1\naccount\nurev@a.test', 'UTF8'));
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
  -- A former member (revoked): neither visible nor unlockable — the account stays locked.
  select * into r from private.member_sign_in_lock('a1000000-0000-4000-8000-0000000000a5', 3);
  perform tests.assert(not r.locked, 'a revoked member''s lock is not visible');
  perform tests.assert_eq(private.unlock_member_sign_in('a1000000-0000-4000-8000-0000000000a5', 3), 'no_account',
    'a revoked member cannot be unlocked');
  select * into r from private.rate_limit_sign_in_check(sha256(convert_to('client-admin', 'UTF8')), v_urev, null,
                                                        100, 900, 100, 900, 3, 900, 10, 900);
  perform tests.assert(not r.allowed and r.refused_by = 'sign_in.account_failures', 'the revoked member stays locked');
  perform tests.assert_eq(private.unlock_member_sign_in('b1000000-0000-4000-8000-0000000000ab', 3), 'no_account',
    'another organization''s membership of the same account cannot be unlocked from here');
  -- Measured against the budget the web app applies: under a budget of 5, uAB's failures are no lock — nothing
  -- is ended, counted or e-mailed (72: one unlock notice only, from the real unlocks below).
  perform tests.assert_eq(private.unlock_member_sign_in('a1000000-0000-4000-8000-0000000000ab', 5), 'not_locked',
    'a run of failures below the budget is no lock to end');
  select * into r from private.member_sign_in_lock('a1000000-0000-4000-8000-0000000000ab', 3);
  perform tests.assert(r.locked, 'and the run of failures is still there');
  perform tests.assert_eq(private.unlock_member_sign_in('a1000000-0000-4000-8000-0000000000ab', 3), 'unlocked',
    'unlock: there was a lock');
  select * into r from private.member_sign_in_lock('a1000000-0000-4000-8000-0000000000ab', 3);
  perform tests.assert(not r.locked, 'unlocked');
  perform tests.assert_eq(private.unlock_member_sign_in('a1000000-0000-4000-8000-0000000000ab', 3), 'not_locked',
    'nothing left to unlock (and nothing counted)');
  -- At most 3 unlocks a day per account: locked again twice and unlocked, the 4th unlock is refused.
  for k in 2..4 loop
    for i in 1..3 loop
      perform private.rate_limit_sign_in_check(sha256(convert_to('client-admin', 'UTF8')), v_uab, null,
                                               100, 900, 100, 900, 3, 900, 10, 900);
    end loop;
    perform tests.assert_eq(private.unlock_member_sign_in('a1000000-0000-4000-8000-0000000000ab', 3),
                            case when k <= 3 then 'unlocked' else 'limited' end,
      format('unlock %s of the day', k));
  end loop;
  select * into r from private.member_sign_in_lock('a1000000-0000-4000-8000-0000000000ab', 3);
  perform tests.assert(r.locked, 'a refused unlock leaves the lock');
end $$;
commit;

-- An HR Manager (uAB) and a learner (uInv) of A may not; the Organization Admin of B may not reach A.
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
                                          'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000ab'));
select tests.assert_fails($$select * from private.member_sign_in_lock('a1000000-0000-4000-8000-0000000000a1', 3)$$,
  array['42501'], 'an HR Manager may not see sign-in locks');
select tests.assert_fails($$select private.unlock_member_sign_in('a1000000-0000-4000-8000-0000000000a1', 3)$$,
  array['42501'], 'an HR Manager may not unlock');
commit;
-- The budget is checked before anything else.
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
                                          'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
select tests.assert_fails($$select private.unlock_member_sign_in('a1000000-0000-4000-8000-0000000000ab', 0)$$,
  array['22023'], 'unlock: the account budget is positive');
select tests.assert_fails($$select private.unlock_member_sign_in('a1000000-0000-4000-8000-0000000000ab', null)$$,
  array['22023'], 'unlock: the account budget is given');
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
  perform tests.assert_eq(private.unlock_member_sign_in('a1000000-0000-4000-8000-0000000000a1', 3), 'no_account',
    'the Organization Admin of B cannot reach a member of A');
end $$;
commit;

-- Outside `set role authenticated` the login role itself (NOINHERIT, no privileges) cannot call it.
select tests.assert_fails($$select private.rate_limit_hit('tests.args', sha256('\x01'::bytea), 3, 60)$$,
  array['42501'], 'app_server without the authenticated role has no access');

\echo '71_rate_limiter_app_server: ok'
