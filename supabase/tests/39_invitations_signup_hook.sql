-- db-test: run-as=owner
-- Sign-up gate (T-M2-07, FR-IAM-03, security review H1): Supabase Auth's "before user created" hook,
-- executed as supabase_auth_admin (the role Auth uses) with events shaped like GoTrue v2.197.0's. The
-- hook API is FAIL-OPEN ('{}', NULL or an error without a message admit the user), so every refusal is
-- asserted to be EXACTLY the deny object, and the one admitted case exactly '{}'.
-- Fixtures: 00_helpers_and_fixtures.sql (tenant A: Organization Admin uA, HR Manager uAB; tenant C
-- suspended). This file builds its own invitations through the normal lifecycle (platform operations:
-- invite, mail a token, then expire / revoke / accept), with tokens in the real format (43 base64url
-- characters). Everything is rolled back.
\set ON_ERROR_STOP on
begin;

-- tok(<name>): a well-formed token (43 characters of [A-Za-z0-9_-]) per name.
create function pg_temp.tok(p_name text) returns text language sql immutable as $$
  select rpad('Hook' || p_name, 43, '_')
$$;
-- event(<e-mail>, <metadata>, <user overrides>): GoTrue's payload for an e-mail sign-up.
create function pg_temp.event(p_email text, p_metadata jsonb, p_user jsonb default '{}'::jsonb) returns jsonb
language sql as $$
  select jsonb_build_object(
    'metadata', jsonb_build_object('uuid', gen_random_uuid(), 'time', now(), 'name', 'before-user-created',
                                   'ip_address', '127.0.0.1'),
    'user', jsonb_build_object(
      'id', gen_random_uuid(), 'aud', '', 'role', '', 'email', p_email, 'phone', '',
      'app_metadata', jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      'user_metadata', p_metadata, 'identities', '[]'::jsonb, 'created_at', now(), 'updated_at', now(),
      'is_anonymous', false) || p_user)
$$;
create function pg_temp.signup(p_email text, p_token text) returns jsonb language sql as $$
  select private.before_user_created_hook(pg_temp.event(p_email, jsonb_build_object('invitation', p_token)))
$$;
create function pg_temp.deny() returns jsonb language sql immutable as $$
  select '{"error": {"http_code": 403, "message": "Sign-up is by invitation only."}}'::jsonb
$$;

-- Invitations of tenant A (inviter uA unless noted; learner unless noted), each mailed once.
insert into platform.persons (id, tenant_id, display_name_ar, email) values
  ('a1000000-0000-4000-8000-00000000c001', 'a0000000-0000-4000-8000-000000000001', 'صالح', 'hook-valid@a.test'),
  ('a1000000-0000-4000-8000-00000000c002', 'a0000000-0000-4000-8000-000000000001', 'منتهي', 'hook-expired@a.test'),
  ('a1000000-0000-4000-8000-00000000c003', 'a0000000-0000-4000-8000-000000000001', 'ملغى', 'hook-revoked@a.test'),
  ('a1000000-0000-4000-8000-00000000c004', 'a0000000-0000-4000-8000-000000000001', 'مستخدم', 'hook-used@a.test'),
  ('a1000000-0000-4000-8000-00000000c005', 'a0000000-0000-4000-8000-000000000001', 'مدقق', 'hook-priv@a.test'),
  ('a1000000-0000-4000-8000-00000000c006', 'a0000000-0000-4000-8000-000000000001', 'تغير', 'hook-changed@a.test'),
  ('a1000000-0000-4000-8000-00000000c007', 'a0000000-0000-4000-8000-000000000001', 'معطل', 'hook-inactive@a.test'),
  ('c1000000-0000-4000-8000-00000000c008', 'c0000000-0000-4000-8000-000000000001', 'معلق', 'hook-suspended@c.test');
