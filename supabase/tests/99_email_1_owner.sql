-- db-test: run-as=owner
-- E-mail sending set up in the product (WP-ADM-01, migration 20261022100100; FR-NTF-11, FR-ADM-17): the guard
-- role and what it may reach; no application role reaches the settings tables (sealed secrets); the tables'
-- rules; the whole flow as each caller (session authorization app_server / app_worker): the worker publishes
-- its key, the Super Admin saves the platform sender and its test is queued, the worker claims and sends it
-- and the sender becomes verified (audited); an Organization Admin connects the organization's own provider,
-- tests and enables it, a new key switches it off; deny by default for everyone else and across
-- organizations; messages waiting for a sender are listed and swept after 7 days, stale ones after a day,
-- final rows after 12 months; the invitation mailer's skipped e-mails (T-M2-20). Fixtures: 00 and 95 (the
-- Super Admin uP …f1, session …fa01). COMMITTED fixture for 99_email_2/3: the worker's public key. Every other
-- block is rolled back.
\set ON_ERROR_STOP on

-- The worker's public key (committed: the app_server and app_worker files seal with it).
insert into private.email_credentials_key (id, key_id, public_key)
values (1, 'k3yId0000001', repeat('A', 43));

create or replace function pg_temp.sealed(p_key text default 'k3yId0000001') returns text language sql immutable as $$
  select 'v1.' || p_key || '.' || repeat('x', 80);
$$;
create or replace function pg_temp.as_member(p_claims jsonb) returns void language plpgsql as $$
begin
  reset role;
  reset session authorization;
  set local session authorization app_server;
  set local role authenticated;
  perform tests.set_claims(p_claims);
end $$;
create or replace function pg_temp.as_super_admin() returns void language plpgsql as $$
begin
  perform pg_temp.as_member(tests.user_claims('00000000-0000-4000-8000-0000000000f1',
                                              '10000000-0000-4000-8000-00000000fa01', null));
end $$;
create or replace function pg_temp.as_worker(p_tenant uuid default null) returns void language plpgsql as $$
begin
  reset role;
  reset session authorization;
  set local session authorization app_worker;
  set local role authenticated;
  perform tests.set_claims(tests.system_claims(p_tenant, 'tests.email'));
end $$;
create or replace function pg_temp.become_owner() returns void language plpgsql as $$
begin
  reset role;
  reset session authorization;
  perform tests.set_claims(null);
end $$;

-- ---------------------------------------------------------------------------------------------------
-- The guard role and the tables (catalog)
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  v_list text;
  v_role text;
