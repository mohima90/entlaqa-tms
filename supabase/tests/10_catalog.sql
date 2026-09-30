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

-- Global tables on the allow-list still need RLS (checked above) — and must exist.
do $$
begin
  perform tests.assert(
    (select count(*) from tests.tenant_tables()) >= 6,
    'expected at least the 6 platform tenancy tables to be tenant-owned');
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
  foreach v_role in array array['anon', 'authenticated', 'app_server', 'app_worker', 'tenant_guard'] loop
    perform tests.assert(not has_database_privilege(v_role, current_database(), 'TEMPORARY'),
      format('%s must not create temporary objects', v_role));
  end loop;
end $$;

-- Access-token hook: EXECUTE only for supabase_auth_admin.
do $$
begin
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
  perform tests.assert(not has_table_privilege('app_server', 'platform.persons', 'select'),
    'app_server must have no table privileges of its own (NOINHERIT)');
end $$;

rollback;
\echo '10_catalog: ok'
