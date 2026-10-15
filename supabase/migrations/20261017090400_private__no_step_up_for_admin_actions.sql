-- No authenticator step-up for organization-level actions (PO decision, 14 Oct 2026 — "no need for an
-- authenticator to change anything as long as I'm signed in as Organization Admin; it's not a banking
-- system"). Reverses security decision D-IAM-01 (6 Oct 2026) in the database guards: the Organization
-- Admin's own role (and, for deactivation, the existing membership guards) is the rule; AAL2 and a code
-- from the last 15 minutes are no longer required to
--   - change the security policy                       private.actor_may_change_security_policy
--   - reset another member's authenticator apps        private.reset_member_mfa
--   - reactivate a member who holds a privileged role  private.reactivate_membership
--   - deactivate a member who holds a privileged role  trigger tenant_memberships_privileged_deactivation
--                                                      and private.check_privileged_deactivation (dropped:
--                                                      they did nothing else; membership_guard loses
--                                                      EXECUTE on the AAL2 helpers it needed for them)
-- (The organization profile's guard, private.actor_may_manage_tenant, is unmerged: changed in place.)
-- Kept: the organization's MFA sign-in policy (private.session_access, request_aal2 for it), a member's own
-- authenticator app (private.remove_mfa_app, the e-mailed set-up code) and the trusted-device rule after a
-- sign-in code. Who may act is unchanged: Organization Admin only for privileged members, the manage rule,
-- separation of duties, the last-admin guard and tenant isolation stay exactly as they were.
-- Owners and grants of the replaced functions are kept (CREATE OR REPLACE).

create or replace function private.actor_may_change_security_policy(p_tenant_id uuid)
returns boolean
language sql stable
set search_path = ''
as $$
  select 'tenant_admin' = any (private.actor_role_codes(p_tenant_id, private.request_user_id()));
$$;

comment on function private.actor_may_change_security_policy(uuid) is
  'SECURITY-RELEVANT (T-IAM-24; PO decision 14 Oct 2026 reversing D-IAM-01): an Organization Admin (role in force now) may change the security policy; no authenticator code needed.';

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
     or not ('tenant_admin' = any (private.actor_role_codes(v_tenant, v_actor))) then
    raise exception 'only an Organization Admin resets authenticator apps'
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
  'SECURITY-RELEVANT (FR-IAM-12, T-M2-10, TM-0003 T-IAM-10; no authenticator code since the PO decision of 14 Oct 2026). An Organization Admin resets the authenticator apps of a member they may manage whose login belongs to no other organization: apps deleted in Auth, every session ended, the member e-mailed.';

-- As in 20261012120000, without the authenticator-code step for a privileged member.
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
  'SECURITY-RELEVANT (FR-IAM-05, TM-0003 T-IAM-21; T-M2-10 review H1/L3). The signed-in Organization Admin / HR Manager reactivates a deactivated membership of their organization (privileged members: the Organization Admin; no authenticator code since the PO decision of 14 Oct 2026). app_server only; owner membership_guard.';

drop trigger tenant_memberships_privileged_deactivation on platform.tenant_memberships;
drop function private.check_privileged_deactivation();

-- membership_guard needed the AAL2 helpers only for the two checks above (20261012120000): least privilege.
-- rate_limit_guard keeps them (the trust of a remembered browser after the sign-in code, 20261013090000).
revoke execute on function private.request_aal2() from membership_guard;
revoke execute on function private.request_code_fresh() from membership_guard;
