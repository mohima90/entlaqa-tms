-- db-test: run-as=owner
-- Invitation codes (FR-IAM-03, migration 20261018090000), checked as the owner: the code generator, the
-- column's constraints, the lifecycle rules for codes (platform operations), and the sign-up gate with
-- codes — executed as supabase_auth_admin like 39_invitations_signup_hook.sql: exactly '{}' for a valid
-- code with its invitation's e-mail, exactly the refusal otherwise; a rotated code no longer opens it.
-- Everything is rolled back.
\set ON_ERROR_STOP on
begin;

create function pg_temp.event(p_email text, p_code text) returns jsonb language sql as $$
  select jsonb_build_object(
    'metadata', jsonb_build_object('uuid', gen_random_uuid(), 'time', now(), 'name', 'before-user-created',
                                   'ip_address', '127.0.0.1'),
    'user', jsonb_build_object(
      'id', gen_random_uuid(), 'aud', '', 'role', '', 'email', p_email, 'phone', '',
      'app_metadata', jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      'user_metadata', jsonb_build_object('invitation', p_code), 'identities', '[]'::jsonb,
      'created_at', now(), 'updated_at', now(), 'is_anonymous', false))
$$;
create function pg_temp.signup(p_email text, p_code text) returns jsonb language sql as $$
  select private.before_user_created_hook(pg_temp.event(p_email, p_code))
$$;
create function pg_temp.deny() returns jsonb language sql immutable as $$
  select '{"error": {"http_code": 403, "message": "Sign-up is by invitation only."}}'::jsonb
$$;

-- The generator: 8 symbols of the alphabet, all of them used, no repeats in a sample.
do $$
declare
  v_all text := '';
  v_codes text[];
