-- db-test: run-as=app_server
-- E-mail sending (WP-ADM-01, migration 20261022100100), CONNECTED AS app_server (as withUserTx): deny by
-- default — the settings tables (sealed secrets) are out of reach for every caller; the worker's functions
-- refuse the web app's login whatever the claims; only a Super Admin sees and sets the platform sender; only an
-- Organization Admin changes the organization's provider, for its own organization; cross-organization reads
-- show nothing. Fixtures: 00, 95 (Super Admin …f1, session …fa01), 99_email_1 (the worker's public key).
-- Each block is rolled back.
\set ON_ERROR_STOP on

do $$ begin perform tests.assert(session_user = 'app_server', 'must run connected as app_server'); end $$;

begin;
set local role authenticated;
do $$
declare
  c record;
begin
  for c in
    select * from (values
      ('no claims', null::jsonb),
      ('Organization Admin of A', tests.ua_claims()),
      ('HR Manager of A', tests.uab_claims()),
      ('the Super Admin', tests.user_claims('00000000-0000-4000-8000-0000000000f1', '10000000-0000-4000-8000-00000000fa01', null)),
      ('system claims', tests.system_claims('a0000000-0000-4000-8000-000000000001'))
    ) as v (who, claims)
  loop
    perform tests.set_claims(c.claims);
    perform tests.assert_privilege_denied($q$select * from private.tenant_email_settings$q$, c.who || ': no settings table');
    perform tests.assert_privilege_denied($q$select credentials_sealed from private.platform_email_settings$q$,
      c.who || ': no platform settings table');
    perform tests.assert_privilege_denied($q$select * from private.email_credentials_key$q$, c.who || ': no key table');
    perform tests.assert_privilege_denied($q$select * from private.invitation_mail_skips$q$, c.who || ': no skips table');
    perform tests.assert_privilege_denied(
      $q$update private.tenant_email_settings set enabled = true$q$, c.who || ': cannot switch a provider on directly');
    -- The worker's functions refuse the web app's login role whatever the claims.
    perform tests.assert_fails($q$select * from private.email_route()$q$, array['42501'], c.who || ': no route (secrets)');
    perform tests.assert_fails($q$select * from private.claim_email_tests(5)$q$, array['42501'], c.who || ': no test claim');
    perform tests.assert_fails($q$select private.finish_email_test(null, 1, true, null)$q$, array['42501'],
      c.who || ': cannot verify a sender');
    perform tests.assert_fails($q$select * from private.sweep_email_deliveries(10)$q$, array['42501'], c.who || ': no sweep');
    perform tests.assert_fails($q$select * from private.email_tenants_waiting()$q$, array['42501'], c.who || ': no waiting list');
    perform tests.assert_fails($q$select private.publish_email_credentials_key('k3yId0000009', repeat('C', 43))$q$,
      array['42501'], c.who || ': cannot plant a sealing key');
    perform tests.assert_fails($q$select private.note_invitation_mail_skipped('a4000000-0000-4000-8000-000000000004')$q$,
      array['42501'], c.who || ': cannot mark an invitation unsent');
    perform tests.assert_privilege_denied($q$select private.email_member_tenant(true)$q$, c.who || ': no caller helper');
  end loop;
end $$;
rollback;

-- The platform sender: the Super Admin only.
begin;
set local role authenticated;
do $$
declare
  r record;
begin
  perform tests.set_claims(tests.ua_claims());
  perform tests.assert_fails($q$select * from private.platform_email_settings_view()$q$, array['42501'], 'Organization Admin: no platform sender');
  perform tests.assert_fails($q$select private.platform_save_email_settings('resend', '{}', 'v1.k3yId0000001.' || repeat('x', 80), 'X', 'x@x.example', 'x@x.example', null)$q$,
    array['42501'], 'Organization Admin: cannot set the platform sender');
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000f1', '10000000-0000-4000-8000-00000000fa09', null));
  perform tests.assert_fails($q$select * from private.platform_email_settings_view()$q$, array['42501'], 'expired Super Admin session: nothing');
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000f1', '10000000-0000-4000-8000-00000000fa01', null));
  perform tests.assert_eq(private.platform_save_email_settings('smtp', '{"host": "relay.entlaqa.example", "port": 587, "security": "starttls"}',
                                                               'v1.k3yId0000001.' || repeat('x', 80), 'ENTLAQA',
                                                               'no-reply@jadarat.example', 'ops@entlaqa.example', null),
    1, 'the Super Admin saves the platform sender');
  select * into r from private.platform_email_settings_view();
  perform tests.assert(r.configured and r.provider = 'smtp' and r.options ->> 'host' = 'relay.entlaqa.example'
                       and r.status = 'unverified' and r.test_status = 'queued',
    'shown: provider, options, unverified, test queued');
end $$;
rollback;

-- The organization's provider: its Organization Admin, its organization.
begin;
set local role authenticated;
do $$
declare
  r record;
begin
  perform tests.set_claims(tests.ua_claims());
  select * into r from private.save_tenant_email_settings('resend', '{}', 'v1.k3yId0000001.' || repeat('x', 80),
                                                         'Tenant A', 'mail@a.example', null, null);
  perform tests.assert_eq(r.version, 1, 'A''s Organization Admin saves A''s provider');
  perform tests.assert_eq((select provider from private.tenant_email_settings_view()), 'resend', 'A sees it');
  perform tests.set_claims(tests.uab_claims());
  perform tests.assert_fails($q$select private.request_tenant_email_test('it@a.example')$q$, array['42501'],
    'A''s HR Manager cannot send a test');
  perform tests.assert_fails($q$select private.set_tenant_email_enabled(false, 1)$q$, array['42501'],
    'A''s HR Manager cannot switch it');
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1',
                                             'b0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-0000000000b1'));
  perform tests.assert(not (select configured from private.tenant_email_settings_view()), 'B sees nothing of A''s');
  perform tests.assert_fails_state_like($q$select private.request_tenant_email_test('it@b.example')$q$, 'JE005', '%no e-mail provider%',
    'B cannot test A''s provider');
  -- A member of A and B acting in B never reaches A's settings.
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab',
                                             'b0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-0000000000ab'));
  perform tests.assert_fails($q$select * from private.tenant_email_settings_view()$q$, array['42501'],
    'a session whose organization is A cannot claim B (claim validation)');
end $$;
rollback;
