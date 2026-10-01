-- ADR 0002 §3 / ADR 0003 §2 (T-M1-D03 sign-in): the organizations (المنشآت) the signed-in user may act in,
-- for the CURRENT Auth session — used right after sign-in, before a tenant is selected (the access token
-- carries no tenant_id yet, so tenant RLS returns nothing).
-- SECURITY-RELEVANT. SECURITY DEFINER owned by tenant_guard (ADR 0002 §6a rev. 2). Returns rows only when:
--   * the caller connected as app_server with user claims (role authenticated), and
--   * the claimed session exists in Auth for that user and is not expired (private.user_session_is_valid);
-- and then only the caller's ACTIVE memberships in active/trial tenants, with the names to show. Never other
-- users' memberships, never invited/suspended/revoked ones.

-- The names shown in the organization chooser (tenant_guard could read only id/status so far).
grant select (name_ar, name_en) on platform.tenants to tenant_guard;

create or replace function private.session_tenants()
returns table (tenant_id uuid, name_ar text, name_en text)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_claims jsonb := private.request_claims();
  v_user uuid;
  v_session uuid;
begin
  if session_user <> 'app_server' or v_claims is null or coalesce(v_claims ->> 'role', '') <> 'authenticated' then
    return;
  end if;
  v_user := private.try_uuid(v_claims ->> 'sub');
  v_session := private.try_uuid(v_claims ->> 'session_id');
  if not private.user_session_is_valid(v_user, v_session) then
    return;
  end if;

  return query
    select t.id, t.name_ar, t.name_en
    from platform.tenant_memberships m
    join platform.tenants t on t.id = m.tenant_id
    where m.user_id = v_user
      and m.status = 'active'
      and t.status in ('active', 'trial')
    order by t.name_ar, t.id;
end
$$;

comment on function private.session_tenants() is
  'SECURITY-RELEVANT (ADR 0002 §3). Active organizations of the caller''s current, valid Auth session (app_server only).';

-- Ownership hand-over as in migration 20260930120100 (non-superuser migration role on hosted Supabase).
grant create on schema private to tenant_guard;
alter function private.session_tenants() owner to tenant_guard;
revoke create on schema private from tenant_guard;

revoke all on function private.session_tenants() from public;
grant execute on function private.session_tenants() to authenticated;
