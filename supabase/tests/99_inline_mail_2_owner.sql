-- db-test: run-as=owner
-- The test e-mail of the two e-mail settings pages, sent the moment the action commits (WP-ADM-05 follow-up,
-- migration 20261026110100): the Super Admin claims the platform sender's own test, a member with
-- platform.tenant.manage the organization's; the claim shares the worker's lease and keeps only the SHA-256 of
-- the request's secret; the outcome needs that secret, verifies the settings it proved (audited) and removes it;
-- nobody else (another organization, the worker, a member without the permission) can claim or finish.
-- Fixtures: 00 (tenants A/B, uA ...a1 a tenant admin, uB) and 95 (the Super Admin ...f1, session ...fa01).
-- Every block is rolled back.
\set ON_ERROR_STOP on

create function pg_temp.sealed() returns text language sql immutable as $$
  select 'v1.k3yId0000001.' || repeat('x', 80);
$$;

begin;
insert into private.platform_email_settings (provider, credentials_sealed, from_name, from_address, updated_by, test_status,
                                             test_recipient, test_recipient_masked, test_requested_at)
values ('resend', pg_temp.sealed(), 'Jadarat', 'no-reply@jadarat.example', '00000000-0000-4000-8000-0000000000f1', 'queued',
        'it@jadarat.example', 'i***@jadarat.example', now());
insert into private.tenant_email_settings (tenant_id, provider, credentials_sealed, from_name, from_address, test_status,
                                           test_recipient, test_recipient_masked, test_requested_at)
values ('a0000000-0000-4000-8000-000000000001', 'smtp', pg_temp.sealed(), 'Tenant A', 'hr@a.example', 'queued',
        'it@a.example', 'i***@a.example', now());

-- The platform sender: the Super Admin only.
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(tests.ua_claims());
do $$
begin
  perform tests.assert_fails($q$select * from private.inline_email_test_claim('platform', pg_catalog.sha256(decode(repeat('ab', 32), 'hex')))$q$,
    array['42501'], 'a tenant admin cannot claim the platform sender''s test');
  perform tests.assert_fails($q$select * from private.inline_email_test_claim('elsewhere', pg_catalog.sha256(decode(repeat('ab', 32), 'hex')))$q$,
    array['22023'], 'an unknown scope');
  perform tests.assert_fails($q$select * from private.inline_email_test_claim('tenant', decode('00', 'hex'))$q$,
    array['22023'], 'a hash that is not 32 bytes');
end $$;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000f1', '10000000-0000-4000-8000-00000000fa01', null));
do $$
declare
  r record;
begin
  select * into r from private.inline_email_test_claim('platform', pg_catalog.sha256(decode(repeat('ab', 32), 'hex')));
  perform tests.assert(r.recipient = 'it@jadarat.example' and r.provider = 'resend' and r.from_address = 'no-reply@jadarat.example'
                       and r.tenant_id is null and r.credentials_sealed is not null,
    'the Super Admin claims the platform sender''s test with its settings');
  perform tests.assert_eq((select count(*) from private.inline_email_test_claim('platform', pg_catalog.sha256(decode(repeat('cd', 32), 'hex')))), 0::bigint,
    'claimed once: the lease holds');
end $$;
-- The worker honours the same lease.
set local session authorization app_worker;
set local role authenticated;
select tests.set_claims(tests.system_claims(null, 'tests.inline.test'));
do $$
begin
  perform tests.assert_eq((select count(*) from private.claim_email_tests(5) where tenant_id is null), 0::bigint,
    'the worker does not take a test the web app is sending');
  perform tests.assert_fails($q$select * from private.inline_email_test_claim('platform', pg_catalog.sha256(decode(repeat('ab', 32), 'hex')))$q$,
    array['42501'], 'the worker does not use the web app''s claim');
  perform tests.assert_fails($q$select private.inline_email_test_finish(decode(repeat('ab', 32), 'hex'), 1, true, null)$q$,
    array['42501'], 'nor its finish');
