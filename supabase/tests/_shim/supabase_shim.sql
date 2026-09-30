-- =============================================================================================
-- TEST-ONLY Supabase shim for plain PostgreSQL 16 (local runs and CI service containers).
-- NEVER applied to a Supabase project and NEVER part of supabase/migrations.
--
-- Recreates the minimum of what a Supabase database provides so migrations and RLS tests run:
--   roles anon, authenticated, service_role, supabase_auth_admin
--   schema auth with auth.users, auth.sessions, auth.jwt(), auth.uid()
-- Definitions follow Supabase's (auth.jwt()/auth.uid() read request.jwt.claims).
-- Idempotent: roles are cluster-wide and may already exist from an earlier run.
-- =============================================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin noinherit createrole;
  end if;
end
$$;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role, supabase_auth_admin;

create table if not exists auth.users (
  id uuid primary key,
  email text,
  created_at timestamptz not null default now()
);

-- Subset of Supabase Auth's sessions table used by private.current_tenant_id() (ADR 0002 §6a).
create table if not exists auth.sessions (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  not_after timestamptz
);

create or replace function auth.jwt() returns jsonb
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

create or replace function auth.uid() returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

grant execute on function auth.jwt() to public;
grant execute on function auth.uid() to public;
