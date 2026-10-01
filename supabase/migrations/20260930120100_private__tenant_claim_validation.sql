-- ADR 0002 §6 / §6a: tenant resolution for RLS with claim validation inside the database.
--
-- SECURITY-RELEVANT. private.current_tenant_id() is the single predicate every tenant_isolation
-- policy relies on. It returns a tenant only when the claims set by server code are valid for the
-- LOGIN role that set them (a stolen app_server credential alone must not unlock any tenant):
--   * user claims   role=authenticated, sub, session_id, tenant_id — only when session_user = app_server,
--                   the session exists in auth.sessions for sub and is not expired, sub has an
--                   ACTIVE membership in tenant_id of an ACTIVE/TRIAL tenant, AND the session's
--                   platform.session_context row still points at tenant_id (a token issued before a
--                   tenant switch stops working immediately, not at JWT expiry);
--   * system claims role=system, tenant_id, job_id — only when session_user = app_worker and the tenant
--                   is active/trial (ADR 0002 §6a says "active"; trial tenants are live customers too);
--   * anything else → NULL → every tenant policy denies.
--
-- It is SECURITY DEFINER (unavoidable: authenticated must not read auth.sessions or other tenants'
-- memberships) and owned by tenant_guard, which has no BYPASSRLS: it can read exactly the rows it
-- needs through explicit grants + policies `to tenant_guard` (added with the tables). tenant_isolation
-- policies apply `to authenticated` only, so there is no recursion. search_path is empty; every
-- identifier is schema-qualified. Plpgsql bodies are validated at first call, so tables may be
-- created after these functions (their DEFAULT uses current_tenant_id()).
--
-- Claims are read ONLY from the transaction-local `request.jwt.claims` setting that withUserTx /
-- withSystemTx set (private.request_claims()). Never through auth.jwt() / auth.uid(): Supabase's
-- versions prefer the legacy `request.jwt.claim` / `request.jwt.claim.sub` settings, which a
-- session-level SET on a pooled connection could leave behind for the next transaction.

create or replace function private.try_uuid(p_value text)
returns uuid
language sql immutable
set search_path = ''
as $$
  select case
    when p_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p_value::uuid
  end
$$;

comment on function private.try_uuid(text) is 'Casts text to uuid, NULL when malformed (claims never raise).';

-- The claims of the current transaction, from `request.jwt.claims` only (see header). NULL when unset,
-- empty, malformed or not a JSON object — claims never raise.
create or replace function private.request_claims()
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_raw text := nullif(current_setting('request.jwt.claims', true), '');
  v_claims jsonb;
begin
  if v_raw is null then
    return null;
  end if;
  begin
    v_claims := v_raw::jsonb;
  exception when others then
    return null;
  end;
  if jsonb_typeof(v_claims) <> 'object' then
    return null;
  end if;
  return v_claims;
end
$$;

comment on function private.request_claims() is
  'SECURITY-RELEVANT. Claims of the current transaction from request.jwt.claims ONLY (never request.jwt.claim*).';

-- Subject (auth user id) of the current claims; replaces auth.uid() in policies.
create or replace function private.request_user_id()
returns uuid
language sql stable
set search_path = ''
as $$
  select private.try_uuid((select private.request_claims()) ->> 'sub')
$$;

comment on function private.request_user_id() is
  'The `sub` claim of request.jwt.claims as uuid (NULL when absent/malformed). Use instead of auth.uid().';

-- tenant_guard cannot be granted access to schema `auth` on hosted Supabase (the migration role has USAGE
-- on `auth` without the grant option). It reads the three columns it needs through this view instead:
-- a view reads its base table with its OWNER's rights (the migration role), and granting SELECT on a view
-- needs no grant option on the base table (ADR 0002 §6a rev. 2). Nobody but tenant_guard may select it.
create or replace view private.auth_session_validity
with (security_barrier = true)  -- defensive only: the view has no WHERE clause
as select s.id, s.user_id, s.not_after from auth.sessions s;

comment on view private.auth_session_validity is
  'SECURITY-RELEVANT (ADR 0002 §6a rev. 2): auth.sessions (id, user_id, not_after) for tenant_guard only. Owned by the migration role.';

revoke all on private.auth_session_validity from public;
grant select on private.auth_session_validity to tenant_guard;

create or replace function private.user_session_is_valid(p_user_id uuid, p_session_id uuid)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_session_id is null then
    return false;
  end if;
  return exists (
    select 1
    from private.auth_session_validity s
    where s.id = p_session_id
      and s.user_id = p_user_id
      and (s.not_after is null or s.not_after > now())
  );
end
$$;

comment on function private.user_session_is_valid(uuid, uuid) is
  'SECURITY DEFINER (owner tenant_guard, reads private.auth_session_validity): true when the Auth session exists for the user and is not expired.';

create or replace function private.has_active_membership(p_user_id uuid, p_tenant_id uuid)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_tenant_id is null then
    return false;
  end if;
  return exists (
    select 1
    from platform.tenant_memberships m
    join platform.tenants t on t.id = m.tenant_id
    where m.user_id = p_user_id
      and m.tenant_id = p_tenant_id
      and m.status = 'active'
      and t.status in ('active', 'trial')
  );
end
$$;

comment on function private.has_active_membership(uuid, uuid) is
  'SECURITY DEFINER (owner tenant_guard): active membership in an active/trial tenant.';

create or replace function private.current_tenant_id()
returns uuid
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_claims jsonb := private.request_claims();
  v_role text;
  v_tenant uuid;
  v_user uuid;
  v_session uuid;
