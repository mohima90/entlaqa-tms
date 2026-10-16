-- Post-deployment checks for a hosted environment (scripts/db-deploy.sh apply). Read-only; rolled back.
-- A subset of supabase/tests/10_catalog.sql that needs no test fixtures (ADR 0002 Verification 1, §3, §5–§7).
-- Schemas checked: platform, private and the module schemas listed in `module_schemas` below — add each
-- new module schema there (core_hr, payroll, …).
\set ON_ERROR_STOP on
begin;

do $$
declare
  module_schemas constant text[] := array['platform', 'private', 'tms'];
  -- Roles that must never reach tenant data or the hook directly. service_role bypasses RLS.
  outsiders constant text[] := array['anon', 'service_role'];
  -- Global (non-tenant) reference tables: RLS enabled + forced, read-only for authenticated, no
  -- tenant_isolation policy. Same allow-list as tests.global_tables() (security review required).
  global_tables constant text[] := array['platform.ref_roles', 'platform.file_purposes'];
  hook constant text := 'private.custom_access_token_hook(jsonb)';
  signup_hook constant text := 'private.before_user_created_hook(jsonb)';
  r record;
  v_role text;
  failures text[] := '{}';
begin
  -- 1. Login roles: exact attributes and memberships (ADR 0002 §5, §7).
  for r in
    select rolname, rolcanlogin, rolinherit, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication
    from pg_roles where rolname in ('app_server', 'app_worker', 'app_queue', 'tenant_guard', 'invitation_guard',
                                    'account_mail_guard', 'membership_guard', 'rate_limit_guard', 'file_guard',
                                    'user_import_guard', 'platform_admin_guard')
  loop
    if r.rolname in ('app_server', 'app_worker', 'app_queue') and not r.rolcanlogin then
      failures := failures || format('%s must be LOGIN', r.rolname);
    end if;
    if r.rolname in ('tenant_guard', 'invitation_guard', 'account_mail_guard', 'membership_guard', 'rate_limit_guard',
                     'file_guard', 'user_import_guard', 'platform_admin_guard')
       and r.rolcanlogin then
      failures := failures || format('%s must be NOLOGIN', r.rolname);
    end if;
    if r.rolinherit or r.rolsuper or r.rolbypassrls or r.rolcreaterole or r.rolcreatedb or r.rolreplication then
      failures := failures || format('%s must be NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION', r.rolname);
    end if;
  end loop;
  if (select count(*) from pg_roles
      where rolname in ('app_server', 'app_worker', 'app_queue', 'tenant_guard', 'invitation_guard',
                        'account_mail_guard', 'membership_guard', 'rate_limit_guard', 'file_guard',
                        'user_import_guard', 'platform_admin_guard')) <> 11 then
    failures := failures || 'roles app_server, app_worker, app_queue, tenant_guard, invitation_guard, account_mail_guard, membership_guard, rate_limit_guard, file_guard, user_import_guard and platform_admin_guard must all exist'::text;
  end if;
  -- The job runner (ADR 0005 §2): member of nothing (never authenticated), owner of graphile_worker.
  if exists (select 1 from pg_auth_members m join pg_roles u on u.oid = m.member where u.rolname = 'app_queue') then
    failures := failures || 'app_queue must not be a member of any role'::text;
  end if;
  if (select pg_get_userbyid(nspowner) from pg_namespace where nspname = 'graphile_worker') is distinct from 'app_queue' then
    failures := failures || 'schema graphile_worker must exist and be owned by app_queue'::text;
  end if;
  -- No CREATE on the database (it could add schemas named after other roles and capture their
  -- unqualified names), and nothing owned outside graphile_worker: none of its code can run in other
  -- roles' transactions.
  if exists (select 1 from pg_roles where rolname = 'app_queue')
     and has_database_privilege('app_queue', current_database(), 'CREATE') then
    failures := failures || 'app_queue must have no CREATE privilege on the database'::text;
  end if;
  if exists (
    select 1 from pg_namespace n
    where n.nspowner = (select oid from pg_roles where rolname = 'app_queue') and n.nspname <> 'graphile_worker'
    union all
    -- pg_toast: the out-of-line storage of graphile_worker's own tables (owned with them; no code).
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relowner = (select oid from pg_roles where rolname = 'app_queue')
      and n.nspname not in ('graphile_worker', 'pg_toast')
    union all
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.proowner = (select oid from pg_roles where rolname = 'app_queue') and n.nspname <> 'graphile_worker'
  ) then
    failures := failures || 'app_queue must own nothing outside schema graphile_worker'::text;
  end if;
  -- Table or column privileges only on the outbox (read; update of dispatched_at).
  if exists (select 1 from pg_roles where rolname = 'app_queue') and exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p', 'v', 'm', 'f') and n.nspname = any (module_schemas)
      and c.oid <> 'platform.event_outbox'::regclass
      and (has_table_privilege('app_queue', c.oid, 'select, insert, update, delete, truncate, references, trigger')
           or has_any_column_privilege('app_queue', c.oid, 'select, insert, update, references'))
  ) then
    failures := failures || 'app_queue must have privileges on platform.event_outbox only'::text;
  end if;
  foreach v_role in array array['app_server', 'app_worker'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      -- Direct memberships must be exactly {authenticated} (distinct: PostgreSQL 16+ keeps one row per grantor).
      if (select coalesce(array_agg(distinct g.rolname::text order by g.rolname::text), '{}')
          from pg_auth_members m
          join pg_roles g on g.oid = m.roleid
          join pg_roles u on u.oid = m.member
          where u.rolname = v_role) <> array['authenticated'] then
        failures := failures || format('%s must be a member of authenticated only', v_role);
      end if;
      -- PostgreSQL 16+: inheritance is per membership grant, not only the role's NOINHERIT default.
      if exists (select 1 from pg_auth_members m join pg_roles u on u.oid = m.member
                 where u.rolname = v_role and m.inherit_option) then
        failures := failures || format('%s: every membership must be granted WITH INHERIT FALSE', v_role);
      end if;
    end if;
  end loop;

  -- Session check (ADR 0002 §6a rev. 2): tenant_guard reads auth.sessions only through the view
  -- private.auth_session_validity, owned by the migration role; nobody else may read the view.
  if to_regclass('private.auth_session_validity') is null then
    failures := failures || 'private.auth_session_validity is missing'::text;
  else
    v_role := (select pg_get_userbyid(relowner) from pg_class where oid = 'private.auth_session_validity'::regclass);
    if not (has_schema_privilege(v_role, 'auth', 'usage')
            and has_column_privilege(v_role, 'auth.sessions', 'id', 'select')
            and has_column_privilege(v_role, 'auth.sessions', 'user_id', 'select')
            and has_column_privilege(v_role, 'auth.sessions', 'not_after', 'select')
            and has_column_privilege(v_role, 'auth.sessions', 'created_at', 'select')
            and has_column_privilege(v_role, 'auth.sessions', 'updated_at', 'select')
            and has_column_privilege(v_role, 'auth.sessions', 'user_agent', 'select')
            and has_column_privilege(v_role, 'auth.sessions', 'aal', 'select')
            and has_column_privilege(v_role, 'auth.sessions', 'factor_id', 'select')
            and has_table_privilege(v_role, 'auth.sessions', 'delete')) then
      failures := failures || format('%s (owner of private.auth_session_validity) must read auth.sessions (id, user_id, not_after, created_at, updated_at, user_agent, aal, factor_id) and delete from it (T-M2-10, review M1)', v_role);
    end if;
    if (select string_agg(a.attname, ',' order by a.attnum) from pg_attribute a
        where a.attrelid = 'private.auth_session_validity'::regclass and a.attnum > 0 and not a.attisdropped)
       <> 'id,user_id,not_after,created_at,updated_at,user_agent,aal,factor_id' then
      failures := failures || 'private.auth_session_validity must expose exactly id, user_id, not_after, created_at, updated_at, user_agent, aal, factor_id (never a token)'::text;
    end if;
    -- Exact ACL: tenant_guard may only SELECT and DELETE (end a session, T-M2-10 review M1); nobody else
    -- (besides the owner) holds any privilege, at table or column level. The view is a plain projection,
    -- i.e. auto-updatable: write privileges on it reach auth.sessions with the owner's rights.
    for r in
      select distinct
        case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee,
        a.privilege_type
      from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
      where c.oid = 'private.auth_session_validity'::regclass and a.grantee <> c.relowner
        and not (a.grantee <> 0 and pg_get_userbyid(a.grantee) = 'tenant_guard' and a.privilege_type in ('SELECT', 'DELETE'))
      union
      select distinct
        case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
        a.privilege_type || ' (column ' || att.attname || ')'
      from pg_attribute att, aclexplode(att.attacl) a
      where att.attrelid = 'private.auth_session_validity'::regclass and att.attacl is not null
    loop
      failures := failures || format('%s must not have %s on private.auth_session_validity', r.grantee, r.privilege_type);
    end loop;
  end if;

  -- MFA policy (T-M2-10): tenant_guard reads Auth factors only through private.auth_mfa_factor, owned by the
  -- migration role (never the secret), and deletes through it (removal, resets); rate_limit_guard reads three
  -- of its columns (whether a signing-in user has an app, T-M2-11); nobody else may use it.
  if to_regclass('private.auth_mfa_factor') is null then
    failures := failures || 'private.auth_mfa_factor is missing'::text;
  else
    v_role := (select pg_get_userbyid(relowner) from pg_class where oid = 'private.auth_mfa_factor'::regclass);
    if not (has_schema_privilege(v_role, 'auth', 'usage')
            and has_column_privilege(v_role, 'auth.mfa_factors', 'user_id', 'select')
            and has_column_privilege(v_role, 'auth.mfa_factors', 'factor_type', 'select')
            and has_column_privilege(v_role, 'auth.mfa_factors', 'status', 'select')
            and has_table_privilege(v_role, 'auth.mfa_factors', 'delete')
            and has_table_privilege(v_role, 'auth.mfa_factors', 'references')) then
      failures := failures || format('%s (owner of private.auth_mfa_factor) must read, delete from and reference auth.mfa_factors', v_role);
    end if;
    if (select string_agg(a.attname, ',' order by a.attnum) from pg_attribute a
        where a.attrelid = 'private.auth_mfa_factor'::regclass and a.attnum > 0 and not a.attisdropped)
       <> 'id,user_id,factor_type,status,created_at,updated_at' then
      failures := failures || 'private.auth_mfa_factor must expose exactly id, user_id, factor_type, status, created_at, updated_at (never the secret)'::text;
    end if;
    for r in
      select distinct
        case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee,
        a.privilege_type
      from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
      where c.oid = 'private.auth_mfa_factor'::regclass and a.grantee <> c.relowner
        and not (a.grantee <> 0 and pg_get_userbyid(a.grantee) = 'tenant_guard' and a.privilege_type in ('SELECT', 'DELETE'))
      union
      select distinct
        case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
        a.privilege_type || ' (column ' || att.attname || ')'
      from pg_attribute att, aclexplode(att.attacl) a
      where att.attrelid = 'private.auth_mfa_factor'::regclass and att.attacl is not null
        -- rate_limit_guard: whether a signing-in user has an app (T-M2-11 integration review L4).
        and not (a.grantee <> 0 and pg_get_userbyid(a.grantee) = 'rate_limit_guard' and a.privilege_type = 'SELECT'
                 and att.attname in ('user_id', 'factor_type', 'status'))
    loop
      failures := failures || format('%s must not have %s on private.auth_mfa_factor', r.grantee, r.privilege_type);
    end loop;
  end if;
  -- Ended sessions, the MFA prompt answers, the confirmed apps and the wrong set-up codes (T-M2-10):
  -- tenant_guard alone.
  for r in
    select o.obj from (values ('private.revoked_sessions'), ('private.mfa_prompt_dismissals'),
                              ('private.mfa_factor_confirmations'), ('private.mfa_setup_code_failures')) as o(obj)
  loop
    if to_regclass(r.obj) is null then
      failures := failures || format('%s is missing', r.obj);
      continue;
    end if;
    for v_role in
      select distinct case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end
      from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
      where c.oid = to_regclass(r.obj) and a.grantee <> c.relowner
        and not (a.grantee <> 0 and pg_get_userbyid(a.grantee) = 'tenant_guard'
                 and a.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE'))
      union
      select distinct case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end
      from pg_attribute att, aclexplode(att.attacl) a
      where att.attrelid = to_regclass(r.obj) and att.attacl is not null
    loop
      failures := failures || format('%s must have no privilege on %s', v_role, r.obj);
    end loop;
  end loop;
  -- Security notices held for an account's digest (T-M2-10, final re-review L1): account_mail_guard alone.
  if to_regclass('private.security_notice_digests') is null then
    failures := failures || 'private.security_notice_digests is missing'::text;
  else
    for v_role in
      select distinct case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end
      from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
      where c.oid = 'private.security_notice_digests'::regclass and a.grantee <> c.relowner
        and not (a.grantee <> 0 and pg_get_userbyid(a.grantee) = 'account_mail_guard'
                 and a.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE'))
    loop
      failures := failures || format('%s must have no privilege on private.security_notice_digests', v_role);
    end loop;
  end if;

  -- Invitation acceptance (FR-IAM-03): invitation_guard reads Auth users only through the view
  -- private.auth_user_email, owned by the migration role; nobody else may read the view.
  if to_regclass('private.auth_user_email') is null then
    failures := failures || 'private.auth_user_email is missing'::text;
  else
    v_role := (select pg_get_userbyid(relowner) from pg_class where oid = 'private.auth_user_email'::regclass);
    if not (has_schema_privilege(v_role, 'auth', 'usage')
            and has_column_privilege(v_role, 'auth.users', 'id', 'select')
            and has_column_privilege(v_role, 'auth.users', 'email', 'select')) then
      failures := failures || format('%s (owner of private.auth_user_email) must read auth.users (id, email)', v_role);
    end if;
    for r in
      select distinct
        case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee,
        a.privilege_type
      from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
      where c.oid = 'private.auth_user_email'::regclass and a.grantee <> c.relowner
        -- Readers: invitation_guard (FR-IAM-03) and rate_limit_guard (Organization Admin unlock, T-M2-11).
        and not (a.grantee <> 0 and pg_get_userbyid(a.grantee) in ('invitation_guard', 'rate_limit_guard')
                 and a.privilege_type = 'SELECT')
      union
      select distinct
        case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
        a.privilege_type || ' (column ' || att.attname || ')'
      from pg_attribute att, aclexplode(att.attacl) a
      where att.attrelid = 'private.auth_user_email'::regclass and att.attacl is not null
    loop
      failures := failures || format('%s must not have %s on private.auth_user_email', r.grantee, r.privilege_type);
    end loop;
  end if;

  -- Invitation codes (20261018090000, FR-IAM-03): the request path neither reads nor writes a code and
  -- writes no token hash (the code functions apply the rules of managing each invitation).
  if exists (select 1 from pg_attribute where attrelid = 'platform.invitations'::regclass and attname = 'invite_code'
                                          and not attisdropped)
     and (has_column_privilege('authenticated', 'platform.invitations', 'invite_code', 'select')
          or has_column_privilege('authenticated', 'platform.invitations', 'invite_code', 'update')
          or has_column_privilege('authenticated', 'platform.invitations', 'token_hash', 'select')
          or has_column_privilege('authenticated', 'platform.invitations', 'token_hash', 'update')) then
    failures := failures || 'authenticated must neither read nor write platform.invitations invite_code / token_hash'::text;
  end if;

  -- The SECURITY DEFINER helpers: owned by tenant_guard or invitation_guard, search_path = '', and
  -- executable only by the roles that need them (exact ACL, not a deny-list). The list is complete: any
  -- other SECURITY DEFINER function in `private` fails the check.
  for r in
    select h.fn, h.owner, h.allowed, h.definer, p.oid as poid, p.proowner, p.prosecdef, p.proconfig, p.proacl
    from (values
      ('private.user_session_is_valid(uuid, uuid)', 'tenant_guard', array['tenant_guard', 'invitation_guard', 'platform_admin_guard'], true),
      ('private.has_active_membership(uuid, uuid)', 'tenant_guard', array['tenant_guard', 'rate_limit_guard'], true),
      ('private.current_tenant_id()',               'tenant_guard', array['tenant_guard', 'authenticated', 'account_mail_guard', 'membership_guard', 'rate_limit_guard', 'file_guard', 'invitation_guard', 'platform_admin_guard'], true),
      ('private.switch_active_tenant(uuid)',        'tenant_guard', array['tenant_guard', 'authenticated'], true),
      ('private.session_tenants()',                 'tenant_guard', array['tenant_guard', 'authenticated'], true),
      ('private.discard_inactive_tenant_delivery(uuid)', 'tenant_guard', array['tenant_guard', 'authenticated'], true),
      ('private.invitation_by_token(bytea)',        'invitation_guard', array['invitation_guard', 'authenticated'], true),
      ('private.accept_invitation_as_caller(bytea, text, text)', 'invitation_guard', array['invitation_guard', 'authenticated'], true),
      -- The sign-up gate's yes/no check (review H1): Auth's hook only.
      ('private.invitation_allows_signup(text, text)', 'invitation_guard', array['invitation_guard', 'supabase_auth_admin'], true),
      -- The acceptance effects: SECURITY INVOKER, called only by accept_invitation_as_caller.
      ('private.apply_invitation_acceptance(bytea, uuid, text, text)', 'invitation_guard',
       array['invitation_guard'], false),
      -- Invitation codes (20261018090000, FR-IAM-03): issue and read for members who may manage the
      -- invitation (app_server user claims, checked inside); the mailer's read (app_worker system claims).
      ('private.issue_invitation_code(uuid)', 'invitation_guard', array['invitation_guard', 'authenticated'], true),
      ('private.invitation_codes(uuid[])', 'invitation_guard', array['invitation_guard', 'authenticated'], true),
      ('private.invitation_code_for_mail(uuid)', 'invitation_guard', array['invitation_guard', 'authenticated'], true),
      -- Their caller check: SECURITY INVOKER, called by them only.
      ('private.invitation_code_caller()', 'invitation_guard', array['invitation_guard'], false),
      -- A link's state (the one definition of "valid"): SECURITY INVOKER, called by the definer functions.
      ('private.invitation_link(bytea)', 'invitation_guard', array['invitation_guard'], false),
      -- Does the inviter still hold the authority (review M1): SECURITY INVOKER, same callers.
      ('private.invitation_inviter_may_grant(uuid, uuid, text[])', 'invitation_guard',
       array['invitation_guard'], false),
      -- Platform Super Admin console (20261018100000, FR-ADM-17): the inviter rule of a link and of acceptance
      -- (console invitations: their issuer must still be a Super Admin) and the shared code-writing step.
      ('private.invitation_issuer_may_grant(uuid, uuid, uuid, text[])', 'invitation_guard', array['invitation_guard'], false),
      ('private.write_invitation_code(uuid)', 'invitation_guard', array['invitation_guard', 'platform_admin_guard'], false),
      -- The console (app_server user claims of a Super Admin, checked inside), the workflow's grant and revoke
      -- (the migration role only), what invitation_guard asks about console invitations, and the helpers.
      ('private.is_platform_admin()', 'platform_admin_guard', array['platform_admin_guard', 'authenticated'], true),
      ('private.platform_list_tenants()', 'platform_admin_guard', array['platform_admin_guard', 'authenticated'], true),
      ('private.platform_create_tenant(text, text, text, text, text, text, text, text, text)', 'platform_admin_guard',
       array['platform_admin_guard', 'authenticated'], true),
      ('private.platform_admin_invitation_code(uuid)', 'platform_admin_guard', array['platform_admin_guard', 'authenticated'], true),
      ('private.platform_reissue_admin_code(uuid)', 'platform_admin_guard', array['platform_admin_guard', 'authenticated'], true),
      ('private.grant_platform_admin(uuid)', 'platform_admin_guard', array['platform_admin_guard', current_user::text], true),
      ('private.revoke_platform_admin(uuid)', 'platform_admin_guard', array['platform_admin_guard', current_user::text], true),
      ('private.platform_admin_is_active(uuid)', 'platform_admin_guard', array['platform_admin_guard', 'invitation_guard'], true),
      ('private.is_platform_invitation(uuid)', 'platform_admin_guard', array['platform_admin_guard', 'invitation_guard'], true),
      ('private.platform_admin_caller()', 'platform_admin_guard', array['platform_admin_guard'], false),
      ('private.platform_pending_admin_invitation(uuid)', 'platform_admin_guard', array['platform_admin_guard'], false),
      ('private.platform_reserved_slug(text)', 'platform_admin_guard', array['platform_admin_guard'], false),
      -- Account e-mails (T-M2-17): the web app queues requests (app_server, checked inside), the worker
      -- answers them (app_worker system claims, checked inside).
      ('private.request_password_reset_mail(text)', 'account_mail_guard', array['account_mail_guard', 'authenticated'], true),
      ('private.request_password_changed_mail(uuid)', 'account_mail_guard', array['account_mail_guard', 'authenticated'], true),
      ('private.claim_account_mail_request()', 'account_mail_guard', array['account_mail_guard', 'authenticated'], true),
      ('private.finish_account_mail_request(uuid)', 'account_mail_guard', array['account_mail_guard', 'authenticated'], true),
      ('private.retry_account_mail_request(uuid)', 'account_mail_guard', array['account_mail_guard', 'authenticated'], true),
      -- Deactivation / reactivation (T-M2-09): the session-ending trigger (the privileged-deactivation
      -- step-up trigger was dropped by 20261017090400, PO decision 14 Oct 2026), the checked reactivation (app_server user claims, checked inside) and the sign-in refusal rule of the
      -- access-token hook (Auth only).
      ('private.end_member_sessions()', 'membership_guard', array['membership_guard'], true),
      -- With T-M2-10 (20261012120000): the statement trigger that ends the Auth sessions of logins left
      -- without an active membership (residual N2).
      ('private.end_unserved_logins()', 'membership_guard', array['membership_guard'], true),
      ('private.reactivate_membership(uuid)', 'membership_guard', array['membership_guard', 'authenticated'], true),
      ('private.account_sign_in_refused(uuid)', 'membership_guard', array['membership_guard', 'supabase_auth_admin'], true),
      -- Security policy, MFA and sign-in sessions (T-M2-10): the decision is tenant_guard's own; the web app
      -- calls the others (app_server, checked inside).
      ('private.session_access(uuid, uuid, uuid, boolean, boolean)', 'tenant_guard', array['tenant_guard'], true),
      ('private.session_access_state()',            'tenant_guard', array['tenant_guard', 'authenticated'], true),
      -- rate_limit_guard: a remembered browser after the sign-in code (20261013090000); membership_guard no
      -- longer (its authenticator-code rule was removed by 20261017090400).
      ('private.request_aal2()',                    'tenant_guard', array['tenant_guard', 'authenticated', 'rate_limit_guard'], true),
      ('private.request_code_fresh()',              'tenant_guard', array['tenant_guard', 'authenticated', 'rate_limit_guard'], true),
      ('private.request_session_facts()',           'tenant_guard', array['tenant_guard', 'authenticated'], true),
      ('private.dismiss_mfa_prompt()',              'tenant_guard', array['tenant_guard', 'authenticated'], true),
      ('private.tenant_member_mfa(uuid)',           'tenant_guard', array['tenant_guard', 'authenticated'], true),
      ('private.password_min_length_for_caller()',  'tenant_guard', array['tenant_guard', 'authenticated'], true),
      ('private.tenant_lockout_policy(uuid)',       'tenant_guard', array['tenant_guard', 'authenticated'], true),
      ('private.invitation_password_min_length(bytea)', 'invitation_guard', array['invitation_guard', 'authenticated'], true),
      ('private.touch_session()',                   'tenant_guard', array['tenant_guard', 'authenticated'], true),
      ('private.my_sessions()',                     'tenant_guard', array['tenant_guard', 'authenticated'], true),
      ('private.end_my_sessions(uuid)',             'tenant_guard', array['tenant_guard', 'authenticated'], true),
      ('private.tenant_member_sessions(uuid)',      'tenant_guard', array['tenant_guard', 'authenticated'], true),
      ('private.end_member_sessions(uuid, uuid)',   'tenant_guard', array['tenant_guard', 'authenticated'], true),
      ('private.apply_device_limit()',              'tenant_guard', array['tenant_guard', 'authenticated'], true),
      ('private.purge_ended_sessions(integer)',     'tenant_guard', array['tenant_guard', 'authenticated'], true),
      -- Internal helpers of tenant_guard's functions only.
      ('private.audit_account_event(uuid, text, jsonb, text, uuid, uuid)', 'tenant_guard', array['tenant_guard'], true),
      ('private.end_sessions(uuid, uuid[], uuid, text, uuid)', 'tenant_guard', array['tenant_guard'], true),
      ('private.enforce_device_limit(uuid, uuid, uuid)', 'tenant_guard', array['tenant_guard'], true),
      ('private.queue_mfa_mail(text, uuid, uuid, text, uuid)', 'tenant_guard', array['tenant_guard'], true),
      ('private.remove_account_factors(uuid, uuid[])', 'tenant_guard', array['tenant_guard'], true),
      ('private.end_all_account_sessions(uuid, uuid, uuid)', 'tenant_guard', array['tenant_guard'], true),
      -- A deactivation ends the login's Auth sessions when it belongs nowhere any more (T-M2-09 residual N2,
      -- 20261012120000): the session-ending trigger (membership_guard) only.
      ('private.end_unserved_login_sessions(uuid, uuid, uuid)', 'tenant_guard', array['tenant_guard', 'membership_guard'], true),
      ('private.request_live_user()',               'tenant_guard', array['tenant_guard'], true),
      ('private.security_policy_changed_mail()',    'tenant_guard', array['tenant_guard'], true),
      -- Authenticator apps (T-M2-10, review H1/M2, re-review N1/N2): web app and worker (checked inside).
      ('private.request_mfa_factor_mail(uuid)',     'tenant_guard', array['tenant_guard', 'authenticated'], true),
      ('private.confirm_mfa_setup(uuid, text)',     'tenant_guard', array['tenant_guard', 'authenticated'], true),
      ('private.my_mfa_apps()',                     'tenant_guard', array['tenant_guard', 'authenticated'], true),
      ('private.remove_mfa_app(uuid)',              'tenant_guard', array['tenant_guard', 'authenticated'], true),
      ('private.issue_mfa_factor_tokens(uuid, uuid, bytea, bytea)', 'tenant_guard', array['tenant_guard', 'authenticated'], true),
      ('private.account_has_app(uuid)',             'tenant_guard', array['tenant_guard', 'authenticated'], true),
      ('private.reject_mfa_factor(bytea)',          'tenant_guard', array['tenant_guard', 'authenticated'], true),
      ('private.purge_unconfirmed_mfa_apps(integer)', 'tenant_guard', array['tenant_guard', 'authenticated'], true),
      ('private.reset_member_mfa(uuid)',            'tenant_guard', array['tenant_guard', 'authenticated'], true),
      -- ENTLAQA support's reset: the migration role (operators) only — never the request path.
      ('private.reset_account_mfa(uuid, text)',     'tenant_guard', array['tenant_guard', current_user::text], true),
      -- The lockout e-mail request (T-M2-11): the web app (app_server, checked inside); the unlock notice:
      -- the Organization Admin's unlock only (its owner rate_limit_guard).
      ('private.request_account_locked_mail(text, integer)', 'account_mail_guard', array['account_mail_guard', 'authenticated'], true),
      ('private.request_sign_in_unlocked_mail(uuid)', 'account_mail_guard', array['account_mail_guard', 'rate_limit_guard'], true),
      -- The "wrong codes after your password" notice (T-M2-11 integration review M1): the web app.
      ('private.request_mfa_code_locked_mail(uuid, integer)', 'account_mail_guard', array['account_mail_guard', 'authenticated'], true),
      -- Shared rate limiter and sign-in protection (ADR 0011 §4, T-M2-11): the web app counts, clears and
      -- checks sign-ins (app_server, checked inside); the Organization Admin functions also check the
      -- claims; the helpers and the key rotation are the owner's own.
      ('private.rate_limit_hit(text, bytea, integer, integer)', 'rate_limit_guard', array['rate_limit_guard', 'authenticated'], true),
      ('private.rate_limit_clear(text, bytea)', 'rate_limit_guard', array['rate_limit_guard', 'authenticated'], true),
      ('private.rate_limit_give_back(text, bytea)', 'rate_limit_guard', array['rate_limit_guard', 'authenticated'], true),
      ('private.sign_in_account_in_tenant(text, uuid)', 'rate_limit_guard', array['rate_limit_guard', 'authenticated'], true),
      ('private.rate_limit_sign_in_check(bytea, bytea, bytea, integer, integer, integer, integer, integer, integer, integer, integer)',
       'rate_limit_guard', array['rate_limit_guard', 'authenticated'], true),
      ('private.rate_limit_sign_in_succeeded(bytea, bytea, bytea, bytea, boolean, boolean, integer, uuid, bytea, boolean, integer)', 'rate_limit_guard',
       array['rate_limit_guard', 'authenticated'], true),
      ('private.rate_limit_sign_in_not_checked(bytea, bytea, boolean)', 'rate_limit_guard', array['rate_limit_guard', 'authenticated'], true),
      ('private.rate_limit_sign_in_reset(bytea, bytea, bytea, integer)', 'rate_limit_guard', array['rate_limit_guard', 'authenticated'], true),
      ('private.rate_limit_forget_other_devices(bytea, bytea)', 'rate_limit_guard', array['rate_limit_guard', 'authenticated'], true),
      -- «تذكّر هذا المتصفح» after the sign-in code (integration review L4).
      ('private.rate_limit_trust_after_code(bytea, bytea, integer)', 'rate_limit_guard', array['rate_limit_guard', 'authenticated'], true),
      ('private.member_sign_in_lock(uuid, integer)', 'rate_limit_guard', array['rate_limit_guard', 'authenticated'], true),
      ('private.unlock_member_sign_in(uuid, integer)', 'rate_limit_guard', array['rate_limit_guard', 'authenticated'], true),
      ('private.rotate_rate_limit_keys()', 'rate_limit_guard', array['rate_limit_guard'], true),
      ('private.rate_limit_generate_keys()', 'rate_limit_guard', array['rate_limit_guard'], false),
      ('private.rate_limit_key(bytea)', 'rate_limit_guard', array['rate_limit_guard'], false),
      ('private.rate_limit_ref(bytea)', 'rate_limit_guard', array['rate_limit_guard'], false),
      ('private.rate_limit_check_call(text, bytea)', 'rate_limit_guard', array['rate_limit_guard'], false),
      ('private.rate_limit_count(text, bytea, integer, integer, boolean)', 'rate_limit_guard', array['rate_limit_guard'], false),
      ('private.rate_limit_refund(text, bytea)', 'rate_limit_guard', array['rate_limit_guard'], false),
      ('private.rate_limit_purge()', 'rate_limit_guard', array['rate_limit_guard'], false),
      ('private.rate_limit_normalize_email(text)', 'rate_limit_guard', array['rate_limit_guard'], false),
      ('private.rate_limit_account_subject(text)', 'rate_limit_guard', array['rate_limit_guard'], false),
      ('private.rate_limit_lock_account_devices(bytea)', 'rate_limit_guard', array['rate_limit_guard'], false),
      ('private.rate_limit_choose_device(bytea)', 'rate_limit_guard', array['rate_limit_guard'], false),
      ('private.rate_limit_trust_device(bytea, bytea, integer)', 'rate_limit_guard', array['rate_limit_guard'], false),
      ('private.rate_limit_member_account(uuid)', 'rate_limit_guard', array['rate_limit_guard'], false),
      ('private.rate_limit_session_subject(uuid)', 'rate_limit_guard', array['rate_limit_guard'], false),
      -- Files (T-M2-18, ADR 0006). Storage's user claims: the storage.objects policies (authenticated) and
      -- file_guard's checks. The file functions are called as authenticated by the web app, Storage's
      -- policies and the worker; each checks the login role and the claims itself. Three helpers run
      -- inside them only.
      ('private.storage_request_tenant()', 'tenant_guard', array['tenant_guard', 'authenticated', 'file_guard'], true),
      ('private.create_file_upload(text, text, text, uuid, text, text, bigint)', 'file_guard', array['file_guard', 'authenticated'], true),
      ('private.confirm_file_upload(uuid)', 'file_guard', array['file_guard', 'authenticated'], true),
      ('private.grant_file_download(uuid, text, text, text, uuid)', 'file_guard', array['file_guard', 'authenticated'], true),
      ('private.delete_file(uuid)', 'file_guard', array['file_guard', 'authenticated'], true),
      ('private.mark_file_used(uuid)', 'file_guard', array['file_guard', 'authenticated'], true),
      ('private.can_upload_object(text, text)', 'file_guard', array['file_guard', 'authenticated'], true),
      ('private.can_read_object(text, text)', 'file_guard', array['file_guard', 'authenticated'], true),
      ('private.claim_file_scan()', 'file_guard', array['file_guard', 'authenticated'], true),
      ('private.finish_file_scan(uuid, text, text, bigint, text, text, text, text, text)', 'file_guard', array['file_guard', 'authenticated'], true),
      ('private.retry_file_scan(uuid, text)', 'file_guard', array['file_guard', 'authenticated'], true),
      ('private.claim_file_housekeeping(integer)', 'file_guard', array['file_guard', 'authenticated'], true),
      ('private.lock_file_housekeeping(uuid, text)', 'file_guard', array['file_guard', 'authenticated'], true),
      ('private.finish_file_housekeeping(uuid, text)', 'file_guard', array['file_guard', 'authenticated'], true),
      ('private.claim_orphan_objects(integer)', 'file_guard', array['file_guard', 'authenticated'], true),
      ('private.create_generated_file(text, text, text, uuid, text, text, bigint, uuid)', 'file_guard', array['file_guard', 'authenticated'], true),
      ('private.finish_generated_file(uuid, bigint, text)', 'file_guard', array['file_guard', 'authenticated'], true),
      ('private.file_user_tenant()', 'file_guard', array['file_guard'], false),
      ('private.file_for_actor(uuid)', 'file_guard', array['file_guard'], false),
      ('private.file_worker_check()', 'file_guard', array['file_guard'], false),
      ('private.file_housekeeping_action(platform.files)', 'file_guard', array['file_guard'], false),
      -- User imports (T-M2-12): the worker's claim across organizations (app_worker system claims, checked
      -- inside; ids, step and lease only) and its check.
      ('private.claim_user_import_work()', 'user_import_guard', array['user_import_guard', 'authenticated'], true),
      ('private.user_import_worker_check()', 'user_import_guard', array['user_import_guard'], false),
      -- The platform-wide send clock of import invitations (security review M2): app_worker system claims.
      ('private.take_invitation_send_slot(interval)', 'user_import_guard', array['user_import_guard', 'authenticated'], true)
    ) as h(fn, owner, allowed, definer)
    left join pg_proc p on p.oid = to_regprocedure(h.fn)
  loop
    if r.poid is null then
      failures := failures || format('%s is missing', r.fn);
      continue;
    end if;
    if pg_get_userbyid(r.proowner) <> r.owner then
      failures := failures || format('%s must be owned by %s (is %s)', r.fn, r.owner, pg_get_userbyid(r.proowner));
    end if;
    if r.prosecdef <> r.definer or not coalesce('search_path=""' = any (r.proconfig) or 'search_path=' = any (r.proconfig), false) then
      failures := failures || format('%s must be %s with an empty search_path', r.fn,
                                     case when r.definer then 'SECURITY DEFINER' else 'SECURITY INVOKER' end);
    end if;
    for v_role in
      select distinct case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end
      from aclexplode(coalesce(r.proacl, acldefault('f', r.proowner))) a
      where a.privilege_type = 'EXECUTE'
    loop
      if not (v_role = any (r.allowed)) then
        failures := failures || format('%s must not execute %s', v_role, r.fn);
      end if;
    end loop;
  end loop;

  for r in
    select p.oid::regprocedure as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = any (module_schemas) and p.prosecdef
      and p.oid::regprocedure::text not in (
        'private.user_session_is_valid(uuid,uuid)', 'private.has_active_membership(uuid,uuid)',
        'private.current_tenant_id()', 'private.switch_active_tenant(uuid)', 'private.session_tenants()',
        'private.discard_inactive_tenant_delivery(uuid)', 'private.invitation_by_token(bytea)',
        'private.accept_invitation_as_caller(bytea,text,text)', 'private.invitation_allows_signup(text,text)',
        'private.issue_invitation_code(uuid)', 'private.invitation_codes(uuid[])',
        'private.invitation_code_for_mail(uuid)',
        -- Platform Super Admin console (FR-ADM-17)
        'private.is_platform_admin()', 'private.platform_list_tenants()',
        'private.platform_create_tenant(text,text,text,text,text,text,text,text,text)',
        'private.platform_admin_invitation_code(uuid)', 'private.platform_reissue_admin_code(uuid)',
        'private.grant_platform_admin(uuid)', 'private.revoke_platform_admin(uuid)',
        'private.platform_admin_is_active(uuid)', 'private.is_platform_invitation(uuid)',
        'private.request_password_reset_mail(text)', 'private.request_password_changed_mail(uuid)',
        'private.claim_account_mail_request()', 'private.finish_account_mail_request(uuid)',
        'private.retry_account_mail_request(uuid)', 'private.end_member_sessions()',
        'private.reactivate_membership(uuid)',
        'private.end_unserved_logins()',
        'private.account_sign_in_refused(uuid)',
        'private.session_access(uuid,uuid,uuid,boolean,boolean)', 'private.session_access_state()',
        'private.dismiss_mfa_prompt()', 'private.tenant_member_mfa(uuid)', 'private.password_min_length_for_caller()',
        'private.tenant_lockout_policy(uuid)', 'private.invitation_password_min_length(bytea)',
        'private.touch_session()', 'private.my_sessions()', 'private.end_my_sessions(uuid)',
        'private.tenant_member_sessions(uuid)', 'private.end_member_sessions(uuid,uuid)',
        'private.request_aal2()', 'private.request_code_fresh()', 'private.request_session_facts()',
        'private.apply_device_limit()',
        'private.purge_ended_sessions(integer)', 'private.audit_account_event(uuid,text,jsonb,text,uuid,uuid)',
        'private.end_sessions(uuid,uuid[],uuid,text,uuid)', 'private.enforce_device_limit(uuid,uuid,uuid)',
        'private.queue_mfa_mail(text,uuid,uuid,text,uuid)', 'private.remove_account_factors(uuid,uuid[])',
        'private.end_all_account_sessions(uuid,uuid,uuid)', 'private.request_live_user()',
        'private.end_unserved_login_sessions(uuid,uuid,uuid)',
        'private.security_policy_changed_mail()',
        'private.request_mfa_factor_mail(uuid)', 'private.confirm_mfa_setup(uuid,text)', 'private.my_mfa_apps()',
        'private.remove_mfa_app(uuid)', 'private.issue_mfa_factor_tokens(uuid,uuid,bytea,bytea)',
        'private.account_has_app(uuid)', 'private.reject_mfa_factor(bytea)',
        'private.purge_unconfirmed_mfa_apps(integer)', 'private.reset_member_mfa(uuid)',
        'private.reset_account_mfa(uuid,text)',
        'private.request_account_locked_mail(text,integer)',
        'private.request_sign_in_unlocked_mail(uuid)', 'private.request_mfa_code_locked_mail(uuid,integer)',
        'private.rate_limit_hit(text,bytea,integer,integer)', 'private.rate_limit_clear(text,bytea)',
        'private.rate_limit_give_back(text,bytea)', 'private.sign_in_account_in_tenant(text,uuid)',
        'private.rate_limit_sign_in_check(bytea,bytea,bytea,integer,integer,integer,integer,integer,integer,integer,integer)',
        'private.rate_limit_sign_in_succeeded(bytea,bytea,bytea,bytea,boolean,boolean,integer,uuid,bytea,boolean,integer)',
        'private.rate_limit_sign_in_not_checked(bytea,bytea,boolean)',
        'private.rate_limit_sign_in_reset(bytea,bytea,bytea,integer)', 'private.rate_limit_forget_other_devices(bytea,bytea)',
        'private.rate_limit_trust_after_code(bytea,bytea,integer)',
        'private.member_sign_in_lock(uuid,integer)', 'private.unlock_member_sign_in(uuid,integer)',
        'private.rotate_rate_limit_keys()',
        -- Files (T-M2-18)
        'private.storage_request_tenant()', 'private.create_file_upload(text,text,text,uuid,text,text,bigint)',
        'private.confirm_file_upload(uuid)', 'private.grant_file_download(uuid,text,text,text,uuid)', 'private.delete_file(uuid)',
        'private.mark_file_used(uuid)', 'private.can_upload_object(text,text)', 'private.can_read_object(text,text)',
        'private.claim_file_scan()', 'private.finish_file_scan(uuid,text,text,bigint,text,text,text,text,text)',
        'private.retry_file_scan(uuid,text)', 'private.claim_file_housekeeping(integer)',
        'private.lock_file_housekeeping(uuid,text)', 'private.finish_file_housekeeping(uuid,text)',
        'private.claim_orphan_objects(integer)',
        'private.create_generated_file(text,text,text,uuid,text,text,bigint,uuid)',
        'private.finish_generated_file(uuid,bigint,text)',
        -- User imports (T-M2-12)
        'private.claim_user_import_work()', 'private.take_invitation_send_slot(interval)')
  loop
    failures := failures || format('%s: unexpected SECURITY DEFINER function (security review)', r.fn);
  end loop;

  -- invitation_guard: the same rules as tenant_guard below.
  if exists (select 1 from pg_roles where rolname = 'invitation_guard') then
    for r in select nspname from pg_namespace where nspname = any (module_schemas) loop
      if has_schema_privilege('invitation_guard', r.nspname, 'create') then
        failures := failures || format('invitation_guard must not have CREATE on schema %s', r.nspname);
      end if;
    end loop;
    for r in
      select distinct u.rolname from pg_auth_members m
      join pg_roles g on g.oid = m.roleid join pg_roles u on u.oid = m.member
      where g.rolname = 'invitation_guard' and (m.inherit_option or m.set_option)
        and not u.rolsuper and u.rolname <> current_user
    loop
      failures := failures || format('%s must not be a member of invitation_guard', r.rolname);
    end loop;
  end if;

  -- platform_admin_guard (FR-ADM-17): the same rules; it owns no relation, and the Super Admin tables
  -- (private.platform_admins, platform_invitations, platform_audit_events) are reachable by it alone.
  if exists (select 1 from pg_roles where rolname = 'platform_admin_guard') then
    for r in select nspname from pg_namespace where nspname = any (module_schemas) loop
      if has_schema_privilege('platform_admin_guard', r.nspname, 'create') then
        failures := failures || format('platform_admin_guard must not have CREATE on schema %s', r.nspname);
      end if;
    end loop;
    if exists (select 1 from pg_class c where c.relowner = (select oid from pg_roles where rolname = 'platform_admin_guard')) then
      failures := failures || 'platform_admin_guard must own no relations'::text;
    end if;
    for r in
      select distinct u.rolname from pg_auth_members m
      join pg_roles g on g.oid = m.roleid join pg_roles u on u.oid = m.member
      where g.rolname = 'platform_admin_guard' and (m.inherit_option or m.set_option)
        and not u.rolsuper and u.rolname <> current_user
    loop
      failures := failures || format('%s must not be a member of platform_admin_guard', r.rolname);
    end loop;
    for r in
      select distinct c.oid::regclass::text as t,
             case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee
      from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
      where c.oid in (to_regclass('private.platform_admins'), to_regclass('private.platform_invitations'),
                      to_regclass('private.platform_audit_events'))
        and a.grantee <> c.relowner
        and not (a.grantee <> 0 and pg_get_userbyid(a.grantee) = 'platform_admin_guard')
      union
      select distinct att.attrelid::regclass::text,
             case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end
      from pg_attribute att, aclexplode(att.attacl) a
      where att.attrelid in (to_regclass('private.platform_admins'), to_regclass('private.platform_invitations'),
                             to_regclass('private.platform_audit_events'))
        and att.attacl is not null and not (a.grantee <> 0 and pg_get_userbyid(a.grantee) = 'platform_admin_guard')
    loop
      failures := failures || format('%s must have no privilege on %s (FR-ADM-17)', r.grantee, r.t);
    end loop;
    if to_regclass('private.platform_admins') is null or to_regclass('private.platform_audit_events') is null then
      failures := failures || 'private.platform_admins and private.platform_audit_events must exist (FR-ADM-17)'::text;
    end if;
  end if;

  -- account_mail_guard (T-M2-17): creates nothing, nobody acts as it; it reads Auth accounts only through
  -- private.auth_account (owned by the migration role, SELECT for account_mail_guard only), and the request
  -- queue private.account_mail_requests is reachable by account_mail_guard — and by tenant_guard for the
  -- authenticator notices (T-M2-10; its policy limits it to those kinds: SELECT, INSERT, DELETE).
  if exists (select 1 from pg_roles where rolname = 'account_mail_guard') then
    for r in select nspname from pg_namespace where nspname = any (module_schemas) loop
      if has_schema_privilege('account_mail_guard', r.nspname, 'create') then
        failures := failures || format('account_mail_guard must not have CREATE on schema %s', r.nspname);
      end if;
    end loop;
    for r in
      select distinct u.rolname from pg_auth_members m
      join pg_roles g on g.oid = m.roleid join pg_roles u on u.oid = m.member
      where g.rolname = 'account_mail_guard' and (m.inherit_option or m.set_option)
        and not u.rolsuper and u.rolname <> current_user
    loop
      failures := failures || format('%s must not be a member of account_mail_guard', r.rolname);
    end loop;
  end if;
  -- membership_guard (T-M2-09): the same rules; it reads Auth accounts only through
  -- private.auth_account_email (id and e-mail).
  if exists (select 1 from pg_roles where rolname = 'membership_guard') then
    for r in select nspname from pg_namespace where nspname = any (module_schemas) loop
      if has_schema_privilege('membership_guard', r.nspname, 'create') then
        failures := failures || format('membership_guard must not have CREATE on schema %s', r.nspname);
      end if;
    end loop;
    for r in
      select distinct u.rolname from pg_auth_members m
      join pg_roles g on g.oid = m.roleid join pg_roles u on u.oid = m.member
      where g.rolname = 'membership_guard' and (m.inherit_option or m.set_option)
        and not u.rolsuper and u.rolname <> current_user
    loop
      failures := failures || format('%s must not be a member of membership_guard', r.rolname);
    end loop;
  end if;
  for r in
    select o.obj, o.reader
    from (values ('private.auth_account', 'account_mail_guard'), ('private.account_mail_requests', 'account_mail_guard'),
                 ('private.auth_account_email', 'membership_guard'),
                 ('private.invitation_send_clock', 'user_import_guard')) as o(obj, reader)
  loop
    if to_regclass(r.obj) is null then
      failures := failures || format('%s is missing', r.obj);
      continue;
    end if;
    for v_role in
      select distinct case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end
      from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
      where c.oid = to_regclass(r.obj) and a.grantee <> c.relowner
        and not (a.grantee <> 0 and pg_get_userbyid(a.grantee) = r.reader
                 and (a.privilege_type = 'SELECT' or (r.obj = 'private.account_mail_requests'
                                                     and a.privilege_type in ('INSERT', 'UPDATE', 'DELETE'))))
        and not (a.grantee <> 0 and pg_get_userbyid(a.grantee) = 'tenant_guard'
                 and r.obj = 'private.account_mail_requests' and a.privilege_type in ('SELECT', 'INSERT', 'DELETE'))
      union
      select distinct case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end
      from pg_attribute att, aclexplode(att.attacl) a
      where att.attrelid = to_regclass(r.obj) and att.attacl is not null
        -- The send clock's reader has column privileges (listed exactly in the user_import_guard block).
        and not (r.obj = 'private.invitation_send_clock' and a.grantee <> 0 and pg_get_userbyid(a.grantee) = r.reader)
    loop
      failures := failures || format('%s must have no privilege on %s', v_role, r.obj);
    end loop;
  end loop;
  if to_regclass('private.auth_account') is not null then
    v_role := (select pg_get_userbyid(relowner) from pg_class where oid = 'private.auth_account'::regclass);
    if not (has_schema_privilege(v_role, 'auth', 'usage')
            and has_column_privilege(v_role, 'auth.users', 'email', 'select')
            and has_column_privilege(v_role, 'auth.users', 'banned_until', 'select')
            and has_column_privilege(v_role, 'auth.users', 'recovery_sent_at', 'select')
            and has_column_privilege(v_role, 'auth.users', 'recovery_token', 'select')) then
      failures := failures || format('%s (owner of private.auth_account) must read auth.users', v_role);
    end if;
    -- Exactly these columns: whether a recovery token waits, never the token itself.
    if (select string_agg(a.attname, ',' order by a.attnum) from pg_attribute a
        where a.attrelid = 'private.auth_account'::regclass and a.attnum > 0 and not a.attisdropped)
       <> 'id,email,banned_until,recovery_sent_at,recovery_pending,is_sso_user,deleted_at' then
      failures := failures || 'private.auth_account must expose exactly id, email, banned_until, recovery_sent_at, recovery_pending, is_sso_user, deleted_at'::text;
    end if;
  end if;
  if to_regclass('private.auth_account_email') is not null then
    v_role := (select pg_get_userbyid(relowner) from pg_class where oid = 'private.auth_account_email'::regclass);
    if not (has_schema_privilege(v_role, 'auth', 'usage')
            and has_column_privilege(v_role, 'auth.users', 'email', 'select')) then
      failures := failures || format('%s (owner of private.auth_account_email) must read auth.users', v_role);
    end if;
    if (select string_agg(a.attname, ',' order by a.attnum) from pg_attribute a
        where a.attrelid = 'private.auth_account_email'::regclass and a.attnum > 0 and not a.attisdropped)
       <> 'id,email' then
      failures := failures || 'private.auth_account_email must expose exactly id, email'::text;
    end if;
  end if;
  -- Deactivation (T-M2-09): the trigger that ends a member's sessions in the organization exists and is
  -- enabled — and (T-M2-10 integration) the one that ends the Auth sessions of a login left without an
  -- active membership. (No authenticator-code trigger since 20261017090400, PO decision 14 Oct 2026.)
  for r in
    select t.tbl, t.name, t.fn
    from (values ('platform.tenant_memberships', 'tenant_memberships_end_sessions', 'private.end_member_sessions()'),
                 ('platform.tenant_memberships', 'tenant_memberships_end_login_sessions',
                  'private.end_unserved_logins()')) as t(tbl, name, fn)
  loop
    if not exists (select 1 from pg_trigger g where g.tgrelid = to_regclass(r.tbl) and g.tgname = r.name
                   and g.tgenabled in ('O', 'A') and g.tgfoid = to_regprocedure(r.fn)) then
      failures := failures || format('trigger %s on %s (T-M2-09) is missing, disabled or altered', r.name, r.tbl);
    end if;
  end loop;
  -- membership_guard's table access is exactly what its triggers, the reactivation and the sign-in rule
  -- read or change (T-M2-09, review I3): column SELECT grants, UPDATE (status) on memberships, DELETE on
  -- session contexts, SELECT on the e-mail view — nothing else, and no other table-level privilege.
  if exists (select 1 from pg_roles where rolname = 'membership_guard') then
    for r in
      select x.tbl, string_agg(x.priv, ',' order by x.priv) as privs
      from (
        select c.oid::regclass::text as tbl, a.privilege_type || '(' || att.attname || ')' as priv
        from pg_class c
        join pg_attribute att on att.attrelid = c.oid and att.attnum > 0 and not att.attisdropped
        cross join lateral aclexplode(att.attacl) a
        where a.grantee = (select oid from pg_roles where rolname = 'membership_guard')
          and c.relnamespace in ('platform'::regnamespace, 'private'::regnamespace)
        union all
        select c.oid::regclass::text, a.privilege_type
        from pg_class c
        cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
        where a.grantee = (select oid from pg_roles where rolname = 'membership_guard')
          and c.relnamespace in ('platform'::regnamespace, 'private'::regnamespace)
      ) x
      group by x.tbl
    loop
      if r.privs is distinct from (case r.tbl
           when 'platform.tenant_memberships'
             then 'SELECT(id),SELECT(person_id),SELECT(status),SELECT(tenant_id),SELECT(user_id),UPDATE(status)'
           when 'platform.session_context' then 'DELETE,SELECT(active_tenant_id),SELECT(session_id),SELECT(user_id)'
           when 'platform.role_assignments'
             then 'SELECT(membership_id),SELECT(role_code),SELECT(tenant_id),SELECT(valid_from),SELECT(valid_until)'
           when 'platform.ref_roles' then 'SELECT(code),SELECT(is_privileged)'
           when 'platform.persons' then 'SELECT(id),SELECT(status),SELECT(tenant_id)'
           when 'platform.tenants' then 'SELECT(id),SELECT(status)'
           -- mail_held: a held invitation (T-M2-12, not sent yet) does not let a login sign in.
           when 'platform.invitations' then 'SELECT(email),SELECT(expires_at),SELECT(mail_held),SELECT(status),SELECT(tenant_id)'
           when 'private.auth_account_email' then 'SELECT'
         end) then
        failures := failures || format('membership_guard on %s: %s (T-M2-09: unexpected privileges)', r.tbl, r.privs);
      end if;
    end loop;
  end if;
  -- The access-token hook asks the sign-in rule (T-M2-09): a hook that no longer calls it would issue
  -- tokens to logins that belong nowhere any more; without EXECUTE for Auth nobody could sign in (the hook
  -- fails closed).
  if to_regprocedure('private.account_sign_in_refused(uuid)') is null
     or not has_function_privilege('supabase_auth_admin', 'private.account_sign_in_refused(uuid)', 'execute') then
    failures := failures || 'supabase_auth_admin must execute private.account_sign_in_refused (T-M2-09: every sign-in asks it)'::text;
  end if;
  if to_regprocedure(hook) is not null
     and position('private.account_sign_in_refused(' in (select prosrc from pg_proc where oid = to_regprocedure(hook))) = 0 then
    failures := failures || format('%s must refuse tokens through private.account_sign_in_refused (T-M2-09)', hook);
  end if;
  -- account_mail_guard on our deliveries (security re-verification): SELECT on exactly (tenant_id,
  -- recipient_person_id, template, created_at) — never the address or the content (html_body holds live
  -- reset links while queued) — and no table-level SELECT, no writes.
  if to_regclass('platform.message_deliveries') is not null
     and exists (select 1 from pg_roles where rolname = 'account_mail_guard') then
    if (select coalesce(string_agg(a.attname, ',' order by a.attname::text collate "C"), '')
        from pg_attribute a
        where a.attrelid = 'platform.message_deliveries'::regclass and a.attnum > 0 and not a.attisdropped
          and has_column_privilege('account_mail_guard', a.attrelid, a.attnum, 'select'))
       <> 'created_at,recipient_person_id,template,tenant_id' then
      failures := failures || 'account_mail_guard must read exactly (tenant_id, recipient_person_id, template, created_at) of platform.message_deliveries'::text;
    end if;
    for r in
      select c.col from unnest(array['destination', 'subject', 'html_body', 'text_body']) as c(col)
      where has_column_privilege('account_mail_guard', 'platform.message_deliveries', c.col, 'select, insert, update, references')
    loop
      failures := failures || format('account_mail_guard must have no privilege on platform.message_deliveries.%s', r.col);
    end loop;
    if has_table_privilege('account_mail_guard', 'platform.message_deliveries',
                           'select, insert, update, delete, truncate, references, trigger')
       or has_any_column_privilege('account_mail_guard', 'platform.message_deliveries', 'insert, update, references') then
      failures := failures || 'account_mail_guard must have no table-level SELECT and no write on platform.message_deliveries'::text;
    end if;
  end if;

  -- rate_limit_guard (T-M2-11): creates nothing, nobody acts as it; the limiter's keys
  -- (private.rate_limit_secret: SELECT, UPDATE for rotation), counters (private.rate_limit_counters) and
  -- trusted browsers (private.sign_in_trusted_devices: SELECT, INSERT, UPDATE, DELETE) are reachable by
  -- rate_limit_guard alone, with row level security forced (section 2).
  if exists (select 1 from pg_roles where rolname = 'rate_limit_guard') then
    for r in select nspname from pg_namespace where nspname = any (module_schemas) loop
      if has_schema_privilege('rate_limit_guard', r.nspname, 'create') then
        failures := failures || format('rate_limit_guard must not have CREATE on schema %s', r.nspname);
      end if;
    end loop;
    for r in
      select distinct u.rolname from pg_auth_members m
      join pg_roles g on g.oid = m.roleid join pg_roles u on u.oid = m.member
      where g.rolname = 'rate_limit_guard' and (m.inherit_option or m.set_option)
        and not u.rolsuper and u.rolname <> current_user
    loop
      failures := failures || format('%s must not be a member of rate_limit_guard', r.rolname);
    end loop;
  end if;
  for r in
    select o.obj from (values ('private.rate_limit_secret'), ('private.rate_limit_counters'),
                              ('private.sign_in_trusted_devices')) as o(obj)
  loop
    if to_regclass(r.obj) is null then
      failures := failures || format('%s is missing', r.obj);
      continue;
    end if;
    for v_role in
      select distinct case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end
      from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
      where c.oid = to_regclass(r.obj) and a.grantee <> c.relowner
        and not (a.grantee <> 0 and pg_get_userbyid(a.grantee) = 'rate_limit_guard'
                 and (a.privilege_type = 'SELECT'
                      or (r.obj = 'private.rate_limit_secret' and a.privilege_type = 'UPDATE')
                      or (r.obj in ('private.rate_limit_counters', 'private.sign_in_trusted_devices')
                          and a.privilege_type in ('INSERT', 'UPDATE', 'DELETE'))))
      union
      select distinct case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end
      from pg_attribute att, aclexplode(att.attacl) a
      where att.attrelid = to_regclass(r.obj) and att.attacl is not null
    loop
      failures := failures || format('%s must have no privilege on %s', v_role, r.obj);
    end loop;
  end loop;
  if to_regclass('private.rate_limit_secret') is not null
     and (select count(*) from private.rate_limit_secret) <> 1 then
    failures := failures || 'private.rate_limit_secret must hold exactly one key'::text;
  end if;

  -- user_import_guard (T-M2-12): creates nothing, owns no relation, nobody acts as it; it reads the
  -- imports' lifecycle columns, their file's status, the organizations' status and due held invitations,
  -- and writes the lease and the send clock only (column privileges; no table-wide privilege anywhere).
  -- The send clock (private.invitation_send_clock, security review M2) is reachable by it alone.
  if exists (select 1 from pg_roles where rolname = 'user_import_guard') then
    for r in select nspname from pg_namespace where nspname = any (module_schemas) loop
      if has_schema_privilege('user_import_guard', r.nspname, 'create') then
        failures := failures || format('user_import_guard must not have CREATE on schema %s', r.nspname);
      end if;
    end loop;
    if exists (select 1 from pg_class c where c.relowner = (select oid from pg_roles where rolname = 'user_import_guard')) then
      failures := failures || 'user_import_guard must own no relations'::text;
    end if;
    for r in
      select distinct u.rolname from pg_auth_members m
      join pg_roles g on g.oid = m.roleid join pg_roles u on u.oid = m.member
      where g.rolname = 'user_import_guard' and (m.inherit_option or m.set_option)
        and not u.rolsuper and u.rolname <> current_user
    loop
      failures := failures || format('%s must not be a member of user_import_guard', r.rolname);
    end loop;
    for r in
      select c.oid::regclass::text as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p', 'v', 'm', 'f') and n.nspname = any (module_schemas)
        and has_table_privilege('user_import_guard', c.oid, 'select, insert, update, delete, truncate, references, trigger')
    loop
      failures := failures || format('user_import_guard must have no table-wide privilege on %s', r.t);
    end loop;
    for r in
      select format('%s.%s %s', c.oid::regclass, a.attname, x.privilege_type) as p
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      cross join lateral aclexplode(a.attacl) x
      where n.nspname = any (module_schemas) and x.grantee = (select oid from pg_roles where rolname = 'user_import_guard')
        and not ((c.oid::regclass::text, a.attname::text, x.privilege_type) in (
                   ('platform.files', 'id', 'SELECT'), ('platform.files', 'tenant_id', 'SELECT'),
                   ('platform.files', 'status', 'SELECT'),
                   ('platform.tenants', 'id', 'SELECT'), ('platform.tenants', 'status', 'SELECT'),
                   ('platform.invitations', 'tenant_id', 'SELECT'), ('platform.invitations', 'import_id', 'SELECT'),
                   ('platform.invitations', 'status', 'SELECT'), ('platform.invitations', 'mail_held', 'SELECT'),
                   ('platform.invitations', 'send_at', 'SELECT'),
                   ('platform.user_imports', 'lease_until', 'UPDATE'), ('platform.user_imports', 'lease_token', 'UPDATE'),
                   ('private.invitation_send_clock', 'id', 'SELECT'), ('private.invitation_send_clock', 'next_slot', 'SELECT'),
                   ('private.invitation_send_clock', 'next_slot', 'UPDATE'))
                 or (c.oid = 'platform.user_imports'::regclass and x.privilege_type = 'SELECT'
                     and a.attname in ('id', 'tenant_id', 'file_id', 'status', 'review_expires_at', 'finished_at',
                                       'undone_at', 'confirmed_at', 'data_purged_at', 'lease_until', 'lease_token',
                                       'next_attempt_at', 'updated_at', 'created_at', 'upload_due_at')))
    loop
      failures := failures || format('user_import_guard: unexpected privilege %s (T-M2-12)', r.p);
    end loop;
  end if;

  -- Files (T-M2-18, ADR 0006). file_guard: the same attributes as the other guard roles; it creates
  -- nothing and nobody acts as it; it reads storage.objects only through the view
  -- private.storage_object_facts (owned by the migration role, which must bypass RLS on storage.objects;
  -- SELECT for file_guard only).
  if not exists (select 1 from pg_roles where rolname = 'file_guard') then
    failures := failures || 'role file_guard must exist'::text;
  else
    if exists (select 1 from pg_roles where rolname = 'file_guard'
               and (rolcanlogin or rolinherit or rolsuper or rolbypassrls or rolcreaterole or rolcreatedb or rolreplication)) then
      failures := failures || 'file_guard must be NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION'::text;
    end if;
    for r in select nspname from pg_namespace where nspname = any (module_schemas) loop
      if has_schema_privilege('file_guard', r.nspname, 'create') then
        failures := failures || format('file_guard must not have CREATE on schema %s', r.nspname);
      end if;
    end loop;
    for r in
      select distinct u.rolname from pg_auth_members m
      join pg_roles g on g.oid = m.roleid join pg_roles u on u.oid = m.member
      where g.rolname = 'file_guard' and (m.inherit_option or m.set_option)
        and not u.rolsuper and u.rolname <> current_user
    loop
      failures := failures || format('%s must not be a member of file_guard', r.rolname);
    end loop;
    if to_regclass('storage.objects') is not null and has_table_privilege('file_guard', 'storage.objects', 'select') then
      failures := failures || 'file_guard must read storage.objects only through private.storage_object_facts'::text;
    end if;
  end if;
  if to_regclass('private.storage_object_facts') is null then
    failures := failures || 'private.storage_object_facts is missing'::text;
  else
    v_role := (select pg_get_userbyid(relowner) from pg_class where oid = 'private.storage_object_facts'::regclass);
    if not (has_schema_privilege(v_role, 'storage', 'usage')
            and has_column_privilege(v_role, 'storage.objects', 'bucket_id', 'select')
            and has_column_privilege(v_role, 'storage.objects', 'name', 'select')
            and has_column_privilege(v_role, 'storage.objects', 'metadata', 'select')
            and exists (select 1 from pg_roles where rolname = v_role and (rolsuper or rolbypassrls))) then
      failures := failures || format('%s (owner of private.storage_object_facts) must read storage.objects and bypass its RLS', v_role);
    end if;
    for r in
      select distinct
        case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee, a.privilege_type
      from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
      where c.oid = 'private.storage_object_facts'::regclass and a.grantee <> c.relowner
        and not (a.grantee <> 0 and pg_get_userbyid(a.grantee) = 'file_guard' and a.privilege_type = 'SELECT')
      union
      select distinct case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
        a.privilege_type || ' (column ' || att.attname || ')'
      from pg_attribute att, aclexplode(att.attacl) a
      where att.attrelid = 'private.storage_object_facts'::regclass and att.attacl is not null
    loop
      failures := failures || format('%s must not have %s on private.storage_object_facts', r.grantee, r.privilege_type);
    end loop;
  end if;
  -- The file tables' policies (T-M2-18, re-review L-C): the permissive policies of platform.files and
  -- platform.file_download_grants are exactly ours; the `using (true)` guard policies (files_guard,
  -- file_download_grants_guard) — and every policy naming file_guard anywhere — apply to file_guard ALONE:
  -- one widened to authenticated would open every file of the organization.
  for r in
    select c.relname, p.polname, p.polcmd,
           array(select g.rolname::text from pg_roles g where g.oid = any (p.polroles) order by 1) as roles,
           coalesce(pg_get_expr(p.polqual, p.polrelid), '') as qual,
           coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') as chk
    from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'platform' and c.relname in ('files', 'file_download_grants') and p.polpermissive
  loop
    if not ((r.relname = 'files' and r.polname = 'files_guard' and r.polcmd = '*'
               and r.roles = array['file_guard'] and r.qual = 'true' and r.chk = 'true')
            or (r.relname = 'files' and r.polname = 'files_read' and r.polcmd = 'r'
                and r.roles = array['authenticated'] and r.qual like '%private.request_user_id()%'
                and r.qual not like '%true%')
            -- T-M2-12: the import worker's claim reads a file's tenant and status (column privileges id,
            -- tenant_id, status only — checked in the user_import_guard block), for user_import_guard alone.
            or (r.relname = 'files' and r.polname = 'files_user_import_guard_read' and r.polcmd = 'r'
                and r.roles = array['user_import_guard'] and r.qual = 'true' and r.chk = '')
            or (r.relname = 'file_download_grants' and r.polname = 'file_download_grants_guard' and r.polcmd = '*'
                and r.roles = array['file_guard'] and r.qual = 'true' and r.chk = 'true')
            or (r.relname = 'file_download_grants' and r.polname = 'file_download_grants_read' and r.polcmd = 'r'
                and r.roles = array['authenticated']
                and r.qual = '(user_id = ( SELECT private.request_user_id() AS request_user_id))')) then
      failures := failures || format('platform.%s: unexpected or altered permissive policy %s (security review)',
                                     r.relname, r.polname);
    end if;
  end loop;
  if (select count(*) from pg_policy p
      where (p.polrelid = 'platform.files'::regclass and p.polname = 'files_guard')
         or (p.polrelid = 'platform.file_download_grants'::regclass and p.polname = 'file_download_grants_guard')) <> 2 then
    failures := failures || 'the file tables'' guard policies (files_guard, file_download_grants_guard) are missing'::text;
  end if;
  if exists (select 1 from pg_roles where rolname = 'file_guard') then
    for r in
      select p.polrelid::regclass::text as t, p.polname from pg_policy p
      where 'file_guard'::regrole::oid = any (p.polroles)
        and p.polroles <> array['file_guard'::regrole::oid]
    loop
      failures := failures || format('%s: policy %s applies to file_guard and other roles (security review)', r.t, r.polname);
    end loop;
  end if;

  -- Storage (ADR 0006 §1, §4): our six buckets exist and NO bucket is public; storage.objects carries our
  -- three policies exactly, and every other policy on it is restrictive (a dashboard "allow all" policy
  -- would widen what the files service grants).
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    failures := failures || 'Supabase Storage (storage.buckets, storage.objects) is missing'::text;
  else
    if (select count(*) from storage.buckets
        where id in ('materials', 'images', 'evidence', 'imports', 'generated', 'quarantine')) <> 6 then
      failures := failures || 'the storage buckets materials, images, evidence, imports, generated and quarantine must exist'::text;
    end if;
    for r in select b.id from storage.buckets b where b.public loop
      failures := failures || format('storage bucket %s must be private', r.id);
    end loop;
    if not exists (select 1 from pg_policy p where p.polrelid = 'storage.objects'::regclass
                   and p.polname = 'jadarat_tenant_prefix' and not p.polpermissive and p.polcmd = '*'
                   and p.polroles = array[(select oid from pg_roles where rolname = 'authenticated')]::oid[]
                   and pg_get_expr(p.polqual, p.polrelid)
                       = '(split_part(name, ''/''::text, 1) = (( SELECT private.storage_request_tenant() AS storage_request_tenant))::text)'
                   and pg_get_expr(p.polwithcheck, p.polrelid) = pg_get_expr(p.polqual, p.polrelid)) then
      failures := failures || 'storage.objects: RESTRICTIVE policy jadarat_tenant_prefix (ALL, authenticated) missing or altered'::text;
    end if;
    if not exists (select 1 from pg_policy p where p.polrelid = 'storage.objects'::regclass
                   and p.polname = 'jadarat_files_upload' and p.polpermissive and p.polcmd = 'a'
                   and p.polroles = array[(select oid from pg_roles where rolname = 'authenticated')]::oid[]
                   and pg_get_expr(p.polwithcheck, p.polrelid) = 'private.can_upload_object(bucket_id, name)') then
      failures := failures || 'storage.objects: policy jadarat_files_upload (INSERT, authenticated) missing or altered'::text;
    end if;
    if not exists (select 1 from pg_policy p where p.polrelid = 'storage.objects'::regclass
                   and p.polname = 'jadarat_files_read' and p.polpermissive and p.polcmd = 'r'
                   and p.polroles = array[(select oid from pg_roles where rolname = 'authenticated')]::oid[]
                   and pg_get_expr(p.polqual, p.polrelid) = 'private.can_read_object(bucket_id, name)') then
      failures := failures || 'storage.objects: policy jadarat_files_read (SELECT, authenticated) missing or altered'::text;
    end if;
    for r in select p.polname from pg_policy p
             where p.polrelid = 'storage.objects'::regclass and p.polpermissive
               and p.polname not in ('jadarat_files_upload', 'jadarat_files_read') loop
      failures := failures || format('storage.objects: unexpected permissive policy %s (security review)', r.polname);
    end loop;
  end if;

  -- tenant_guard creates nothing (CREATE on `private` is granted only while ownership is handed over,
  -- migration 120100) and nobody else acts as it.
  if exists (select 1 from pg_roles where rolname = 'tenant_guard') then
    for r in select nspname from pg_namespace where nspname = any (module_schemas) loop
      if has_schema_privilege('tenant_guard', r.nspname, 'create') then
        failures := failures || format('tenant_guard must not have CREATE on schema %s', r.nspname);
      end if;
    end loop;
    -- Nobody may act as tenant_guard (inherit its privileges or SET ROLE to it) except the deploying role
    -- and superusers: a member such as authenticated would receive the `to tenant_guard` policies
    -- (cross-tenant reads). ADMIN-only rows (e.g. the one PostgreSQL 16+ adds for the role's creator) do not
    -- let the member act as the role.
    for r in
      select distinct u.rolname from pg_auth_members m
      join pg_roles g on g.oid = m.roleid join pg_roles u on u.oid = m.member
      where g.rolname = 'tenant_guard' and (m.inherit_option or m.set_option)
        and not u.rolsuper and u.rolname <> current_user
    loop
      failures := failures || format('%s must not be a member of tenant_guard', r.rolname);
    end loop;
  end if;

  -- 2. Every table: RLS enabled AND forced; no privileges for outsider roles.
  for r in
    select c.oid::regclass as t, n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and n.nspname = any (module_schemas)
  loop
    if not (r.relrowsecurity and r.relforcerowsecurity) then
      failures := failures || format('%s: row level security must be ENABLED and FORCED', r.t);
    end if;
    foreach v_role in array outsiders loop
      if exists (select 1 from pg_roles where rolname = v_role)
         and has_table_privilege(v_role, r.t, 'select, insert, update, delete, truncate, references, trigger') then
        failures := failures || format('%s: %s must have no privileges', r.t, v_role);
      end if;
    end loop;
    -- 3. Tenant tables (all tables in platform/module schemas except global_tables): RESTRICTIVE
    --    tenant_isolation for ALL commands, to authenticated only, whose USING and WITH CHECK are EXACTLY
    --    `<tenant column> = (select private.current_tenant_id())` (normalized; same rule as 10_catalog.sql,
    --    so `… or true` fails).
    if r.t::text = any (global_tables) then
      if has_table_privilege('authenticated', r.t, 'insert, update, delete, truncate, references, trigger')
         or has_any_column_privilege('authenticated', r.t, 'insert, update, references')
         or exists (select 1 from pg_policy p where p.polrelid = r.t and p.polcmd <> 'r') then
        failures := failures || format('%s: global table must be read-only for authenticated (grants and policies)', r.t);
      end if;
    elsif r.nspname <> 'private' and not exists (
      select 1 from pg_policy p
      where p.polrelid = r.t and p.polname = 'tenant_isolation' and not p.polpermissive and p.polcmd = '*'
        and p.polroles = array[(select oid from pg_roles where rolname = 'authenticated')]::oid[]
        and pg_get_expr(p.polqual, p.polrelid) = format('(%I = ( SELECT private.current_tenant_id() AS current_tenant_id))',
              case when r.nspname = 'platform' and r.relname = 'tenants' then 'id'
                   when r.nspname = 'platform' and r.relname = 'session_context' then 'active_tenant_id'
                   else 'tenant_id' end)
        and pg_get_expr(p.polwithcheck, p.polrelid) = pg_get_expr(p.polqual, p.polrelid)
    ) then
      failures := failures || format('%s: RESTRICTIVE tenant_isolation policy (ALL, authenticated) missing or altered', r.t);
    end if;
  end loop;

  -- 4. No outsider access to our schemas.
  for r in select nspname from pg_namespace where nspname = any (module_schemas) loop
    foreach v_role in array outsiders loop
      if exists (select 1 from pg_roles where rolname = v_role) and has_schema_privilege(v_role, r.nspname, 'usage') then
        failures := failures || format('schema %s: %s must not have USAGE', r.nspname, v_role);
      end if;
    end loop;
  end loop;

  -- 5. Custom Access Token Hook: present; executable by supabase_auth_admin and nobody else (ADR 0002 §3).
  if to_regprocedure(hook) is null then
    failures := failures || format('%s is missing', hook);
  else
    if not has_schema_privilege('supabase_auth_admin', 'private', 'usage')
       or not has_function_privilege('supabase_auth_admin', hook, 'execute') then
      failures := failures || 'supabase_auth_admin must have USAGE on private and EXECUTE on the access token hook'::text;
    end if;
    foreach v_role in array array['anon', 'authenticated', 'service_role', 'app_server', 'app_worker', 'authenticator'] loop
      if exists (select 1 from pg_roles where rolname = v_role) and has_function_privilege(v_role, hook, 'execute') then
        failures := failures || format('%s must not execute the access token hook', v_role);
      end if;
    end loop;
  end if;

  -- 5b. Before-user-created hook (sign-up gate, FR-IAM-03, review H1): present, SECURITY INVOKER with an
  --     empty search_path, executable by supabase_auth_admin and nobody else (exact ACL besides the owner).
  --     Auth's hook setting itself lives outside the database: the staging uptime check probes it.
  if to_regprocedure(signup_hook) is null then
    failures := failures || format('%s is missing', signup_hook);
  else
    if not has_function_privilege('supabase_auth_admin', signup_hook, 'execute')
       or not has_function_privilege('supabase_auth_admin', 'private.invitation_allows_signup(text, text)', 'execute') then
      failures := failures || 'supabase_auth_admin must have EXECUTE on the sign-up hook and its check'::text;
    end if;
    if exists (select 1 from pg_proc p where p.oid = to_regprocedure(signup_hook)
               and (p.prosecdef or not coalesce('search_path=""' = any (p.proconfig) or 'search_path=' = any (p.proconfig), false))) then
      failures := failures || format('%s must be SECURITY INVOKER with an empty search_path', signup_hook);
    end if;
    for v_role in
      select distinct case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end
      from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = to_regprocedure(signup_hook) and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner
    loop
      if v_role <> 'supabase_auth_admin' then
        failures := failures || format('%s must not execute the sign-up hook', v_role);
      end if;
    end loop;
  end if;
  if to_regprocedure('private.accept_invitation(bytea, uuid, text, text)') is not null then
    failures := failures || 'private.accept_invitation (acceptance for a given user id) must not exist (review H1)'::text;
  end if;

  -- 5c. No Auth e-mail change (re-review N1): the guard trigger on auth.users exists, is enabled (ALWAYS
  --     or ORIGIN), fires before UPDATE OF email, email_change, and calls the SECURITY INVOKER function
  --     with an empty search_path that PUBLIC cannot execute.
  if not exists (
    select 1 from pg_trigger t
    where t.tgrelid = 'auth.users'::regclass and t.tgname = 'jadarat_refuse_email_change' and not t.tgisinternal
      and t.tgenabled in ('O', 'A') and t.tgfoid = to_regprocedure('private.refuse_auth_email_change()')
      and (t.tgtype & 1) <> 0 and (t.tgtype & 2) <> 0 and (t.tgtype & 16) <> 0  -- FOR EACH ROW, BEFORE, UPDATE
      and (select array_agg(a.attname::text order by a.attname) from pg_attribute a
           where a.attrelid = t.tgrelid and a.attnum = any (t.tgattr::int2[])) = array['email', 'email_change']
  ) then
    failures := failures || 'trigger jadarat_refuse_email_change on auth.users (re-review N1) is missing, disabled or altered'::text;
  end if;
  if exists (select 1 from pg_proc p where p.oid = to_regprocedure('private.refuse_auth_email_change()')
             and (p.prosecdef or not coalesce('search_path=""' = any (p.proconfig) or 'search_path=' = any (p.proconfig), false)
                  or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                             where a.grantee = 0 and a.privilege_type = 'EXECUTE'))) then
    failures := failures || 'private.refuse_auth_email_change() must be SECURITY INVOKER with an empty search_path, not executable by PUBLIC'::text;
  end if;

  -- 6. Data API, best effort: self-hosted PostgREST reads pgrst.db_schemas from the authenticator role.
  --    Hosted Supabase keeps this setting outside the database, so there the dashboard setting
  --    ("Data API" off) is the control (runbook) and this check cannot fail.
  if exists (
    select 1 from pg_db_role_setting s join pg_roles ro on ro.oid = s.setrole, unnest(s.setconfig) cfg
    where ro.rolname = 'authenticator' and cfg like 'pgrst.db_schemas=%'
      and exists (select 1 from unnest(module_schemas) m
                  where m = any (string_to_array(replace(split_part(cfg, '=', 2), ' ', ''), ',')))
  ) then
    failures := failures || 'the Data API (pgrst.db_schemas) exposes platform/private/module schemas'::text;
  end if;

  -- 7. Separation of duties (BR-IAM-4, T-M2-16): the guard triggers exist and are enabled, and no member
  --    holds the Organization Admin role together with another role (now or later), no pending
  --    invitation gives it with another role. Counts only (no ids). Reads every organization: the migration role
  --    bypasses row-level security (checked by migration 20261010090000).
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'platform.role_assignments'::regclass
                 and t.tgname = 'role_assignments_separation_of_duties' and t.tgenabled in ('O', 'A')
                 and t.tgfoid = to_regprocedure('private.check_role_separation()'))
     or not exists (select 1 from pg_trigger t where t.tgrelid = 'platform.invitations'::regclass
                    and t.tgname = 'invitations_separation_of_duties' and t.tgenabled in ('O', 'A')
                    and t.tgfoid = to_regprocedure('private.check_invitation_separation()')) then
    failures := failures || 'separation-of-duties triggers (BR-IAM-4) on role_assignments / invitations are missing or disabled'::text;
  elsif to_regprocedure('private.separation_of_duties_violations()') is null then
    failures := failures || 'private.separation_of_duties_violations() is missing'::text;
  elsif not exists (select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls)) then
    -- Both tables force RLS: without bypassing it the counts would silently read 0 (security review L2).
    failures := failures || format('role %s must bypass row-level security to check separation of duties (BR-IAM-4)', current_user);
  else
    select * into r from private.separation_of_duties_violations();
    if r.members > 0 then
      failures := failures || format('%s member(s) hold the Organization Admin role together with another role (BR-IAM-4)', r.members);
    end if;
    if r.pending_invitations > 0 then
      failures := failures || format('%s pending invitation(s) give the Organization Admin role with another role (BR-IAM-4)', r.pending_invitations);
    end if;
  end if;

  if cardinality(failures) > 0 then
    raise exception 'deployment verification failed:%', E'\n  - ' || array_to_string(failures, E'\n  - ');
  end if;

  -- Known hosted-Supabase limitation (migration 20260930120000): the migration role may not own the
  -- database, so `revoke temporary … from public` is a no-op. Reported, not fatal; tracked in STATUS.
  if has_database_privilege('authenticated', current_database(), 'temporary') then
    raise warning 'authenticated can still create temporary objects (database not owned by the migration role); see STATUS risks';
  end if;
end
$$;

rollback;
