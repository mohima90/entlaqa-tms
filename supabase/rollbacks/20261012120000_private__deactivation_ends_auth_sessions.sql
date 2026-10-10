-- Rollback of 20261012120000_private__deactivation_ends_auth_sessions.sql: the session-ending trigger, the
-- privileged-deactivation rule and the reactivation as in 20261011090000 (the token's `aal` claim; no Auth
-- sessions ended — residual N2 again), without the login-session helper.
revoke execute on function private.request_aal2() from membership_guard;
revoke execute on function private.request_code_fresh() from membership_guard;

create or replace function private.end_member_sessions()
returns trigger
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  if old.status = 'active' and new.status <> 'active' then
    -- Waits for an organization switch of this membership in flight (it holds the lock shared until it
    -- commits); the DELETE below is a later statement, so it sees that switch's row (READ COMMITTED).
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'platform.membership:' || new.tenant_id::text || ':' || new.user_id::text, 0));
    delete from platform.session_context c
    where c.active_tenant_id = new.tenant_id and c.user_id = new.user_id;
  end if;
  return null;
end
$$;

comment on function private.end_member_sessions() is
  'SECURITY-RELEVANT (FR-IAM-05, T-IAM-39/40). Trigger: a membership leaving active ends that organization''s sign-in sessions of the user (session_context rows). membership_guard.';

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
     and (v_claims ->> 'aal') is distinct from 'aal2' then
    raise exception 'deactivating a member who holds a privileged role needs an authenticator code'
      using errcode = 'JM003';
  end if;
  return new;
end
$$;

comment on function private.check_privileged_deactivation() is
  'SECURITY-RELEVANT (FR-IAM-05, D-IAM-01, review M4). Trigger: a request-path deactivation of a member who holds a privileged role needs AAL2. membership_guard.';

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
    if (v_claims ->> 'aal') is distinct from 'aal2' then
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
  'SECURITY-RELEVANT (FR-IAM-05, TM-0003 T-IAM-21). The signed-in Organization Admin / HR Manager reactivates a deactivated membership of their organization (privileged members: Organization Admin with AAL2). app_server only; owner membership_guard.';

drop function private.end_unserved_login_sessions(uuid, uuid, uuid);
