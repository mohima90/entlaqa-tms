-- db-test: run-as=owner
-- Platform Super Admin console (FR-ADM-17, migration 20261018100000), checked as the owner: the guard role
-- and what it may reach; granting and revoking Super Admins (the workflow's functions: the migration role
-- only); the whole Kawadir flow — a Super Admin creates an organization with its Organization Admin's pending
-- invitation, the invitee's sign-up passes the existing hook for that e-mail only, the acceptance makes them
-- the ACTIVE Organization Admin of that organization only; a revoked Super Admin's pending invitation stops
-- working. COMMITTED fixtures for 96_platform_admin_app_server.sql: the Super Admin uP (…f1) with a valid
-- session sP (…fa01) and an expired one (…fa09), no membership anywhere. Everything else is rolled back.
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------------------------------
-- Fixtures (committed)
-- ---------------------------------------------------------------------------------------------------
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000f1', 'super@entlaqa.test');
insert into auth.sessions (id, user_id, not_after) values
  ('10000000-0000-4000-8000-00000000fa01', '00000000-0000-4000-8000-0000000000f1', null),
  ('10000000-0000-4000-8000-00000000fa09', '00000000-0000-4000-8000-0000000000f1', now() - interval '1 minute');
select private.grant_platform_admin('00000000-0000-4000-8000-0000000000f1');

create or replace function pg_temp.become_super_admin() returns void language plpgsql as $$
begin
  set local session authorization app_server;
  set local role authenticated;
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000f1',
                                             '10000000-0000-4000-8000-00000000fa01', null));
end $$;
create or replace function pg_temp.become_owner() returns void language plpgsql as $$
begin
  reset role;
  reset session authorization;
  perform tests.set_claims(null);
end $$;
-- What platform_create_tenant returned in this transaction (kept in a setting: authenticated may not create
-- temporary tables).
create or replace function pg_temp.flow() returns table (tenant_id uuid, invitation_id uuid, invite_code text)
language sql stable as $$
  select (j ->> 'tenant_id')::uuid, (j ->> 'invitation_id')::uuid, j ->> 'invite_code'
  from (select current_setting('tests.flow')::jsonb as j) s
$$;
create or replace function pg_temp.event(p_email text, p_code text) returns jsonb language sql as $$
  select jsonb_build_object(
    'metadata', jsonb_build_object('uuid', gen_random_uuid(), 'time', now(), 'name', 'before-user-created',
                                   'ip_address', '127.0.0.1'),
    'user', jsonb_build_object(
      'id', gen_random_uuid(), 'aud', '', 'role', '', 'email', p_email, 'phone', '',
      'app_metadata', jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      'user_metadata', jsonb_build_object('invitation', p_code), 'identities', '[]'::jsonb,
      'created_at', now(), 'updated_at', now(), 'is_anonymous', false))
$$;

-- ---------------------------------------------------------------------------------------------------
-- The guard role and the tables (catalog)
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  v_list text;
  v_role text;
