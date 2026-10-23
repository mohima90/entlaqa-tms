-- db-test: run-as=owner
-- Account e-mails sent the moment the action commits (WP-ADM-05 follow-up, migration 20261026120000): the
-- requests a transaction created are tagged with the hash of a secret only that web request holds, claimed with
-- it (not with another, not by the worker, not requests of other transactions), resolved by the database (the
-- recipient, organization, person and sender rule are not the web app's to name), queued as a delivery AND
-- removed in one step, with the platform-only variant required for an account of several organizations; the
-- worker's own lease keeps working and leaves tagged requests alone for two minutes; the password-reset e-mail
-- of the Send Email hook is queued only for the account's own address, at most five an hour. Runs as the owner
-- and switches to the login roles. Fixtures: 00 (uA single organization A, uAB in A and B, uE no organization,
-- sessions sA / sAB1). Every block is rolled back.
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------------------------------
-- Ownership and reach (catalog)
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  v_list text;
  v_fn text;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text collate "C") into v_list
  from pg_proc p
  where p.proowner = 'account_mail_guard'::regrole
    and p.proname in ('account_mail_base_template', 'account_mail_claim_core', 'account_mail_consume',
                      'inline_account_mail_tag', 'inline_account_mail_claim', 'inline_account_mail_done',
                      'inline_recovery_facts', 'recovery_target');
  perform tests.assert_eq(v_list,
    'private.account_mail_base_template(text), private.account_mail_claim_core(bytea), '
    'private.account_mail_consume(bytea,uuid,text,bytea,bytea), '
    'private.inline_account_mail_claim(bytea,integer), '
    'private.inline_account_mail_done(bytea,uuid), '
    'private.inline_account_mail_tag(bytea), '
    'private.inline_recovery_facts(uuid), '
    'private.recovery_target(uuid,text,text)',
    'account_mail_guard owns the account e-mail claim functions and the two internal checks');
  perform tests.assert((select count(*) = 2 from pg_proc p where p.proowner = 'inline_mail_guard'::regrole
                        and p.proname in ('inline_account_mail_queue', 'inline_recovery_queue')),
    'inline_mail_guard owns the two functions that insert the delivery');
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text collate "C") into v_list
  from pg_proc p
  where p.proowner = 'tenant_guard'::regrole and p.proname in ('mfa_setup_peek', 'mfa_setup_issue', 'user_has_totp_app');
  perform tests.assert_eq(v_list,
    'private.mfa_setup_issue(uuid,uuid,bytea,bytea), private.mfa_setup_peek(uuid,uuid), private.user_has_totp_app(uuid)',
    'tenant_guard owns the three authenticator helpers');
  perform tests.assert((select bool_and(exists (select 1 from unnest(p.proconfig) c where c in ('search_path=""', 'search_path=')))
                        from pg_proc p where p.proname in ('account_mail_base_template', 'account_mail_claim_core',
                          'inline_account_mail_tag', 'inline_account_mail_claim', 'inline_account_mail_queue',
                          'inline_account_mail_done', 'inline_recovery_facts', 'inline_recovery_queue',
                          'account_mail_consume', 'recovery_target', 'mfa_setup_peek', 'mfa_setup_issue', 'user_has_totp_app')
                          and p.pronamespace = 'private'::regnamespace),
    'every one has an empty search_path');
  -- The web app's six functions: authenticated (each checks the LOGIN role); the helpers: nobody but the guard.
  foreach v_fn in array array[
    'private.inline_account_mail_tag(bytea)', 'private.inline_account_mail_claim(bytea,integer)',
    'private.inline_account_mail_queue(bytea,uuid,text,integer,text,text,text,text,bytea,bytea)',
    'private.inline_account_mail_done(bytea,uuid)', 'private.inline_recovery_facts(uuid)',
    'private.inline_recovery_queue(uuid,text,integer,text,text,text,text,text,text,bytea)'] loop
    perform tests.assert(has_function_privilege('authenticated', v_fn, 'execute')
                         and not has_function_privilege('anon', v_fn, 'execute')
                         and not has_function_privilege('service_role', v_fn, 'execute'),
      format('%s: authenticated only', v_fn));
  end loop;
  foreach v_fn in array array[
    'private.account_mail_claim_core(bytea)', 'private.account_mail_base_template(text)',
    'private.account_mail_consume(bytea,uuid,text,bytea,bytea)', 'private.recovery_target(uuid,text,text)',
    'private.mfa_setup_peek(uuid,uuid)', 'private.mfa_setup_issue(uuid,uuid,bytea,bytea)',
    'private.user_has_totp_app(uuid)'] loop
    perform tests.assert(not has_function_privilege('authenticated', v_fn, 'execute')
                         and not has_function_privilege('anon', v_fn, 'execute')
                         and not has_function_privilege('app_server', v_fn, 'execute')
                         and not has_function_privilege('app_worker', v_fn, 'execute'),
      format('%s: internal, not callable by any application role', v_fn));
  end loop;
  perform tests.assert(has_function_privilege('account_mail_guard', 'private.mfa_setup_issue(uuid,uuid,bytea,bytea)', 'execute')
                       and not has_function_privilege('inline_mail_guard', 'private.mfa_setup_issue(uuid,uuid,bytea,bytea)', 'execute'),
    'only account_mail_guard calls the authenticator helpers');
  perform tests.assert(has_function_privilege('inline_mail_guard', 'private.account_mail_consume(bytea,uuid,text,bytea,bytea)', 'execute')
                       and has_function_privilege('inline_mail_guard', 'private.recovery_target(uuid,text,text)', 'execute')
                       and not has_any_column_privilege('account_mail_guard', 'platform.message_deliveries', 'insert, update'),
    'the delivery is inserted by inline_mail_guard; account_mail_guard still reads four columns of the log and writes none');
