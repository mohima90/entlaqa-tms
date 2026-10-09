-- Rollback of 20261012090100_private__mfa_enforcement.sql: current_tenant_id() as in 20260930120100 (no MFA
-- policy), without the session-access functions, the prompt dismissals and the factor view.
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

drop function private.tenant_member_mfa(uuid);
drop function private.dismiss_mfa_prompt();
drop function private.session_access_state();
drop function private.session_access(uuid, uuid, uuid, boolean, boolean);

revoke execute on function private.actor_role_codes(uuid, uuid) from tenant_guard;
revoke execute on function private.actor_manages_users(uuid) from tenant_guard;
revoke execute on function private.request_person_id() from tenant_guard;

drop policy role_assignments_tenant_guard_read on platform.role_assignments;
revoke select (tenant_id, membership_id, role_code, valid_from, valid_until) on platform.role_assignments from tenant_guard;
revoke select (id, created_at) on platform.tenant_memberships from tenant_guard;

drop table private.mfa_prompt_dismissals;
drop view private.auth_mfa_factor;