begin
  perform tests.assert(not (select rolbypassrls or rolcanlogin or rolsuper or rolinherit or rolcreaterole or rolcreatedb
                            from pg_roles where rolname = 'platform_admin_guard'),
    'platform_admin_guard must be NOLOGIN NOINHERIT and not BYPASSRLS / superuser / createrole / createdb');
  perform tests.assert(not exists (select 1 from pg_auth_members m join pg_roles u on u.oid = m.member
                                   where m.roleid = 'platform_admin_guard'::regrole and (m.inherit_option or m.set_option)
                                     and not u.rolsuper and u.rolname <> current_user),
    'nobody acts as platform_admin_guard');
  perform tests.assert(not has_schema_privilege('platform_admin_guard', 'private', 'CREATE')
                       and not has_schema_privilege('platform_admin_guard', 'platform', 'CREATE')
                       and not exists (select 1 from pg_class c where c.relowner = 'platform_admin_guard'::regrole),
    'platform_admin_guard creates and owns no relations');
  select string_agg(format('%s%s', p.oid::regprocedure, case when p.prosecdef then ' (definer)' else '' end), ', '
                    order by p.oid::regprocedure::text collate "C") into v_list
  from pg_proc p where p.proowner = 'platform_admin_guard'::regrole;
  perform tests.assert_eq(v_list,
    'private.grant_platform_admin(uuid) (definer), private.is_platform_admin() (definer), '
    'private.is_platform_invitation(uuid) (definer), private.platform_admin_caller(), '
    'private.platform_admin_invitation_code(uuid) (definer), private.platform_admin_is_active(uuid) (definer), '
    'private.platform_create_tenant(text,text,text,text,text,text,text,text,text) (definer), '
    'private.platform_list_tenants() (definer), private.platform_pending_admin_invitation(uuid), '
    'private.platform_reissue_admin_code(uuid) (definer), private.platform_reserved_slug(text), '
    'private.revoke_platform_admin(uuid) (definer)',
    'platform_admin_guard owns the console, the workflow''s grant and revoke and their helpers only');
  -- Who may execute what (exact, besides the owner).
  select string_agg(format('%s → %s', p.oid::regprocedure,
                           case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end), ', '
                    order by p.oid::regprocedure::text collate "C", 2) into v_list
  from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where p.proowner = 'platform_admin_guard'::regrole and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner;
  perform tests.assert_eq(v_list,
    format('private.grant_platform_admin(uuid) → %1$s, private.is_platform_admin() → authenticated, '
           'private.is_platform_invitation(uuid) → invitation_guard, '
           'private.platform_admin_invitation_code(uuid) → authenticated, '
           'private.platform_admin_is_active(uuid) → invitation_guard, '
           'private.platform_create_tenant(text,text,text,text,text,text,text,text,text) → authenticated, '
           'private.platform_list_tenants() → authenticated, private.platform_reissue_admin_code(uuid) → authenticated, '
           'private.revoke_platform_admin(uuid) → %1$s', current_user),
    'EXECUTE: the console for authenticated (checked inside), the grants for the migration role, the link checks for invitation_guard');
  -- The Super Admin tables: RLS forced; no application role reaches them.
  foreach v_role in array array['anon', 'authenticated', 'service_role', 'app_server', 'app_worker', 'app_queue',
                                'tenant_guard', 'invitation_guard', 'supabase_auth_admin'] loop
    perform tests.assert(
      not has_table_privilege(v_role, 'private.platform_admins', 'select, insert, update, delete, truncate, references, trigger')
        and not has_table_privilege(v_role, 'private.platform_invitations', 'select, insert, update, delete, truncate, references, trigger')
        and not has_table_privilege(v_role, 'private.platform_audit_events', 'select, insert, update, delete, truncate, references, trigger')
        and not has_any_column_privilege(v_role, 'private.platform_audit_events', 'select, insert, update, references'),
      format('%s must have no privilege on the Super Admin tables', v_role));
  end loop;
  perform tests.assert((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class
                        where oid in ('private.platform_admins'::regclass, 'private.platform_invitations'::regclass,
                                      'private.platform_audit_events'::regclass)),
    'the Super Admin tables force row level security');
  -- Never a tenant table's write beyond what the console needs.
  perform tests.assert(not has_table_privilege('platform_admin_guard', 'platform.tenant_memberships', 'insert, update, delete')
                       and not has_table_privilege('platform_admin_guard', 'platform.role_assignments', 'insert, update, delete')
                       and not has_column_privilege('platform_admin_guard', 'platform.invitations', 'token_hash', 'select, update')
                       and not has_table_privilege('platform_admin_guard', 'platform.tenants', 'update, delete')
                       and not has_table_privilege('platform_admin_guard', 'platform.audit_events', 'select'),
    'platform_admin_guard creates no membership or role, reads no token hash, changes no organization, reads no audit');
  perform tests.assert_fails($q$update private.platform_audit_events set action = 'platform.test.tampered'$q$,
    array['42501'], 'platform audit: append-only for every role');
end $$;

