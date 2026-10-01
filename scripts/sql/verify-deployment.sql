-- Post-deployment checks for a hosted environment (scripts/db-deploy.sh apply). Read-only; rolled back.
-- A subset of supabase/tests/10_catalog.sql that needs no test fixtures (ADR 0002 Verification 1, §5–§7).
\set ON_ERROR_STOP on
begin;

do $$
declare
  r record;
  failures text[] := '{}';
begin
  -- Login roles: exact attributes (ADR 0002 §5, §7).
  for r in
    select rolname, rolcanlogin, rolinherit, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication
    from pg_roles where rolname in ('app_server', 'app_worker', 'tenant_guard')
  loop
    if r.rolname in ('app_server', 'app_worker') and not r.rolcanlogin then
      failures := failures || format('%s must be LOGIN', r.rolname);
    end if;
    if r.rolname = 'tenant_guard' and r.rolcanlogin then
      failures := failures || 'tenant_guard must be NOLOGIN';
    end if;
    if r.rolinherit or r.rolsuper or r.rolbypassrls or r.rolcreaterole or r.rolcreatedb or r.rolreplication then
      failures := failures || format('%s must be NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION', r.rolname);
    end if;
  end loop;
  if (select count(*) from pg_roles where rolname in ('app_server', 'app_worker', 'tenant_guard')) <> 3 then
    failures := failures || 'roles app_server, app_worker and tenant_guard must all exist';
  end if;

  -- Every table in the platform and module schemas: RLS enabled AND forced; nothing for anon.
  for r in
    select c.oid::regclass as t, c.relrowsecurity, c.relforcerowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    -- Add each new module schema here and below (core_hr, payroll, …).
    where c.relkind in ('r', 'p') and n.nspname in ('platform', 'private', 'tms')
  loop
    if not (r.relrowsecurity and r.relforcerowsecurity) then
      failures := failures || format('%s: row level security must be ENABLED and FORCED', r.t);
    end if;
    if has_table_privilege('anon', r.t, 'select, insert, update, delete, truncate, references, trigger') then
      failures := failures || format('%s: anon must have no privileges', r.t);
    end if;
  end loop;

  -- No anonymous access to our schemas.
  for r in select nspname from pg_namespace where nspname in ('platform', 'private', 'tms') loop
    if has_schema_privilege('anon', r.nspname, 'usage') then
      failures := failures || format('schema %s: anon must not have USAGE', r.nspname);
    end if;
  end loop;

  -- Custom Access Token Hook: present; executable by supabase_auth_admin only (ADR 0002 §3).
  if to_regprocedure('private.custom_access_token_hook(jsonb)') is null then
    failures := failures || 'private.custom_access_token_hook(jsonb) is missing';
  else
    if not has_function_privilege('supabase_auth_admin', 'private.custom_access_token_hook(jsonb)', 'execute') then
      failures := failures || 'supabase_auth_admin must be able to execute the access token hook';
    end if;
    if has_function_privilege('anon', 'private.custom_access_token_hook(jsonb)', 'execute')
       or has_function_privilege('authenticated', 'private.custom_access_token_hook(jsonb)', 'execute') then
      failures := failures || 'anon/authenticated must not execute the access token hook';
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
