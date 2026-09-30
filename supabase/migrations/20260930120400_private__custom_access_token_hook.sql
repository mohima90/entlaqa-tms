-- ADR 0002 §3: Supabase Custom Access Token Hook.
-- SECURITY-RELEVANT. Adds `tenant_id` and `person_id` for the Auth session's active tenant
-- (platform.session_context keyed by session_id) ONLY IF the membership is active and the tenant is
-- active or trial. Any incoming tenant_id/person_id claims are removed first.
--
-- SECURITY INVOKER: runs as supabase_auth_admin, which may read only the columns granted to it
-- (tenants, tenant_memberships, session_context) through `to supabase_auth_admin` read policies.
-- EXECUTE is granted only to supabase_auth_admin (revoked from public, anon, authenticated).
-- Configure: supabase/config.toml [auth.hook.custom_access_token] (and GoTrue env on self-hosted, T-M1-D04).

create or replace function private.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  v_user uuid := private.try_uuid(event ->> 'user_id');
  v_session uuid := private.try_uuid(event -> 'claims' ->> 'session_id');
  v_tenant uuid;
  v_person uuid;
begin
  v_claims := v_claims - 'tenant_id' - 'person_id';

  if v_user is not null and v_session is not null then
    select m.tenant_id, m.person_id
      into v_tenant, v_person
    from platform.session_context c
    join platform.tenant_memberships m
      on m.tenant_id = c.active_tenant_id and m.user_id = c.user_id
    join platform.tenants t on t.id = m.tenant_id
    where c.session_id = v_session
      and c.user_id = v_user
      and m.status = 'active'
      and t.status in ('active', 'trial');
  end if;

  if v_tenant is not null then
    v_claims := v_claims || jsonb_build_object('tenant_id', v_tenant, 'person_id', v_person);
  end if;

  return jsonb_set(event, '{claims}', v_claims);
end
$$;

comment on function private.custom_access_token_hook(jsonb) is
  'SECURITY-RELEVANT (ADR 0002 §3). Supabase Custom Access Token Hook: tenant_id/person_id for the session''s active tenant.';

revoke all on function private.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant usage on schema private to supabase_auth_admin;
grant execute on function private.custom_access_token_hook(jsonb) to supabase_auth_admin;
grant execute on function private.try_uuid(text) to supabase_auth_admin;