begin
  perform tests.assert(not (select rolbypassrls or rolcanlogin or rolsuper or rolinherit or rolcreaterole or rolcreatedb
                            from pg_roles where rolname = 'email_guard'),
    'email_guard must be NOLOGIN NOINHERIT and not BYPASSRLS / superuser / createrole / createdb');
  perform tests.assert(not exists (select 1 from pg_auth_members m join pg_roles u on u.oid = m.member
                                   where m.roleid = 'email_guard'::regrole and (m.inherit_option or m.set_option)
                                     and not u.rolsuper and u.rolname <> current_user),
    'nobody acts as email_guard');
  perform tests.assert(not has_schema_privilege('email_guard', 'private', 'CREATE')
                       and not has_schema_privilege('email_guard', 'platform', 'CREATE')
                       and not exists (select 1 from pg_class c where c.relowner = 'email_guard'::regrole),
    'email_guard creates and owns no relations');
  select string_agg(format('%s%s', p.oid::regprocedure, case when p.prosecdef then ' (definer)' else '' end), ', '
                    order by p.oid::regprocedure::text collate "C") into v_list
  from pg_proc p where p.proowner = 'email_guard'::regrole;
  perform tests.assert_eq(v_list,
    'private.auth_mail_route(uuid) (definer), '
    'private.claim_email_tests(integer) (definer), private.email_credentials_public_key() (definer), '
    'private.email_route() (definer), private.email_tenants_waiting() (definer), '
    'private.finish_email_test(uuid,integer,boolean,text) (definer), private.invitation_mail_skipped_ids() (definer), '
    'private.note_invitation_mail_skipped(uuid) (definer), private.platform_email_settings_view() (definer), '
    'private.platform_save_email_settings(text,jsonb,text,text,text,text,integer) (definer), '
    'private.publish_email_credentials_key(text,text) (definer), private.request_tenant_email_test(text) (definer), '
    'private.save_tenant_email_settings(text,jsonb,text,text,text,text,integer) (definer), '
    'private.set_tenant_email_enabled(boolean,integer) (definer), private.sweep_email_deliveries(integer) (definer), '
    'private.tenant_email_failures(integer) (definer), private.tenant_email_settings_view() (definer)',
    'email_guard owns the e-mail settings functions only');
  perform tests.assert((select bool_and(exists (select 1 from unnest(p.proconfig) c where c in ('search_path=""', 'search_path=')))
                        from pg_proc p where p.proowner = 'email_guard'::regrole),
    'every e-mail settings function has an empty search_path');
  -- Who may execute what (exact, besides the owner): authenticated (each function checks the login role
  -- and the claims itself).
  select string_agg(distinct case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, ', ')
    into v_list
  from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where p.proowner = 'email_guard'::regrole and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner;
  perform tests.assert_eq(v_list, 'account_mail_guard, authenticated, inline_mail_guard',
    'EXECUTE: authenticated (checked inside) and, for the sender-settings read of the immediate e-mails, account_mail_guard and inline_mail_guard');
  perform tests.assert(not has_function_privilege('authenticated', 'private.auth_mail_route(uuid)', 'execute')
                       and has_function_privilege('account_mail_guard', 'private.auth_mail_route(uuid)', 'execute'),
    'the sender settings of the Send Email hook are reachable only through private.auth_mail_issue (re-review M-B)');
  perform tests.assert(not has_function_privilege('authenticated', 'private.email_member_tenant(boolean)', 'execute')
                       and not has_function_privilege('authenticated', 'private.email_job_tenant(boolean)', 'execute'),
    'the caller checks are the functions'' own');
  -- The settings tables (sealed secrets): RLS forced; no application role reaches them, not even a column.
  foreach v_role in array array['anon', 'authenticated', 'service_role', 'app_server', 'app_worker', 'app_queue',
                                'tenant_guard', 'invitation_guard', 'platform_admin_guard', 'supabase_auth_admin'] loop
    perform tests.assert(
      not has_table_privilege(v_role, 'private.email_credentials_key', 'select, insert, update, delete, truncate, references, trigger')
        and not has_table_privilege(v_role, 'private.platform_email_settings', 'select, insert, update, delete, truncate, references, trigger')
        and not has_table_privilege(v_role, 'private.tenant_email_settings', 'select, insert, update, delete, truncate, references, trigger')
        and not has_table_privilege(v_role, 'private.invitation_mail_skips', 'select, insert, update, delete, truncate, references, trigger')
        and not has_any_column_privilege(v_role, 'private.platform_email_settings', 'select, insert, update, references')
        and not has_any_column_privilege(v_role, 'private.tenant_email_settings', 'select, insert, update, references'),
      format('%s must have no privilege on the e-mail settings tables', v_role));
  end loop;
  perform tests.assert((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class
                        where oid in ('private.email_credentials_key'::regclass, 'private.platform_email_settings'::regclass,
                                      'private.tenant_email_settings'::regclass, 'private.invitation_mail_skips'::regclass)),
    'the e-mail settings tables force row level security');
  -- email_guard: what it reaches outside its tables, nothing more.
  perform tests.assert(not has_column_privilege('email_guard', 'platform.message_deliveries', 'destination', 'select')
                       and not has_column_privilege('email_guard', 'platform.message_deliveries', 'html_body', 'select')
                       and not has_column_privilege('email_guard', 'platform.message_deliveries', 'subject', 'select')
                       and not has_table_privilege('email_guard', 'platform.message_deliveries', 'insert')
                       and not has_column_privilege('email_guard', 'platform.invitations', 'invite_code', 'select')
                       and not has_column_privilege('email_guard', 'platform.invitations', 'token_hash', 'select')
                       and not has_table_privilege('email_guard', 'platform.tenants', 'insert, update, delete')
                       and not has_table_privilege('email_guard', 'platform.audit_events', 'select')
                       and not has_table_privilege('email_guard', 'platform.role_assignments', 'insert, update, delete'),
    'email_guard reads no message content, address or invitation code, changes no organization or role, reads no audit');
end $$;

-- ---------------------------------------------------------------------------------------------------
-- The tables' rules
-- ---------------------------------------------------------------------------------------------------
begin;
do $$
begin
  perform tests.assert_fails($q$insert into private.email_credentials_key (id, key_id, public_key) values (2, 'k3yId0000002', repeat('B', 43))$q$,
    array['23514'], 'one key only');
  perform tests.assert_fails($q$insert into private.platform_email_settings (provider, credentials_sealed, from_name, from_address, updated_by)
      values ('postmark', 'v1.k3yId0000001.' || repeat('x', 80), 'Jadarat', 'no-reply@jadarat.example', gen_random_uuid())$q$,
    array['23514'], 'the five providers only');
  perform tests.assert_fails($q$insert into private.platform_email_settings (provider, credentials_sealed, from_name, from_address, updated_by)
      values ('resend', 're_plaintext_key_here', 'Jadarat', 'no-reply@jadarat.example', gen_random_uuid())$q$,
    array['23514'], 'secrets are stored sealed only (never a plain key)');
  perform tests.assert_fails($q$insert into private.platform_email_settings (provider, credentials_sealed, from_name, from_address, updated_by)
      values ('resend', 'v1.k3yId0000001.' || repeat('x', 80), 'Jadarat', 'not an address', gen_random_uuid())$q$,
    array['23514'], 'the sender address is an e-mail address');
  perform tests.assert_fails($q$insert into private.platform_email_settings (provider, credentials_sealed, from_name, from_address, updated_by)
      values ('resend', 'v1.k3yId0000001.' || repeat('x', 80), E'Jadarat\r\nBcc: x@evil.example', 'no-reply@jadarat.example', gen_random_uuid())$q$,
    array['23514'], 'the sender name is one line (no header injection)');
  perform tests.assert_fails($q$insert into private.platform_email_settings (provider, credentials_sealed, from_name, from_address, updated_by, status)
      values ('resend', 'v1.k3yId0000001.' || repeat('x', 80), 'Jadarat', 'no-reply@jadarat.example', gen_random_uuid(), 'verified')$q$,
    array['23514'], 'verified only with its time');
  perform tests.assert_fails($q$insert into private.tenant_email_settings (tenant_id, provider, credentials_sealed, from_name, from_address, enabled)
      values ('a0000000-0000-4000-8000-000000000001', 'smtp', 'v1.k3yId0000001.' || repeat('x', 80), 'A', 'mail@a.example', true)$q$,
    array['23514'], 'an organization''s provider is enabled only once verified');
  perform tests.assert_fails($q$insert into private.tenant_email_settings (tenant_id, provider, credentials_sealed, from_name, from_address, test_status)
      values ('a0000000-0000-4000-8000-000000000001', 'smtp', 'v1.k3yId0000001.' || repeat('x', 80), 'A', 'mail@a.example', 'queued')$q$,
    array['23514'], 'a waiting test has its recipient');
  perform tests.assert_fails($q$insert into private.tenant_email_settings (tenant_id, provider, credentials_sealed, from_name, from_address, updated_by)
      values ('a0000000-0000-4000-8000-000000000001', 'smtp', 'v1.k3yId0000001.' || repeat('x', 80), 'A', 'mail@a.example', 'b1000000-0000-4000-8000-0000000000b1')$q$,
    array['23503'], 'no person of another organization as the last editor');
  perform tests.assert(private.email_address_is_valid('n.aldossari@alraya.example')
                       and not private.email_address_is_valid('a@b') and not private.email_address_is_valid('a b@c.example')
                       and not private.email_address_is_valid('<a@c.example>') and not private.email_address_is_valid(E'a@c.example\n'),
    'the address syntax of the application');
  perform tests.assert_eq(private.email_address_masked('n.aldossari@alraya.example'), 'n***@alraya.example', 'masked address');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- The platform sender: the Super Admin saves, the worker tests, verified only after the test went out
