-- db-test: run-as=owner
-- E-mail sent the moment the action commits (WP-ADM-05 follow-up, migration 20261026110000): the guard role and
-- what it may reach; an invitation e-mail is prepared and queued only by a member who may manage the invitation,
-- only for the invitation's own address and current code number, once; the claim needs the secret of the
-- request that queued it, shares ONE lease with the worker's sender, returns the sender settings only with a
-- successful claim, and the outcome removes the content, the address and the secret's hash; the worker's rescue
-- lists only unfinished inline messages of served organizations (not those waiting for a sender, not final
-- ones); nobody else can read or claim the delivery log. Runs as the owner and switches to the login roles.
-- Every block is rolled back.
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------------------------------
-- The role and its reach (catalog)
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  v_list text;
  v_role text;
begin
  perform tests.assert(not (select rolbypassrls or rolcanlogin or rolsuper or rolinherit or rolcreaterole or rolcreatedb
                            from pg_roles where rolname = 'inline_mail_guard'),
    'inline_mail_guard must be NOLOGIN NOINHERIT and not BYPASSRLS / superuser / createrole / createdb');
  perform tests.assert(not exists (select 1 from pg_auth_members m join pg_roles u on u.oid = m.member
                                   where m.roleid = 'inline_mail_guard'::regrole and (m.inherit_option or m.set_option)
                                     and not u.rolsuper and u.rolname <> current_user),
    'nobody acts as inline_mail_guard');
  perform tests.assert(not has_schema_privilege('inline_mail_guard', 'private', 'CREATE')
                       and not has_schema_privilege('inline_mail_guard', 'platform', 'CREATE')
                       and not exists (select 1 from pg_class c where c.relowner = 'inline_mail_guard'::regrole),
    'inline_mail_guard creates and owns no relations');
  select string_agg(format('%s%s', p.oid::regprocedure, case when p.prosecdef then ' (definer)' else '' end), ', '
                    order by p.oid::regprocedure::text collate "C") into v_list
  from pg_proc p where p.proowner = 'inline_mail_guard'::regrole;
  perform tests.assert_eq(v_list,
    'private.inline_account_mail_queue(bytea,uuid,text,integer,text,text,text,text,bytea,bytea) (definer), '
    'private.inline_invitation_prepare(uuid) (definer), private.inline_mail_caller(), '
    'private.inline_mail_claim(uuid,bytea) (definer), '
    'private.inline_mail_finish(uuid,bytea,text,text,text,text,text) (definer), '
    'private.inline_mail_queue(text,uuid,text,integer,text,text,text,text,text,text,bytea) (definer), '
    'private.inline_mail_tenants_to_rescue() (definer), '
    'private.inline_recovery_queue(uuid,text,integer,text,text,text,text,text,text,bytea) (definer)',
    'inline_mail_guard owns the inline e-mail functions only');
  perform tests.assert((select bool_and(exists (select 1 from unnest(p.proconfig) c where c in ('search_path=""', 'search_path=')))
                        from pg_proc p where p.proowner = 'inline_mail_guard'::regrole),
    'every inline e-mail function has an empty search_path');
  select string_agg(distinct case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, ', ')
    into v_list
  from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where p.proowner = 'inline_mail_guard'::regrole and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner;
  perform tests.assert_eq(v_list, 'authenticated', 'EXECUTE: authenticated only (each function checks the login role)');
  perform tests.assert(not has_function_privilege('authenticated', 'private.inline_mail_caller()', 'execute'),
    'the caller check is internal');
  -- The delivery log: no application role reaches the inline columns; the guard reaches what it needs and no more.
  foreach v_role in array array['anon', 'authenticated', 'service_role', 'app_server', 'app_worker', 'app_queue',
                                'tenant_guard', 'invitation_guard', 'platform_admin_guard', 'account_mail_guard'] loop
    perform tests.assert(
      not has_column_privilege(v_role, 'platform.message_deliveries', 'inline_claim_hash', 'select')
        or v_role in ('authenticated', 'app_worker', 'app_server'),
      format('%s must not read the claim hash', v_role));
  end loop;
  perform tests.assert(not has_table_privilege('inline_mail_guard', 'platform.message_deliveries', 'delete')
                       and not has_column_privilege('inline_mail_guard', 'platform.message_deliveries', 'tenant_id', 'update')
                       and not has_column_privilege('inline_mail_guard', 'platform.message_deliveries', 'source_key', 'update')
                       and not has_column_privilege('inline_mail_guard', 'platform.invitations', 'invite_code', 'select')
                       and not has_column_privilege('inline_mail_guard', 'platform.invitations', 'token_hash', 'select')
                       and not has_table_privilege('inline_mail_guard', 'private.platform_email_settings', 'select')
                       and not has_table_privilege('inline_mail_guard', 'private.tenant_email_settings', 'select'),
    'the guard cannot delete deliveries, change what they are, read invitation codes or the settings tables');
