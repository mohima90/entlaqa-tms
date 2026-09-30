-- ADR 0001 (schemas per module/platform area) and ADR 0002 §5–§7 (database login roles).
--
-- Login roles have NO password here: operators set it out of band (secret manager) per environment.
--   app_server   request-path server code; used only through withUserTx()   (ADR 0002 §5)
--   app_worker   background jobs; used only through withSystemTx()           (ADR 0002 §7, ADR 0005)
-- Both: LOGIN, NOINHERIT (no table privileges until `set local role authenticated`), NOBYPASSRLS,
-- member of authenticated, own nothing.
--   tenant_guard NOLOGIN owner of the few SECURITY DEFINER helpers in `private`; reads only what
--                those helpers need, through explicit grants and policies (no BYPASSRLS).

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_server') then
    create role app_server login noinherit nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'app_worker') then
    create role app_worker login noinherit nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'tenant_guard') then
    create role tenant_guard nologin noinherit nobypassrls;
  end if;
end
$$;

-- Re-assert attributes in case the roles pre-existed with different settings.
alter role app_server login noinherit nobypassrls nosuperuser nocreatedb nocreaterole noreplication;
alter role app_worker login noinherit nobypassrls nosuperuser nocreatedb nocreaterole noreplication;
alter role tenant_guard nologin noinherit nobypassrls nosuperuser nocreatedb nocreaterole noreplication;

grant authenticated to app_server;
grant authenticated to app_worker;

-- The migration role must be able to hand function ownership to tenant_guard.
grant tenant_guard to current_user;

create schema if not exists platform;
create schema if not exists private;
-- Module schemas (tms, …) are created by their own `<module>__` migrations (ADR 0001).

comment on schema platform is 'Jadarat Platform: tenancy, identity, people, rbac, audit (ADR 0001). Not exposed through the Data API.';
comment on schema private is 'Security helpers used by RLS policies and Auth hooks. Never exposed through the Data API.';

revoke all on schema platform, private from public;
grant usage on schema platform, private to authenticated;
grant usage on schema platform, private to tenant_guard;

-- Functions are executable by PUBLIC by default: turn that off for everything created in `private`.
alter default privileges in schema private revoke execute on functions from public;
alter default privileges in schema platform revoke execute on functions from public;

-- No temporary objects for application roles: temp tables/functions live in pg_temp, which is searched
-- before other schemas for relations and could shadow unqualified names in code that does not pin
-- search_path. PostgreSQL grants TEMPORARY on every database to PUBLIC by default; the Jadarat roles
-- (authenticated, anon, app_server, app_worker, tenant_guard) never need it.
-- On hosted Supabase the migration role may not own the database, in which case REVOKE only emits a
-- WARNING and changes nothing: verify on the staging project (T-M0-07) and apply as the owner if needed.
-- The catalog test (supabase/tests/10_catalog.sql) asserts the result on every CI run.
do $$
begin
  execute format('revoke temporary on database %I from public', current_database());
end
$$;
