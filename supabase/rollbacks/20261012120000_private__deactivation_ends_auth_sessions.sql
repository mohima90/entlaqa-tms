-- Rollback of 20261012120000_private__deactivation_ends_auth_sessions.sql: no login-session trigger and helper
-- (no Auth sessions ended by a deactivation — residual N2 again); private.end_sessions and
-- private.purge_ended_sessions as in 20261012100000 (no login lock, no fixed order, no SKIP LOCKED); the
-- privileged-deactivation rule and the reactivation as in 20261011090000 (the token's `aal` claim).
drop trigger tenant_memberships_end_login_sessions on platform.tenant_memberships;
drop function private.end_unserved_logins();

revoke execute on function private.request_aal2() from membership_guard;
revoke execute on function private.request_code_fresh() from membership_guard;

-- As in 20261012100000.
create or replace function private.end_sessions(
  p_user_id uuid, p_session_ids uuid[], p_tenant_id uuid, p_reason text, p_revoked_by uuid)
returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_user_id is null or p_session_ids is null or cardinality(p_session_ids) = 0 then
    return 0;
  end if;
  insert into private.revoked_sessions (session_id, user_id, tenant_id, reason, revoked_by)
  select distinct x.id, p_user_id, p_tenant_id, p_reason, p_revoked_by
  from unnest(p_session_ids) as x (id)
  where x.id is not null
  on conflict (session_id) do nothing;
  get diagnostics v_count = row_count;
  -- Auth forgets them too (security review M1): refresh tokens and MFA claims go with them (Auth's cascades).
  delete from private.auth_session_validity s where s.user_id = p_user_id and s.id = any (p_session_ids);
  return v_count;
end
$$;

comment on function private.end_sessions(uuid, uuid[], uuid, text, uuid) is
  'SECURITY-RELEVANT (T-M2-10, review M1). Internal: ends sessions of an account — revocation marker, then the Auth session is deleted. tenant_guard only.';

-- As in 20261012100000.
create or replace function private.purge_ended_sessions(p_limit integer)
returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_claims jsonb := private.request_claims();
  v_limit integer := least(greatest(coalesce(p_limit, 0), 0), 1000);
  v_count integer;
begin
  if session_user <> 'app_worker' or coalesce(v_claims ->> 'role', '') <> 'system'
     or coalesce(btrim(v_claims ->> 'job_id'), '') = '' then
    raise exception 'reserved to the worker' using errcode = 'insufficient_privilege';
  end if;
  delete from private.revoked_sessions r where r.revoked_at < now() - interval '25 hours';
  with candidates as (
    select e.id, e.user_id, e.tenant_id, e.marked
    from (
      select s.id, s.user_id, null::uuid as tenant_id, true as marked
      from private.revoked_sessions r
      join private.auth_session_validity s on s.id = r.session_id and s.user_id = r.user_id
      union all
      select s.id, s.user_id, c.active_tenant_id, false
      from private.auth_session_validity s
      left join platform.session_context c on c.session_id = s.id and c.user_id = s.user_id
      left join platform.security_policies p on p.tenant_id = c.active_tenant_id
      where (s.created_at <= now() - interval '24 hours'
             or s.created_at <= now() - make_interval(hours => p.session_max_hours)
             or c.last_seen_at <= now() - make_interval(mins => p.session_idle_minutes))
        and not exists (select 1 from private.revoked_sessions r where r.session_id = s.id)
    ) e
    limit v_limit
  ), marked as (
    insert into private.revoked_sessions (session_id, user_id, tenant_id, reason)
    select c.id, c.user_id, c.tenant_id, 'expired' from candidates c where not c.marked
    on conflict (session_id) do nothing
    returning 1
  ), gone as (
    delete from private.auth_session_validity s
    where s.id in (select c.id from candidates c)
    returning 1
  )
  select count(*) into v_count from gone;
  return v_count;
end
$$;

comment on function private.purge_ended_sessions(integer) is
  'SECURITY-RELEVANT (T-M2-10, review M1). Worker: deletes Auth sessions that ended (markers, 24 hours, the organization''s inactivity or maximum length), at most p_limit. app_worker system claims only.';


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