-- ---------------------------------------------------------------------------------------------------
-- Granting and revoking (the workflow): idempotent, audited, an unknown UID refused clearly
-- ---------------------------------------------------------------------------------------------------
begin;
do $$
begin
  perform tests.assert_eq(private.grant_platform_admin('00000000-0000-4000-8000-0000000000f1'), false,
    'granting a Super Admin again changes nothing');
  perform tests.assert_fails($q$select private.grant_platform_admin('00000000-0000-4000-8000-00000000dead')$q$,
    array['JP004'], 'an unknown Auth user is refused');
  perform tests.assert_eq(private.grant_platform_admin('00000000-0000-4000-8000-0000000000e1'), true, 'grant uNone');
  perform tests.assert_eq(private.revoke_platform_admin('00000000-0000-4000-8000-0000000000e1'), true, 'revoke uNone');
  perform tests.assert_eq(private.revoke_platform_admin('00000000-0000-4000-8000-0000000000e1'), false,
    'revoking again changes nothing');
  perform tests.assert_eq((select string_agg(action || ':' || entity_id || ':' || coalesce(actor_user_id::text, '-'), ', ' order by occurred_at, action)
                           from private.platform_audit_events where entity_id = '00000000-0000-4000-8000-0000000000e1'),
    'platform.admin.granted:00000000-0000-4000-8000-0000000000e1:-, platform.admin.revoked:00000000-0000-4000-8000-0000000000e1:-',
    'grants and revocations are audited (no actor: the workflow)');
end $$;
-- The request path cannot grant (privilege), even for itself.
set local session authorization app_server;
set local role authenticated;
select tests.assert_privilege_denied($q$select private.grant_platform_admin('00000000-0000-4000-8000-0000000000e1')$q$,
  'app_server cannot grant Super Admins');
select tests.assert_privilege_denied($q$select * from private.platform_admins$q$, 'app_server cannot read Super Admins');
rollback;

-- ---------------------------------------------------------------------------------------------------
-- The flow: create → sign-up gate → acceptance → the new Organization Admin of that organization only
-- ---------------------------------------------------------------------------------------------------
begin;
select pg_temp.become_super_admin();
select set_config('tests.flow', to_jsonb(x)::text, true)
from private.platform_create_tenant('entlaqa-test', 'إنطلاقة', 'ENTLAQA', ' New.Admin@Entlaqa.TEST ',
                                    'سارة', 'العتيبي', 'Sara', null, 'ar') x;
do $$
declare
  f record;
