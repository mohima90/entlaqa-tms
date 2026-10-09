-- Rollback of 20261012090100_private__mfa_enforcement.sql: current_tenant_id() as in 20260930120100 (no MFA
-- policy) and actor_may_change_security_policy() as in 20261012090000 (aal2 claim), without the
-- session-access functions, the confirmed apps, the prompt dismissals, the factor view, and the session view's
-- extra columns.
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
drop function private.request_session_facts();

create or replace function private.actor_may_change_security_policy(p_tenant_id uuid)
returns boolean
language sql stable
set search_path = ''
as $$
  select coalesce(private.request_claims() ->> 'aal', '') = 'aal2'
     and 'tenant_admin' = any (private.actor_role_codes(p_tenant_id, private.request_user_id()));
$$;

comment on function private.actor_may_change_security_policy(uuid) is
  'SECURITY-RELEVANT (T-IAM-24, D-IAM-01): an Organization Admin at AAL2 may change the security policy.';

drop function private.request_aal2();
drop function private.session_access(uuid, uuid, uuid, boolean, boolean);
drop function private.mfa_no_grace_roles();
drop function private.mfa_prompt_reask_after();

revoke execute on function private.actor_role_codes(uuid, uuid) from tenant_guard;
revoke execute on function private.actor_manages_users(uuid) from tenant_guard;
revoke execute on function private.request_person_id() from tenant_guard;

drop policy role_assignments_tenant_guard_read on platform.role_assignments;
revoke select (tenant_id, membership_id, role_code, valid_from, valid_until) on platform.role_assignments from tenant_guard;
revoke select (id, created_at) on platform.tenant_memberships from tenant_guard;

drop table private.mfa_prompt_dismissals;
drop table private.mfa_factor_confirmations;
drop view private.auth_mfa_factor;

-- A view cannot lose columns with CREATE OR REPLACE: recreated as in 20260930120100.
drop view private.auth_session_validity;
create view private.auth_session_validity
with (security_barrier = true)  -- defensive only: the view has no WHERE clause
as select s.id, s.user_id, s.not_after from auth.sessions s;

comment on view private.auth_session_validity is
  'SECURITY-RELEVANT (ADR 0002 §6a rev. 2): auth.sessions (id, user_id, not_after) for tenant_guard only. Owned by the migration role.';

revoke all on private.auth_session_validity from public;
grant select on private.auth_session_validity to tenant_guard;