end $$;

-- ---------------------------------------------------------------------------------------------------
-- Fixtures: an invitation of tenant A with a code, and one of tenant B
-- ---------------------------------------------------------------------------------------------------
create function pg_temp.secret() returns bytea language sql immutable as $$ select decode(repeat('ab', 32), 'hex') $$;
create function pg_temp.other_secret() returns bytea language sql immutable as $$ select decode(repeat('cd', 32), 'hex') $$;
create function pg_temp.hash(p bytea) returns bytea language sql immutable as $$ select pg_catalog.sha256(p) $$;

begin;
insert into platform.persons (id, tenant_id, display_name_ar, display_name_en, email) values
  ('a1000000-0000-4000-8000-00000000f101', 'a0000000-0000-4000-8000-000000000001', 'مدعو فوري', 'Inline Invitee', 'inline-a@a.test'),
  ('b1000000-0000-4000-8000-00000000f101', 'b0000000-0000-4000-8000-000000000001', 'مدعو ب', 'Inline B', 'inline-b@b.test');
insert into platform.invitations (id, tenant_id, person_id, email, locale, primary_role, invited_by) values
  ('a4000000-0000-4000-8000-00000000f101', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000f101',
   'inline-a@a.test', 'en', 'learner', '00000000-0000-4000-8000-0000000000a1'),
  ('b4000000-0000-4000-8000-00000000f101', 'b0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-00000000f101',
   'inline-b@b.test', 'en', 'learner', '00000000-0000-4000-8000-0000000000b1');
update platform.invitations set invite_code = 'HKCD2345WXYZ' where id = 'a4000000-0000-4000-8000-00000000f101';
update platform.invitations set invite_code = 'JKCD2345WXYZ' where id = 'b4000000-0000-4000-8000-00000000f101';

-- Prepare: a member who may manage the invitation; nobody else; not without claims, not the worker.
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(tests.ua_claims());
do $$
declare
  r record;
begin
  select * into r from private.inline_invitation_prepare('a4000000-0000-4000-8000-00000000f101');
  perform tests.assert(r.invite_code = 'HKCD2345WXYZ' and r.email = 'inline-a@a.test' and r.send_count = 1
                       and r.source_key = 'invitation:a4000000-0000-4000-8000-00000000f101:1'
                       and r.organization_en = 'Tenant A' and r.recipient_en = 'Inline Invitee' and r.primary_role = 'learner',
    'prepare: the facts, the current code and the key of this code number');
  perform tests.assert_eq((select count(*) from private.inline_invitation_prepare('b4000000-0000-4000-8000-00000000f101')), 0::bigint,
    'another organization''s invitation: nothing');
  perform tests.assert_eq((select count(*) from private.inline_invitation_prepare(gen_random_uuid())), 0::bigint,
    'an unknown invitation: nothing');
end $$;
select tests.set_claims(null);
do $$
begin
  perform tests.assert_fails($q$select * from private.inline_invitation_prepare('a4000000-0000-4000-8000-00000000f101')$q$, array['42501'], 'no claims: refused');
  perform tests.assert_fails($q$select private.inline_mail_queue('invitation', 'a4000000-0000-4000-8000-00000000f101', 'platform.invitation', 1, 'en', 'inline-a@a.test', 's', '<p>h</p>', 't', 'invitation:a4000000-0000-4000-8000-00000000f101:1', pg_catalog.sha256(decode(repeat('ab', 32), 'hex')))$q$,
    array['42501'], 'no claims: nothing queued');