end $$;

-- ---------------------------------------------------------------------------------------------------
-- Tag, claim, queue: a single-organization account (uA) and a multi-organization one (uAB)
-- ---------------------------------------------------------------------------------------------------
begin;
-- Requests as the request functions leave them (owner inserts; created in THIS transaction), and one that
-- another transaction created (created_txid forced).
insert into private.account_mail_requests (id, kind, user_id, tenant_id)
values ('f5000000-0000-4000-8000-000000000001', 'password_changed', '00000000-0000-4000-8000-0000000000a1',
        'a0000000-0000-4000-8000-000000000001');
insert into private.account_mail_requests (id, kind, email, lock_minutes)
values ('f5000000-0000-4000-8000-000000000002', 'account_locked', 'ua@a.test', 15);
insert into private.account_mail_requests (id, kind, user_id, tenant_id, mfa_reason)
values ('f5000000-0000-4000-8000-000000000003', 'mfa_factor_removed', '00000000-0000-4000-8000-0000000000ab',
        'a0000000-0000-4000-8000-000000000001', 'removed');
insert into private.account_mail_requests (id, kind, user_id, tenant_id, created_txid)
values ('f5000000-0000-4000-8000-000000000009', 'password_changed', '00000000-0000-4000-8000-0000000000b1',
        'b0000000-0000-4000-8000-000000000001', '1'::xid8);

set local session authorization app_server;
set local role authenticated;
select tests.set_claims(null);
do $$
declare
  v_secret bytea := decode(repeat('ab', 32), 'hex');
  v_other bytea := decode(repeat('cd', 32), 'hex');
  r record;
  v_id uuid;
