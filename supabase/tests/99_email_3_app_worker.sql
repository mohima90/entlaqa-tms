-- db-test: run-as=app_worker
-- E-mail sending (WP-ADM-01, migration 20261022100100), CONNECTED AS app_worker (as withSystemTx /
-- withPlatformTx): the worker's functions need system claims with a job id (a platform task for the claims
-- across organizations, the job's own served organization for its route); the members' and the Super
-- Admin's functions refuse the worker's login whatever the claims; the settings tables stay out of reach.
-- Fixtures: 00, 99_email_1 (the worker's public key). Each block is rolled back.
\set ON_ERROR_STOP on

do $$ begin perform tests.assert(session_user = 'app_worker', 'must run connected as app_worker'); end $$;

begin;
set local role authenticated;
do $$
declare
  r record;
begin
  -- Without a job id, or with user claims: nothing.
  perform tests.set_claims(jsonb_build_object('role', 'system'));
  perform tests.assert_fails($q$select * from private.claim_email_tests(5)$q$, array['42501'], 'no job id: no claim');
  perform tests.set_claims(tests.ua_claims());
  perform tests.assert_fails($q$select * from private.email_route()$q$, array['42501'], 'user claims under app_worker: no route');
  perform tests.assert_fails($q$select * from private.tenant_email_settings_view()$q$, array['42501'],
    'user claims under app_worker: no member functions');
  perform tests.assert_fails($q$select * from private.email_credentials_public_key()$q$, array['42501'],
    'the sealing key is for the web app''s users');

  -- A platform task: claims across organizations, publishes its key; never a member's or a Super Admin's function.
  perform tests.set_claims(tests.system_claims(null, 'platform.email.tests'));
  perform tests.assert_eq((select count(*) from private.claim_email_tests(5)), 0::bigint, 'nothing to test');
  perform tests.assert(not private.publish_email_credentials_key('k3yId0000001', repeat('A', 43)), 'same key: unchanged');
  perform tests.assert_fails($q$select * from private.email_route()$q$, array['42501'], 'a platform task has no organization to route');
  perform tests.assert_fails($q$select * from private.platform_email_settings_view()$q$, array['42501'], 'a job is no Super Admin');
  perform tests.assert_fails($q$select * from private.save_tenant_email_settings('resend', '{}', null, 'A', 'a@a.example', null, null)$q$,
    array['42501'], 'a job changes no organization''s provider');
  perform tests.assert_privilege_denied($q$select * from private.tenant_email_settings$q$, 'no settings table for jobs either');

  -- A tenant job: its own route only; never the claims across organizations.
  perform tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001', 'notifications.email'));
  select * into r from private.email_route();
  perform tests.assert(r.brand_name_ar = 'المنشأة أ' and not r.platform_configured and r.tenant_provider is null,
    'A''s route: nothing configured (messages wait)');
  perform tests.assert_fails($q$select * from private.sweep_email_deliveries(10)$q$, array['42501'], 'a tenant job does not sweep');
end $$;
rollback;
