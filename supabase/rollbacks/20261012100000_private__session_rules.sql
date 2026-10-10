-- Rollback of 20261012100000_private__session_rules.sql: session validity as in 20260930120100, the tenant
-- switch as in 20261011090000 (T-M2-09: the membership's advisory lock, shared), the access decision as in
-- 20261012090100 (no session rules, no ended sessions), without the activity, the device limit, the lists
-- and sign-out, the purge and the account audit helper.
drop function private.purge_ended_sessions(integer);
drop function private.end_member_sessions(uuid, uuid);
drop function private.tenant_member_sessions(uuid);
drop function private.end_my_sessions(uuid);
drop function private.my_sessions();
drop function private.apply_device_limit();
drop function private.touch_session();

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

create or replace function private.session_access(
  p_user_id uuid, p_session_id uuid, p_tenant_id uuid, p_aal2 boolean, p_detail boolean,
  out state text, out mfa_deadline timestamptz, out uses_app boolean, out mfa_pending boolean, out aal2 boolean)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v record;
  v_required boolean;
  v_no_grace boolean;
begin
  state := 'invalid';
  aal2 := false;
  if p_user_id is null or p_session_id is null or p_tenant_id is null
     or not private.user_session_is_valid(p_user_id, p_session_id) then
    return;
  end if;
  -- The session acts in this organization (ADR 0002 §3), as an active member of an active/trial one; its
  -- own assurance level and whether the factor it passed is a confirmed app.
  select m.id as membership_id, m.created_at as member_since, p.mfa_mode, p.mfa_required_roles,
         p.mfa_grace_days, p.mfa_required_since, p.mfa_prompt_admins,
         s.aal as session_aal, k.factor_id is not null as factor_confirmed
    into v
  from private.auth_session_validity s
  join platform.session_context c on c.session_id = s.id and c.user_id = s.user_id
  join platform.tenant_memberships m on m.tenant_id = c.active_tenant_id and m.user_id = c.user_id
  join platform.tenants t on t.id = m.tenant_id
  join platform.security_policies p on p.tenant_id = m.tenant_id
  left join private.mfa_factor_confirmations k
    on k.factor_id = s.factor_id and k.user_id = s.user_id and k.confirmed_at is not null
  where s.id = p_session_id and s.user_id = p_user_id and c.active_tenant_id = p_tenant_id
    and m.status = 'active' and t.status in ('active', 'trial');
  if not found then
    return;
  end if;
  state := 'ok';
  if p_aal2 is null then
    return;  -- lifecycle only (lists, sign-out): the MFA rules are not asked
  end if;
  -- The lower of the token's claim and the Auth session's own level, with a confirmed app (review H1).
  aal2 := p_aal2 and v.session_aal = 'aal2' and v.factor_confirmed;
  if (aal2 or v.mfa_mode = 'off') and not p_detail then
    return;
  end if;

  v_required := v.mfa_mode = 'required_all'
    or (v.mfa_mode = 'required_roles' and exists (
          select 1 from platform.role_assignments ra
          where ra.tenant_id = p_tenant_id and ra.membership_id = v.membership_id
            and ra.role_code = any (v.mfa_required_roles)
            and (ra.valid_from is null or ra.valid_from <= now())
            and (ra.valid_until is null or ra.valid_until > now())));
  uses_app := exists (select 1 from private.auth_mfa_factor f
                      join private.mfa_factor_confirmations k on k.factor_id = f.id and k.user_id = f.user_id
                      where f.user_id = p_user_id and f.factor_type = 'totp' and f.status = 'verified'
                        and k.confirmed_at is not null);
  mfa_pending := not uses_app and exists (
    select 1 from private.auth_mfa_factor f
    where f.user_id = p_user_id and f.factor_type = 'totp' and f.status = 'verified');
  if v_required then
    v_no_grace := exists (select 1 from platform.role_assignments ra
                          where ra.tenant_id = p_tenant_id and ra.membership_id = v.membership_id
                            and ra.role_code = any (private.mfa_no_grace_roles())
                            and (ra.valid_from is null or ra.valid_from <= now())
                            and (ra.valid_until is null or ra.valid_until > now()));
    mfa_deadline := greatest(v.mfa_required_since, v.member_since)
                    + make_interval(days => case when v_no_grace then 0 else v.mfa_grace_days end);
  end if;
  if aal2 then
    return;
  end if;

  if uses_app and v.mfa_mode <> 'off' then
    state := 'mfa_challenge';
  elsif v_required and now() >= mfa_deadline then
    state := 'mfa_enrol';
  elsif p_detail and v_required then
    state := 'prompt_grace';
  elsif p_detail and v.mfa_prompt_admins and not uses_app
        and exists (select 1 from platform.role_assignments ra
                    where ra.tenant_id = p_tenant_id and ra.membership_id = v.membership_id
                      and ra.role_code = 'tenant_admin'
                      and (ra.valid_from is null or ra.valid_from <= now())
                      and (ra.valid_until is null or ra.valid_until > now()))
        and not exists (select 1 from private.mfa_prompt_dismissals d
                        where d.tenant_id = p_tenant_id and d.user_id = p_user_id
                          and d.dismissed_at > now() - private.mfa_prompt_reask_after()) then
    state := 'prompt_admin';
  end if;
end
$$;

comment on function private.session_access(uuid, uuid, uuid, boolean, boolean) is
  'SECURITY-RELEVANT (ADR 0002 §6a, T-IAM-41, T-IAM-11). May this user session act in this organization now (ok), and if not why; with detail also the MFA prompts, whether the account uses a confirmed app or one awaits confirmation, and the effective AAL2. aal2 NULL: lifecycle only. tenant_guard only.';

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
  if not private.user_session_is_valid(v_user, v_session) or p_tenant_id is null then
    return false;
  end if;
  perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended(
    'platform.membership:' || p_tenant_id::text || ':' || v_user::text, 0));
  if not private.has_active_membership(v_user, p_tenant_id) then
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

drop function private.enforce_device_limit(uuid, uuid, uuid);
drop function private.end_sessions(uuid, uuid[], uuid, text, uuid);
drop function private.audit_account_event(uuid, text, jsonb, text, uuid, uuid);

drop policy audit_events_tenant_guard_insert on platform.audit_events;
revoke insert (tenant_id, actor_user_id, actor_person_id, action, entity_type, entity_id, data)
  on platform.audit_events from tenant_guard;

revoke execute on function private.actor_may_manage_person(uuid, uuid) from tenant_guard;
revoke execute on function private.membership_is_privileged(uuid, uuid) from tenant_guard;
drop policy ref_roles_tenant_guard_read on platform.ref_roles;
revoke select (code, is_privileged) on platform.ref_roles from tenant_guard;

drop table private.revoked_sessions;
alter table platform.session_context drop column device_limit_applied;
alter table platform.session_context drop column last_seen_at;