begin
  select * into r from private.inline_account_mail_claim(v_secret, 1440);
  perform tests.assert_eq(r.outcome, 'none', 'nothing tagged: nothing to claim');
  perform tests.assert_fails($q$select private.inline_account_mail_tag(decode('00', 'hex'))$q$, array['22023'],
    'a hash that is not 32 bytes');
  perform tests.assert_eq(private.inline_account_mail_tag(pg_catalog.sha256(v_secret)), 3,
    'this transaction''s three requests are tagged; the other transaction''s is not');
  perform tests.assert_eq(private.inline_account_mail_tag(pg_catalog.sha256(v_other)), 0,
    'a request is tagged once: the first secret keeps it');
  select * into r from private.inline_account_mail_claim(v_other, 1440);
  perform tests.assert_eq(r.outcome, 'none', 'another secret claims nothing');
  select * into r from private.inline_account_mail_claim(decode('00', 'hex'), 1440);
  perform tests.assert_eq(r.outcome, 'none', 'a short secret claims nothing');

  -- 1. password changed, uA (one organization).
  select * into r from private.inline_account_mail_claim(v_secret, 1440);
  perform tests.assert(r.outcome = 'send' and r.request_id = 'f5000000-0000-4000-8000-000000000001'
                       and r.kind = 'password_changed' and r.email = 'ua@a.test'
                       and r.tenant_id = 'a0000000-0000-4000-8000-000000000001' and r.organization_en = 'Tenant A'
                       and r.platform_sender = false and r.recent_count = 0 and r.quiet_count = 0,
    'the claim resolves the recipient, organization and sender rule (and the counts behind the caps)');
  perform tests.assert_fails(
    $q$select private.inline_account_mail_queue(decode(repeat('ab', 32), 'hex'), 'f5000000-0000-4000-8000-000000000001',
         'platform.password_reset', 1, 'en', 's', '<p>h</p>', 't', null, null)$q$,
    array['42501'], 'only the kind''s own template');
  perform tests.assert_fails(
    $q$select private.inline_account_mail_queue(decode(repeat('ab', 32), 'hex'), 'f5000000-0000-4000-8000-000000000001',
         'platform.password_changed_platform', 1, 'en', 's', '<p>h</p>', 't', null, null)$q$,
    array['42501'], 'not a platform variant the kind does not have');
  perform tests.assert(private.inline_account_mail_queue(v_other, 'f5000000-0000-4000-8000-000000000001',
         'platform.password_changed', 1, 'en', 's', '<p>h</p>', 't', null, null) is null,
    'another secret queues nothing');
  v_id := private.inline_account_mail_queue(v_secret, 'f5000000-0000-4000-8000-000000000001',
            'platform.password_changed', 1, 'en', 'Subject', '<p>h</p>', 'text', null, null);
  perform tests.assert(v_id is not null, 'the claimed request queues its delivery');
  perform set_config('tests.inline_account_delivery', v_id::text, true);
  perform tests.assert(private.inline_account_mail_queue(v_secret, 'f5000000-0000-4000-8000-000000000001',
         'platform.password_changed', 1, 'en', 'Subject', '<p>h</p>', 'text', null, null) is null,
    'the request is gone: a second call queues nothing');

  -- 2. account locked, by the typed address: the same account.
  select * into r from private.inline_account_mail_claim(v_secret, 1440);
  perform tests.assert(r.outcome = 'send' and r.kind = 'account_locked' and r.email = 'ua@a.test'
                       and r.lock_minutes = 15 and r.tenant_id = 'a0000000-0000-4000-8000-000000000001',
    'an account-locked request resolves the account by the typed address');
  perform tests.assert(not private.inline_account_mail_done(v_other, r.request_id), 'another secret removes nothing');
  perform tests.assert(private.inline_account_mail_done(v_secret, r.request_id), 'the claimed request is removed when not sent');

  -- 3. mfa removed, uAB: several organizations -> the platform sender only; the organization of the request.
  select * into r from private.inline_account_mail_claim(v_secret, 1440);
  perform tests.assert(r.outcome = 'send' and r.kind = 'mfa_factor_removed' and r.mfa_reason = 'removed'
                       and r.email = 'uab@ab.test' and r.platform_sender = true
                       and r.tenant_id = 'a0000000-0000-4000-8000-000000000001',
    'an account of several organizations: platform sender; the request''s own organization first');
  select * into r from private.inline_account_mail_claim(v_secret, 1440);
  perform tests.assert_eq(r.outcome, 'none', 'the other transaction''s request is never claimed');
end $$;