begin
  if v_claims is null then
    return null;
  end if;

  v_role := v_claims ->> 'role';
  v_tenant := private.try_uuid(v_claims ->> 'tenant_id');
  if v_tenant is null then
    return null;
  end if;

  if v_role = 'authenticated' and session_user = 'app_server' then
    v_user := private.try_uuid(v_claims ->> 'sub');
    v_session := private.try_uuid(v_claims ->> 'session_id');
    if private.user_session_is_valid(v_user, v_session)
       and private.has_active_membership(v_user, v_tenant)
       -- The session still acts in this tenant (ADR 0002 §3): stale pre-switch tokens are refused.
       and exists (
         select 1
         from platform.session_context c
         where c.session_id = v_session
           and c.user_id = v_user
           and c.active_tenant_id = v_tenant
       ) then
      return v_tenant;
    end if;
    return null;
  end if;

  if v_role = 'system' and session_user = 'app_worker' then
    if coalesce(btrim(v_claims ->> 'job_id'), '') <> ''
       and exists (select 1 from platform.tenants t where t.id = v_tenant and t.status in ('active', 'trial')) then
      return v_tenant;
    end if;
    return null;
  end if;

  return null;
end
$$;

comment on function private.current_tenant_id() is
  'SECURITY-RELEVANT (ADR 0002 §6a). Tenant of the validated request claims, else NULL. Use as (select private.current_tenant_id()).';

-- Tenant switch (ADR 0002 §3): called by the explicit POST server action inside withUserTx, after
-- which the server refreshes the Auth session so the hook issues a token with the new tenant claim.
-- Validates the CURRENT session (not the current tenant: the first tenant selection has none) and an
-- active membership in the target tenant; updates only this session's row.
create or replace function private.switch_active_tenant(p_tenant_id uuid)
returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_claims jsonb := private.request_claims();
  v_user uuid;
  v_session uuid;
begin
  if session_user <> 'app_server' or v_claims is null or coalesce(v_claims ->> 'role', '') <> 'authenticated' then
    return false;
  end if;
  v_user := private.try_uuid(v_claims ->> 'sub');
  v_session := private.try_uuid(v_claims ->> 'session_id');
  if not private.user_session_is_valid(v_user, v_session)
     or not private.has_active_membership(v_user, p_tenant_id) then
    return false;
  end if;

  insert into platform.session_context as c (session_id, user_id, active_tenant_id, updated_at)
  values (v_session, v_user, p_tenant_id, now())
  on conflict (session_id) do update
    set active_tenant_id = excluded.active_tenant_id,
        updated_at = excluded.updated_at
    where c.user_id = excluded.user_id;
  return found;
end
$$;

comment on function private.switch_active_tenant(uuid) is
  'SECURITY-RELEVANT (ADR 0002 §3). Sets the active tenant of the caller''s current Auth session only.';

-- A non-superuser (hosted Supabase's migration role) may hand ownership to a role only if that role has
-- CREATE on the schema; tenant_guard gets it for these four statements only (same transaction).
grant create on schema private to tenant_guard;
alter function private.user_session_is_valid(uuid, uuid) owner to tenant_guard;
alter function private.has_active_membership(uuid, uuid) owner to tenant_guard;
alter function private.current_tenant_id() owner to tenant_guard;
alter function private.switch_active_tenant(uuid) owner to tenant_guard;
revoke create on schema private from tenant_guard;

revoke all on function private.try_uuid(text) from public;
revoke all on function private.request_claims() from public;
revoke all on function private.request_user_id() from public;
revoke all on function private.user_session_is_valid(uuid, uuid) from public;
revoke all on function private.has_active_membership(uuid, uuid) from public;
revoke all on function private.current_tenant_id() from public;
revoke all on function private.switch_active_tenant(uuid) from public;

grant execute on function private.try_uuid(text) to tenant_guard, authenticated;
grant execute on function private.request_claims() to tenant_guard, authenticated;
grant execute on function private.request_user_id() to tenant_guard, authenticated;
grant execute on function private.user_session_is_valid(uuid, uuid) to tenant_guard;
grant execute on function private.has_active_membership(uuid, uuid) to tenant_guard;
grant execute on function private.current_tenant_id() to authenticated;
grant execute on function private.switch_active_tenant(uuid) to authenticated;

-- The view's owner (the migration role) must be able to read auth.sessions, and tenant_guard must be able
-- to read the view; otherwise every tenant query would fail at runtime (plpgsql does not check this at
-- CREATE time).
do $$
declare
  v_owner name := (select pg_get_userbyid(relowner) from pg_class
                   where oid = 'private.auth_session_validity'::regclass);
begin
  if not (has_schema_privilege(v_owner, 'auth', 'usage')
          and has_column_privilege(v_owner, 'auth.sessions', 'id', 'select')
          and has_column_privilege(v_owner, 'auth.sessions', 'user_id', 'select')
          and has_column_privilege(v_owner, 'auth.sessions', 'not_after', 'select')) then
    raise exception 'role % (owner of private.auth_session_validity) cannot read auth.sessions (id, user_id, not_after)', v_owner;
  end if;
  if not has_table_privilege('tenant_guard', 'private.auth_session_validity', 'select') then
    raise exception 'tenant_guard cannot read private.auth_session_validity';
  end if;
end
$$;

-- updated_at maintenance (SECURITY INVOKER).
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

revoke all on function private.set_updated_at() from public;
