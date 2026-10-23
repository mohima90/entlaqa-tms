-- db-test: run-as=owner
-- Sign-in codes by e-mail (WP-ADM-05, FR-IAM-12; security re-review H1): the hook stores OUR code's keyed hash and
-- the sealed Auth token hash; the check is here. Runs as the owner and switches to the login roles as
-- 99_signin_1_kept_sessions_owner.sql does. Every block is rolled back. Covers: one live code per account (a new
-- one replaces), the right code releases the sealed token hash ONCE, 5 wrong tries remove the code, expiry, the
-- same answer for an address without an account, only a keyed hash is stored, no access to the tables, the
-- web app's login role only.

begin;
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(null);
do $$
declare
  r record;
begin
  perform count(*) from private.auth_mail_issue('00000000-0000-4000-8000-0000000000a1', '123456', 'sealed-token-hash-of-ua-one', 'magiclink');
  select * into r from private.verify_sign_in_code('ua@a.test', '000000');
  perform tests.assert(r.outcome = 'wrong' and r.token_hash_sealed is null, 'a wrong code: wrong, nothing released');
  select * into r from private.verify_sign_in_code('  UA@a.test ', '123456');
  perform tests.assert(r.outcome = 'ok' and r.user_id = '00000000-0000-4000-8000-0000000000a1'
                       and r.token_hash_sealed = 'sealed-token-hash-of-ua-one' and r.action_type = 'magiclink',
    'the right code (address trimmed, any case): the sealed token hash and its type');
  select * into r from private.verify_sign_in_code('ua@a.test', '123456');
  perform tests.assert(r.outcome = 'none' and r.token_hash_sealed is null, 'single use: the code is gone');

  -- A new code replaces the old one, and the tries start again.
  perform count(*) from private.auth_mail_issue('00000000-0000-4000-8000-0000000000a1', '111111', 'sealed-token-hash-of-ua-two', 'magiclink');
  perform count(*) from private.auth_mail_issue('00000000-0000-4000-8000-0000000000a1', '222222', 'sealed-token-hash-of-ua-three', 'magiclink');
  perform tests.assert_eq((select count(*) from private.verify_sign_in_code('ua@a.test', '111111') where outcome = 'wrong'), 1::bigint,
    'the replaced code no longer works');
  select * into r from private.verify_sign_in_code('ua@a.test', '222222');
  perform tests.assert(r.outcome = 'ok' and r.token_hash_sealed = 'sealed-token-hash-of-ua-three', 'the latest code works');

  -- Five wrong tries remove the code: the fifth answers killed, and then even the right code is refused.
  perform count(*) from private.auth_mail_issue('00000000-0000-4000-8000-0000000000a1', '333333', 'sealed-token-hash-of-ua-four', 'magiclink');
  for i in 1..4 loop
    select * into r from private.verify_sign_in_code('ua@a.test', '99999' || i::text);
    perform tests.assert(r.outcome = 'wrong', format('wrong try %s', i));
  end loop;
  select * into r from private.verify_sign_in_code('ua@a.test', '999995');
  perform tests.assert(r.outcome = 'killed', 'the 5th wrong try kills the code');
  select * into r from private.verify_sign_in_code('ua@a.test', '333333');
  perform tests.assert(r.outcome = 'none' and r.token_hash_sealed is null, 'and the right code no longer works');

  -- An address without an account, an account without a code, and another account''s address: nothing.
  select * into r from private.verify_sign_in_code('nobody@nowhere.test', '123456');
  perform tests.assert(r.outcome = 'none' and r.user_id is null, 'no account: none');
  perform count(*) from private.auth_mail_issue('00000000-0000-4000-8000-0000000000a1', '444444', 'sealed-token-hash-of-ua-five', 'magiclink');
  select * into r from private.verify_sign_in_code('ub@b.test', '444444');
  perform tests.assert(r.outcome = 'none' and r.token_hash_sealed is null, 'another account''s address does not release uA''s code');
  select * into r from private.verify_sign_in_code('ua@a.test', '444444');
  perform tests.assert(r.outcome = 'ok', 'uA''s own address does');

  -- A malformed code never reaches the comparison.
  perform tests.assert_fails($q$select * from private.verify_sign_in_code('ua@a.test', '12345')$q$, array['22023'], 'five digits');
  perform tests.assert_fails($q$select * from private.verify_sign_in_code('ua@a.test', 'abcdef')$q$, array['22023'], 'letters');
  perform tests.assert_fails($q$select * from private.verify_sign_in_code('ua@a.test', null)$q$, array['22023'], 'no code');
  perform tests.assert_fails($q$select * from private.verify_sign_in_code(null, '123456')$q$, array['22023'], 'no address');
end $$;
do $$
begin
  perform tests.assert_privilege_denied($q$select * from private.sign_in_codes$q$, 'the codes are not readable by the web app');
  perform tests.assert_privilege_denied($q$select * from private.sign_in_code_secret$q$, 'nor the key');
  perform tests.assert_privilege_denied($q$insert into private.sign_in_codes (user_id, code_hash, token_hash_sealed, action_type, expires_at)
    values (gen_random_uuid(), '\x00'::bytea, 'x', 'magiclink', now())$q$, 'nor writable');
  perform tests.assert_fails($q$select private.sign_in_code_hmac('00000000-0000-4000-8000-0000000000a1', '123456')$q$, array['42501'], 'the hash function is internal');
end $$;
rollback;

-- Expiry, and what is stored.
begin;
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(null);
do $$
begin
  perform count(*) from private.auth_mail_issue('00000000-0000-4000-8000-0000000000a1', '123456', 'sealed-token-hash-of-ua-one', 'magiclink');
end $$;
set local session authorization default;
do $$
begin
  perform tests.assert((select expires_at between now() + interval '9 minutes 50 seconds' and now() + interval '10 minutes 5 seconds'
                        from private.sign_in_codes where user_id = '00000000-0000-4000-8000-0000000000a1'), 'a code lives 10 minutes');
  perform tests.assert((select position('123456' in c::text) = 0 and octet_length(c.code_hash) = 32
                        from private.sign_in_codes c where user_id = '00000000-0000-4000-8000-0000000000a1'), 'only a keyed hash of the code is stored');
  perform tests.assert((select position('ua@a.test' in c::text) = 0 from private.sign_in_codes c), 'and no address');
  perform tests.assert((select c.code_hash <> private.sign_in_code_hmac('00000000-0000-4000-8000-0000000000a2', '123456')
                        from private.sign_in_codes c where user_id = '00000000-0000-4000-8000-0000000000a1'), 'the hash is bound to the account');
  update private.sign_in_codes set created_at = now() - interval '20 minutes', expires_at = now() - interval '10 minutes';
end $$;
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(null);
do $$
declare
  r record;
begin
  select * into r from private.verify_sign_in_code('ua@a.test', '123456');
  perform tests.assert(r.outcome = 'none' and r.token_hash_sealed is null, 'an expired code is refused, even the right one');
end $$;
set local session authorization default;
do $$
begin
  perform tests.assert_eq((select count(*) from private.sign_in_codes), 0::bigint, 'and removed');
end $$;
rollback;