end $$;
set local session authorization app_worker;
set local role authenticated;
select tests.set_claims(tests.system_claims('a0000000-0000-4000-8000-000000000001', 'tests.inline'));
do $$
begin
  perform tests.assert_fails($q$select * from private.inline_invitation_prepare('a4000000-0000-4000-8000-00000000f101')$q$, array['42501'], 'the worker does not prepare');
  perform tests.assert_fails($q$select * from private.inline_mail_claim(gen_random_uuid(), decode(repeat('ab', 32), 'hex'))$q$, array['42501'], 'the worker does not claim for the web app');
  perform tests.assert_fails($q$select private.inline_mail_finish(gen_random_uuid(), decode(repeat('ab', 32), 'hex'), 'sent', null, 'resend', 'x', 'platform')$q$, array['42501'], 'nor finish');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- Queue, claim, finish
-- ---------------------------------------------------------------------------------------------------
begin;
insert into platform.persons (id, tenant_id, display_name_ar, display_name_en, email) values
  ('a1000000-0000-4000-8000-00000000f101', 'a0000000-0000-4000-8000-000000000001', 'مدعو فوري', 'Inline Invitee', 'inline-a@a.test'),
  ('b1000000-0000-4000-8000-00000000f101', 'b0000000-0000-4000-8000-000000000001', 'مدعو ب', 'Inline B', 'inline-b@b.test');
insert into platform.invitations (id, tenant_id, person_id, email, locale, primary_role, invited_by) values
  ('a4000000-0000-4000-8000-00000000f101', 'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-00000000f101',
   'inline-a@a.test', 'en', 'learner', '00000000-0000-4000-8000-0000000000a1'),
  ('b4000000-0000-4000-8000-00000000f101', 'b0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-00000000f101',
   'inline-b@b.test', 'en', 'learner', '00000000-0000-4000-8000-0000000000b1');
update platform.invitations set invite_code = 'HKCD2345WXYZ' where id = 'a4000000-0000-4000-8000-00000000f101';
update platform.invitations set invite_code = 'JKCD2345WXYZ' where id = 'b4000000-0000-4000-8000-00000000f101';

set local session authorization app_server;
set local role authenticated;
select tests.set_claims(tests.ua_claims());
do $$
declare
  v_id uuid;
  v_key text := 'invitation:a4000000-0000-4000-8000-00000000f101:1';
