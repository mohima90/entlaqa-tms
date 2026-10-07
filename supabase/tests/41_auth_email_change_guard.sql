-- db-test: run-as=owner
-- No e-mail change through Auth (T-M2-07, FR-IAM-03, re-review N1): the trigger
-- jadarat_refuse_email_change on auth.users (migration 20261009090000) refuses a new e-mail and a
-- requested change (email_change: Auth's PUT /user and its confirmation links, the admin API) for every
-- role, Auth's own (supabase_auth_admin) included, unless an operator sets
-- jadarat.allow_auth_email_change = 'on' for the transaction. Everything Auth does on sign-in, token
-- refresh and password change goes through. Everything is rolled back.
\set ON_ERROR_STOP on
begin;

-- Auth's role owns and updates auth.users on hosted Supabase; the test shim's table is the superuser's.
grant select, update on auth.users to supabase_auth_admin;
insert into auth.users (id, email, email_change, encrypted_password, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000e0001', 'guard-member@a.test', '', 'hash-1', now());

do $$
begin
  perform tests.assert(exists (select 1 from pg_trigger where tgrelid = 'auth.users'::regclass
                               and tgname = 'jadarat_refuse_email_change' and tgenabled = 'O'),
    'the e-mail change guard exists and is enabled');
  perform tests.assert((select not prosecdef from pg_proc
                        where oid = 'private.refuse_auth_email_change()'::regprocedure),
    'the guard is SECURITY INVOKER');
end $$;

set local role supabase_auth_admin;
do $$
begin
  -- What Auth does for a member: sign-in, refresh, password change, metadata, a no-op e-mail write.
  update auth.users set last_sign_in_at = now() where id = '00000000-0000-4000-8000-0000000e0001';
  update auth.users set encrypted_password = 'hash-2' where id = '00000000-0000-4000-8000-0000000e0001';
  update auth.users set email = 'guard-member@a.test', email_change = ''
   where id = '00000000-0000-4000-8000-0000000e0001';
  perform tests.assert_eq(
    (select email || '|' || encrypted_password from auth.users where id = '00000000-0000-4000-8000-0000000e0001'),
    'guard-member@a.test|hash-2', 'sign-in, password and unchanged e-mail updates go through');

  -- Self-service change (PUT /user {"email"}): Auth first stores the requested address.
  perform tests.assert_fails_like(
    $q$update auth.users set email_change = 'invitee@a.test' where id = '00000000-0000-4000-8000-0000000e0001'$q$,
    '%managed by the organization%', 'a requested e-mail change is refused');
  -- The confirmation link (or an anonymous account under autoconfirm, or the admin API): the e-mail itself.
  perform tests.assert_fails_like(
    $q$update auth.users set email = 'invitee@a.test', email_change = '' where id = '00000000-0000-4000-8000-0000000e0001'$q$,
    '%managed by the organization%', 'an e-mail change is refused');
  perform tests.assert_fails_like(
    $q$update auth.users set email = null where id = '00000000-0000-4000-8000-0000000e0001'$q$,
    '%managed by the organization%', 'removing the e-mail is refused');
  perform tests.assert_fails_like(
    $q$update auth.users set email = 'GUARD-MEMBER@a.test' where id = '00000000-0000-4000-8000-0000000e0001'$q$,
    '%managed by the organization%', 'a change of case is a change');
  -- The flag must be exactly 'on' for this transaction.
  perform set_config('jadarat.allow_auth_email_change', 'true', true);
  perform tests.assert_fails_like(
    $q$update auth.users set email = 'invitee@a.test' where id = '00000000-0000-4000-8000-0000000e0001'$q$,
    '%managed by the organization%', 'any flag value but on is refused');
  perform set_config('jadarat.allow_auth_email_change', '', true);
  perform tests.assert_eq((select email from auth.users where id = '00000000-0000-4000-8000-0000000e0001'),
    'guard-member@a.test', 'the e-mail is unchanged');
end $$;
reset role;

-- Every role is refused, a superuser too (triggers fire for everyone).
do $$
begin
  perform tests.assert_fails_like(
    $q$update auth.users set email = 'invitee@a.test' where id = '00000000-0000-4000-8000-0000000e0001'$q$,
    '%managed by the organization%', 'refused for the owner / superuser too');
end $$;

-- An operator changes it deliberately, for one transaction.
set local jadarat.allow_auth_email_change = 'on';
update auth.users set email = 'guard-renamed@a.test' where id = '00000000-0000-4000-8000-0000000e0001';
do $$
begin
  perform tests.assert_eq((select email from auth.users where id = '00000000-0000-4000-8000-0000000e0001'),
    'guard-renamed@a.test', 'with the operator flag the e-mail changes');
end $$;

rollback;
\echo '41_auth_email_change_guard: ok'
