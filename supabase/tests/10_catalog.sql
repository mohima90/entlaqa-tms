-- db-test: run-as=owner
-- (a) Catalog checks (ADR 0002 Verification 1, ADR 0002 §5–§6). Runs as the superuser connection.
\set ON_ERROR_STOP on
begin;

-- Every table in platform/tms (and any future module schema) has RLS enabled AND forced.
do $$
declare
  r record;
begin
  for r in
    select c.oid::regclass as t, c.relrowsecurity, c.relforcerowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and n.nspname in (select schema_name from tests.module_schemas())
  loop
    perform tests.assert(r.relrowsecurity, format('%s: row level security must be ENABLED', r.t));
    perform tests.assert(r.relforcerowsecurity, format('%s: row level security must be FORCED', r.t));
  end loop;
end $$;

-- Every tenant-owned table has the RESTRICTIVE tenant_isolation policy for ALL commands, to authenticated,
-- whose USING and WITH CHECK are exactly `<tenant column> = (select private.current_tenant_id())`.
do $$
declare
  r record;
  p record;
begin
  for r in select * from tests.tenant_tables() loop
    select pol.polpermissive, pol.polcmd, pol.polroles,
           pg_get_expr(pol.polqual, pol.polrelid) as qual,
           pg_get_expr(pol.polwithcheck, pol.polrelid) as withcheck
      into p
    from pg_policy pol
    where pol.polrelid = r.table_name and pol.polname = 'tenant_isolation';

    perform tests.assert(found, format('%s: missing tenant_isolation policy', r.table_name));
    perform tests.assert(not p.polpermissive, format('%s: tenant_isolation must be RESTRICTIVE', r.table_name));
    perform tests.assert_eq(p.polcmd::text, '*', format('%s: tenant_isolation must apply to ALL commands', r.table_name));
    perform tests.assert(
      p.polroles = array[(select oid from pg_roles where rolname = 'authenticated')]::oid[],
      format('%s: tenant_isolation must target role authenticated', r.table_name));
    -- Exact match on the normalized expression (pg_get_expr), not a substring: e.g.
    -- `tenant_id = (select private.current_tenant_id()) or true` must fail.
    perform tests.assert_eq(p.qual,
      format('(%I = ( SELECT private.current_tenant_id() AS current_tenant_id))', r.tenant_column),
      format('%s: tenant_isolation USING must be exactly %s = (select private.current_tenant_id())', r.table_name, r.tenant_column));
    perform tests.assert_eq(p.withcheck,
      format('(%I = ( SELECT private.current_tenant_id() AS current_tenant_id))', r.tenant_column),
      format('%s: tenant_isolation WITH CHECK must be exactly %s = (select private.current_tenant_id())', r.table_name, r.tenant_column));
  end loop;
end $$;

-- Global tables on the allow-list still need RLS (checked above) — and must exist. They are read-only
-- for authenticated: no write privileges (table or column level) and only SELECT policies.
do $$
declare
  r record;
begin
  perform tests.assert(
    (select count(*) from tests.tenant_tables()) >= 6,
    'expected at least the 6 platform tenancy tables to be tenant-owned');
  for r in select table_name as t from tests.global_tables() loop
    perform tests.assert(
      not has_table_privilege('authenticated', r.t, 'insert, update, delete, truncate, references, trigger')
        and not has_any_column_privilege('authenticated', r.t, 'insert, update, references'),
      format('%s: global table must be read-only for authenticated', r.t));
    perform tests.assert(
      not exists (select 1 from pg_policy p where p.polrelid = r.t and p.polcmd <> 'r'),
      format('%s: global table may only have SELECT policies', r.t));
  end loop;
end $$;

-- No privileges for anon or PUBLIC on any table in module schemas.
do $$
declare
  r record;
begin
  for r in
    select c.oid::regclass as t
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p', 'v', 'm') and n.nspname in (select schema_name from tests.module_schemas())
  loop
    perform tests.assert(
      not has_table_privilege('anon', r.t, 'select, insert, update, delete, truncate, references, trigger'),
      format('%s: anon must have no privileges', r.t));
    perform tests.assert(
      not exists (select 1 from information_schema.role_table_grants g
                  where g.grantee = 'PUBLIC' and format('%I.%I', g.table_schema, g.table_name)::regclass = r.t),
      format('%s: PUBLIC must have no privileges', r.t));
    perform tests.assert(
      not has_table_privilege('authenticated', r.t, 'truncate, references, trigger'),
      format('%s: authenticated must not have TRUNCATE/REFERENCES/TRIGGER', r.t));
  end loop;
end $$;