begin
  select array_agg(private.new_invitation_code()) into v_codes from generate_series(1, 2000);
  perform tests.assert((select bool_and(c ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$') from unnest(v_codes) c),
    'every code: 8 characters of ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
  perform tests.assert_eq((select count(distinct c) from unnest(v_codes) c), 2000::bigint, 'no repeats in 2,000 codes');
  select string_agg(c, '') into v_all from unnest(v_codes) c;
  perform tests.assert_eq((select count(distinct ch) from regexp_split_to_table(v_all, '') ch), 32::bigint,
    'all 32 symbols occur (no 0, O, 1 or I)');
  perform tests.assert(not has_function_privilege('anon', 'private.new_invitation_code()', 'execute'),
    'anon cannot draw codes');
end $$;

-- Invitations of tenant A for this file (platform operations: invite; a code; then states).
insert into platform.persons (id, tenant_id, display_name_ar, email) values
  ('a1000000-0000-4000-8000-00000000d101', 'a0000000-0000-4000-8000-000000000001', 'رمز صالح', 'code-valid@a.test'),
  ('a1000000-0000-4000-8000-00000000d102', 'a0000000-0000-4000-8000-000000000001', 'رمز ملغى', 'code-revoked@a.test');
insert into platform.invitations (id, tenant_id, person_id, email, locale, primary_role, invited_by) values
  ('a4000000-0000-4000-8000-00000000d101', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000d101',
   'code-valid@a.test', 'ar', 'learner', '00000000-0000-4000-8000-0000000000a1'),
  ('a4000000-0000-4000-8000-00000000d102', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000d102',
   'code-revoked@a.test', 'ar', 'learner', '00000000-0000-4000-8000-0000000000a1');

do $$
begin
  perform tests.assert_fails($q$insert into platform.invitations (tenant_id, person_id, email, locale, primary_role, invited_by, invite_code) values ('a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000e6', 'notoken@a.test', 'ar', 'learner', '00000000-0000-4000-8000-0000000000a1', 'HKCD2345')$q$,
    array['23514'], 'an invitation starts without a code');
  -- A platform operation sets a code: the trigger derives the token hash and counts it.
  update platform.invitations set invite_code = 'HKCD2345' where id = 'a4000000-0000-4000-8000-00000000d101';
  perform tests.assert((select token_hash = tests.token_hash('HKCD2345') and send_count = 1 and token_issued_at = now()
                               and expires_at = now() + interval '7 days'
                        from platform.invitations where id = 'a4000000-0000-4000-8000-00000000d101'),
    'a code: token hash = SHA-256 of the code (as hashInvitationToken), counted, valid 7 days');
  update platform.invitations set invite_code = 'HKCD2399' where id = 'a4000000-0000-4000-8000-00000000d102';
  update platform.invitations set status = 'revoked' where id = 'a4000000-0000-4000-8000-00000000d102';

  perform tests.assert_check_constraint($q$update platform.invitations set invite_code = 'hkcd2345' where id = 'a4000000-0000-4000-8000-00000000d101'$q$,
    'invitations_invite_code_check', 'lower case is not a code');
  perform tests.assert_check_constraint($q$update platform.invitations set invite_code = 'HKCD234O' where id = 'a4000000-0000-4000-8000-00000000d101'$q$,
    'invitations_invite_code_check', 'O is not in the alphabet');
  perform tests.assert_check_constraint($q$update platform.invitations set invite_code = 'HKCD234' where id = 'a4000000-0000-4000-8000-00000000d101'$q$,
    'invitations_invite_code_check', '7 characters: not a code');
  perform tests.assert_fails($q$update platform.invitations set invite_code = 'HKCD2399' where id = 'a4000000-0000-4000-8000-00000000d101'$q$,
    array['23505'], 'codes are unique (also against final invitations)');
  perform tests.assert_fails($q$update platform.invitations set invite_code = 'HKCD2346', token_hash = tests.token_hash('other') where id = 'a4000000-0000-4000-8000-00000000d101'$q$,
    array['23514'], 'a code brings its own token hash');
  perform tests.assert_fails($q$update platform.invitations set invite_code = null where id = 'a4000000-0000-4000-8000-00000000d101'$q$,
    array['23514'], 'a code cannot be removed');
  perform tests.assert_fails($q$update platform.invitations set invite_code = 'HKCD2398' where id = 'a4000000-0000-4000-8000-00000000d102'$q$,
    array['23514'], 'a revoked invitation keeps its last code');
end $$;

-- The gate, as Auth runs it.
set local role supabase_auth_admin;
do $$
begin
  perform tests.assert_eq(pg_temp.signup('code-valid@a.test', 'HKCD2345'), '{}'::jsonb,
    'a valid code with its invitation''s e-mail: admitted');
  perform tests.assert_eq(pg_temp.signup('attacker@example.test', 'HKCD2345'), pg_temp.deny(),
    'a valid code with another e-mail: refused');
  perform tests.assert_eq(pg_temp.signup('invitee@a.test', 'HKCD2345'), pg_temp.deny(),
    'a valid code with another invitee''s e-mail: refused');
  perform tests.assert_eq(pg_temp.signup('code-valid@a.test', 'hkcd2345'), pg_temp.deny(),
    'lower case: refused (the web app upper-cases)');
  perform tests.assert_eq(pg_temp.signup('code-valid@a.test', 'HKCD234'), pg_temp.deny(), '7 characters: refused');
  perform tests.assert_eq(pg_temp.signup('code-valid@a.test', 'HKCD23455'), pg_temp.deny(), '9 characters: refused');
  perform tests.assert_eq(pg_temp.signup('code-valid@a.test', 'HKCD 2345'), pg_temp.deny(), 'a space: refused');
  perform tests.assert_eq(pg_temp.signup('code-valid@a.test', 'HKCD2345' || E'\n'), pg_temp.deny(), 'a newline: refused');
  perform tests.assert_eq(pg_temp.signup('code-valid@a.test', 'HKCD2340'), pg_temp.deny(), 'unknown code (0 not in the alphabet): refused');
  perform tests.assert_eq(pg_temp.signup('code-valid@a.test', 'HKCD2347'), pg_temp.deny(), 'unknown code: refused');
  perform tests.assert_eq(pg_temp.signup('code-revoked@a.test', 'HKCD2399'), pg_temp.deny(), 'a revoked invitation''s code: refused');
  perform tests.assert_eq(pg_temp.signup('code-valid@a.test', encode(tests.token_hash('HKCD2345'), 'hex')), pg_temp.deny(),
    'the stored hash is not a code: refused');
  perform tests.assert_eq(private.invitation_allows_signup('code-valid@a.test', 'HKCD2345'), true,
    'the yes/no check: yes');
  perform tests.assert_eq(private.invitation_allows_signup('code-valid@a.test', 'HKCD2346'), false,
    'the yes/no check: no');
end $$;
reset role;

-- A new code (resend): the old one stops working at the gate and the link page.
update platform.invitations set invite_code = 'HKCD2346' where id = 'a4000000-0000-4000-8000-00000000d101';
set local role supabase_auth_admin;
do $$
begin
  perform tests.assert_eq(pg_temp.signup('code-valid@a.test', 'HKCD2345'), pg_temp.deny(), 'the replaced code: refused');
  perform tests.assert_eq(pg_temp.signup('code-valid@a.test', 'HKCD2346'), '{}'::jsonb, 'the new code: admitted');
end $$;
reset role;
do $$
begin
  perform tests.assert_eq((select state from private.invitation_link(tests.token_hash('HKCD2345'))), 'invalid',
    'the link page: the replaced code is unknown');
  perform tests.assert_eq((select send_count from platform.invitations where id = 'a4000000-0000-4000-8000-00000000d101'),
    2::smallint, 'two codes counted');
  -- A bare token hash (support, links e-mailed before codes) replaces the code.
  update platform.invitations set token_hash = tests.token_hash('support-token') where id = 'a4000000-0000-4000-8000-00000000d101';
  perform tests.assert((select invite_code is null and send_count = 3 from platform.invitations
                        where id = 'a4000000-0000-4000-8000-00000000d101'), 'a bare token clears the code');
  -- The code committed by 92 for a4…06 is consistent.
  perform tests.assert((select invite_code is not null and token_hash = sha256(convert_to(invite_code, 'UTF8')) and send_count = 1
                        from platform.invitations where id = 'a4000000-0000-4000-8000-000000000006'),
    'the code issued through issue_invitation_code (92) is stored with its hash');
  -- The code functions run as invitation_guard.
  perform tests.assert_eq((select string_agg(distinct pg_get_userbyid(proowner), ',') from pg_proc
                           where proname in ('issue_invitation_code', 'invitation_codes', 'invitation_code_for_mail',
                                             'invitation_code_caller')),
    'invitation_guard', 'owner of the code functions');
end $$;
rollback;

\echo '94_invitation_codes_owner: ok'
