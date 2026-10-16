-- db-test: run-as=app_server
-- Platform Super Admin console (FR-ADM-17, migration 20261018100000), CONNECTED AS app_server: deny by
-- default — nobody but a Super Admin with a valid session gets anything (no claims, an Organization Admin
-- of another organization, an account without organizations, a Super Admin's expired session, a session of
-- another account under the Super Admin's id, system claims); the Super Admin lists and creates; the input
-- is validated in the database (short name, names, e-mail, language; reserved and taken short names); a new
-- code replaces the old one. Fixtures: 00_helpers_and_fixtures.sql, 95_platform_admin_owner.sql (uP …f1 with
-- the valid session …fa01 and the expired one …fa09). Each block is rolled back.
\set ON_ERROR_STOP on

do $$ begin perform tests.assert(session_user = 'app_server', 'must run connected as app_server'); end $$;

-- ---------------------------------------------------------------------------------------------------
-- Everyone else is refused
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
do $$
declare
  c record;
begin
  for c in
    select * from (values
      ('no claims', null::jsonb),
      ('Organization Admin of A', tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
        'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1')),
      ('an account without organizations',
        tests.user_claims('00000000-0000-4000-8000-0000000000e1', '10000000-0000-4000-8000-0000000000e1', null)),
      ('the Super Admin with an expired session',
        tests.user_claims('00000000-0000-4000-8000-0000000000f1', '10000000-0000-4000-8000-00000000fa09', null)),
      ('the Super Admin''s id with another account''s session',
        tests.user_claims('00000000-0000-4000-8000-0000000000f1', '10000000-0000-4000-8000-0000000000e1', null)),
      ('the Super Admin''s id without a session', tests.user_claims('00000000-0000-4000-8000-0000000000f1', null, null)),
      ('system claims', jsonb_build_object('sub', '00000000-0000-4000-8000-0000000000f1', 'role', 'system',
        'session_id', '10000000-0000-4000-8000-00000000fa01', 'tenant_id', 'a0000000-0000-4000-8000-000000000001',
        'job_id', 'tests.job')),
      ('another role claim', jsonb_build_object('sub', '00000000-0000-4000-8000-0000000000f1', 'role', 'service_role',
        'session_id', '10000000-0000-4000-8000-00000000fa01'))
    ) as v (who, claims)
  loop
    perform tests.set_claims(c.claims);
    perform tests.assert_eq(private.is_platform_admin(), false, c.who || ': not a Super Admin');
    perform tests.assert_fails($q$select * from private.platform_list_tenants()$q$, array['42501'], c.who || ': no list');
    perform tests.assert_fails(
      $q$select * from private.platform_create_tenant('denied-org', 'منشأة', null, 'a@denied.test')$q$,
      array['42501'], c.who || ': cannot create an organization');
    perform tests.assert_fails(
      $q$select * from private.platform_admin_invitation_code('a0000000-0000-4000-8000-000000000001')$q$,
      array['42501'], c.who || ': cannot read a code');
    perform tests.assert_fails(
      $q$select * from private.platform_reissue_admin_code('a0000000-0000-4000-8000-000000000001')$q$,
      array['42501'], c.who || ': cannot issue a code');
    perform tests.assert_privilege_denied($q$select * from private.platform_admins$q$, c.who || ': no Super Admin table');
    perform tests.assert_privilege_denied($q$select * from private.platform_audit_events$q$, c.who || ': no platform audit');
    perform tests.assert_privilege_denied($q$select private.grant_platform_admin('00000000-0000-4000-8000-0000000000a1')$q$,
      c.who || ': cannot grant');
    perform tests.assert_privilege_denied(
      $q$select private.platform_admin_is_active('00000000-0000-4000-8000-0000000000f1')$q$,
      c.who || ': cannot ask who is a Super Admin');
    perform tests.assert_privilege_denied($q$select private.write_invitation_code('a4000000-0000-4000-8000-000000000001')$q$,
      c.who || ': cannot write invitation codes');
  end loop;
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- The Super Admin: list, create (validated), copy, new code
-- ---------------------------------------------------------------------------------------------------
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000f1', '10000000-0000-4000-8000-00000000fa01', null));
do $$
declare
  v_create text := $q$select * from private.platform_create_tenant(%L, %L, %L, %L, null, null, null, null, %L)$q$;
  v_tenant uuid;
  v_first text;
  v_second text;
  v_read text;
  r record;
  v_bad text;