reset role;
reset session authorization;
do $$
declare
  v_id uuid := current_setting('tests.inline_account_delivery')::uuid;
  d record;
begin
  select * into d from platform.message_deliveries where id = v_id;
  perform tests.assert(d.tenant_id = 'a0000000-0000-4000-8000-000000000001' and d.template = 'platform.password_changed'
                       and d.status = 'queued' and d.destination = 'ua@a.test' and d.destination_masked = 'u***@a.test'
                       and d.source_key = 'account:f5000000-0000-4000-8000-000000000001'
                       and d.inline_claim_hash = pg_catalog.sha256(decode(repeat('ab', 32), 'hex'))
                       and d.recipient_person_id = 'a1000000-0000-4000-8000-0000000000a1',
    'the delivery: the account''s address, organization and person; the secret''s hash; keyed by the request');
  perform tests.assert(not exists (select 1 from private.account_mail_requests
                                   where id in ('f5000000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-000000000002')),
    'queued and unsent requests are gone');
  perform tests.assert(exists (select 1 from private.account_mail_requests where id = 'f5000000-0000-4000-8000-000000000009'
                                 and inline_claim_hash is null),
    'the other transaction''s request is untouched');
end $$;

-- The web app's delivery claim (the lease shared with the worker) takes it with the same secret.
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(null);
do $$
declare
  r record;
begin
  select * into r from private.inline_mail_claim(current_setting('tests.inline_account_delivery')::uuid,
                                                 decode(repeat('ab', 32), 'hex'));
  perform tests.assert(r.outcome = 'claimed' and r.destination = 'ua@a.test' and r.subject = 'Subject',
    'the delivery is claimed with the request''s secret, as every inline message');
end $$;
reset role;
reset session authorization;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- The worker keeps the queue: it leaves tagged requests alone for two minutes, then takes them
-- ---------------------------------------------------------------------------------------------------
begin;
insert into private.account_mail_requests (id, kind, user_id, tenant_id)
values ('f5000000-0000-4000-8000-000000000011', 'password_changed', '00000000-0000-4000-8000-0000000000a1',
        'a0000000-0000-4000-8000-000000000001');
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(null);
select private.inline_account_mail_tag(pg_catalog.sha256(decode(repeat('ab', 32), 'hex')));
reset role;
reset session authorization;
do $$
begin
  perform tests.assert((select not_before > now() + interval '90 seconds'
                        from private.account_mail_requests where id = 'f5000000-0000-4000-8000-000000000011'),
    'a tagged request waits two minutes for the web app');
end $$;
set local session authorization app_worker;
set local role authenticated;
select tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001', 'tests.inline_account'));
do $$
declare
  r record;
begin
  perform tests.assert_fails($q$select private.inline_account_mail_tag(decode(repeat('ab', 32), 'hex'))$q$, array['42501'],
    'the worker does not tag');
  perform tests.assert_fails($q$select * from private.inline_account_mail_claim(decode(repeat('ab', 32), 'hex'), 1440)$q$,
    array['42501'], 'the worker does not claim for the web app');
  perform tests.assert_fails($q$select private.inline_recovery_facts('00000000-0000-4000-8000-0000000000a1')$q$,
    array['42501'], 'nor read reset facts');
  select * into r from private.claim_account_mail_request() where id = 'f5000000-0000-4000-8000-000000000011';
  perform tests.assert(r.id is null, 'the worker does not see a tagged request inside its two minutes');
end $$;
reset role;
reset session authorization;
update private.account_mail_requests set not_before = now() - interval '1 second'
where id = 'f5000000-0000-4000-8000-000000000011';
set local session authorization app_worker;
set local role authenticated;
select tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001', 'tests.inline_account'));
do $$
declare
  r record;
begin
  select * into r from private.claim_account_mail_request() where id = 'f5000000-0000-4000-8000-000000000011';
  perform tests.assert(r.outcome = 'send' and r.email = 'ua@a.test',
    'after the two minutes the worker takes the request as before (the safety net)');