begin
  -- Refused: another address, another template, another key, another organization's invitation, an unknown kind.
  perform tests.assert_fails(format($q$select private.inline_mail_queue('invitation', 'a4000000-0000-4000-8000-00000000f101', 'platform.invitation', 1, 'en', 'someone-else@a.test', 's', '<p>h</p>', 't', %L, pg_catalog.sha256(decode(repeat('ab', 32), 'hex')))$q$, v_key),
    array['42501'], 'only the invitation''s own address');
  perform tests.assert_fails(format($q$select private.inline_mail_queue('invitation', 'a4000000-0000-4000-8000-00000000f101', 'platform.password_reset', 1, 'en', 'inline-a@a.test', 's', '<p>h</p>', 't', %L, pg_catalog.sha256(decode(repeat('ab', 32), 'hex')))$q$, v_key),
    array['42501'], 'only the invitation e-mail');
  perform tests.assert_fails($q$select private.inline_mail_queue('invitation', 'a4000000-0000-4000-8000-00000000f101', 'platform.invitation', 1, 'en', 'inline-a@a.test', 's', '<p>h</p>', 't', 'invitation:a4000000-0000-4000-8000-00000000f101:2', pg_catalog.sha256(decode(repeat('ab', 32), 'hex')))$q$,
    array['42501'], 'only the current code number');
  perform tests.assert_fails($q$select private.inline_mail_queue('invitation', 'b4000000-0000-4000-8000-00000000f101', 'platform.invitation', 1, 'en', 'inline-b@b.test', 's', '<p>h</p>', 't', 'invitation:b4000000-0000-4000-8000-00000000f101:1', pg_catalog.sha256(decode(repeat('ab', 32), 'hex')))$q$,
    array['42501'], 'another organization''s invitation');
  perform tests.assert_fails(format($q$select private.inline_mail_queue('password_reset', 'a4000000-0000-4000-8000-00000000f101', 'platform.invitation', 1, 'en', 'inline-a@a.test', 's', '<p>h</p>', 't', %L, pg_catalog.sha256(decode(repeat('ab', 32), 'hex')))$q$, v_key),
    array['22023'], 'an unknown kind');
  perform tests.assert_fails(format($q$select private.inline_mail_queue('invitation', 'a4000000-0000-4000-8000-00000000f101', 'platform.invitation', 1, 'en', 'inline-a@a.test', 's', '<p>h</p>', 't', %L, decode('00', 'hex'))$q$, v_key),
    array['22023'], 'a claim hash that is not 32 bytes');
  -- Accepted: once.
  v_id := private.inline_mail_queue('invitation', 'a4000000-0000-4000-8000-00000000f101', 'platform.invitation', 1, 'en',
                                    ' Inline-A@a.test ', 'Invitation', '<p>Hello</p>', 'Hello', v_key,
                                    pg_catalog.sha256(decode(repeat('ab', 32), 'hex')));
  perform tests.assert(v_id is not null, 'queued');
  perform tests.assert(private.inline_mail_queue('invitation', 'a4000000-0000-4000-8000-00000000f101', 'platform.invitation', 1, 'en',
                                                 'inline-a@a.test', 'Invitation', '<p>Hello</p>', 'Hello', v_key,
                                                 pg_catalog.sha256(decode(repeat('cd', 32), 'hex'))) is null,
    'the same message is queued once (the worker''s mailer and a second request skip it)');
  perform tests.assert_eq((select count(*) from platform.message_deliveries), 0::bigint,
    'the web app reads no deliveries');
end $$;
set local session authorization default;
do $$
begin
  perform tests.assert((select status = 'queued' and attempts = 0 and destination = 'inline-a@a.test'
                               and destination_masked = 'i***@a.test'
                               and recipient_person_id = 'a1000000-0000-4000-8000-00000000f101'
                               and tenant_id = 'a0000000-0000-4000-8000-000000000001'
                               and inline_claim_hash = pg_catalog.sha256(decode(repeat('ab', 32), 'hex'))
                               and source_key = 'invitation:a4000000-0000-4000-8000-00000000f101:1'
                        from platform.message_deliveries where template = 'platform.invitation' and source_key is not null),
    'one queued delivery: address normalised and masked, the invitation''s person, the hash of the secret only');
  perform set_config('tests.inline_id', (select id::text from platform.message_deliveries where source_key is not null), true);
end $$;

-- Claim: the secret of the request that queued it, nobody else's.
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(null);
do $$
declare
  r record;
  v_id uuid := current_setting('tests.inline_id')::uuid;
