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

-- email is character varying(255) as in Supabase Auth (a function returning it as `text` must cast it:
-- found by the self-hosted smoke, T-M2-17).
create table if not exists auth.users (
  id uuid primary key,
  email character varying(255),
  created_at timestamptz not null default now()
);
-- Columns Supabase Auth updates that the migrations' trigger on auth.users reads or the tests touch
-- (e-mail change guard, re-review N1).
alter table auth.users
  add column if not exists email_change text default '',
  add column if not exists encrypted_password text,
  add column if not exists email_confirmed_at timestamptz,
  add column if not exists last_sign_in_at timestamptz,
  -- Read by the account e-mail worker functions (T-M2-17, private.auth_account).
  add column if not exists banned_until timestamptz,
  add column if not exists recovery_sent_at timestamptz,
  add column if not exists recovery_token character varying(255),
  add column if not exists is_sso_user boolean not null default false,
  add column if not exists deleted_at timestamptz;

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

-- ---------------------------------------------------------------------------------------------
-- Storage (T-M2-18, ADR 0006): the subset of Supabase Storage that our migrations, policies and tests
-- use, as storage-api v1.74.0 leaves it on supabase/postgres 17.11.0.003 (checked on the image, 9 Oct
-- 2026): tables owned by supabase_storage_admin with RLS enabled (not forced), every privilege for
-- anon/authenticated/service_role, ALL WITH GRANT OPTION for the migration role (storage migration 0049;
-- granted to it by scripts/db-test-hosted-sim.sh). Storage connects as the LOGIN role
-- supabase_storage_admin and switches to the caller's role (authenticated) with `set_config('role', …)`
-- through authenticator, then sets request.jwt.claims to the caller's JWT payload. The db-test gate logs
-- in as supabase_storage_admin for `-- db-test: run-as=storage` files (scripts/db-test.sh).
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'supabase_storage_admin') then
    create role supabase_storage_admin nologin noinherit createrole;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator nologin noinherit;
  end if;
end
$$;
grant anon, authenticated, service_role to authenticator with inherit false, set true;
grant authenticator to supabase_storage_admin with inherit false, set true;

create schema if not exists storage authorization supabase_storage_admin;
grant usage on schema storage to anon, authenticated, service_role;

create table if not exists storage.buckets (
  id text primary key,
  name text not null unique,
  owner uuid,
  owner_id text,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  owner_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_accessed_at timestamptz default now(),
  metadata jsonb,
  user_metadata jsonb,
  version text,
  unique (bucket_id, name)
);
alter table storage.buckets owner to supabase_storage_admin;
alter table storage.objects owner to supabase_storage_admin;
alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;
grant all on storage.buckets, storage.objects to anon, authenticated, service_role;
