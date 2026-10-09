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
-- Columns of Supabase Auth's sessions listed in "sign-in sessions" (T-M2-10, private.auth_session_validity).
-- As in GoTrue: refreshed_at is a timestamp WITHOUT time zone, aal an enum (text here).
alter table auth.sessions
  add column if not exists updated_at timestamptz default now(),
  add column if not exists refreshed_at timestamp without time zone,
  add column if not exists user_agent text,
  add column if not exists aal text;

-- Supabase Auth's MFA factors (T-M2-10, private.auth_mfa_factor). GoTrue uses enums for factor_type and
-- status; text here (the view casts both to text).
create table if not exists auth.mfa_factors (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  friendly_name text,
  factor_type text not null,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  secret text
);
create index if not exists mfa_factors_user_id_idx on auth.mfa_factors (user_id);

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