-- ---------------------------------------------------------------------------------------------------
begin;
do $$
declare
  v_version integer;
  r record;
begin
  -- Nobody but a Super Admin (the console's own rule).
  perform pg_temp.as_member(tests.ua_claims());
  perform tests.assert_fails($q$select * from private.platform_email_settings_view()$q$, array['42501'],
    'an Organization Admin sees no platform sender');
  perform tests.assert_fails(format($q$select private.platform_save_email_settings('resend', '{}', %L, 'Jadarat', 'no-reply@jadarat.example', 'ops@entlaqa.example', null)$q$, pg_temp.sealed()),
    array['42501'], 'an Organization Admin sets no platform sender');

  perform pg_temp.as_super_admin();
  select * into r from private.platform_email_settings_view();
  perform tests.assert(not r.configured and r.status = 'unverified' and r.current_key_id = 'k3yId0000001',
    'not set up yet; the worker''s key is known');
  -- Input refused in the database, field named.
  perform tests.assert_fails_state_like(format($q$select private.platform_save_email_settings('resend', '{}', null, 'Jadarat', 'no-reply@jadarat.example', 'ops@entlaqa.example', null)$q$),
    'JE001', 'credentials', 'a new sender brings its secrets');
  perform tests.assert_fails_state_like(format($q$select private.platform_save_email_settings('resend', '{}', %L, 'Jadarat', 'no-reply@jadarat.example', 'ops@entlaqa.example', null)$q$, pg_temp.sealed('otherKey0001')),
    'JE003', '%another key%', 'secrets sealed with another key are refused');
  perform tests.assert_fails_state_like(format($q$select private.platform_save_email_settings('resend', '{}', %L, 'Jadarat', 'nope', 'ops@entlaqa.example', null)$q$, pg_temp.sealed()),
    'JE001', 'from_address', 'the sender address is checked');
  perform tests.assert_fails_state_like(format($q$select private.platform_save_email_settings('resend', '{}', %L, 'Jadarat', 'no-reply@jadarat.example', 'nope', null)$q$, pg_temp.sealed()),
    'JE001', 'test_to', 'the test recipient is checked');
  perform tests.assert_fails_state_like(format($q$select private.platform_save_email_settings('resend', '{}', %L, 'Jadarat', 'no-reply@jadarat.example', 'ops@entlaqa.example', 3)$q$, pg_temp.sealed()),
    'JE002', '%meanwhile%', 'a stale page is refused');

  v_version := private.platform_save_email_settings('resend', '{}', pg_temp.sealed(), ' ENTLAQA ',
                                                    'no-reply@jadarat.example', 'ops@entlaqa.example', null);
  perform tests.assert_eq(v_version, 1, 'saved: version 1');
  select * into r from private.platform_email_settings_view();
  perform tests.assert(r.configured and r.provider = 'resend' and r.from_name = 'ENTLAQA' and r.status = 'unverified'
                       and r.test_status = 'queued' and r.test_recipient_masked = 'o***@entlaqa.example'
                       and r.credentials_key_id = 'k3yId0000001' and r.platform_failed_24h = 0,
    'saved unverified, its test queued (masked recipient), never the secrets');
  -- One test e-mail a minute (every save sends one).
  perform tests.assert_fails_state_like(format($q$select private.platform_save_email_settings('resend', '{}', %L, 'ENTLAQA', 'no-reply@jadarat.example', 'ops@entlaqa.example', 1)$q$, pg_temp.sealed()),
    'JE006', 'test_too_soon', 'a second test within a minute is refused');

  -- The worker claims and sends the test; the sender becomes verified (audited, no address or secret).
  perform pg_temp.as_worker();
  select * into r from private.claim_email_tests(5);
  perform tests.assert(r.tenant_id is null and r.recipient = 'ops@entlaqa.example' and r.version = 1
                       and r.credentials_sealed = pg_temp.sealed() and r.from_name = 'ENTLAQA',
    'the worker gets the test with the sealed secrets');
  perform tests.assert_eq((select count(*) from private.claim_email_tests(5)), 0::bigint, 'claimed once');
  perform tests.assert(private.finish_email_test(null, 1, true, null), 'the test went out: verified');
  perform pg_temp.become_owner();
  perform tests.assert((select status = 'verified' and test_status = 'sent' and test_recipient is null
                               and test_recipient_masked = 'o***@entlaqa.example'
                        from private.platform_email_settings),
    'verified; the plain recipient is gone');
  perform tests.assert_eq((select string_agg(action, ',' order by occurred_at, action) from private.platform_audit_events
                           where action like 'platform.email.%'),
    'platform.email.sender_changed,platform.email.sender_verified', 'both audited');
  perform tests.assert((select bool_and(data::text not like '%@%' and data::text not like '%v1.%')
                        from private.platform_audit_events where action like 'platform.email.%'),
    'the audit names no address and no secret');

  -- Saving again (same provider, secrets kept) makes it unverified until the new test went out.
  update private.platform_email_settings set test_requested_at = now() - interval '2 minutes';
  perform pg_temp.as_super_admin();
  v_version := private.platform_save_email_settings('resend', '{}', null, 'ENTLAQA', 'alerts@jadarat.example',
                                                    'ops@entlaqa.example', 1);
  perform tests.assert_eq(v_version, 2, 'version 2');
  perform pg_temp.as_worker();
  perform tests.assert_eq((select credentials_sealed from private.claim_email_tests(5)), pg_temp.sealed(),
    'the secrets were kept');
  perform tests.assert(not private.finish_email_test(null, 2, false, 'PROVIDER_AUTH'), 'a failed test verifies nothing');
  perform pg_temp.as_super_admin();
  select * into r from private.platform_email_settings_view();
  perform tests.assert(r.status = 'unverified' and r.test_status = 'failed' and r.test_error_code = 'PROVIDER_AUTH',
    'the failure and its code are shown');
  -- A test of an older version never verifies the current one.
  perform pg_temp.become_owner();
  update private.platform_email_settings set test_requested_at = now() - interval '2 minutes';
  perform pg_temp.as_super_admin();
  v_version := private.platform_save_email_settings('resend', '{}', null, 'ENTLAQA', 'alerts@jadarat.example',
                                                    'ops@entlaqa.example', 2);
  perform pg_temp.as_worker();
  perform private.claim_email_tests(5);
  perform pg_temp.become_owner();
  update private.platform_email_settings set version = version + 1;
  perform pg_temp.as_worker();
  perform tests.assert(not private.finish_email_test(null, 3, true, null), 'the settings changed since: not verified');

  -- An SMTP sender keeps its saved password only for the same server (host, port, encryption).
  perform pg_temp.become_owner();
  update private.platform_email_settings set test_requested_at = now() - interval '2 minutes';
  perform pg_temp.as_super_admin();
  v_version := private.platform_save_email_settings('smtp', '{"host": "relay.entlaqa.example", "port": 587, "security": "starttls"}',
                                                    pg_temp.sealed(), 'ENTLAQA', 'alerts@jadarat.example', 'ops@entlaqa.example', 4);
  perform pg_temp.become_owner();
  update private.platform_email_settings set test_requested_at = now() - interval '2 minutes';
  perform pg_temp.as_super_admin();
  perform tests.assert_fails_state_like(format($q$select private.platform_save_email_settings('smtp', '{"host": "evil.example", "port": 587, "security": "starttls"}', null, 'ENTLAQA', 'alerts@jadarat.example', 'ops@entlaqa.example', %s)$q$, v_version),
    'JE001', 'credentials', 'another SMTP host needs the password again');
  perform tests.assert_fails_state_like(format($q$select private.platform_save_email_settings('smtp', '{"host": "relay.entlaqa.example", "port": 2525, "security": "starttls"}', null, 'ENTLAQA', 'alerts@jadarat.example', 'ops@entlaqa.example', %s)$q$, v_version),
    'JE001', 'credentials', 'another SMTP port needs the password again');
  perform tests.assert_fails_state_like(format($q$select private.platform_save_email_settings('smtp', '{"host": "relay.entlaqa.example", "port": 587, "security": "tls"}', null, 'ENTLAQA', 'alerts@jadarat.example', 'ops@entlaqa.example', %s)$q$, v_version),
    'JE001', 'credentials', 'another encryption needs the password again');
  perform tests.assert_eq(private.platform_save_email_settings('smtp', '{"host": "RELAY.entlaqa.example", "port": 587, "security": "starttls"}',
                                                               null, 'ENTLAQA', 'alerts@jadarat.example', 'ops@entlaqa.example', v_version),
    v_version + 1, 'the same server keeps the password');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Test e-mails that never finish (security review): failed after 3 claims (TIMEOUT); the limit counts the
-- platform's and organizations' tests together; tests left unsent for 7 days fail (TEST_EXPIRED); the Super
-- Admin sees the platform sender's failures of the last 24 hours
-- ---------------------------------------------------------------------------------------------------
begin;
do $$
declare
  i integer;
  r record;
begin
  insert into private.platform_email_settings (provider, credentials_sealed, from_name, from_address, updated_by,
                                               test_status, test_recipient, test_requested_at)
  values ('resend', pg_temp.sealed(), 'ENTLAQA', 'no-reply@jadarat.example', '00000000-0000-4000-8000-0000000000f1',
          'queued', 'ops@entlaqa.example', now());
  for i in 1..3 loop
    perform pg_temp.as_worker();
    perform tests.assert_eq((select count(*) from private.claim_email_tests(5)), 1::bigint, format('claim %s', i));
    perform pg_temp.become_owner();
    -- Its worker never finished it (a server that never answers): claimed again after 5 minutes.
    update private.platform_email_settings set test_claimed_at = now() - interval '6 minutes';
  end loop;
  perform pg_temp.as_worker();
  perform tests.assert_eq((select count(*) from private.claim_email_tests(5)), 0::bigint, 'never claimed a 4th time');
  perform pg_temp.become_owner();
  perform tests.assert((select test_status = 'failed' and test_error_code = 'TIMEOUT' and test_recipient is null
                               and test_attempts = 3 from private.platform_email_settings),
    'failed with TIMEOUT, the plain recipient removed');

  -- The limit counts both kinds together: nothing is left claimed beyond what was asked for.
  update private.platform_email_settings
  set test_status = 'queued', test_recipient = 'ops@entlaqa.example', test_error_code = null, test_finished_at = null,
      test_attempts = 0;
  insert into private.tenant_email_settings (tenant_id, provider, credentials_sealed, from_name, from_address,
                                             test_status, test_recipient, test_requested_at)
  values ('a0000000-0000-4000-8000-000000000001', 'sendgrid', pg_temp.sealed(), 'A', 'mail@a.example',
          'queued', 'it@a.example', now()),
         ('c0000000-0000-4000-8000-000000000001', 'sendgrid', pg_temp.sealed(), 'C', 'mail@c.example',
          'queued', 'it@c.example', now() - interval '8 days');
  perform pg_temp.as_worker();
  select * into r from private.claim_email_tests(1);
  perform tests.assert(r.tenant_id is null, 'one asked for: the platform test');
  perform pg_temp.become_owner();
  perform tests.assert_eq((select test_status from private.tenant_email_settings
                           where tenant_id = 'a0000000-0000-4000-8000-000000000001'), 'queued', 'A''s test still waits');
  perform pg_temp.as_worker();
  select * into r from private.claim_email_tests(1);
  perform tests.assert(r.tenant_id = 'a0000000-0000-4000-8000-000000000001', 'then A''s (C is suspended)');

  -- Unsent for 7 days (C is suspended: never claimed; A's claim backdated) → failed, TEST_EXPIRED.
  perform pg_temp.become_owner();
  update private.tenant_email_settings set test_requested_at = now() - interval '8 days'
  where tenant_id = 'a0000000-0000-4000-8000-000000000001';
  perform pg_temp.as_worker();
  select * into r from private.sweep_email_deliveries(100);
  perform tests.assert_eq(r.tests_expired, 2::bigint, 'A''s and C''s tests expired');
  perform pg_temp.become_owner();
  perform tests.assert((select bool_and(test_status = 'failed' and test_error_code = 'TEST_EXPIRED' and test_recipient is null)
                        from private.tenant_email_settings),
    'expired tests: failed, the plain recipient removed');

  -- The platform sender's failures of the last 24 hours (all organizations), for the Super Admin.
  alter table platform.message_deliveries disable trigger message_deliveries_check;
  insert into platform.message_deliveries (tenant_id, template, template_version, locale, destination_masked, status,
                                           error_code, sender, created_at, updated_at)
  values ('b0000000-0000-4000-8000-000000000001', 'platform.invitation', 1, 'en', 'y***@b.example', 'failed',
          'PROVIDER_REJECTED', 'platform', now(), now()),
         ('b0000000-0000-4000-8000-000000000001', 'platform.invitation', 1, 'en', 'z***@b.example', 'failed',
          'PROVIDER_REJECTED', 'organization', now(), now()),
         ('a0000000-0000-4000-8000-000000000001', 'platform.invitation', 1, 'en', 'q***@a.example', 'failed',
          'PROVIDER_REJECTED', 'platform', now() - interval '2 days', now() - interval '2 days');
  alter table platform.message_deliveries enable trigger message_deliveries_check;
  perform pg_temp.as_super_admin();
  perform tests.assert_eq((select platform_failed_24h from private.platform_email_settings_view()), 1::bigint,
    'one failure of the platform sender in the last 24 hours');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- An organization's own provider: Organization Admins only, its organization only
-- ---------------------------------------------------------------------------------------------------
begin;
do $$
declare
  r record;
  v_version integer;
begin
  -- Deny by default: no claims, the HR Manager of A (no tenant.manage / tenant.read), system claims under
  -- app_server, a Super Admin without an organization.
  perform pg_temp.as_member(null);
  perform tests.assert_fails($q$select * from private.tenant_email_settings_view()$q$, array['42501'], 'no claims: nothing');
  perform pg_temp.as_member(tests.uab_claims());
  perform tests.assert_fails($q$select * from private.tenant_email_settings_view()$q$, array['42501'],
    'the HR Manager sees no Email integration');
  perform tests.assert_fails($q$select * from private.tenant_email_failures(10)$q$, array['42501'],
    'the HR Manager sees no delivery errors');
  perform tests.assert_fails(format($q$select * from private.save_tenant_email_settings('smtp', '{}', %L, 'A', 'mail@a.example', null, null)$q$, pg_temp.sealed()),
    array['42501'], 'the HR Manager changes nothing');
  perform pg_temp.as_member(tests.system_claims('a0000000-0000-4000-8000-000000000001'));
  perform tests.assert_fails($q$select * from private.tenant_email_settings_view()$q$, array['42501'], 'system claims under app_server: nothing');
  perform pg_temp.as_super_admin();
  perform tests.assert_fails($q$select * from private.tenant_email_settings_view()$q$, array['42501'],
    'the Super Admin has no organization here');

  -- The Organization Admin of A.
  perform pg_temp.as_member(tests.ua_claims());
  select * into r from private.tenant_email_settings_view();
  perform tests.assert(not r.configured and not r.enabled and not r.platform_sender_verified and r.waiting_count = 0,
    'nothing configured: the platform sender (not verified yet) is used');
  perform tests.assert_fails_state_like(format($q$select * from private.save_tenant_email_settings('smtp', '{}', null, 'A', 'mail@a.example', null, null)$q$),
    'JE001', 'credentials', 'a new provider brings its secrets');
  perform tests.assert_fails_state_like(format($q$select * from private.save_tenant_email_settings('smtp', '{}', %L, 'A', 'mail@a.example', 'bad', null)$q$, pg_temp.sealed()),
    'JE001', 'reply_to', 'the reply-to address is checked');
  select * into r from private.save_tenant_email_settings('smtp', '{"host": "smtp.a.example", "port": 587}', pg_temp.sealed(),
                                                         'Tenant A', 'mail@a.example', 'hr@a.example', null);
  perform tests.assert(r.version = 1 and r.reverify and 'credentials' = any (r.changed), 'saved: version 1, to be verified');
  perform tests.assert_fails_state_like($q$select private.set_tenant_email_enabled(true, 1)$q$, 'JE004', '%test%',
    'not enabled before a test went out');
  perform tests.assert_eq(private.request_tenant_email_test('it@a.example'), 'smtp', 'test queued');

  -- Tenant B's Organization Admin sees B only (nothing configured) and cannot touch A.
  perform pg_temp.as_member(tests.user_claims('00000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1',
                                              'b0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-0000000000b1'));
  select * into r from private.tenant_email_settings_view();
  perform tests.assert(not r.configured, 'B sees its own (none), never A''s');
  perform tests.assert_fails_state_like($q$select private.set_tenant_email_enabled(false, 1)$q$, 'JE005', '%no e-mail provider%',
    'B has no provider to switch');

  -- The worker sends A's test through A's provider and verifies it (audited in A).
  perform pg_temp.as_worker();
  select * into r from private.claim_email_tests(5);
  perform tests.assert(r.tenant_id = 'a0000000-0000-4000-8000-000000000001' and r.recipient = 'it@a.example'
                       and r.reply_to = 'hr@a.example' and r.options ->> 'host' = 'smtp.a.example',
    'the worker gets A''s test with A''s settings');
  perform tests.assert(private.finish_email_test('a0000000-0000-4000-8000-000000000001', 1, true, null), 'verified');
  perform pg_temp.become_owner();
  perform tests.assert_eq((select count(*) from platform.audit_events
                           where tenant_id = 'a0000000-0000-4000-8000-000000000001'
                             and action = 'platform.email.integration_verified' and actor_user_id is null),
    1::bigint, 'the verification is in A''s audit trail (system actor)');

  perform pg_temp.as_member(tests.ua_claims());
  v_version := private.set_tenant_email_enabled(true, 1);
  perform tests.assert_eq(v_version, 2, 'enabled once verified');
  perform tests.assert_fails_state_like($q$select private.set_tenant_email_enabled(false, 1)$q$, 'JE002', '%meanwhile%',
    'a stale page is refused');
  -- The sender name and reply-to keep the verification; a new address needs a new test and switches it off.
  select * into r from private.save_tenant_email_settings('smtp', '{"host": "smtp.a.example", "port": 587}', null,
                                                         'Tenant A HR', 'mail@a.example', null, 2);
  perform tests.assert(r.version = 3 and not r.reverify and r.changed = array['from_name', 'reply_to'],
    'name and reply-to: still verified');
  select * into r from private.tenant_email_settings_view();
  perform tests.assert(r.enabled and r.status = 'verified', 'still enabled');
  select * into r from private.save_tenant_email_settings('smtp', '{"host": "smtp.a.example", "port": 587}', null,
                                                         'Tenant A HR', 'training@a.example', null, 3);
  perform tests.assert(r.reverify, 'a new address must be verified again');
  select * into r from private.tenant_email_settings_view();
  perform tests.assert(not r.enabled and r.status = 'unverified', 'switched off: the platform sender takes over');
  select * into r from private.save_tenant_email_settings('smtp', '{"host": "smtp.a.example", "port": 587}', null,
                                                         'Tenant A HR', 'training@a.example', null, 4);
  perform tests.assert(r.version = 4 and cardinality(r.changed) = 0, 'nothing changed: no new version');
  -- Another SMTP server needs the password again.
  perform tests.assert_fails_state_like($q$select * from private.save_tenant_email_settings('smtp', '{"host": "smtp.evil.example", "port": 587}', null, 'Tenant A HR', 'training@a.example', null, 4)$q$,
    'JE001', 'credentials', 'another SMTP host needs the password again');
  perform tests.assert_fails_state_like($q$select * from private.save_tenant_email_settings('smtp', '{"host": "smtp.a.example", "port": 465}', null, 'Tenant A HR', 'training@a.example', null, 4)$q$,
    'JE001', 'credentials', 'another SMTP port needs the password again');

  -- Test e-mails: one a minute, 20 a day per organization.
  perform tests.assert_fails_state_like($q$select private.request_tenant_email_test('it@a.example')$q$, 'JE006', 'test_too_soon',
    'a second test within a minute is refused');
  perform pg_temp.become_owner();
  update private.tenant_email_settings
  set test_requested_at = now() - interval '2 minutes', test_window_started_at = now() - interval '1 hour', test_window_count = 20
  where tenant_id = 'a0000000-0000-4000-8000-000000000001';
  perform pg_temp.as_member(tests.ua_claims());
  perform tests.assert_fails_state_like($q$select private.request_tenant_email_test('it@a.example')$q$, 'JE006', 'test_daily_limit',
    'the 21st test of the day is refused');
  perform pg_temp.become_owner();
  update private.tenant_email_settings set test_window_started_at = now() - interval '25 hours'
  where tenant_id = 'a0000000-0000-4000-8000-000000000001';
  perform pg_temp.as_member(tests.ua_claims());
  perform tests.assert_eq(private.request_tenant_email_test('it@a.example'), 'smtp', 'a new day: allowed again');
  perform pg_temp.become_owner();
  perform tests.assert_eq((select test_window_count from private.tenant_email_settings
                           where tenant_id = 'a0000000-0000-4000-8000-000000000001'), 1::smallint, 'a new window');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- The worker: route, waiting messages, the sweeper (T-M2-48), skipped invitation e-mails (T-M2-20)
-- ---------------------------------------------------------------------------------------------------
begin;
do $$
declare
  r record;
  v_id uuid;
  v_inv uuid;
begin
  insert into private.platform_email_settings (provider, credentials_sealed, from_name, from_address, updated_by)
  values ('mailgun', pg_temp.sealed(), 'ENTLAQA', 'no-reply@jadarat.example', '00000000-0000-4000-8000-0000000000f1');
  insert into private.tenant_email_settings (tenant_id, provider, credentials_sealed, from_name, from_address, status, verified_at, enabled)
  values ('b0000000-0000-4000-8000-000000000001', 'sendgrid', 'v1.k3yId0000001.' || repeat('b', 80), 'B', 'mail@b.example',
          'verified', now(), true);

  -- Deny by default.
  perform pg_temp.as_member(tests.ua_claims());
  perform tests.assert_fails($q$select * from private.email_route()$q$, array['42501'], 'a member gets no route (secrets)');
  perform tests.assert_fails($q$select * from private.claim_email_tests(5)$q$, array['42501'], 'a member claims no test');
  perform tests.assert_fails($q$select * from private.sweep_email_deliveries(10)$q$, array['42501'], 'a member sweeps nothing');
  perform tests.assert_fails($q$select private.publish_email_credentials_key('k3yId0000009', repeat('C', 43))$q$, array['42501'],
    'a member publishes no key');
  perform pg_temp.as_worker('a0000000-0000-4000-8000-000000000001');
  perform tests.assert_fails($q$select * from private.claim_email_tests(5)$q$, array['42501'],
    'a tenant job claims no tests (platform task only)');
  perform tests.assert_fails($q$select * from private.tenant_email_settings_view()$q$, array['42501'], 'a job is no member');
  perform tests.assert_fails($q$select * from private.platform_email_settings_view()$q$, array['42501'], 'a job is no Super Admin');

  -- The route of A: no own provider; the platform sender, not verified (messages wait); A's brand name.
  select * into r from private.email_route();
  perform tests.assert(r.tenant_provider is null and not r.tenant_enabled and r.platform_configured
                       and r.platform_provider = 'mailgun' and not r.platform_verified and r.brand_name_en = 'Tenant A'
                       and r.default_locale = 'en',
    'A: the platform sender (unverified), brand «Tenant A»');
  -- The route of B: its own provider, never A's or B's in another job.
  perform pg_temp.as_worker('b0000000-0000-4000-8000-000000000001');
  select * into r from private.email_route();
  perform tests.assert(r.tenant_provider = 'sendgrid' and r.tenant_enabled and r.tenant_from_address = 'mail@b.example',
    'B: its own provider');
  perform pg_temp.as_worker('c0000000-0000-4000-8000-000000000001');
  perform tests.assert_fails($q$select * from private.email_route()$q$, array['42501'], 'a suspended organization gets no route');

  -- Messages waiting for a sender: listed per served organization; the Super Admin sees the count.
  perform pg_temp.as_worker('a0000000-0000-4000-8000-000000000001');
  insert into platform.message_deliveries (template, template_version, locale, destination, destination_masked, subject, html_body, text_body)
  values ('platform.invitation', 1, 'en', 'w@a.example', 'w***@a.example', 's', 'h', 't') returning id into v_id;
  update platform.message_deliveries set status = 'sending', attempts = 1 where id = v_id;
  update platform.message_deliveries set status = 'queued', error_code = 'NO_SENDER' where id = v_id;
  perform pg_temp.as_worker();
  select * into r from private.email_tenants_waiting();
  perform tests.assert(r.tenant_id = 'a0000000-0000-4000-8000-000000000001' and r.waiting = 1, 'A has one waiting message');
  perform pg_temp.as_super_admin();
  perform tests.assert_eq((select waiting_count from private.platform_email_settings_view()), 1::bigint,
    'the Super Admin sees the waiting message (warning)');
  perform pg_temp.as_member(tests.ua_claims());
  perform tests.assert_eq((select waiting_count from private.tenant_email_settings_view()), 1::bigint,
    'A''s Organization Admin sees it too');

  -- The sweeper: waiting for a sender up to 7 days; stale after a day otherwise; final rows after 12 months.
  perform pg_temp.become_owner();
  alter table platform.message_deliveries disable trigger message_deliveries_check;
  update platform.message_deliveries set created_at = now() - interval '3 days', updated_at = now() - interval '3 days' where id = v_id;
  insert into platform.message_deliveries (tenant_id, template, template_version, locale, destination, destination_masked,
                                           subject, html_body, text_body, status, attempts, updated_at, created_at)
  values ('b0000000-0000-4000-8000-000000000001', 'platform.invitation', 1, 'en', 'x@b.example', 'x***@b.example', 's', 'h', 't',
          'sending', 1, now() - interval '2 days', now() - interval '2 days');
  insert into platform.message_deliveries (tenant_id, template, template_version, locale, destination_masked, status,
                                           error_code, created_at, updated_at)
  values ('b0000000-0000-4000-8000-000000000001', 'platform.invitation', 1, 'en', 'y***@b.example', 'failed', 'PROVIDER_AUTH',
          now() - interval '13 months', now() - interval '13 months');
  alter table platform.message_deliveries enable trigger message_deliveries_check;
  perform pg_temp.as_worker();
  select * into r from private.sweep_email_deliveries(100);
  perform tests.assert(r.stale = 1 and r.expired = 0 and r.purged = 1 and r.tests_expired = 0,
    'one stale, none expired (3 days < 7), one purged');
  perform pg_temp.become_owner();
  perform tests.assert((select status = 'failed' and error_code = 'STALE' and destination is null and html_body is null
                        from platform.message_deliveries where destination_masked = 'x***@b.example'),
    'stale: failed, content removed');
  perform tests.assert_eq((select count(*) from platform.message_deliveries where destination_masked = 'y***@b.example'), 0::bigint,
    'older than 12 months: removed');
  alter table platform.message_deliveries disable trigger message_deliveries_check;
  update platform.message_deliveries set created_at = now() - interval '8 days' where id = v_id;
  alter table platform.message_deliveries enable trigger message_deliveries_check;
  perform pg_temp.as_worker();
  select * into r from private.sweep_email_deliveries(100);
  perform tests.assert(r.stale = 0 and r.expired = 1, 'waited for a sender for 8 days: expired');
  perform pg_temp.become_owner();
  perform tests.assert((select status = 'failed' and error_code = 'SENDER_WAIT_EXPIRED' and destination is null
                        from platform.message_deliveries where id = v_id),
    'expired: failed, content removed');

  -- A's delivery errors: A's only, the recipient's domain only.
  perform pg_temp.as_member(tests.ua_claims());
  select * into r from private.tenant_email_failures(10);
  perform tests.assert(r.error_code = 'SENDER_WAIT_EXPIRED' and r.recipient_domain = 'a.example', 'A''s latest error');
  perform tests.assert_eq((select count(*) from private.tenant_email_failures(10) where recipient_domain = 'b.example'), 0::bigint,
    'never B''s errors');

  -- T-M2-20: the mailer skips an invitation's e-mail; the list knows until a new code is sent.
  perform pg_temp.become_owner();
  select i.id into v_inv from platform.invitations i
  where i.tenant_id = 'a0000000-0000-4000-8000-000000000001' and i.status = 'pending' and i.token_issued_at is not null
    and not i.mail_held
  limit 1;
  perform tests.assert(v_inv is not null, 'fixture: a pending invitation with a code in A');
  perform pg_temp.as_worker('a0000000-0000-4000-8000-000000000001');
  perform tests.assert(private.note_invitation_mail_skipped(v_inv), 'skipped e-mail remembered');
  perform tests.assert(not private.note_invitation_mail_skipped(gen_random_uuid()), 'an unknown invitation: nothing');
  perform pg_temp.as_member(tests.ua_claims());
  perform tests.assert(v_inv in (select private.invitation_mail_skipped_ids()), 'A sees it as not sent');
  perform pg_temp.as_member(tests.user_claims('00000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1',
                                              'b0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-0000000000b1'));
  perform tests.assert(not exists (select 1 from private.invitation_mail_skipped_ids()), 'B sees none of A''s');
  perform pg_temp.become_owner();
  -- (A new code moves the invitation's token_issued_at; the lifecycle trigger allows that only with a new
  -- code, so the skip is moved back instead — the same comparison.)
  update private.invitation_mail_skips set token_issued_at = token_issued_at - interval '1 second'
  where invitation_id = v_inv;
  perform pg_temp.as_member(tests.ua_claims());
  perform tests.assert(not (v_inv in (select private.invitation_mail_skipped_ids())), 'a new code: sent again');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- A new worker key: published once; settings sealed with the old key cannot be saved
-- ---------------------------------------------------------------------------------------------------
begin;
do $$
begin
  perform pg_temp.as_worker();
  perform tests.assert(not private.publish_email_credentials_key('k3yId0000001', repeat('A', 43)), 'same key: nothing changes');
  perform tests.assert(private.publish_email_credentials_key('k3yId0000002', repeat('B', 43)), 'a new key is published');
  perform tests.assert_fails_state_like($q$select private.publish_email_credentials_key('bad', 'short')$q$, 'JE001', 'public_key',
    'a malformed key is refused');
  perform pg_temp.as_member(tests.ua_claims());
  perform tests.assert_eq((select key_id from private.email_credentials_public_key()), 'k3yId0000002', 'the web app seals with the new key');
  perform tests.assert_fails_state_like(format($q$select * from private.save_tenant_email_settings('resend', '{}', %L, 'A', 'mail@a.example', null, null)$q$, pg_temp.sealed()),
    'JE003', '%another key%', 'secrets sealed with the old key are refused');
  perform pg_temp.as_member(tests.user_claims('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a9',
                                              'a0000000-0000-4000-8000-000000000001'));
  perform tests.assert_fails($q$select * from private.email_credentials_public_key()$q$, array['42501'], 'an expired session gets no key');
end $$;
rollback;