-- Append-only audit log: no UPDATE/DELETE privileges and no UPDATE/DELETE policies (FR-AUD-01).
do $$
begin
  perform tests.assert(not has_table_privilege('authenticated', 'platform.audit_events', 'update'),
    'audit_events: authenticated must not have UPDATE');
  perform tests.assert(not has_table_privilege('authenticated', 'platform.audit_events', 'delete'),
    'audit_events: authenticated must not have DELETE');
  perform tests.assert(not exists (select 1 from pg_policy where polrelid = 'platform.audit_events'::regclass
                                   and polcmd in ('w', 'd') and polpermissive),
    'audit_events: no permissive UPDATE/DELETE policies');
  perform tests.assert(exists (select 1 from pg_trigger where tgrelid = 'platform.audit_events'::regclass
                               and tgname = 'audit_events_append_only' and tgenabled = 'O'),
    'audit_events: append-only trigger must exist and be enabled');
  -- The trigger blocks even privileged roles (this superuser session).
  perform tests.assert_fails($q$update platform.audit_events set action = 'platform.test.tampered'$q$,
    array['42501'], 'audit_events: UPDATE is blocked for every role');
  perform tests.assert_fails($q$delete from platform.audit_events$q$,
    array['42501'], 'audit_events: DELETE is blocked for every role');
end $$;

-- Foreign keys between two tenant-owned tables must be composite and include the tenant column.
do $$
declare
  r record;
begin
  for r in
    select con.conname, con.conrelid::regclass as child, con.confrelid::regclass as parent,
           array(select a.attname from unnest(con.conkey) k join pg_attribute a
                 on a.attrelid = con.conrelid and a.attnum = k) as child_cols,
           array(select a.attname from unnest(con.confkey) k join pg_attribute a
                 on a.attrelid = con.confrelid and a.attnum = k) as parent_cols
    from pg_constraint con
    where con.contype = 'f'
      and con.conrelid in (select table_name from tests.tenant_tables())
      and con.confrelid in (select table_name from tests.tenant_tables())
      and con.confrelid <> 'platform.tenants'::regclass
  loop
    perform tests.assert(
      array_length(r.child_cols, 1) >= 2
        and (select tenant_column from tests.tenant_tables() where table_name = r.child) = any (r.child_cols)
        and 'tenant_id' = any (r.parent_cols),
      format('%s → %s (%s): FK between tenant-owned tables must be composite with the tenant column',
             r.child, r.parent, r.conname));
  end loop;
end $$;

