-- Rollback of 20261017090400_private__no_step_up_for_admin_actions.sql: the definitions of
-- 20261012090100 (security policy), 20261012110000 (reset_member_mfa) and 20261012120000 (reactivation,
-- privileged deactivation trigger), with their owners and grants.
create or replace function private.actor_may_change_security_policy(p_tenant_id uuid)
returns boolean
language sql stable
set search_path = ''
as $$
  select private.request_aal2() and private.request_code_fresh()
     and 'tenant_admin' = any (private.actor_role_codes(p_tenant_id, private.request_user_id()));
$$;

comment on function private.actor_may_change_security_policy(uuid) is
  'SECURITY-RELEVANT (T-IAM-24, D-IAM-01, review L3): an Organization Admin at AAL2 (confirmed app, private.request_aal2) with a code from the last 15 minutes (private.request_code_fresh) may change the security policy.';

create or replace function private.reset_member_mfa(p_person_id uuid)
returns text
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_tenant uuid := private.current_tenant_id();
  v_actor uuid := private.request_user_id();
  v_member uuid;
begin
  if v_tenant is null or v_actor is null
     or not ('tenant_admin' = any (private.actor_role_codes(v_tenant, v_actor)))
     or not private.request_aal2() or not private.request_code_fresh() then
    raise exception 'only an Organization Admin with an authenticator code resets authenticator apps'
      using errcode = 'insufficient_privilege';
  end if;
  if p_person_id is null or not private.actor_may_manage_person(v_tenant, p_person_id) then
    raise exception 'not a member this administrator may manage' using errcode = 'insufficient_privilege';
  end if;
  select m.user_id into v_member from platform.tenant_memberships m
  where m.tenant_id = v_tenant and m.person_id = p_person_id and m.user_id is not null;
  if v_member is null then
    return 'not_found';
  end if;
  if v_member = v_actor then
    return 'self';
  end if;
  if exists (select 1 from platform.tenant_memberships m join platform.tenants t on t.id = m.tenant_id
             where m.user_id = v_member and m.tenant_id <> v_tenant and m.status = 'active'
               and t.status in ('active', 'trial')) then
    return 'other_organization';
  end if;
  if private.remove_account_factors(v_member, null) = 0 then
    return 'no_app';
  end if;
  perform private.end_all_account_sessions(v_member, v_tenant, v_actor);
  perform private.queue_mfa_mail('mfa_factor_removed', v_member, null, 'admin_reset', v_tenant);
  return 'reset';
end
$$;

comment on function private.reset_member_mfa(uuid) is
  'SECURITY-RELEVANT (FR-IAM-12, T-M2-10, TM-0003 T-IAM-10). An Organization Admin at AAL2 resets the authenticator apps of a member they may manage whose login belongs to no other organization: apps deleted in Auth, every session ended, the member e-mailed.';

create or replace function private.reactivate_membership(p_person_id uuid)
returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_claims jsonb := private.request_claims();
  v_tenant uuid;
  v_actor uuid;
  v_roles text[];
  v_membership record;
begin
  if session_user <> 'app_server' or v_claims is null or coalesce(v_claims ->> 'role', '') <> 'authenticated' then
    raise exception 'reactivate_membership needs a signed-in member' using errcode = 'insufficient_privilege';
  end if;
  -- Validates the session, the caller's own ACTIVE membership and the session's organization.
  v_tenant := private.current_tenant_id();
  v_actor := private.request_user_id();
  if v_tenant is null or v_actor is null or p_person_id is null then
    raise exception 'reactivate_membership needs a signed-in member of an organization' using errcode = 'insufficient_privilege';
  end if;
  -- Serialised with every role and membership change of the organization (READ COMMITTED: the rows
  -- below are read after the lock is granted).
  perform private.lock_tenant_roles(v_tenant);

  select m.id, m.user_id, m.status into v_membership
  from platform.tenant_memberships m
  where m.tenant_id = v_tenant and m.person_id = p_person_id;
  if not found then
    raise exception 'the person has no membership in this organization' using errcode = 'JM001';
  end if;
  if v_membership.user_id = v_actor then
    raise exception 'members cannot change their own membership' using errcode = 'insufficient_privilege';
  end if;
  if v_membership.status <> 'suspended' then
    raise exception 'the membership is not deactivated' using errcode = 'JM002';
  end if;

  v_roles := private.actor_role_codes(v_tenant, v_actor);
  if not (v_roles && array['tenant_admin', 'hr_manager']) then
    raise exception 'only an Organization Admin or an HR Manager can reactivate members'
      using errcode = 'insufficient_privilege';
  end if;
  if private.membership_is_privileged(v_tenant, v_membership.id) then
    if not ('tenant_admin' = any (v_roles)) then
      raise exception 'only an Organization Admin can reactivate a member who holds a privileged role'
        using errcode = 'insufficient_privilege';
    end if;
    if not (private.request_aal2() and private.request_code_fresh()) then
      raise exception 'reactivating a member who holds a privileged role needs an authenticator code'
        using errcode = 'JM003';
    end if;
  end if;
  if not exists (select 1 from platform.persons p
                 where p.tenant_id = v_tenant and p.id = p_person_id and p.status = 'active') then
    raise exception 'the person must be active before the membership' using errcode = 'JM004';
  end if;

  update platform.tenant_memberships m set status = 'active'
  where m.id = v_membership.id and m.tenant_id = v_tenant and m.status = 'suspended';
  if not found then
    raise exception 'the membership is not deactivated' using errcode = 'JM002';
  end if;
  return v_membership.id;
end
$$;

comment on function private.reactivate_membership(uuid) is
  'SECURITY-RELEVANT (FR-IAM-05, TM-0003 T-IAM-21; T-M2-10 review H1/L3). The signed-in Organization Admin / HR Manager reactivates a deactivated membership of their organization (privileged members: Organization Admin at AAL2 through a confirmed app with a code from the last 15 minutes). app_server only; owner membership_guard.';

create or replace function private.check_privileged_deactivation()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_claims jsonb := private.request_claims();
begin
  if old.status = 'active' and new.status <> 'active'
     and coalesce(v_claims ->> 'role', '') = 'authenticated'
     and private.membership_is_privileged(new.tenant_id, new.id)
     and not (private.request_aal2() and private.request_code_fresh()) then
    raise exception 'deactivating a member who holds a privileged role needs an authenticator code'
      using errcode = 'JM003';
  end if;
  return new;
end
$$;

comment on function private.check_privileged_deactivation() is
  'SECURITY-RELEVANT (FR-IAM-05, D-IAM-01, review M4; T-M2-10 review H1/L3). Trigger: a request-path deactivation of a member who holds a privileged role needs AAL2 through a confirmed app and a code from the last 15 minutes (private.request_aal2, private.request_code_fresh). membership_guard.';

-- Ownership hand-over as in migration 20260930120100 (non-superuser migration role on hosted Supabase).
grant create on schema private to membership_guard;
alter function private.check_privileged_deactivation() owner to membership_guard;
revoke create on schema private from membership_guard;
revoke all on function private.check_privileged_deactivation() from public;

create trigger tenant_memberships_privileged_deactivation before update of status on platform.tenant_memberships
  for each row execute function private.check_privileged_deactivation();

grant execute on function private.request_aal2() to membership_guard;
grant execute on function private.request_code_fresh() to membership_guard;