begin
  perform tests.assert_eq(private.is_platform_admin(), true, 'the Super Admin');
  perform tests.assert_eq((select string_agg(slug || ':' || status || ':' || admin_state, ',' order by slug)
                           from private.platform_list_tenants() where slug like 'tenant-_'),
    'tenant-a:active:active,tenant-b:active:active,tenant-c:suspended:none,tenant-d:trial:none',
    'every organization with its Organization Admin state');
  perform tests.assert((select bool_and(member_count >= 1) from private.platform_list_tenants() where slug like 'tenant-_'),
    'with their active members counted');
  -- Still nothing of a tenant table directly: only through the console's functions.
  perform tests.assert_eq((select count(*) from platform.tenants), 0::bigint, 'no tenant rows without a tenant claim');
  perform tests.assert_eq((select count(*) from platform.invitations), 0::bigint, 'no invitation rows');

  -- Short names: 3–40 of a-z, 0-9 and hyphens, no hyphen at either end; not reserved; not taken.
  foreach v_bad in array array['ab', 'Entlaqa', '-entlaqa', 'entlaqa-', 'ent laqa', 'entlaqa_x', 'إنطلاقة',
                               repeat('a', 41), '', 'ent.laqa'] loop
    perform tests.assert_fails(format(v_create, v_bad, 'منشأة', null, 'a@valid.test', 'en'), array['JP001'],
      format('short name %L refused', v_bad));
  end loop;
  perform tests.assert_fails(format(v_create, 'admin', 'منشأة', null, 'a@valid.test', 'en'), array['JP002'],
    'a reserved short name');
  perform tests.assert_fails(format(v_create, 'tenant-a', 'منشأة', null, 'a@valid.test', 'en'), array['JP002'],
    'a taken short name (another organization''s)');
  perform tests.assert_fails(format(v_create, 'new-org', '  ', null, 'a@valid.test', 'en'), array['JP001'], 'Arabic name required');
  perform tests.assert_fails(format(v_create, 'new-org', repeat('م', 201), null, 'a@valid.test', 'en'), array['JP001'],
    'Arabic name at most 200');
  perform tests.assert_fails(format(v_create, 'new-org', E'منشأة\n', null, 'a@valid.test', 'en'), array['JP001'],
    'no control characters');
  perform tests.assert_fails(format(v_create, 'new-org', 'منشأة', repeat('x', 201), 'a@valid.test', 'en'), array['JP001'],
    'English name at most 200');
  foreach v_bad in array array['not-an-email', 'a@b', '@valid.test', 'a b@valid.test', ''] loop
    perform tests.assert_fails(format(v_create, 'new-org', 'منشأة', null, v_bad, 'en'), array['JP001'],
      format('e-mail %L refused', v_bad));
  end loop;
  perform tests.assert_fails(format(v_create, 'new-org', 'منشأة', null, 'a@valid.test', 'fr'), array['JP001'], 'language ar|en');
  perform tests.assert_fails(
    $q$select * from private.platform_create_tenant('new-org', 'منشأة', null, 'a@valid.test', repeat('x', 101))$q$,
    array['JP001'], 'names at most 100');

  -- Created: the code works, a new code replaces it; reading a code changes nothing.
  select * into r from private.platform_create_tenant('new-org', 'منشأة جديدة', 'New Org', 'admin@new-org.test',
                                                      null, null, null, null, 'en');
  v_tenant := r.tenant_id;
  v_first := r.invite_code;
  perform tests.assert_eq((select state from private.invitation_by_token(tests.token_hash(v_first))), 'valid', 'the first code');
  perform tests.assert_eq((select invite_code from private.platform_admin_invitation_code(v_tenant)), v_first,
    'copy: the current code');
  v_second := (select invite_code from private.platform_reissue_admin_code(v_tenant));
  perform tests.assert(v_second <> v_first, 'a new code');
  perform tests.assert_eq((select state from private.invitation_by_token(tests.token_hash(v_first))), 'invalid',
    'the old code stops working');
  v_read := (select invite_code from private.platform_admin_invitation_code(v_tenant));
  perform tests.assert_eq(v_read, v_second, 'copy: the new code');
  perform tests.assert_eq((select row(admin_state, admin_invitation_locale)::text from private.platform_list_tenants()
                           where tenant_id = v_tenant), row('pending', 'en')::text, 'listed as pending');
  perform tests.assert_fails(format(v_create, 'new-org', 'منشأة', null, 'b@valid.test', 'en'), array['JP002'],
    'its short name is taken now');
  -- After the 4 codes of an invitation: a new invitation for the same person (the previous one revoked).
  perform private.platform_reissue_admin_code(v_tenant);
  perform private.platform_reissue_admin_code(v_tenant);
  v_first := (select invite_code from private.platform_reissue_admin_code(v_tenant));
  perform tests.assert_eq((select row(state, email)::text from private.invitation_by_token(tests.token_hash(v_first))),
    row('valid', 'admin@new-org.test')::text, 'a 5th code works (a new invitation)');
  -- An organization without a console invitation has nothing to copy or reissue.
  perform tests.assert_fails($q$select * from private.platform_reissue_admin_code('a0000000-0000-4000-8000-000000000001')$q$,
    array['JP003'], 'tenant A: no console invitation');
  perform tests.assert_fails($q$select * from private.platform_admin_invitation_code('a0000000-0000-4000-8000-000000000001')$q$,
    array['JP003'], 'tenant A: nothing to copy');
  perform tests.assert_fails($q$select * from private.platform_reissue_admin_code('a0000000-0000-4000-8000-0000000000ff')$q$,
    array['JP003'], 'an unknown organization');
  -- The claims are back after the console's work (the transaction goes on as the Super Admin).
  perform tests.assert_eq(private.request_user_id(), '00000000-0000-4000-8000-0000000000f1'::uuid, 'claims restored');
end $$;
rollback;

-- An Organization Admin of A cannot reach the console invitation of another organization through the tenant
-- path either (codes and new codes of their own organization's invitations only).
begin;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000f1', '10000000-0000-4000-8000-00000000fa01', null));
select set_config('tests.invitation', invitation_id::text, true)
from private.platform_create_tenant('other-org', 'منشأة أخرى', null, 'admin@other-org.test') x;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
  'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a1'));
do $$
begin
  perform tests.assert_fails(format('select private.issue_invitation_code(%L)', current_setting('tests.invitation')),
    array['JI005'], 'A''s admin: not an invitation of A');
  perform tests.assert_eq((select count(*) from private.invitation_codes(array[current_setting('tests.invitation')::uuid])),
    0::bigint, 'A''s admin reads no code of it');
end $$;
rollback;

\echo '96_platform_admin_app_server: ok'