begin
  select * into r from private.inline_mail_claim(v_id, decode(repeat('cd', 32), 'hex'));
  perform tests.assert(r.outcome = 'gone' and r.destination is null and r.platform_configured is null,
    'a wrong secret: nothing, and no sender settings');
  select * into r from private.inline_mail_claim(gen_random_uuid(), decode(repeat('ab', 32), 'hex'));
  perform tests.assert(r.outcome = 'gone', 'an unknown message: nothing');
  select * into r from private.inline_mail_claim(v_id, decode('abab', 'hex'));
  perform tests.assert(r.outcome = 'gone', 'a secret of the wrong size: nothing');
  select * into r from private.inline_mail_claim(v_id, decode(repeat('ab', 32), 'hex'));
  perform tests.assert(r.outcome = 'claimed', format('claim outcome %s', r.outcome));
  perform tests.assert(r.destination = 'inline-a@a.test' and r.subject = 'Invitation' and r.html = '<p>Hello</p>',
    format('claim content %s / %s / %s', r.destination, r.subject, r.html));
  perform tests.assert(r.attempts = 1 and r.brand_name_en = 'Tenant A',
    format('claim attempts %s brand %s', r.attempts, r.brand_name_en));
  perform tests.assert(r.tenant_id = 'a0000000-0000-4000-8000-000000000001' and r.template = 'platform.invitation',
    'the right secret: the message and the organization''s sender settings');
  select * into r from private.inline_mail_claim(v_id, decode(repeat('ab', 32), 'hex'));
  perform tests.assert(r.outcome = 'busy' and r.destination is null and r.tenant_provider is null,
    'claimed again at once: busy (the shared lease), nothing returned');
  perform tests.assert(not private.inline_mail_finish(v_id, decode(repeat('cd', 32), 'hex'), 'sent', null, 'resend', 'x', 'platform'),
    'a wrong secret finishes nothing');
  perform tests.assert_fails($q$select private.inline_mail_finish(gen_random_uuid(), decode(repeat('ab', 32), 'hex'), 'queued', null, null, null, null)$q$,
    array['22023'], 'only sent, failed or retry');
  -- A temporary failure puts it back, content kept; a claim follows (attempt 2).
  perform tests.assert(private.inline_mail_finish(v_id, decode(repeat('ab', 32), 'hex'), 'retry', 'SEND_FAILED', null, null, null),
    'retry');
end $$;
set local session authorization default;
do $$
begin
  perform tests.assert((select status = 'queued' and error_code = 'SEND_FAILED' and destination is not null and inline_claim_hash is not null
                        from platform.message_deliveries where source_key is not null), 'back in the queue with the reason, content kept');
end $$;
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(null);
do $$
declare
  r record;
  v_id uuid := current_setting('tests.inline_id')::uuid;
begin
  select * into r from private.inline_mail_claim(v_id, decode(repeat('ab', 32), 'hex'));
  perform tests.assert(r.outcome = 'claimed' and r.attempts = 2, 'claimed again after the retry');
  perform tests.assert(private.inline_mail_finish(v_id, decode(repeat('ab', 32), 'hex'), 'sent', null, 'resend', 'msg-1', 'platform'),
    'sent');
  select * into r from private.inline_mail_claim(v_id, decode(repeat('ab', 32), 'hex'));
  perform tests.assert(r.outcome = 'gone', 'a final message cannot be claimed again');
  perform tests.assert(not private.inline_mail_finish(v_id, decode(repeat('ab', 32), 'hex'), 'sent', null, 'resend', 'msg-1', 'platform'),
    'nor finished twice');
end $$;
set local session authorization default;
do $$
begin
  perform tests.assert((select status = 'sent' and sender = 'platform' and provider = 'resend' and provider_message_id = 'msg-1'
                               and sent_at is not null and destination is null and subject is null and html_body is null
                               and text_body is null and inline_claim_hash is null
                        from platform.message_deliveries where source_key is not null),
    'final: outcome recorded; address, content and the secret''s hash removed');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- The lease is shared with the worker; a suspended organization is not served; the safety net (rescue)
-- ---------------------------------------------------------------------------------------------------
begin;
insert into platform.message_deliveries (id, tenant_id, template, template_version, locale, destination, destination_masked,
                                         subject, html_body, text_body, source_key, inline_claim_hash)
values ('a8000000-0000-4000-8000-00000000f201', 'a0000000-0000-4000-8000-000000000001', 'platform.invitation', 1, 'en',
        'r1@a.test', 'r***@a.test', 's', '<p>x</p>', 'x', 'invitation:r1:1', pg_temp.hash(pg_temp.secret())),
       ('a8000000-0000-4000-8000-00000000f202', 'a0000000-0000-4000-8000-000000000001', 'platform.invitation', 1, 'en',
        'r2@a.test', 'r***@a.test', 's', '<p>x</p>', 'x', 'invitation:r2:1', pg_temp.hash(pg_temp.secret())),
       ('a8000000-0000-4000-8000-00000000f203', 'a0000000-0000-4000-8000-000000000001', 'platform.invitation', 1, 'en',
        'r3@a.test', 'r***@a.test', 's', '<p>x</p>', 'x', 'invitation:r3:1', pg_temp.hash(pg_temp.secret())),
       ('b8000000-0000-4000-8000-00000000f201', 'b0000000-0000-4000-8000-000000000001', 'platform.invitation', 1, 'en',
        'r4@b.test', 'r***@b.test', 's', '<p>x</p>', 'x', 'invitation:r4:1', pg_temp.hash(pg_temp.secret()));