end $$;
reset role;
reset session authorization;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- An authenticator app's set-up e-mail: its code is stored with the delivery, the platform-only variant is
-- required for an account of several organizations
-- ---------------------------------------------------------------------------------------------------
begin;
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, secret) values
  ('f3000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a1', 'app', 'totp', 'verified', 'NOT-A-REAL-SECRET'),
  ('f3000000-0000-4000-8000-0000000000ab', '00000000-0000-4000-8000-0000000000ab', 'app', 'totp', 'verified', 'NOT-A-REAL-SECRET');
insert into private.mfa_factor_confirmations (factor_id, user_id, session_id, setup_user_agent) values
  ('f3000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', 'Mozilla/5.0 test'),
  ('f3000000-0000-4000-8000-0000000000ab', '00000000-0000-4000-8000-0000000000ab', '10000000-0000-4000-8000-0000000000ab', 'Mozilla/5.0 test');
insert into private.account_mail_requests (id, kind, user_id, tenant_id, factor_id) values
  ('f5000000-0000-4000-8000-000000000021', 'mfa_factor_added', '00000000-0000-4000-8000-0000000000a1',
   'a0000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-0000000000a1'),
  ('f5000000-0000-4000-8000-000000000022', 'mfa_factor_added', '00000000-0000-4000-8000-0000000000ab',
   'a0000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-0000000000ab');

set local session authorization app_server;
set local role authenticated;
select tests.set_claims(null);
do $$
declare
  v_secret bytea := decode(repeat('ee', 32), 'hex');
  r record;
  v_code bytea := pg_catalog.sha256('code'::bytea);
  v_remove bytea := pg_catalog.sha256('remove'::bytea);
begin
  perform tests.assert_eq(private.inline_account_mail_tag(pg_catalog.sha256(v_secret)), 2, 'both set-up requests tagged');
  select * into r from private.inline_account_mail_claim(v_secret, 1440);
  perform tests.assert(r.outcome = 'send' and r.kind = 'mfa_factor_added' and r.user_id = '00000000-0000-4000-8000-0000000000a1'
                       and r.platform_sender = false and r.set_up_at is not null and r.setup_user_agent = 'Mozilla/5.0 test',
    'a single-organization account: the set-up facts come with the claim');
  perform tests.assert_fails(
    $q$select private.inline_account_mail_queue(decode(repeat('ee', 32), 'hex'), 'f5000000-0000-4000-8000-000000000021',
         'platform.mfa_factor_added_platform', 1, 'en', 's', '<p>h</p>', 't', pg_catalog.sha256('c'::bytea), pg_catalog.sha256('r'::bytea))$q$,
    array['42501'], 'the platform-only variant is not used where the organization''s sender may carry it');
  perform tests.assert_fails(
    $q$select private.inline_account_mail_queue(decode(repeat('ee', 32), 'hex'), 'f5000000-0000-4000-8000-000000000021',
         'platform.mfa_factor_added', 1, 'en', 's', '<p>h</p>', 't', null, null)$q$,
    array['22023'], 'the set-up e-mail needs the hashes of its code and link');
  perform tests.assert(private.inline_account_mail_queue(v_secret, 'f5000000-0000-4000-8000-000000000021',
         'platform.mfa_factor_added', 1, 'en', 's', '<p>h</p>', 't', v_code, v_remove) is not null,
    'queued, with the code and link stored in the same step');

  select * into r from private.inline_account_mail_claim(v_secret, 1440);
  perform tests.assert(r.outcome = 'send' and r.user_id = '00000000-0000-4000-8000-0000000000ab' and r.platform_sender = true,
    'an account of several organizations: platform sender');
  perform tests.assert_fails(
    $q$select private.inline_account_mail_queue(decode(repeat('ee', 32), 'hex'), 'f5000000-0000-4000-8000-000000000022',
         'platform.mfa_factor_added', 1, 'en', 's', '<p>h</p>', 't', pg_catalog.sha256('c'::bytea), pg_catalog.sha256('r'::bytea))$q$,
    array['42501'], 'the set-up code of such an account never goes through an organization''s own sender');
  perform tests.assert(private.inline_account_mail_queue(v_secret, 'f5000000-0000-4000-8000-000000000022',
         'platform.mfa_factor_added_platform', 1, 'en', 's', '<p>h</p>', 't', pg_catalog.sha256('c'::bytea), pg_catalog.sha256('r'::bytea)) is not null,
    'the platform-only variant queues');