end $$;
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(null);
do $$
begin
  perform tests.assert(not private.inline_email_test_finish(decode(repeat('cd', 32), 'hex'), 1, true, null),
    'a wrong secret finishes nothing');
  perform tests.assert_fails($q$select private.inline_email_test_finish(decode(repeat('ab', 32), 'hex'), 1, false, null)$q$,
    array['JE001'], 'a failure needs its code');
  perform tests.assert(private.inline_email_test_finish(decode(repeat('ab', 32), 'hex'), 1, true, null),
    'the right secret: sent, and the settings of that version are verified');
  perform tests.assert(not private.inline_email_test_finish(decode(repeat('ab', 32), 'hex'), 1, true, null),
    'not twice');
end $$;
set local session authorization default;
do $$
begin
  perform tests.assert((select test_status = 'sent' and status = 'verified' and test_recipient is null and test_claim_hash is null
                        from private.platform_email_settings where id = 1),
    'recorded: verified, the recipient and the secret''s hash removed');
  perform tests.assert_eq((select count(*) from private.platform_audit_events where action = 'platform.email.sender_verified'), 1::bigint,
    'the verification is audited');
end $$;
rollback;

-- The organization's provider: a member with platform.tenant.manage, for their own organization only.
begin;
insert into private.tenant_email_settings (tenant_id, provider, credentials_sealed, from_name, from_address, test_status,
                                           test_recipient, test_recipient_masked, test_requested_at)
values ('a0000000-0000-4000-8000-000000000001', 'smtp', pg_temp.sealed(), 'Tenant A', 'hr@a.example', 'queued',
        'it@a.example', 'i***@a.example', now()),
       ('b0000000-0000-4000-8000-000000000001', 'smtp', pg_temp.sealed(), 'Tenant B', 'hr@b.example', 'queued',
        'it@b.example', 'i***@b.example', now());
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(tests.ua_claims());
do $$
declare
  r record;
begin
  select * into r from private.inline_email_test_claim('tenant', pg_catalog.sha256(decode(repeat('ab', 32), 'hex')));
  perform tests.assert(r.tenant_id = 'a0000000-0000-4000-8000-000000000001' and r.recipient = 'it@a.example' and r.provider = 'smtp'
                       and r.from_name = 'Tenant A',
    'the Organization Admin claims their own organization''s test');
  perform tests.assert_eq((select count(*) from private.inline_email_test_claim('tenant', pg_catalog.sha256(decode(repeat('cd', 32), 'hex')))), 0::bigint,
    'once');
end $$;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1', 'b0000000-0000-4000-8000-000000000001'));
do $$
begin
  perform tests.assert_eq((select count(*) from private.inline_email_test_claim('tenant', pg_catalog.sha256(decode(repeat('ef', 32), 'hex')))), 1::bigint,
    'the other organization''s admin claims only their own');
end $$;
select tests.set_claims(null);
do $$
begin
  perform tests.assert_fails($q$select * from private.inline_email_test_claim('tenant', pg_catalog.sha256(decode(repeat('ab', 32), 'hex')))$q$,
    array['42501'], 'no claims: refused');
  -- Another organization's secret finishes only its own test.
  perform tests.assert(private.inline_email_test_finish(decode(repeat('ef', 32), 'hex'), 1, true, null), 'B''s test: verified');
  perform tests.assert(not private.inline_email_test_finish(decode(repeat('ef', 32), 'hex'), 1, true, null), 'not twice');
end $$;
set local session authorization default;
do $$
begin
  perform tests.assert((select test_status = 'sending' and status = 'unverified' from private.tenant_email_settings
                        where tenant_id = 'a0000000-0000-4000-8000-000000000001'), 'A''s test is still its own, untouched by B''s outcome');
  perform tests.assert_eq((select count(*) from platform.audit_events where action = 'platform.email.integration_verified'
                           and tenant_id = 'b0000000-0000-4000-8000-000000000001'), 1::bigint,
    'B''s verification is audited in B''s trail');
end $$;
-- A claim nobody finished is the worker's after the lease.
update private.tenant_email_settings set test_claimed_at = now() - interval '6 minutes'
where tenant_id = 'a0000000-0000-4000-8000-000000000001';
set local session authorization app_worker;
set local role authenticated;
select tests.set_claims(tests.system_claims(null, 'tests.inline.test'));
do $$
begin
  perform tests.assert_eq((select count(*) from private.claim_email_tests(5) where tenant_id = 'a0000000-0000-4000-8000-000000000001'), 1::bigint,
    'the worker takes over a test whose lease ran out');
end $$;
rollback;
