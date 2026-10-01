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
  hook constant text := 'private.custom_access_token_hook(jsonb)';
  r record;
  v_role text;
  failures text[] := '{}';
begin
  -- 1. Login roles: exact attributes and memberships (ADR 0002 §5, §7).
  for r in
    select rolname, rolcanlogin, rolinherit, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication
    from pg_roles where rolname in ('app_server', 'app_worker', 'tenant_guard')
  loop
    if r.rolname in ('app_server', 'app_worker') and not r.rolcanlogin then
      failures := failures || format('%s must be LOGIN', r.rolname);
    end if;
    if r.rolname = 'tenant_guard' and r.rolcanlogin then
      failures := failures || 'tenant_guard must be NOLOGIN'::text;
    end if;
    if r.rolinherit or r.rolsuper or r.rolbypassrls or r.rolcreaterole or r.rolcreatedb or r.rolreplication then
      failures := failures || format('%s must be NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION', r.rolname);
    end if;
  end loop;
  if (select count(*) from pg_roles where rolname in ('app_server', 'app_worker', 'tenant_guard')) <> 3 then
    failures := failures || 'roles app_server, app_worker and tenant_guard must all exist'::text;
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

  -- private.user_session_is_valid(): its owner (the migration role, ADR 0002 §6a rev. 2) can read
  -- auth.sessions, and only tenant_guard may execute it (via the tenant_guard-owned helpers).
  if to_regprocedure('private.user_session_is_valid(uuid, uuid)') is null then
    failures := failures || 'private.user_session_is_valid(uuid, uuid) is missing'::text;
  else
    v_role := (select pg_get_userbyid(proowner) from pg_proc
               where oid = 'private.user_session_is_valid(uuid, uuid)'::regprocedure);
    if not (has_schema_privilege(v_role, 'auth', 'usage')
            and has_column_privilege(v_role, 'auth.sessions', 'id', 'select')
            and has_column_privilege(v_role, 'auth.sessions', 'user_id', 'select')
            and has_column_privilege(v_role, 'auth.sessions', 'not_after', 'select')) then
      failures := failures || format('%s (owner of private.user_session_is_valid) must read auth.sessions (id, user_id, not_after)', v_role);
    end if;
    for r in select rolname from pg_roles
             where rolname in ('anon', 'authenticated', 'service_role', 'authenticator', 'app_server', 'app_worker')
    loop
      if has_function_privilege(r.rolname, 'private.user_session_is_valid(uuid, uuid)', 'execute') then
        failures := failures || format('%s must not execute private.user_session_is_valid', r.rolname);
      end if;
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
    -- 3. Tenant tables (all tables in platform/module schemas; no global tables exist yet): RESTRICTIVE
    --    tenant_isolation for ALL commands, to authenticated only, whose USING and WITH CHECK are EXACTLY
    --    `<tenant column> = (select private.current_tenant_id())` (normalized; same rule as 10_catalog.sql,
    --    so `… or true` fails).
    if r.nspname <> 'private' and not exists (
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