end $$;
reset role;
reset session authorization;
do $$
begin
  perform tests.assert((select code_hash = pg_catalog.sha256('code'::bytea) and remove_token_hash = pg_catalog.sha256('remove'::bytea)
                               and code_attempts = 0
                        from private.mfa_factor_confirmations where factor_id = 'f3000000-0000-4000-8000-0000000000a1'),
    'the code and the link are stored as hashes in the step that queued the delivery');
end $$;
-- An app that is gone: nothing to send, nothing left waiting.
delete from auth.mfa_factors where id = 'f3000000-0000-4000-8000-0000000000a1';
insert into private.account_mail_requests (id, kind, user_id, tenant_id, factor_id)
values ('f5000000-0000-4000-8000-000000000023', 'mfa_factor_added', '00000000-0000-4000-8000-0000000000a1',
        'a0000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-0000000000a1');
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(null);
do $$
declare
  r record;
begin
  perform tests.assert_eq(private.inline_account_mail_tag(pg_catalog.sha256(decode(repeat('ef', 32), 'hex'))), 1, 'tagged');
  select * into r from private.inline_account_mail_claim(decode(repeat('ef', 32), 'hex'), 1440);
  perform tests.assert_eq(r.outcome, 'factor_gone', 'an app that is gone or confirmed: nothing to send');
end $$;
reset role;
reset session authorization;
do $$
begin
  perform tests.assert(not exists (select 1 from private.account_mail_requests where id = 'f5000000-0000-4000-8000-000000000023'),
    'and its request is removed');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- The reset e-mail of the Send Email hook (type recovery)
-- ---------------------------------------------------------------------------------------------------
begin;
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(null);
do $$
declare
  r record;
  v_hash bytea := pg_catalog.sha256('recovery'::bytea);
  v_id uuid;
  v_n integer := 0;
  v_key text;
