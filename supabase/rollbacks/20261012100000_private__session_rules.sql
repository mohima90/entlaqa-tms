-- Rollback of 20261012100000_private__session_rules.sql: session validity, access decision and tenant switch
-- as in 20260930120100 / 20261012090100 (no session rules, no ended sessions); the session view without the
-- listing columns.
drop function private.end_member_sessions(uuid, uuid);
drop function private.tenant_member_sessions(uuid);
drop function private.end_my_sessions(uuid);
drop function private.my_sessions();
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
  out state text, out mfa_deadline timestamptz)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_member record;
  v_required boolean;
  v_has_app boolean;
begin
  state := 'invalid';
  if p_user_id is null or p_session_id is null or p_tenant_id is null
     or not private.user_session_is_valid(p_user_id, p_session_id) then
    return;
  end if;
  -- The session acts in this organization (ADR 0002 §3), as an active member of an active/trial one.
  select m.id as membership_id, m.created_at as member_since, p.mfa_mode, p.mfa_required_roles,
         p.mfa_grace_days, p.mfa_required_since, p.mfa_prompt_admins
    into v_member
  from platform.session_context c
  join platform.tenant_memberships m on m.tenant_id = c.active_tenant_id and m.user_id = c.user_id
  join platform.tenants t on t.id = m.tenant_id
  join platform.security_policies p on p.tenant_id = m.tenant_id
  where c.session_id = p_session_id and c.user_id = p_user_id and c.active_tenant_id = p_tenant_id
    and m.status = 'active' and t.status in ('active', 'trial');
  if not found then
    return;
  end if;
  state := 'ok';
  if p_aal2 or (v_member.mfa_mode = 'off' and not p_detail) then
    return;
  end if;

  v_required := v_member.mfa_mode = 'required_all'
    or (v_member.mfa_mode = 'required_roles' and exists (
          select 1 from platform.role_assignments ra
          where ra.tenant_id = p_tenant_id and ra.membership_id = v_member.membership_id
            and ra.role_code = any (v_member.mfa_required_roles)
            and (ra.valid_from is null or ra.valid_from <= now())
            and (ra.valid_until is null or ra.valid_until > now())));
  v_has_app := exists (select 1 from private.auth_mfa_factor f
                       where f.user_id = p_user_id and f.factor_type = 'totp' and f.status = 'verified');
  if v_required then
    mfa_deadline := greatest(v_member.mfa_required_since, v_member.member_since)
                    + make_interval(days => v_member.mfa_grace_days);
  end if;

  if v_has_app and v_member.mfa_mode <> 'off' then
    state := 'mfa_challenge';
  elsif v_required and now() >= mfa_deadline then
    state := 'mfa_enrol';
  elsif p_detail and v_required then
    state := 'prompt_grace';
  elsif p_detail and v_member.mfa_prompt_admins and not v_has_app
        and exists (select 1 from platform.role_assignments ra
                    where ra.tenant_id = p_tenant_id and ra.membership_id = v_member.membership_id
                      and ra.role_code = 'tenant_admin'
                      and (ra.valid_from is null or ra.valid_from <= now())
                      and (ra.valid_until is null or ra.valid_until > now()))
        and not exists (select 1 from private.mfa_prompt_dismissals d
                        where d.tenant_id = p_tenant_id and d.user_id = p_user_id) then
    state := 'prompt_admin';
  end if;
end
$$;

comment on function private.session_access(uuid, uuid, uuid, boolean, boolean) is
  'SECURITY-RELEVANT (ADR 0002 §6a, T-IAM-41). May this user session act in this organization now (ok), and if not why; with detail also the MFA prompts. tenant_guard only.';

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
  if not private.user_session_is_valid(v_user, v_session)
     or not private.has_active_membership(v_user, p_tenant_id) then
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

revoke execute on function private.actor_may_manage_person(uuid, uuid) from tenant_guard;
revoke execute on function private.membership_is_privileged(uuid, uuid) from tenant_guard;
drop policy ref_roles_tenant_guard_read on platform.ref_roles;
revoke select (code, is_privileged) on platform.ref_roles from tenant_guard;

drop table private.revoked_sessions;
alter table platform.session_context drop column last_seen_at;

-- A view cannot lose columns with CREATE OR REPLACE: recreated as in 20260930120100.
drop view private.auth_session_validity;
create view private.auth_session_validity
with (security_barrier = true)  -- defensive only: the view has no WHERE clause
as select s.id, s.user_id, s.not_after from auth.sessions s;

comment on view private.auth_session_validity is
  'SECURITY-RELEVANT (ADR 0002 §6a rev. 2): auth.sessions (id, user_id, not_after) for tenant_guard only. Owned by the migration role.';

revoke all on private.auth_session_validity from public;
grant select on private.auth_session_validity to tenant_guard;