begin
  select * into f from pg_temp.flow();
  perform tests.assert(f.invite_code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$', 'a code of the shared alphabet');
  perform tests.assert_eq((select row(x.state, x.email, x.locale, x.tenant_name_ar, x.display_name_ar)::text
                           from private.invitation_by_token(tests.token_hash(f.invite_code)) x),
    row('valid', 'new.admin@entlaqa.test', 'ar', 'إنطلاقة', 'سارة العتيبي')::text,
    'the code opens the sign-up page for that organization and e-mail (trimmed, lower-cased)');
  perform tests.assert_eq((select row(admin_state, member_count, admin_invitation_locale, status)::text
                           from private.platform_list_tenants() where tenant_id = f.tenant_id),
    row('pending', 0, 'ar', 'active')::text, 'the list: active organization, no members, Organization Admin pending');
end $$;
select pg_temp.become_owner();
do $$
declare
  f record;
begin
  select * into f from pg_temp.flow();
  -- Created exactly as provisioning creates an organization: active, its settings and security policy.
  perform tests.assert_eq((select row(t.slug, t.name_ar, t.name_en, t.status)::text from platform.tenants t where t.id = f.tenant_id),
    row('entlaqa-test', 'إنطلاقة', 'ENTLAQA', 'active')::text, 'the organization');
  perform tests.assert((select count(*) = 1 from platform.tenant_settings s where s.tenant_id = f.tenant_id)
                       and (select count(*) = 1 from platform.security_policies p where p.tenant_id = f.tenant_id),
    'its default settings and security policy');
  perform tests.assert_eq((select row(i.primary_role, i.additional_roles, i.status, i.send_count, i.invited_by, i.mail_held)::text
                           from platform.invitations i where i.id = f.invitation_id),
    row('tenant_admin', '{}'::text[], 'pending', 1::smallint, '00000000-0000-4000-8000-0000000000f1'::uuid, false)::text,
    'a pending invitation: the Organization Admin role alone, the first code, invited by the Super Admin');
  perform tests.assert_eq((select row(p.first_name_ar, p.family_name_ar, p.first_name_en, p.email, p.preferred_locale, p.created_by)::text
                           from platform.persons p join platform.invitations i on i.person_id = p.id where i.id = f.invitation_id),
    row('سارة', 'العتيبي', 'Sara', 'new.admin@entlaqa.test', 'ar', null::uuid)::text,
    'the person record (a platform operation: no person stamped)');
  perform tests.assert_eq((select string_agg(action || ':' || coalesce(actor_user_id::text, '-'), ', ' order by action)
                           from platform.audit_events where tenant_id = f.tenant_id),
    'platform.invitation.created:00000000-0000-4000-8000-0000000000f1, platform.tenant.created:00000000-0000-4000-8000-0000000000f1',
    'the organization''s own audit trail: what the Super Admin did');
  perform tests.assert_eq((select count(*) from private.platform_audit_events
                           where tenant_id = f.tenant_id and action = 'platform.tenant.created'
                             and actor_user_id = '00000000-0000-4000-8000-0000000000f1'), 1::bigint, 'the platform audit');
  perform tests.assert(not exists (select 1 from private.platform_audit_events e
                                   where e.data::text like '%' || f.invite_code || '%' or e.data::text ilike '%entlaqa.test%')
                       and not exists (select 1 from platform.audit_events e
                                       where e.tenant_id = f.tenant_id
                                         and (e.data::text like '%' || f.invite_code || '%' or e.data::text ilike '%entlaqa.test%')),
    'no audit row carries the code or the e-mail');
end $$;

-- The sign-up gate (Auth's role): that e-mail with the code only.
set local role supabase_auth_admin;
do $$
declare
  v_code text := (select invite_code from pg_temp.flow());
begin
  perform tests.assert_eq(private.before_user_created_hook(pg_temp.event('new.admin@entlaqa.test', v_code)), '{}'::jsonb,
    'the hook admits the invitee''s e-mail with the code');
  perform tests.assert_eq(private.before_user_created_hook(pg_temp.event('someone.else@entlaqa.test', v_code)),
    '{"error": {"http_code": 403, "message": "Sign-up is by invitation only."}}'::jsonb, 'any other e-mail is refused');
end $$;
reset role;

-- The invitee's account (as Auth creates it after the hook), then the acceptance with its session.
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000f2', 'new.admin@entlaqa.test');
insert into auth.sessions (id, user_id) values ('10000000-0000-4000-8000-00000000fa02', '00000000-0000-4000-8000-0000000000f2');
set local session authorization app_server;
set local role authenticated;
select tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000f2', '10000000-0000-4000-8000-00000000fa02', null));
do $$
declare
  f record;
begin
  select * into f from pg_temp.flow();
  perform tests.assert_eq(private.accept_invitation_as_caller(tests.token_hash(f.invite_code)), f.tenant_id,
    'the invitee accepts');
  perform tests.assert_eq(private.is_platform_admin(), false, 'the new Organization Admin is no Super Admin');
  perform tests.assert_fails($q$select * from private.platform_list_tenants()$q$, array['42501'],
    'the new Organization Admin cannot open the console');
  perform tests.assert_eq((select string_agg(tenant_id::text, ',') from private.session_tenants()), f.tenant_id::text,
    'their only organization is the new one');
  -- In their organization: they see it, and nothing of another one (cross-tenant isolation unchanged).
  perform private.switch_active_tenant(f.tenant_id);
  perform tests.set_claims(tests.user_claims('00000000-0000-4000-8000-0000000000f2', '10000000-0000-4000-8000-00000000fa02', f.tenant_id));
  perform tests.assert_eq((select string_agg(slug, ',') from platform.tenants), 'entlaqa-test', 'tenants: their own only');
  perform tests.assert_eq((select count(*) from platform.persons where tenant_id <> f.tenant_id), 0::bigint,
    'no person of another organization');
  perform tests.assert_eq((select string_agg(ra.role_code, ',') from platform.role_assignments ra
                           join platform.tenant_memberships m on m.tenant_id = ra.tenant_id and m.id = ra.membership_id
                           where m.user_id = '00000000-0000-4000-8000-0000000000f2' and m.status = 'active'),
    'tenant_admin', 'an ACTIVE member with the Organization Admin role only');
end $$;
select pg_temp.become_super_admin();
do $$
declare
  f record;
begin
  select * into f from pg_temp.flow();
  perform tests.assert_eq((select row(admin_state, member_count, admin_invitation_locale)::text
                           from private.platform_list_tenants() where tenant_id = f.tenant_id),
    row('active', 1, null::text)::text, 'the list: the Organization Admin is active');
  perform tests.assert_fails(format('select * from private.platform_reissue_admin_code(%L)', f.tenant_id), array['JP003'],
    'no new code once the invitation is accepted');
  perform tests.assert_fails(format('select * from private.platform_admin_invitation_code(%L)', f.tenant_id), array['JP003'],
    'nothing to copy once the invitation is accepted');
end $$;
rollback;

-- ---------------------------------------------------------------------------------------------------
-- A revoked Super Admin's pending invitation stops working (as an inviter who lost the role, review M1)
-- ---------------------------------------------------------------------------------------------------
begin;
select pg_temp.become_super_admin();
select set_config('tests.flow', to_jsonb(x)::text, true)
from private.platform_create_tenant('revoked-issuer', 'منشأة', null, 'x@revoked.test', null, null, null, null, 'en') x;
select pg_temp.become_owner();
do $$
declare
  f record;
begin
  select * into f from pg_temp.flow();
  perform tests.assert_eq((select display_name_ar || '|' || display_name_en from platform.persons p
                           join platform.invitations i on i.person_id = p.id where i.id = f.invitation_id),
    'مدير المنشأة|Organization Admin', 'no names given: the neutral name');
  perform tests.assert_eq((select state from private.invitation_link(tests.token_hash(f.invite_code))), 'valid', 'valid');
  perform private.revoke_platform_admin('00000000-0000-4000-8000-0000000000f1');
  perform tests.assert_eq((select state from private.invitation_link(tests.token_hash(f.invite_code))), 'invalid',
    'the issuer is no Super Admin any more: the link stops working');
  perform private.grant_platform_admin('00000000-0000-4000-8000-0000000000f1');
  -- A tenant member cannot turn an ordinary invitation into a console one, nor issue console invitations:
  -- only platform_admin_guard writes private.platform_invitations.
  perform tests.assert_eq((select state from private.invitation_link(tests.token_hash(f.invite_code))), 'valid',
    'granted again: valid again');
end $$;
rollback;

-- An ordinary invitation keeps the inviter rule (an Organization Admin of the organization): a Super Admin
-- as inviter of an invitation that the console did not create gives nothing.
begin;
do $$
declare
  v_person uuid;
  v_invitation uuid;
begin
  insert into platform.persons (tenant_id, display_name_ar, email)
  values ('b0000000-0000-4000-8000-000000000001', 'مدعو', 'forged@b.test') returning id into v_person;
  insert into platform.invitations (tenant_id, person_id, email, locale, primary_role, invited_by)
  values ('b0000000-0000-4000-8000-000000000001', v_person, 'forged@b.test', 'en', 'tenant_admin',
          '00000000-0000-4000-8000-0000000000f1') returning id into v_invitation;
  update platform.invitations set token_hash = tests.token_hash('forged-token') where id = v_invitation;
  perform tests.assert_eq((select state from private.invitation_link(tests.token_hash('forged-token'))), 'invalid',
    'a Super Admin is not an inviter of an organization (only console invitations follow the platform rule)');
end $$;
rollback;

\echo '95_platform_admin_owner: ok'