begin
  select * into r from private.inline_recovery_facts('00000000-0000-4000-8000-0000000000a1');
  perform tests.assert(r.email = 'ua@a.test' and r.tenant_id = 'a0000000-0000-4000-8000-000000000001'
                       and r.platform_sender = false and r.organization_en = 'Tenant A',
    'the facts of a single-organization account');
  select * into r from private.inline_recovery_facts('00000000-0000-4000-8000-0000000000ab');
  perform tests.assert(r.platform_sender = true, 'several organizations: the platform sender');
  perform tests.assert_eq((select count(*) from private.inline_recovery_facts('00000000-0000-4000-8000-0000000000e1')),
    0::bigint, 'an account with no organization: nothing');
  perform tests.assert_eq((select count(*) from private.inline_recovery_facts(gen_random_uuid())), 0::bigint,
    'an unknown account: nothing');

  perform tests.assert_fails(
    $q$select private.inline_recovery_queue('00000000-0000-4000-8000-0000000000a1', 'platform.password_reset', 1, 'en',
         'someone-else@a.test', 's', '<p>h</p>', 't', 'recovery:0123456789abcdef0123', pg_catalog.sha256('r'::bytea))$q$,
    array['42501'], 'only the account''s own address');
  perform tests.assert_fails(
    $q$select private.inline_recovery_queue('00000000-0000-4000-8000-0000000000a1', 'platform.password_reset_platform', 1, 'en',
         'ua@a.test', 's', '<p>h</p>', 't', 'recovery:0123456789abcdef0123', pg_catalog.sha256('r'::bytea))$q$,
    array['42501'], 'the platform-only variant is not used where it is not required');
  perform tests.assert_fails(
    $q$select private.inline_recovery_queue('00000000-0000-4000-8000-0000000000ab', 'platform.password_reset', 1, 'en',
         'uab@ab.test', 's', '<p>h</p>', 't', 'recovery:0123456789abcdef0123', pg_catalog.sha256('r'::bytea))$q$,
    array['42501'], 'an account of several organizations: the platform-only variant is required');
  perform tests.assert_fails(
    $q$select private.inline_recovery_queue('00000000-0000-4000-8000-0000000000a1', 'platform.password_reset', 1, 'en',
         'ua@a.test', 's', '<p>h</p>', 't', 'not-a-key', pg_catalog.sha256('r'::bytea))$q$,
    array['22023'], 'a key that is not a recovery key');
  perform tests.assert(private.inline_recovery_queue('00000000-0000-4000-8000-0000000000e1', 'platform.password_reset', 1, 'en',
         'unone@e.test', 's', '<p>h</p>', 't', 'recovery:0123456789abcdef0123', v_hash) is null,
    'an account with no organization: nothing queued');
  v_id := private.inline_recovery_queue('00000000-0000-4000-8000-0000000000ab', 'platform.password_reset_platform', 1, 'en',
            'UAB@ab.test', 'Subject', '<p>h</p>', 'text', 'recovery:aaaaaaaaaaaaaaaa', v_hash);
  perform tests.assert(v_id is not null, 'queued for the account''s own address (case ignored), platform-only variant');
  perform tests.assert(private.inline_recovery_queue('00000000-0000-4000-8000-0000000000ab', 'platform.password_reset_platform', 1, 'en',
            'uab@ab.test', 'Subject', '<p>h</p>', 'text', 'recovery:aaaaaaaaaaaaaaaa', v_hash) is null,
    'the same webhook is queued once');
  -- Five reset e-mails an hour per person: the first (above, to uAB in A) and four more; the sixth is refused.
  for v_n in 1..4 loop
    v_key := 'recovery:bbbbbbbbbbbbbb0' || v_n::text;
    perform tests.assert(private.inline_recovery_queue('00000000-0000-4000-8000-0000000000ab', 'platform.password_reset_platform', 1, 'en',
              'uab@ab.test', 'Subject', '<p>h</p>', 'text', v_key, v_hash) is not null, 'within the hourly cap: ' || v_n::text);
  end loop;
  perform tests.assert(private.inline_recovery_queue('00000000-0000-4000-8000-0000000000ab', 'platform.password_reset_platform', 1, 'en',
            'uab@ab.test', 'Subject', '<p>h</p>', 'text', 'recovery:cccccccccccccccc', v_hash) is null,
    'the sixth reset e-mail within the hour is refused (the cap of the worker''s account mailer)');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- The "password changed" notice after a reset: the platform-only reset e-mail of an account of several
-- organizations counts as OUR reset e-mail (it did not: such an account never got the notice)
-- ---------------------------------------------------------------------------------------------------
begin;
insert into platform.message_deliveries (tenant_id, template, template_version, locale, recipient_person_id, destination,
                                         destination_masked, subject, html_body, text_body)
values ('a0000000-0000-4000-8000-000000000001', 'platform.password_reset_platform', 1, 'en',
        'a1000000-0000-4000-8000-0000000000ab', 'uab@ab.test', 'u***@ab.test', 's', '<p>h</p>', 't');
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(null);
select private.request_password_changed_mail('00000000-0000-4000-8000-0000000000ab');
select private.request_password_changed_mail('00000000-0000-4000-8000-0000000000a1');
reset role;
reset session authorization;
do $$
begin
  perform tests.assert(exists (select 1 from private.account_mail_requests
                               where kind = 'password_changed' and user_id = '00000000-0000-4000-8000-0000000000ab'),
    'after a platform-only reset e-mail the notice is queued');
  perform tests.assert(not exists (select 1 from private.account_mail_requests
                                   where kind = 'password_changed' and user_id = '00000000-0000-4000-8000-0000000000a1'),
    'and still not for an account that got no reset e-mail of ours');
end $$;
rollback;