-- SECURITY DEFINER functions live only in `private`, pin search_path, and are never executable by PUBLIC/anon.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as fn, n.nspname, p.prosecdef, p.proconfig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('private', 'platform', 'tms')
  loop
    if r.prosecdef then
      perform tests.assert(r.nspname = 'private', format('%s: SECURITY DEFINER only allowed in schema private', r.fn));
    end if;
    perform tests.assert(
      exists (select 1 from unnest(r.proconfig) c where c = 'search_path=""' or c = 'search_path='),
      format('%s: must set search_path = ''''', r.fn));
    perform tests.assert(not has_function_privilege('anon', r.fn, 'execute'), format('%s: anon must not execute', r.fn));
    perform tests.assert(
      not exists (select 1 from pg_proc x, aclexplode(coalesce(x.proacl, acldefault('f', x.proowner))) a
                  where x.oid = r.fn::oid and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
      format('%s: PUBLIC must not execute', r.fn));
  end loop;
end $$;

-- Claims are read ONLY from request.jwt.claims (security review S1): no function in our schemas and no
-- policy on our tables may use auth.jwt()/auth.uid() (Supabase's versions prefer the legacy
-- request.jwt.claim / request.jwt.claim.sub settings, which can leak across pooled transactions) or
-- read the legacy settings directly.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as fn, p.prosrc
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('private', 'platform', 'tms')
  loop
    perform tests.assert(r.prosrc !~* 'auth\.(jwt|uid)\s*\(',
      format('%s: must not call auth.jwt()/auth.uid(); use private.request_claims()/request_user_id()', r.fn));
    perform tests.assert(r.prosrc !~* 'request\.jwt\.claim([^s]|$)',
      format('%s: must not read the legacy request.jwt.claim* settings', r.fn));
  end loop;
  for r in
    select pol.polrelid::regclass as t, pol.polname,
           coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || ' ' ||
           coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') as expr
    from pg_policy pol join pg_class c on c.oid = pol.polrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in (select schema_name from tests.module_schemas())
  loop
    perform tests.assert(r.expr !~* 'auth\.(jwt|uid)\s*\(',
      format('%s policy %s: must not use auth.jwt()/auth.uid() (got %s)', r.t, r.polname, r.expr));
  end loop;
end $$;

-- Member-level escalation guards on memberships (security review L2).
do $$
begin
  perform tests.assert_eq(
    (select pg_get_expr(polwithcheck, polrelid) from pg_policy
     where polrelid = 'platform.tenant_memberships'::regclass and polname = 'tenant_memberships_insert'),
    '(status = ''invited''::text)', 'memberships: request-path inserts must be invitations only');
  perform tests.assert(not has_table_privilege('authenticated', 'platform.tenant_memberships', 'UPDATE'),
    'memberships: no table-wide UPDATE for authenticated');
  perform tests.assert(has_column_privilege('authenticated', 'platform.tenant_memberships', 'status', 'UPDATE'),
    'memberships: UPDATE (status) only');
  perform tests.assert(not has_column_privilege('authenticated', 'platform.tenant_memberships', 'user_id', 'UPDATE'),
    'memberships: user_id must not be updatable');
  perform tests.assert(exists (select 1 from pg_trigger where tgrelid = 'platform.tenant_memberships'::regclass
                               and tgname = 'tenant_memberships_status_transition' and tgenabled = 'O'),
    'memberships: status transition trigger must exist and be enabled');
end $$;

-- The `public` schema is exposed by Supabase's Data API by default: we create nothing there
-- (ADR 0002 §5 — no tenant data reachable through PostgREST). Extension-owned objects are ignored.
do $$
declare
  v_objects text;
begin
  select string_agg(format('%s (%s)', c.oid::regclass, c.relkind), ', ') into v_objects
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
    and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e');
  perform tests.assert(v_objects is null, format('public schema must contain no tables/views/sequences: %s', v_objects));
  select string_agg(p.oid::regprocedure::text, ', ') into v_objects
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e');
  perform tests.assert(v_objects is null, format('public schema must contain no functions: %s', v_objects));
  select string_agg(t.typname, ', ') into v_objects
  from pg_type t join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public' and t.typtype in ('e', 'd', 'c') and t.typrelid = 0
    and not exists (select 1 from pg_depend d where d.classid = 'pg_type'::regclass and d.objid = t.oid and d.deptype = 'e');
  perform tests.assert(v_objects is null, format('public schema must contain no types: %s', v_objects));
end $$;

-- No TEMPORARY privilege for application roles (revoked from PUBLIC in 20260930120000).
do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated', 'app_server', 'app_worker', 'app_queue', 'tenant_guard',
                                'invitation_guard', 'account_mail_guard', 'membership_guard'] loop
    perform tests.assert(not has_database_privilege(v_role, current_database(), 'TEMPORARY'),
      format('%s must not create temporary objects', v_role));
  end loop;
end $$;

-- The job runner app_queue (ADR 0005 §2, T-M2-06a): no CREATE on the database (it could add schemas named
-- after other roles and capture their unqualified names), owns nothing outside graphile_worker (so none of
-- its code runs in request or job transactions), and holds table privileges only on the outbox.
do $$
declare
  v_objects text;
begin
  perform tests.assert(not has_database_privilege('app_queue', current_database(), 'CREATE'),
    'app_queue must not create schemas');
  select string_agg(o, ', ') into v_objects from (
    select n.nspname::text as o from pg_namespace n
    where n.nspowner = 'app_queue'::regrole and n.nspname <> 'graphile_worker'
    union all
    -- pg_toast: the out-of-line storage of graphile_worker's own tables (owned with them; no code).
    select c.oid::regclass::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relowner = 'app_queue'::regrole and n.nspname not in ('graphile_worker', 'pg_toast')
    union all
    select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.proowner = 'app_queue'::regrole and n.nspname <> 'graphile_worker'
    union all
    select t.typname::text from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typowner = 'app_queue'::regrole and n.nspname <> 'graphile_worker'
  ) owned;
  perform tests.assert(v_objects is null, format('app_queue must own nothing outside graphile_worker: %s', v_objects));
  select string_agg(c.oid::regclass::text, ', ') into v_objects
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p', 'v', 'm', 'f')
    and n.nspname not in ('pg_catalog', 'information_schema', 'graphile_worker')
    and c.oid <> 'platform.event_outbox'::regclass
    and (has_table_privilege('app_queue', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
         or has_any_column_privilege('app_queue', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES'));
  perform tests.assert(v_objects is null, format('app_queue must have no privilege on these tables: %s', v_objects));
  -- On the outbox: read, and mark dispatched — nothing else.
  perform tests.assert(has_table_privilege('app_queue', 'platform.event_outbox', 'SELECT')
    and not has_table_privilege('app_queue', 'platform.event_outbox', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
    and (select array_agg(a.attname::text order by a.attname) from pg_attribute a
         where a.attrelid = 'platform.event_outbox'::regclass and a.attnum > 0 and not a.attisdropped
           and has_column_privilege('app_queue', a.attrelid, a.attnum, 'UPDATE')) = array['dispatched_at'],
    'app_queue: select on the outbox and update of dispatched_at only');
  perform tests.assert(not has_schema_privilege('app_queue', 'private', 'USAGE'), 'app_queue must not use schema private');
  perform tests.assert(not has_schema_privilege('app_server', 'graphile_worker', 'USAGE')
    and not has_schema_privilege('app_worker', 'graphile_worker', 'USAGE')
    and not has_schema_privilege('authenticated', 'graphile_worker', 'USAGE')
    and not has_schema_privilege('anon', 'graphile_worker', 'USAGE'),
    'only app_queue uses schema graphile_worker');
  -- The outbox trigger wakes the dispatcher with a notification only: it runs as the inserting role.
  perform tests.assert((select not prosecdef and proowner <> 'app_queue'::regrole from pg_proc
                        where oid = 'private.notify_event_dispatcher()'::regprocedure),
    'the outbox notification trigger is SECURITY INVOKER and not owned by app_queue');
end $$;

-- Access-token hook: EXECUTE only for supabase_auth_admin.
-- Before-user-created hook (sign-up gate, review H1) and its yes/no check: EXECUTE for supabase_auth_admin
-- and nobody else (exact ACL besides the owner); the hook is SECURITY INVOKER with an empty search_path.
do $$
declare
  r record;
  v_grantees text;
begin
  for r in select * from (values ('private.before_user_created_hook(jsonb)'::regprocedure),
                                 ('private.invitation_allows_signup(text,text)'::regprocedure)) as f(fn) loop
    select string_agg(distinct case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, ',')
      into v_grantees
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = r.fn and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner;
    perform tests.assert_eq(v_grantees, 'supabase_auth_admin', format('%s: EXECUTE for supabase_auth_admin only', r.fn));
  end loop;
  perform tests.assert((select not prosecdef
                               and exists (select 1 from unnest(proconfig) c where c in ('search_path=""', 'search_path='))
                               and 'lock_timeout=2s' = any (proconfig)
                        from pg_proc where oid = 'private.before_user_created_hook(jsonb)'::regprocedure),
    'the sign-up hook is SECURITY INVOKER with an empty search_path and a lock timeout');
  perform tests.assert(not has_table_privilege('supabase_auth_admin', 'platform.invitations', 'select')
                       and not has_any_column_privilege('supabase_auth_admin', 'platform.invitations', 'select'),
    'Auth reads no invitation itself (only the yes/no check)');
  perform tests.assert(to_regprocedure('private.accept_invitation(bytea,uuid,text,text)') is null,
    'no app_server-only acceptance for a given user id (review H1)');
  perform tests.assert(has_function_privilege('supabase_auth_admin', 'private.custom_access_token_hook(jsonb)', 'execute'),
    'supabase_auth_admin must execute the access-token hook');
  perform tests.assert(not has_function_privilege('authenticated', 'private.custom_access_token_hook(jsonb)', 'execute'),
    'authenticated must not execute the access-token hook');
  perform tests.assert(not has_function_privilege('app_server', 'private.custom_access_token_hook(jsonb)', 'execute'),
    'app_server must not execute the access-token hook');
  perform tests.assert(not has_function_privilege('authenticated', 'private.user_session_is_valid(uuid, uuid)', 'execute'),
    'authenticated must not probe sessions directly');
  perform tests.assert(not has_function_privilege('authenticated', 'private.has_active_membership(uuid, uuid)', 'execute'),
    'authenticated must not probe memberships directly');
end $$;

-- Database login roles (ADR 0002 §5, §7).
do $$
declare
  r record;
begin
  for r in select * from pg_roles where rolname in ('app_server', 'app_worker') loop
    perform tests.assert(r.rolcanlogin, format('%s must be LOGIN', r.rolname));
    perform tests.assert(not r.rolinherit, format('%s must be NOINHERIT', r.rolname));
    perform tests.assert(not r.rolbypassrls, format('%s must not BYPASSRLS', r.rolname));
    perform tests.assert(not r.rolsuper and not r.rolcreaterole and not r.rolcreatedb,
      format('%s must not be superuser / createrole / createdb', r.rolname));
    perform tests.assert(pg_has_role(r.rolname, 'authenticated', 'MEMBER'), format('%s must be a member of authenticated', r.rolname));
    perform tests.assert(not pg_has_role(r.rolname, 'service_role', 'MEMBER'), format('%s must not be a member of service_role', r.rolname));
    perform tests.assert(not exists (select 1 from pg_class c where c.relowner = r.oid), format('%s must own no relations', r.rolname));
  end loop;
  perform tests.assert((select count(*) from pg_roles where rolname in ('app_server', 'app_worker')) = 2,
    'roles app_server and app_worker must exist');
  perform tests.assert(not (select rolbypassrls or rolcanlogin from pg_roles where rolname = 'tenant_guard'),
    'tenant_guard must be NOLOGIN and not BYPASSRLS');
  perform tests.assert(not (select rolbypassrls or rolcanlogin or rolsuper or rolinherit or rolcreaterole or rolcreatedb
                            from pg_roles where rolname = 'invitation_guard'),
    'invitation_guard must be NOLOGIN NOINHERIT and not BYPASSRLS / superuser / createrole / createdb');
  perform tests.assert(not has_table_privilege('app_server', 'platform.persons', 'select'),
    'app_server must have no table privileges of its own (NOINHERIT)');
end $$;

-- The definer functions and their owners (no BYPASSRLS anywhere; explicit grants + policies per owner).
-- invitation_guard (FR-IAM-03): owns exactly the link, acceptance and sign-up gate functions; nobody but
-- superusers and the deploying role (here: this superuser) may act as it; it reads Auth users only through
-- private.auth_user_email; it creates nothing.
do $$
declare
  v_list text;
begin
  select string_agg(format('%s (owner %s)', p.oid::regprocedure, pg_get_userbyid(p.proowner)), ', '
                    order by p.oid::regprocedure::text) into v_list
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.prosecdef
    and p.proowner <> 'account_mail_guard'::regrole   -- checked in its own block below (T-M2-17)
    and p.proowner <> 'membership_guard'::regrole;    -- checked in its own block below (T-M2-09)
  perform tests.assert_eq(v_list,
    'private.accept_invitation_as_caller(bytea,text,text) (owner invitation_guard), '
    'private.account_has_app(uuid) (owner tenant_guard), '
    'private.apply_device_limit() (owner tenant_guard), '
    'private.audit_account_event(uuid,text,jsonb,text,uuid,uuid) (owner tenant_guard), '
    'private.confirm_mfa_setup(uuid,text) (owner tenant_guard), '
    'private.current_tenant_id() (owner tenant_guard), '
    'private.discard_inactive_tenant_delivery(uuid) (owner tenant_guard), '
    'private.dismiss_mfa_prompt() (owner tenant_guard), '
    'private.end_all_account_sessions(uuid,uuid,uuid) (owner tenant_guard), '
    'private.end_member_sessions(uuid,uuid) (owner tenant_guard), '
    'private.end_my_sessions(uuid) (owner tenant_guard), '
    'private.end_sessions(uuid,uuid[],uuid,text,uuid) (owner tenant_guard), '
    'private.end_unserved_login_sessions(uuid,uuid,uuid) (owner tenant_guard), '
    'private.enforce_device_limit(uuid,uuid,uuid) (owner tenant_guard), '
    'private.has_active_membership(uuid,uuid) (owner tenant_guard), '
    'private.invitation_allows_signup(text,text) (owner invitation_guard), '
    'private.invitation_by_token(bytea) (owner invitation_guard), '
    'private.invitation_password_min_length(bytea) (owner invitation_guard), '
    'private.issue_mfa_factor_tokens(uuid,uuid,bytea,bytea) (owner tenant_guard), '
    'private.my_mfa_apps() (owner tenant_guard), '
    'private.my_sessions() (owner tenant_guard), '
    'private.password_min_length_for_caller() (owner tenant_guard), '
    'private.purge_ended_sessions(integer) (owner tenant_guard), '
    'private.purge_unconfirmed_mfa_apps(integer) (owner tenant_guard), '
    'private.queue_mfa_mail(text,uuid,uuid,text,uuid) (owner tenant_guard), '
    'private.reject_mfa_factor(bytea) (owner tenant_guard), '
    'private.remove_account_factors(uuid,uuid[]) (owner tenant_guard), '
    'private.remove_mfa_app(uuid) (owner tenant_guard), '
    'private.request_aal2() (owner tenant_guard), '
    'private.request_code_fresh() (owner tenant_guard), '
    'private.request_live_user() (owner tenant_guard), '
    'private.request_mfa_factor_mail(uuid) (owner tenant_guard), '
    'private.request_session_facts() (owner tenant_guard), '
    'private.reset_account_mfa(uuid,text) (owner tenant_guard), '
    'private.reset_member_mfa(uuid) (owner tenant_guard), '
    'private.security_policy_changed_mail() (owner tenant_guard), '
    'private.session_access(uuid,uuid,uuid,boolean,boolean) (owner tenant_guard), '
    'private.session_access_state() (owner tenant_guard), '
    'private.session_tenants() (owner tenant_guard), '
    'private.switch_active_tenant(uuid) (owner tenant_guard), '
    'private.tenant_lockout_policy(uuid) (owner tenant_guard), '
    'private.tenant_member_mfa(uuid) (owner tenant_guard), '
    'private.tenant_member_sessions(uuid) (owner tenant_guard), '
    'private.touch_session() (owner tenant_guard), '
    'private.user_session_is_valid(uuid,uuid) (owner tenant_guard)',
    'SECURITY DEFINER functions and owners (security review for any change)');
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text) into v_list
  from pg_proc p where p.proowner = 'invitation_guard'::regrole;
  perform tests.assert_eq(v_list,
    'private.accept_invitation_as_caller(bytea,text,text), '
    'private.apply_invitation_acceptance(bytea,uuid,text,text), private.invitation_allows_signup(text,text), '
    'private.invitation_by_token(bytea), private.invitation_inviter_may_grant(uuid,uuid,text[]), '
    'private.invitation_link(bytea), private.invitation_password_min_length(bytea)',
    'invitation_guard owns the link, acceptance and sign-up gate functions only');
  perform tests.assert(not has_function_privilege('authenticated', 'private.invitation_link(bytea)', 'execute'),
    'only the definer functions read a link''s state');
  perform tests.assert(not has_function_privilege('authenticated',
      'private.invitation_inviter_may_grant(uuid,uuid,text[])', 'execute'),
    'only the acceptance functions check the inviter''s authority');
  -- What invitation_guard reads of the roles (review M1): the inviter's current roles, nothing more.
  perform tests.assert(has_column_privilege('invitation_guard', 'platform.role_assignments', 'role_code', 'select')
                       and not has_column_privilege('invitation_guard', 'platform.role_assignments', 'created_by', 'select')
                       and not has_table_privilege('invitation_guard', 'platform.role_assignments', 'update')
                       and not has_table_privilege('invitation_guard', 'platform.role_assignments', 'delete'),
    'invitation_guard: reads role assignments (columns), never changes or removes them');
  perform tests.assert(not exists (select 1 from pg_class c where c.relowner = 'invitation_guard'::regrole),
    'invitation_guard owns no relations');
  perform tests.assert(not exists (
      select 1 from pg_auth_members m join pg_roles u on u.oid = m.member
      where m.roleid = 'invitation_guard'::regrole and (m.inherit_option or m.set_option)
        and not u.rolsuper and u.rolname <> current_user),
    'nobody acts as invitation_guard');
  perform tests.assert(not has_schema_privilege('invitation_guard', 'private', 'CREATE')
                       and not has_schema_privilege('invitation_guard', 'platform', 'CREATE'),
    'invitation_guard creates nothing');
  perform tests.assert(not has_function_privilege('authenticated',
      'private.apply_invitation_acceptance(bytea,uuid,text,text)', 'execute'),
    'only the acceptance functions run the acceptance effects');
  perform tests.assert(not has_table_privilege('authenticated', 'private.auth_user_email', 'select')
                       and not has_table_privilege('tenant_guard', 'private.auth_user_email', 'select')
                       and has_table_privilege('invitation_guard', 'private.auth_user_email', 'select'),
    'private.auth_user_email: invitation_guard only');
  perform tests.assert(not has_table_privilege('invitation_guard', 'auth.users', 'select'),
    'invitation_guard reads auth.users only through the view');
  -- Request path: every invitation column but the token hash.
  perform tests.assert(not has_column_privilege('authenticated', 'platform.invitations', 'token_hash', 'select'),
    'invitations: token_hash is not readable by authenticated');
  perform tests.assert(not has_table_privilege('authenticated', 'platform.invitations', 'delete')
                       and not has_table_privilege('invitation_guard', 'platform.invitations', 'delete'),
    'invitations: nobody deletes');
end $$;

-- account_mail_guard (T-M2-17, account e-mails): owns exactly the request and worker functions (all
-- SECURITY DEFINER, empty search_path), nobody acts as it, it creates nothing and owns no relation; it
-- reads Auth accounts only through private.auth_account; the request queue is reachable by it alone.
do $$
declare
  v_list text;
  v_column text;
begin
  perform tests.assert(not (select rolbypassrls or rolcanlogin or rolsuper or rolinherit or rolcreaterole or rolcreatedb
                            from pg_roles where rolname = 'account_mail_guard'),
    'account_mail_guard must be NOLOGIN NOINHERIT and not BYPASSRLS / superuser / createrole / createdb');
  select string_agg(format('%s%s', p.oid::regprocedure, case when p.prosecdef then '' else ' (INVOKER)' end), ', '
                    order by p.oid::regprocedure::text) into v_list
  from pg_proc p where p.proowner = 'account_mail_guard'::regrole;
  perform tests.assert_eq(v_list,
    'private.claim_account_mail_request(), private.finish_account_mail_request(uuid), '
    'private.request_password_changed_mail(uuid), private.request_password_reset_mail(text), '
    'private.retry_account_mail_request(uuid)',
    'account_mail_guard owns the account e-mail functions only, all SECURITY DEFINER');
  perform tests.assert(not exists (select 1 from pg_class c where c.relowner = 'account_mail_guard'::regrole),
    'account_mail_guard owns no relations');
  perform tests.assert(not exists (
      select 1 from pg_auth_members m join pg_roles u on u.oid = m.member
      where m.roleid = 'account_mail_guard'::regrole and (m.inherit_option or m.set_option)
        and not u.rolsuper and u.rolname <> current_user),
    'nobody acts as account_mail_guard');
  perform tests.assert(not has_schema_privilege('account_mail_guard', 'private', 'CREATE')
                       and not has_schema_privilege('account_mail_guard', 'platform', 'CREATE'),
    'account_mail_guard creates nothing');
  perform tests.assert(not has_table_privilege('account_mail_guard', 'auth.users', 'select')
                       and has_table_privilege('account_mail_guard', 'private.auth_account', 'select'),
    'account_mail_guard reads auth.users only through the view');
  select string_agg(a.attname, ', ' order by a.attnum) into v_list
  from pg_attribute a where a.attrelid = 'private.auth_account'::regclass and a.attnum > 0 and not a.attisdropped;
  perform tests.assert_eq(v_list, 'id, email, banned_until, recovery_sent_at, recovery_pending, is_sso_user, deleted_at',
    'private.auth_account: whether a recovery token waits, never the token itself');
  -- Our deliveries (security re-verification): which person got which template when — SELECT on exactly
  -- (tenant_id, recipient_person_id, template, created_at); never the address or the content (html_body
  -- holds live reset links while queued), no table-level SELECT, no writes.
  select string_agg(a.attname, ', ' order by a.attname::text collate "C") into v_list
  from pg_attribute a
  where a.attrelid = 'platform.message_deliveries'::regclass and a.attnum > 0 and not a.attisdropped
    and has_column_privilege('account_mail_guard', a.attrelid, a.attnum, 'select');
  perform tests.assert_eq(v_list, 'created_at, recipient_person_id, template, tenant_id',
    'account_mail_guard reads exactly four columns of platform.message_deliveries');
  foreach v_column in array array['destination', 'subject', 'html_body', 'text_body'] loop
    perform tests.assert(
      not has_column_privilege('account_mail_guard', 'platform.message_deliveries', v_column, 'select, insert, update, references'),
      format('account_mail_guard must have no privilege on platform.message_deliveries.%s', v_column));
  end loop;
  perform tests.assert(
    not has_table_privilege('account_mail_guard', 'platform.message_deliveries',
                            'select, insert, update, delete, truncate, references, trigger')
      and not has_any_column_privilege('account_mail_guard', 'platform.message_deliveries', 'insert, update, references'),
    'account_mail_guard: no table-level SELECT and no write on platform.message_deliveries');
  -- The queue and the view: no privilege for any application role (only through the functions).
  perform tests.assert((select relrowsecurity and relforcerowsecurity from pg_class
                        where oid = 'private.account_mail_requests'::regclass),
    'account_mail_requests: row level security must be ENABLED and FORCED');
  for v_list in select unnest(array['anon', 'authenticated', 'service_role', 'app_server', 'app_worker', 'app_queue',
                                    'invitation_guard', 'supabase_auth_admin']) loop
    perform tests.assert(
      not has_table_privilege(v_list, 'private.account_mail_requests', 'select, insert, update, delete, truncate, references, trigger')
        and not has_any_column_privilege(v_list, 'private.account_mail_requests', 'select, insert, update, references')
        and not has_table_privilege(v_list, 'private.auth_account', 'select, insert, update, delete, truncate, references, trigger'),
      format('%s must have no privilege on the account e-mail queue or private.auth_account', v_list));
  end loop;
  -- tenant_guard queues the authenticator and policy-change notices (T-M2-10): select, insert, delete on the
  -- queue (its policy limits it to those kinds); never the Auth accounts view.
  perform tests.assert(
    has_table_privilege('tenant_guard', 'private.account_mail_requests', 'select, insert, delete')
      and not has_table_privilege('tenant_guard', 'private.account_mail_requests', 'update, truncate, references, trigger')
      and not has_table_privilege('tenant_guard', 'private.auth_account', 'select, insert, update, delete, truncate, references, trigger'),
    'tenant_guard: the authenticator notices on the queue only, never private.auth_account');
  perform tests.assert_eq((select string_agg(polname || ':' || pg_get_expr(polqual, polrelid), ', ') from pg_policy
                           where polrelid = 'private.account_mail_requests'::regclass
                             and 'tenant_guard'::regrole = any (polroles)),
    'account_mail_requests_tenant_guard:(kind = ANY (ARRAY[''mfa_factor_added''::text, ''mfa_factor_removed''::text, ''security_policy_changed''::text]))',
    'tenant_guard''s policy on the queue: the authenticator and policy-change notices only');
  -- Callers: the request functions and the worker functions are executable by authenticated (the
  -- functions check the login role themselves) and nobody else besides the owner.
  for v_list in
    select distinct format('%s → %s', p.oid::regprocedure,
                           case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end)
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.proowner = 'account_mail_guard'::regrole and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner
      and (a.grantee = 0 or pg_get_userbyid(a.grantee) <> 'authenticated')
  loop
    perform tests.assert(false, format('unexpected EXECUTE: %s', v_list));
  end loop;
end $$;

-- membership_guard (T-M2-09, deactivate / reactivate): owns exactly the session-ending and
-- privileged-deactivation triggers, the checked reactivation and the sign-in refusal rule; nobody acts as
-- it, it creates nothing and owns no relation; it reads Auth accounts only through
-- private.auth_account_email; only the reactivation (authenticated: it checks the login role itself) and
-- the sign-in rule (supabase_auth_admin: the access-token hook) are callable.
do $$
declare
  v_list text;
  v_role text;
begin
  perform tests.assert(not (select rolbypassrls or rolcanlogin or rolsuper or rolinherit or rolcreaterole or rolcreatedb
                            from pg_roles where rolname = 'membership_guard'),
    'membership_guard must be NOLOGIN NOINHERIT and not BYPASSRLS / superuser / createrole / createdb');
  select string_agg(format('%s%s', p.oid::regprocedure, case when p.prosecdef then '' else ' (INVOKER)' end), ', '
                    order by p.oid::regprocedure::text) into v_list
  from pg_proc p where p.proowner = 'membership_guard'::regrole;
  perform tests.assert_eq(v_list,
    'private.account_sign_in_refused(uuid), private.check_privileged_deactivation(), '
    'private.end_member_sessions(), private.reactivate_membership(uuid)',
    'membership_guard owns the deactivation, reactivation and sign-in refusal functions only');
  perform tests.assert(not exists (select 1 from pg_class c where c.relowner = 'membership_guard'::regrole),
    'membership_guard owns no relations');
  perform tests.assert(not exists (
      select 1 from pg_auth_members m join pg_roles u on u.oid = m.member
      where m.roleid = 'membership_guard'::regrole and (m.inherit_option or m.set_option)
        and not u.rolsuper and u.rolname <> current_user),
    'nobody acts as membership_guard');
  perform tests.assert(not has_schema_privilege('membership_guard', 'private', 'CREATE')
                       and not has_schema_privilege('membership_guard', 'platform', 'CREATE'),
    'membership_guard creates nothing');
  perform tests.assert(not has_table_privilege('membership_guard', 'auth.users', 'select')
                       and has_table_privilege('membership_guard', 'private.auth_account_email', 'select'),
    'membership_guard reads auth.users only through the view');
  select string_agg(a.attname, ', ' order by a.attnum) into v_list
  from pg_attribute a where a.attrelid = 'private.auth_account_email'::regclass and a.attnum > 0 and not a.attisdropped;
  perform tests.assert_eq(v_list, 'id, email', 'private.auth_account_email: id and e-mail only');
  -- What it may change: memberships suspended → active (status only), session_context rows (delete only);
  -- never roles, persons, organizations, invitations or audit records.
  perform tests.assert(has_column_privilege('membership_guard', 'platform.tenant_memberships', 'status', 'update')
                       and not has_column_privilege('membership_guard', 'platform.tenant_memberships', 'user_id', 'update')
                       and not has_column_privilege('membership_guard', 'platform.tenant_memberships', 'person_id', 'update')
                       and not has_table_privilege('membership_guard', 'platform.tenant_memberships', 'insert, delete'),
    'membership_guard: changes a membership''s status only');
  perform tests.assert_eq(
    (select pg_get_expr(polqual, polrelid) || ' / ' || pg_get_expr(polwithcheck, polrelid) from pg_policy
     where polrelid = 'platform.tenant_memberships'::regclass and polname = 'tenant_memberships_membership_guard_reactivate'),
    '(status = ''suspended''::text) / (status = ''active''::text)',
    'membership_guard: only suspended → active');
  perform tests.assert(has_table_privilege('membership_guard', 'platform.session_context', 'delete')
                       and not has_table_privilege('membership_guard', 'platform.session_context', 'insert, update'),
    'membership_guard: removes sign-in session contexts, never creates or moves them');
  foreach v_role in array array['platform.persons', 'platform.role_assignments', 'platform.ref_roles',
                                'platform.tenants', 'platform.invitations'] loop
    perform tests.assert(not has_table_privilege('membership_guard', v_role, 'insert, update, delete, truncate, references, trigger')
                         and not has_any_column_privilege('membership_guard', v_role, 'insert, update, references'),
      format('membership_guard must not change %s', v_role));
  end loop;
  perform tests.assert(not has_table_privilege('membership_guard', 'platform.audit_events', 'select, insert, update, delete')
                       and not has_table_privilege('membership_guard', 'platform.event_outbox', 'select, insert, update, delete'),
    'membership_guard writes no audit record or event (the calling action does)');
  -- The e-mail view: no privilege for any other role.
  foreach v_role in array array['anon', 'authenticated', 'service_role', 'app_server', 'app_worker', 'app_queue',
                                'tenant_guard', 'invitation_guard', 'account_mail_guard', 'supabase_auth_admin'] loop
    perform tests.assert(
      not has_table_privilege(v_role, 'private.auth_account_email', 'select, insert, update, delete, truncate, references, trigger'),
      format('%s must have no privilege on private.auth_account_email', v_role));
  end loop;
  for v_list in
    select distinct format('%s → %s', p.oid::regprocedure,
                           case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end)
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.proowner = 'membership_guard'::regrole and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner
      and not (pg_get_userbyid(a.grantee) = 'authenticated' and p.oid = 'private.reactivate_membership(uuid)'::regprocedure)
      and not (pg_get_userbyid(a.grantee) = 'supabase_auth_admin'
               and p.oid = 'private.account_sign_in_refused(uuid)'::regprocedure)
  loop
    perform tests.assert(false, format('unexpected EXECUTE: %s', v_list));
  end loop;
  perform tests.assert(has_function_privilege('supabase_auth_admin', 'private.account_sign_in_refused(uuid)', 'execute'),
    'the access-token hook (supabase_auth_admin) may ask the sign-in rule');
  -- With T-M2-10 (20261012120000): its trigger ends a login's Auth sessions through tenant_guard's helper, and
  -- its code rule asks tenant_guard's AAL2 and code age — calls only, no table access of its own.
  perform tests.assert(has_function_privilege('membership_guard', 'private.end_unserved_login_sessions(uuid, uuid, uuid)', 'execute')
                       and has_function_privilege('membership_guard', 'private.request_aal2()', 'execute')
                       and has_function_privilege('membership_guard', 'private.request_code_fresh()', 'execute')
                       and not has_function_privilege('membership_guard', 'private.end_sessions(uuid, uuid[], uuid, text, uuid)', 'execute')
                       and not has_table_privilege('membership_guard', 'private.auth_session_validity', 'select, delete')
                       and not has_table_privilege('membership_guard', 'private.revoked_sessions', 'select, insert, delete'),
    'membership_guard: the login-session helper and the AAL2 checks, not the session tables');
  -- The triggers are in place and enabled.
  perform tests.assert((select count(*) from pg_trigger t
                        where t.tgenabled = 'O' and (t.tgrelid, t.tgname, t.tgfoid) in (
                          ('platform.tenant_memberships'::regclass, 'tenant_memberships_end_sessions', 'private.end_member_sessions()'::regprocedure),
                          ('platform.tenant_memberships'::regclass, 'tenant_memberships_privileged_deactivation',
                           'private.check_privileged_deactivation()'::regprocedure))) = 2,
    'deactivation triggers (sessions, privileged members at AAL2) exist and are enabled');
end $$;

rollback;
\echo '10_catalog: ok'