-- The worker's own deliveries (no hash) are never listed.
insert into platform.message_deliveries (id, tenant_id, template, template_version, locale, destination, destination_masked,
                                         subject, html_body, text_body)
values ('a8000000-0000-4000-8000-00000000f204', 'a0000000-0000-4000-8000-000000000001', 'platform.invitation', 1, 'en',
        'r5@a.test', 'r***@a.test', 's', '<p>x</p>', 'x');

-- Too young: nothing to rescue yet.
set local session authorization app_worker;
set local role authenticated;
select tests.set_claims(tests.system_claims(null, 'tests.inline'));
do $$
begin
  perform tests.assert_eq((select count(*) from private.inline_mail_tenants_to_rescue()), 0::bigint, 'a minute has not passed: nothing');
end $$;
set local session authorization default;
-- Age them (the immutability trigger guards created_at, so it is paused for the fixture).
alter table platform.message_deliveries disable trigger message_deliveries_check;
update platform.message_deliveries set created_at = now() - interval '2 minutes';
alter table platform.message_deliveries enable trigger message_deliveries_check;
-- f202 waits for a sender (the resume task's), f203 is still leased by a sender that is alive.
update platform.message_deliveries set status = 'queued', error_code = 'NO_SENDER' where id = 'a8000000-0000-4000-8000-00000000f202';
update platform.message_deliveries set status = 'sending' where id = 'a8000000-0000-4000-8000-00000000f203';
set local session authorization app_worker;
set local role authenticated;
select tests.set_claims(tests.system_claims(null, 'tests.inline'));
do $$
begin
  perform tests.assert((select array_agg(tenant_id order by tenant_id) from private.inline_mail_tenants_to_rescue())
                         = array['a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001']::uuid[],
    'unfinished inline messages of served organizations (not those waiting for a sender, not a live lease, not the worker''s own)');
end $$;
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(tests.ua_claims());
do $$
begin
  perform tests.assert_fails($q$select * from private.inline_mail_tenants_to_rescue()$q$, array['42501'], 'the web app does not list the rescue');
end $$;
-- A suspended organization: not listed and not claimable.
set local session authorization default;
update platform.tenants set status = 'suspended' where id = 'b0000000-0000-4000-8000-000000000001';
set local session authorization app_worker;
set local role authenticated;
select tests.set_claims(tests.system_claims(null, 'tests.inline'));
do $$
begin
  perform tests.assert((select array_agg(tenant_id) from private.inline_mail_tenants_to_rescue())
                         = array['a0000000-0000-4000-8000-000000000001']::uuid[], 'a suspended organization is not rescued');
end $$;
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(null);
do $$
declare
  r record;
begin
  select * into r from private.inline_mail_claim('b8000000-0000-4000-8000-00000000f201', decode(repeat('ab', 32), 'hex'));
  perform tests.assert(r.outcome = 'gone', 'a suspended organization''s message is not claimed by the web app');
  -- An expired lease can be claimed (its sender died).
  select * into r from private.inline_mail_claim('a8000000-0000-4000-8000-00000000f203', decode(repeat('ab', 32), 'hex'));
  perform tests.assert(r.outcome = 'busy', 'a live lease holds');
end $$;
set local session authorization default;
alter table platform.message_deliveries disable trigger message_deliveries_check;
update platform.message_deliveries set updated_at = now() - interval '6 minutes' where id = 'a8000000-0000-4000-8000-00000000f203';
alter table platform.message_deliveries enable trigger message_deliveries_check;
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(null);
do $$
declare
  r record;
begin
  select * into r from private.inline_mail_claim('a8000000-0000-4000-8000-00000000f203', decode(repeat('ab', 32), 'hex'));
  perform tests.assert(r.outcome = 'claimed', 'a lease nobody renewed for five minutes is taken over');
end $$;
rollback;
