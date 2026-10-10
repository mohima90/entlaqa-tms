-- Deactivation meets the sign-in session rules (FR-IAM-05, FR-IAM-12/13; T-M2-09 × T-M2-10 integration;
-- TM-0003 T-IAM-39/40, T-IAM-11). PII: none.
--
-- SECURITY-RELEVANT.
--   * Residual N2 of T-M2-09 (TM-0003 T-IAM-39) closed: a refused refresh is rolled back by Auth, never
--     revoked, so a refresh token from before a deactivation used to work again after the reactivation. When a
--     membership leaves `active` (deactivated, revoked; any writer) and the login is then an active member of
--     NO active or trial organization any more, the deactivation also ends EVERY Auth session of the login
--     through T-M2-10's path (private.end_sessions: a revocation marker, reason 'admin', then the Auth session
--     is deleted through private.auth_session_validity — its refresh tokens go with it). A login that is still
--     an active member elsewhere keeps its sessions there: a tenant action never signs a shared login out of
--     another organization (T-IAM-40). A pending invitation elsewhere does not keep the sessions (the hook
--     still lets the account sign in again to accept it, 20261011090100).
--     Two deactivations of the same login in two organizations at once cannot both see the other membership
--     as still active: the decision takes a per-login advisory lock held until commit, so the second one
--     decides after the first committed (READ COMMITTED: its check is a later statement).
--     private.end_unserved_login_sessions(user, tenant, actor): SECURITY DEFINER, owner tenant_guard (it owns
--     the session-ending path), EXECUTE for membership_guard only — called by private.end_member_sessions()
--     (the T-M2-09 trigger, owner membership_guard), redefined here.
--   * T-M2-09's authenticator-code rule in the database (deactivating or reactivating a member who holds a
--     privileged role, D-IAM-01, review M4) now uses T-M2-10's AAL2 (security review H1, review L3): the
--     token's `aal` claim alone is not enough any more — private.request_aal2() (claim aal2, the Auth session
--     at aal2, through a CONFIRMED app) and private.request_code_fresh() (a code from the last 15 minutes),
--     as defineAction already requires for platform.role.assign_privileged. EXECUTE on both for
--     membership_guard (its trigger and reactivation function call them).
-- Lock order (deadlock-free): the membership lock (private.end_member_sessions(), exclusive) → the login lock
-- (here). No other path takes the login lock.

grant tenant_guard to current_user;
grant membership_guard to current_user;

-- ---------------------------------------------------------------------------------------------------
-- The login's Auth sessions end when it belongs nowhere any more
-- ---------------------------------------------------------------------------------------------------
create or replace function private.end_unserved_login_sessions(p_user_id uuid, p_tenant_id uuid, p_revoked_by uuid)
returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    return 0;
  end if;
  -- One decision per login at a time, until commit (see the header).
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('platform.login_sessions:' || p_user_id::text, 0));
  if exists (select 1
             from platform.tenant_memberships m
             join platform.tenants t on t.id = m.tenant_id
             where m.user_id = p_user_id and m.status = 'active' and t.status in ('active', 'trial')) then
    return 0;
  end if;
  return private.end_sessions(
    p_user_id, array(select s.id from private.auth_session_validity s where s.user_id = p_user_id),
    p_tenant_id, 'admin', p_revoked_by);
end
$$;

comment on function private.end_unserved_login_sessions(uuid, uuid, uuid) is
  'SECURITY-RELEVANT (FR-IAM-05, T-M2-09 residual N2, T-M2-10; TM-0003 T-IAM-39/40). Internal: after a membership left active, ends every Auth session of the login (marker, then the Auth session) when it is an active member of no active or trial organization any more. Per-login lock. tenant_guard; EXECUTE membership_guard only.';

-- As in 20261011090000, plus: the login's Auth sessions end when no active membership remains.
create or replace function private.end_member_sessions()
returns trigger
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_claims jsonb := private.request_claims();
begin
  if old.status = 'active' and new.status <> 'active' then
    -- Waits for an organization switch of this membership in flight (it holds the lock shared until it
    -- commits); the DELETE below is a later statement, so it sees that switch's row (READ COMMITTED).
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'platform.membership:' || new.tenant_id::text || ':' || new.user_id::text, 0));
    delete from platform.session_context c
    where c.active_tenant_id = new.tenant_id and c.user_id = new.user_id;
    -- Residual N2 (T-IAM-39): no active membership left → every Auth session of the login ends. The actor is
    -- recorded for a request-path change (user claims), never for a platform operation or a job.
    perform private.end_unserved_login_sessions(
      new.user_id, new.tenant_id,
      case when coalesce(v_claims ->> 'role', '') = 'authenticated' then private.request_user_id() end);
  end if;
  return null;
end
$$;

comment on function private.end_member_sessions() is
  'SECURITY-RELEVANT (FR-IAM-05, T-IAM-39/40). Trigger: a membership leaving active ends that organization''s sign-in sessions of the user (session_context rows) and, when the login is an active member nowhere any more, every Auth session of the login (private.end_unserved_login_sessions). membership_guard.';

-- ---------------------------------------------------------------------------------------------------
-- The authenticator-code rule with T-M2-10's AAL2
-- ---------------------------------------------------------------------------------------------------
-- As in 20261011090000, with private.request_aal2() and private.request_code_fresh() instead of the claim.
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

-- As in 20261011090000, with private.request_aal2() and private.request_code_fresh() instead of the claim.
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

-- ---------------------------------------------------------------------------------------------------
-- Ownership and privileges
-- ---------------------------------------------------------------------------------------------------
-- Ownership hand-over as in migration 20260930120100 (non-superuser migration role on hosted Supabase). The
-- three redefined functions keep their owner (membership_guard) and privileges.
grant create on schema private to tenant_guard;
alter function private.end_unserved_login_sessions(uuid, uuid, uuid) owner to tenant_guard;
revoke create on schema private from tenant_guard;

revoke all on function private.end_unserved_login_sessions(uuid, uuid, uuid) from public;
grant execute on function private.end_unserved_login_sessions(uuid, uuid, uuid) to membership_guard;

-- What membership_guard's trigger and reactivation call now (both SECURITY DEFINER, owner tenant_guard).
grant execute on function private.request_aal2() to membership_guard;
grant execute on function private.request_code_fresh() to membership_guard;