insert into platform.invitations (id, tenant_id, person_id, email, locale, primary_role, invited_by) values
  ('a4000000-0000-4000-8000-00000000c001', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000c001', 'hook-valid@a.test', 'ar', 'learner', '00000000-0000-4000-8000-0000000000a1'),
  ('a4000000-0000-4000-8000-00000000c002', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000c002', 'hook-expired@a.test', 'ar', 'learner', '00000000-0000-4000-8000-0000000000a1'),
  ('a4000000-0000-4000-8000-00000000c003', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000c003', 'hook-revoked@a.test', 'ar', 'learner', '00000000-0000-4000-8000-0000000000a1'),
  ('a4000000-0000-4000-8000-00000000c004', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000c004', 'hook-used@a.test', 'ar', 'learner', '00000000-0000-4000-8000-0000000000a1'),
  -- Privileged role, invited by uAB, who is only an HR Manager: the inviter may not give it (review M1).
  ('a4000000-0000-4000-8000-00000000c005', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000c005', 'hook-priv@a.test', 'ar', 'auditor', '00000000-0000-4000-8000-0000000000ab'),
  ('a4000000-0000-4000-8000-00000000c006', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000c006', 'hook-changed@a.test', 'ar', 'learner', '00000000-0000-4000-8000-0000000000a1'),
  ('a4000000-0000-4000-8000-00000000c007', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000c007', 'hook-inactive@a.test', 'ar', 'learner', '00000000-0000-4000-8000-0000000000a1'),
  ('c4000000-0000-4000-8000-00000000c008', 'c0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-00000000c008', 'hook-suspended@c.test', 'ar', 'learner', '00000000-0000-4000-8000-0000000000c1');
update platform.invitations set token_hash = tests.token_hash(pg_temp.tok(right(id::text, 4)))
 where id::text like '%0000c00_';
-- After the e-mail: one ran out, one was revoked, one was accepted, one person changed e-mail, one was
-- deactivated.
update platform.invitations set expires_at = now() - interval '1 minute' where id = 'a4000000-0000-4000-8000-00000000c002';
update platform.invitations set status = 'revoked' where id = 'a4000000-0000-4000-8000-00000000c003';
update platform.invitations set status = 'accepted', accepted_user_id = gen_random_uuid() where id = 'a4000000-0000-4000-8000-00000000c004';
update platform.persons set email = 'hook-changed2@a.test' where id = 'a1000000-0000-4000-8000-00000000c006';
update platform.persons set status = 'inactive' where id = 'a1000000-0000-4000-8000-00000000c007';

do $$
begin
  perform tests.assert_eq((select string_agg(right(id::text, 4) || ':' || status || ':' || send_count, ',' order by id)
                           from platform.invitations where id::text like '%0000c00_'),
    'c001:pending:1,c002:pending:1,c003:revoked:1,c004:accepted:1,c005:pending:1,c006:pending:1,c007:pending:1,c008:pending:1',
    'fixtures: every invitation was mailed once');
  perform tests.assert_eq((select status from platform.tenants where id = 'c0000000-0000-4000-8000-000000000001'), 'suspended',
    'fixtures: tenant C is suspended');
end $$;

set local role supabase_auth_admin;
do $$
declare
  v_valid constant text := pg_temp.tok('c001');
begin
  -- The one admitted shape: e-mail sign-up, the raw token of a valid invitation, that invitation's e-mail.
  perform tests.assert_eq(pg_temp.signup('hook-valid@a.test', v_valid), '{}'::jsonb, 'valid invitation, same e-mail: admitted');
  -- The e-mail is compared exactly as Auth sends it (Auth lower-cases it; the account gets that very
  -- address): never trimmed or lower-cased by the hook (re-review N5).
  perform tests.assert_eq(pg_temp.signup(' hook-valid@a.test ', v_valid), pg_temp.deny(), 'e-mail with spaces: refused');
  perform tests.assert_eq(pg_temp.signup('Hook-Valid@A.test', v_valid), pg_temp.deny(), 'e-mail in another case: refused');
  perform tests.assert_eq(pg_temp.signup('hook-valid@a.test' || E'\n', v_valid), pg_temp.deny(), 'e-mail with a newline: refused');
  perform tests.assert_eq(
    private.before_user_created_hook(pg_temp.event('hook-valid@a.test', jsonb_build_object('invitation', v_valid),
      '{"email": 42}')),
    pg_temp.deny(), 'e-mail not a string: refused');
  perform tests.assert_eq(
    private.before_user_created_hook(pg_temp.event('hook-valid@a.test',
      jsonb_build_object('invitation', v_valid, 'locale', 'ar'))),
    '{}'::jsonb, 'other metadata next to the token does not matter');

  -- The token is valid, the e-mail is not the invitation's.
  perform tests.assert_eq(pg_temp.signup('attacker@example.test', v_valid), pg_temp.deny(), 'valid token, other e-mail: refused');
  perform tests.assert_eq(pg_temp.signup('hook-expired@a.test', v_valid), pg_temp.deny(), 'valid token, another invitee''s e-mail: refused');
  perform tests.assert_eq(pg_temp.signup('', v_valid), pg_temp.deny(), 'empty e-mail: refused');
  perform tests.assert_eq(
    private.before_user_created_hook(pg_temp.event(null, jsonb_build_object('invitation', v_valid))),
    pg_temp.deny(), 'no e-mail: refused');

  -- The invitation is no longer valid (same rules as the link page, private.invitation_link).
  perform tests.assert_eq(pg_temp.signup('hook-expired@a.test', pg_temp.tok('c002')), pg_temp.deny(), 'expired: refused');
  perform tests.assert_eq(pg_temp.signup('hook-revoked@a.test', pg_temp.tok('c003')), pg_temp.deny(), 'revoked: refused');
  perform tests.assert_eq(pg_temp.signup('hook-used@a.test', pg_temp.tok('c004')), pg_temp.deny(), 'already used: refused');
  perform tests.assert_eq(pg_temp.signup('hook-priv@a.test', pg_temp.tok('c005')), pg_temp.deny(),
    'inviter may no longer give the role (HR Manager, privileged role): refused');
  perform tests.assert_eq(pg_temp.signup('hook-changed@a.test', pg_temp.tok('c006')), pg_temp.deny(),
    'the person''s e-mail changed (old e-mail): refused');
  perform tests.assert_eq(pg_temp.signup('hook-changed2@a.test', pg_temp.tok('c006')), pg_temp.deny(),
    'the person''s e-mail changed (new e-mail): refused');
  perform tests.assert_eq(pg_temp.signup('hook-inactive@a.test', pg_temp.tok('c007')), pg_temp.deny(), 'person deactivated: refused');
  perform tests.assert_eq(pg_temp.signup('hook-suspended@c.test', pg_temp.tok('c008')), pg_temp.deny(), 'organization suspended: refused');
  perform tests.assert_eq(pg_temp.signup('hook-valid@a.test', pg_temp.tok('unknown')), pg_temp.deny(), 'unknown token: refused');

  -- Malformed tokens never reach the lookup: only the raw 43-character base64url form is accepted.
  perform tests.assert_eq(pg_temp.signup('hook-valid@a.test', left(v_valid, 42)), pg_temp.deny(), '42 characters: refused');
  perform tests.assert_eq(pg_temp.signup('hook-valid@a.test', v_valid || 'A'), pg_temp.deny(), '44 characters: refused');
  perform tests.assert_eq(pg_temp.signup('hook-valid@a.test', left(v_valid, 42) || '='), pg_temp.deny(), 'padding: refused');
  perform tests.assert_eq(pg_temp.signup('hook-valid@a.test', left(v_valid, 42) || '+'), pg_temp.deny(), 'base64 (not url) alphabet: refused');
  perform tests.assert_eq(pg_temp.signup('hook-valid@a.test', v_valid || E'\n'), pg_temp.deny(), 'trailing newline: refused');
  perform tests.assert_eq(pg_temp.signup('hook-valid@a.test', encode(tests.token_hash(v_valid), 'hex')), pg_temp.deny(),
    'the stored hash (hex) is not a token: refused');
  perform tests.assert_eq(pg_temp.signup('hook-valid@a.test', ''), pg_temp.deny(), 'empty token: refused');
  perform tests.assert_eq(
    private.before_user_created_hook(pg_temp.event('hook-valid@a.test', jsonb_build_object('invitation', to_jsonb(42)))),
    pg_temp.deny(), 'a number instead of a token: refused');
  perform tests.assert_eq(
    private.before_user_created_hook(pg_temp.event('hook-valid@a.test', jsonb_build_object('invitation', jsonb_build_array(v_valid)))),
    pg_temp.deny(), 'an array holding the token: refused');

  -- Missing metadata or token.
  perform tests.assert_eq(private.before_user_created_hook(pg_temp.event('hook-valid@a.test', '{}'::jsonb)),
    pg_temp.deny(), 'no invitation in the metadata (plain public sign-up): refused');
  perform tests.assert_eq(private.before_user_created_hook(pg_temp.event('hook-valid@a.test', null)),
    pg_temp.deny(), 'no metadata at all: refused');
  perform tests.assert_eq(private.before_user_created_hook(pg_temp.event('hook-valid@a.test', '"x"'::jsonb)),
    pg_temp.deny(), 'metadata that is not an object: refused');

  -- Only e-mail sign-ups: phone, anonymous, OAuth / SSO, a missing or unexpected provider.
  perform tests.assert_eq(
    private.before_user_created_hook(pg_temp.event('hook-valid@a.test', jsonb_build_object('invitation', v_valid),
      '{"phone": "966500000000"}')),
    pg_temp.deny(), 'a phone number: refused');
  perform tests.assert_eq(
    private.before_user_created_hook(pg_temp.event('', jsonb_build_object('invitation', v_valid),
      '{"phone": "966500000000", "app_metadata": {"provider": "phone", "providers": ["phone"]}}')),
    pg_temp.deny(), 'phone sign-up: refused');
  perform tests.assert_eq(
    private.before_user_created_hook(pg_temp.event('', '{}'::jsonb, '{"is_anonymous": true, "app_metadata": {}}')),
    pg_temp.deny(), 'anonymous sign-in: refused');
  perform tests.assert_eq(
    private.before_user_created_hook(pg_temp.event('hook-valid@a.test', jsonb_build_object('invitation', v_valid),
      '{"is_anonymous": true}')),
    pg_temp.deny(), 'anonymous flag with a valid token: refused');
  perform tests.assert_eq(
    private.before_user_created_hook(pg_temp.event('hook-valid@a.test', jsonb_build_object('invitation', v_valid),
      '{"is_anonymous": "false"}')),
    pg_temp.deny(), 'is_anonymous not the boolean false: refused');
  perform tests.assert_eq(
    private.before_user_created_hook(pg_temp.event('hook-valid@a.test', jsonb_build_object('invitation', v_valid)) #- '{user,is_anonymous}'),
    pg_temp.deny(), 'is_anonymous missing: refused');
  perform tests.assert_eq(
    private.before_user_created_hook(pg_temp.event('hook-valid@a.test', jsonb_build_object('invitation', v_valid),
      '{"app_metadata": {"provider": "google", "providers": ["google"]}}')),
    pg_temp.deny(), 'OAuth provider: refused');
  perform tests.assert_eq(
    private.before_user_created_hook(pg_temp.event('hook-valid@a.test', jsonb_build_object('invitation', v_valid),
      '{"app_metadata": {"provider": "sso:6f7c", "providers": ["sso:6f7c"]}}')),
    pg_temp.deny(), 'SAML SSO provider: refused');
  perform tests.assert_eq(
    private.before_user_created_hook(pg_temp.event('hook-valid@a.test', jsonb_build_object('invitation', v_valid),
      '{"app_metadata": {}}')),
    pg_temp.deny(), 'no provider: refused');
  -- No app_metadata shortcut of any kind (admin-created users never reach the hook).
  perform tests.assert_eq(
    private.before_user_created_hook(pg_temp.event('attacker@example.test', '{}'::jsonb,
      '{"app_metadata": {"provider": "email", "providers": ["email"], "jadarat_provisioned": "true"}}')),
    pg_temp.deny(), 'no allow-list flag in app_metadata: refused');

  -- Malformed events.
  perform tests.assert_eq(private.before_user_created_hook(null), pg_temp.deny(), 'NULL event: refused');
  perform tests.assert_eq(private.before_user_created_hook('{}'::jsonb), pg_temp.deny(), 'empty event: refused');
  perform tests.assert_eq(private.before_user_created_hook('{"user": null}'::jsonb), pg_temp.deny(), 'user null: refused');
  perform tests.assert_eq(private.before_user_created_hook('{"user": "hook-valid@a.test"}'::jsonb), pg_temp.deny(), 'user not an object: refused');
  perform tests.assert_eq(private.before_user_created_hook('[]'::jsonb), pg_temp.deny(), 'event not an object: refused');

  -- The yes/no check alone (Auth may call it; it never says more than yes or no).
  perform tests.assert(private.invitation_allows_signup('hook-valid@a.test', v_valid), 'check: valid');
  perform tests.assert(not private.invitation_allows_signup('attacker@example.test', v_valid), 'check: other e-mail');
  perform tests.assert(not private.invitation_allows_signup(null, v_valid), 'check: no e-mail');
  perform tests.assert(not private.invitation_allows_signup('HOOK-VALID@A.TEST', v_valid), 'check: e-mail compared exactly');
  perform tests.assert(not private.invitation_allows_signup('hook-valid@a.test', null), 'check: no token');
  perform tests.assert(not private.invitation_allows_signup('hook-valid@a.test', 'x'), 'check: malformed token');

  -- Auth reads nothing else of ours.
  perform tests.assert_privilege_denied($q$select email from platform.invitations$q$, 'Auth cannot read invitations');
  perform tests.assert_privilege_denied($q$select * from private.invitation_link(tests.token_hash('x'))$q$,
    'Auth cannot read link details');
  perform tests.assert_privilege_denied($q$select * from private.invitation_by_token(tests.token_hash('x'))$q$,
    'Auth cannot call the page''s lookup');
end $$;
reset role;

-- Every error inside the hook is refused (never admitted, never raised): here the check is unreachable.
revoke execute on function private.invitation_allows_signup(text, text) from supabase_auth_admin;
set local role supabase_auth_admin;
set local client_min_messages = error; -- the hook logs a warning with the SQLSTATE
do $$
begin
  perform tests.assert_eq(pg_temp.signup('hook-valid@a.test', pg_temp.tok('c001')), pg_temp.deny(),
    'an error inside the hook (permission denied): refused, not raised');
end $$;
reset role;

-- No side effects: the invitations are as before (Auth commits the hook's transaction even on refusal).
do $$
begin
  perform tests.assert_eq((select string_agg(right(id::text, 4) || ':' || status || ':' || send_count, ',' order by id)
                           from platform.invitations where id::text like '%0000c00_'),
    'c001:pending:1,c002:pending:1,c003:revoked:1,c004:accepted:1,c005:pending:1,c006:pending:1,c007:pending:1,c008:pending:1',
    'the hook changed nothing');
end $$;

rollback;
\echo '39_invitations_signup_hook: ok'
