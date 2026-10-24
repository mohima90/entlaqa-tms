-- A suspended organization's Organization Admin reaches the Subscription page only (WP-ADM-06; PO 24 Oct 2026:
-- "the Org Admin signs in to the Subscription page only — status, plan, contact ENTLAQA; later, with online
-- payment, they reactivate the service from that page"). Class: P. PII: none.
--
-- While an organization is SUSPENDED (by ENTLAQA, or its trial ended):
--   * its members who hold platform.tenant.manage (the Organization Admin; "paused admins") may still sign in
--     and choose the organization; their session acts there in the state 'paused' (private.session_access):
--     private.current_tenant_id() stays null, so every page, action and database guard keeps refusing —
--     only the plan view (private.organization_plan) answers;
--   * everyone else is refused at sign-in (and at the next token refresh) with its own message, so the web
--     app shows «Access paused» instead of the neutral refusal. The message is given only after the password
--     (or a refresh token) was accepted.
-- A CANCELLED organization: nobody signs in (unchanged).
--
-- Functions:
--   private.paused_admin_tenants(user)      the suspended organizations where the user is a paused admin
--   private.account_access_paused(user)     the account belongs to a suspended organization (the message)
--   private.account_sign_in_refused(user)   + a paused admin is not refused
--   private.custom_access_token_hook(event) + the paused message; the organization claim for a paused admin
--   private.session_tenants()               + the paused admin's organizations
--   private.switch_active_tenant(uuid)      + a paused admin may act there (paused)
--   private.session_access(…)               + the state 'paused'
--   private.organization_plan()             + answers in the state 'paused'
-- Expand-first: same signatures; one new session state the web app learns in the same release.

-- ---------------------------------------------------------------------------------------------------
-- Who is a paused admin; who is paused
-- ---------------------------------------------------------------------------------------------------
create or replace function private.paused_admin_tenants(p_user_id uuid)
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select m.tenant_id
  from platform.tenant_memberships m
  join platform.tenants t on t.id = m.tenant_id
  where m.user_id = p_user_id and m.status = 'active' and t.status = 'suspended'
    and private.member_has_permission(m.tenant_id, p_user_id, 'platform.tenant.manage');
$$;
comment on function private.paused_admin_tenants(uuid) is
  'SECURITY-RELEVANT (WP-ADM-06). The suspended organizations in which the user, an active member, holds platform.tenant.manage (the Organization Admin): there the session may act in the state paused (the Subscription page only).';

create or replace function private.account_access_paused(p_user_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from platform.tenant_memberships m
                 join platform.tenants t on t.id = m.tenant_id
                 where m.user_id = p_user_id and m.status = 'active' and t.status = 'suspended');
$$;
comment on function private.account_access_paused(uuid) is
  'SECURITY-RELEVANT (WP-ADM-06). The account is an active member of a suspended organization: a refused sign-in says «access paused». Auth''s hook only.';

grant create on schema private to membership_guard;
alter function private.paused_admin_tenants(uuid) owner to membership_guard;
alter function private.account_access_paused(uuid) owner to membership_guard;
revoke create on schema private from membership_guard;
revoke all on function private.paused_admin_tenants(uuid) from public;
revoke all on function private.account_access_paused(uuid) from public;
grant execute on function private.paused_admin_tenants(uuid) to supabase_auth_admin, tenant_guard;
grant execute on function private.account_access_paused(uuid) to supabase_auth_admin;

-- ---------------------------------------------------------------------------------------------------
-- Sign-in: a paused admin is not refused (definition of 20261016090100, plus the paused admin)
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.account_sign_in_refused(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p_user_id is null
      or (exists (select 1 from platform.tenant_memberships m where m.user_id = p_user_id)
          and not exists (
            select 1
            from platform.tenant_memberships m
            join platform.tenants t on t.id = m.tenant_id
            where m.user_id = p_user_id and m.status = 'active' and t.status in ('active', 'trial'))
          and not exists (select 1 from private.paused_admin_tenants(p_user_id))
          and not exists (
            select 1
            from private.auth_account_email a
            join platform.invitations i on i.email = lower(a.email)
            join platform.tenants t on t.id = i.tenant_id
            where a.id = p_user_id and i.status = 'pending' and not i.mail_held and i.expires_at > now()
              and t.status in ('active', 'trial')));
$function$;

-- ---------------------------------------------------------------------------------------------------
-- The access-token hook (definition of 20261011090100, plus the paused message and the paused admin's
-- organization claim)
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.custom_access_token_hook(event jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  -- Neutral: says nothing about memberships (only someone with the right password or a refresh token
  -- reaches it; the web app shows every refused sign-in alike).
  v_deny constant jsonb := '{"error": {"http_code": 403, "message": "Sign-in is not available for this account."}}';
  -- An error is not a refusal (review N1): no token either, but a server error the client retries.
  v_failed constant jsonb := '{"error": {"http_code": 500, "message": "Sign-in is temporarily unavailable."}}';
  -- A member of a suspended organization (WP-ADM-06): the web app shows «Access paused». Only someone with
  -- the right password or a refresh token reaches it.
  v_paused constant jsonb := '{"error": {"http_code": 403, "message": "Access to this organization is paused."}}';
  v_claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  v_user uuid := private.try_uuid(event ->> 'user_id');
  v_session uuid := private.try_uuid(event -> 'claims' ->> 'session_id');
  v_tenant uuid;
  v_person uuid;
begin
  begin
    -- No token at all for an account that belongs nowhere any more (sign-in and refresh alike).
    if private.account_sign_in_refused(v_user) is not false then
      if private.account_access_paused(v_user) then
        return v_paused;
      end if;
      return v_deny;
    end if;

    v_claims := v_claims - 'tenant_id' - 'person_id';

    if v_session is not null then
      select m.tenant_id, m.person_id
        into v_tenant, v_person
      from platform.session_context c
      join platform.tenant_memberships m
        on m.tenant_id = c.active_tenant_id and m.user_id = c.user_id
      join platform.tenants t on t.id = m.tenant_id
      where c.session_id = v_session
        and c.user_id = v_user
        and m.status = 'active'
        and (t.status in ('active', 'trial')
             or (t.status = 'suspended' and m.tenant_id in (select private.paused_admin_tenants(v_user))));
    end if;

    if v_tenant is not null then
      v_claims := v_claims || jsonb_build_object('tenant_id', v_tenant, 'person_id', v_person);
    end if;

    return jsonb_set(event, '{claims}', v_claims);
  exception when others then
    -- Fail closed: no token. Only the SQLSTATE is logged (no account id, no e-mail); the prefix is what
    -- alerting looks for.
    raise warning 'custom_access_token_hook: no token issued after an error (SQLSTATE %)', sqlstate;
    return v_failed;
  end;
end
$function$;

-- ---------------------------------------------------------------------------------------------------
-- The organizations a session may choose (definition of 20261001120000, plus the paused admin's)
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.session_tenants()
 RETURNS TABLE(tenant_id uuid, name_ar text, name_en text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_claims jsonb := private.request_claims();
  v_user uuid;
  v_session uuid;
begin
  if session_user <> 'app_server' or v_claims is null or coalesce(v_claims ->> 'role', '') <> 'authenticated' then
    return;
  end if;
  v_user := private.try_uuid(v_claims ->> 'sub');
  v_session := private.try_uuid(v_claims ->> 'session_id');
  if not private.user_session_is_valid(v_user, v_session) then
    return;
  end if;

  return query
    select t.id, t.name_ar, t.name_en
    from platform.tenant_memberships m
    join platform.tenants t on t.id = m.tenant_id
    where m.user_id = v_user
      and m.status = 'active'
      and (t.status in ('active', 'trial')
           or (t.status = 'suspended' and m.tenant_id in (select private.paused_admin_tenants(v_user))))
    order by t.name_ar, t.id;
end
$function$;

-- ---------------------------------------------------------------------------------------------------
-- Choosing the organization (definition of 20261026100300, plus the paused admin's organizations)
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.switch_active_tenant(p_tenant_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_kept boolean;
  v_claims jsonb := private.request_claims();
  v_user uuid;
  v_session uuid;
  v_current uuid;
  v_last_seen timestamptz;
  v_started timestamptz;
  v_policy record;
begin
  if session_user <> 'app_server' or v_claims is null or coalesce(v_claims ->> 'role', '') <> 'authenticated' then
    return false;
  end if;
  v_user := private.try_uuid(v_claims ->> 'sub');
  v_session := private.try_uuid(v_claims ->> 'session_id');
  if not private.user_session_is_valid(v_user, v_session) or p_tenant_id is null then
    return false;
  end if;
  -- As in 20261011090000 (T-M2-09, review L3): the membership's advisory lock SHARED from before the
  -- membership check until commit. A deactivation takes it EXCLUSIVE (private.end_member_sessions()): either
  -- this switch commits first and its session_context row is then removed, or it waits and then finds the
  -- membership no longer active.
  perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended(
    'platform.membership:' || p_tenant_id::text || ':' || v_user::text, 0));
  if not private.has_active_membership(v_user, p_tenant_id)
     and not exists (select 1 from private.paused_admin_tenants(v_user) x where x = p_tenant_id) then
    return false;
  end if;
  -- A session its current organization's rules ended (inactivity, maximum length) signs in again.
  select c.active_tenant_id, c.last_seen_at into v_current, v_last_seen
  from platform.session_context c where c.session_id = v_session and c.user_id = v_user;
  if v_current is not null
     and (private.session_access(v_user, v_session, v_current, null, false)).state = 'ended' then
    return false;
  end if;
  -- …and one the TARGET organization's rules would end at once (review L2): its last activity (or its start,
  -- before any organization) older than that organization's inactivity limit, or older than its maximum length.
  select s.created_at,
         exists (select 1 from private.kept_sessions ks where ks.session_id = s.id and ks.user_id = s.user_id and private.kept_until_effective(ks.user_id, ks.kept_until, ks.created_at) > now())
    into v_started, v_kept
  from private.auth_session_validity s where s.id = v_session and s.user_id = v_user;
  select p.session_idle_minutes, p.session_max_hours into v_policy
  from platform.security_policies p where p.tenant_id = p_tenant_id;
  if not found
     or (not coalesce(v_kept, false)
         and (coalesce(v_last_seen, v_started) <= now() - make_interval(mins => v_policy.session_idle_minutes)
              or v_started <= now() - make_interval(hours => v_policy.session_max_hours))) then
    return false;
  end if;

  insert into platform.session_context as c (session_id, user_id, active_tenant_id, updated_at, last_seen_at,
                                            device_limit_applied)
  values (v_session, v_user, p_tenant_id, now(), now(), false)
  on conflict (session_id) do update
    set active_tenant_id = excluded.active_tenant_id,
        updated_at = excluded.updated_at,
        last_seen_at = excluded.last_seen_at,
        device_limit_applied = false
    where c.user_id = excluded.user_id;
  if not found then
    return false;
  end if;

  -- The device limit applies once the session may act there with its OWN assurance level (review L1: a
  -- password alone cannot push the account's other sessions out while the organization still wants a code).
  if (private.session_access(v_user, v_session, p_tenant_id, true, false)).state = 'ok' then
    perform private.enforce_device_limit(v_user, v_session, p_tenant_id);
  end if;
  -- Markers older than the platform's 24 hours protect nothing any more (those sessions are invalid).
  delete from private.revoked_sessions r where r.revoked_at < now() - interval '31 days';
  return true;
end
$function$;

-- ---------------------------------------------------------------------------------------------------
-- Where a session stands (definition of 20261026100300, plus the state 'paused')
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.session_access(p_user_id uuid, p_session_id uuid, p_tenant_id uuid, p_aal2 boolean, p_detail boolean, OUT state text, OUT mfa_deadline timestamp with time zone, OUT uses_app boolean, OUT mfa_pending boolean, OUT aal2 boolean)
 RETURNS record
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v record;
  v_required boolean;
  v_no_grace boolean;
  v_paused boolean := false;
begin
  state := 'invalid';
  aal2 := false;
  if p_user_id is null or p_session_id is null or p_tenant_id is null then
    return;
  end if;
  -- Ended (marker): told so even after Auth deleted the session (review M1).
  if exists (select 1 from private.revoked_sessions r where r.session_id = p_session_id and r.user_id = p_user_id) then
    state := 'ended';
    return;
  end if;
  -- One statement for the session, its context, the membership, the organization, its policy and whether the
  -- factor the session passed is a confirmed app.
  select s.created_at as started_at, s.aal as session_aal, k.factor_id is not null as factor_confirmed,
         c.active_tenant_id, c.last_seen_at, ks.session_id is not null as kept,
         m.id as membership_id, m.created_at as member_since, m.status as member_status, t.status as tenant_status,
         p.mfa_mode, p.mfa_required_roles, p.mfa_grace_days, p.mfa_required_since, p.mfa_prompt_admins,
         p.session_idle_minutes, p.session_max_hours
    into v
  from private.auth_session_validity s
  left join private.mfa_factor_confirmations k
    on k.factor_id = s.factor_id and k.user_id = s.user_id and k.confirmed_at is not null
  left join platform.session_context c on c.session_id = s.id and c.user_id = s.user_id
  left join private.kept_sessions ks on ks.session_id = s.id and ks.user_id = s.user_id and private.kept_until_effective(ks.user_id, ks.kept_until, ks.created_at) > now()
  left join platform.tenant_memberships m on m.tenant_id = p_tenant_id and m.user_id = s.user_id
  left join platform.tenants t on t.id = p_tenant_id
  left join platform.security_policies p on p.tenant_id = p_tenant_id
  where s.id = p_session_id and s.user_id = p_user_id and (s.not_after is null or s.not_after > now());
  if not found then
    return;  -- no live Auth session of this user
  end if;
  if coalesce(v.started_at <= now() - interval '24 hours' and not v.kept, true) then
    state := 'ended';
    return;
  end if;
  -- The session acts in this organization (ADR 0002 §3), as an active member of an active/trial one.
  -- A suspended organization: its paused admins only, in the state 'paused' (WP-ADM-06).
  v_paused := v.tenant_status = 'suspended' and v.member_status = 'active'
              and exists (select 1 from private.paused_admin_tenants(p_user_id) x where x = p_tenant_id);
  if v.active_tenant_id is distinct from p_tenant_id or v.member_status is distinct from 'active'
     or not (coalesce(v.tenant_status in ('active', 'trial'), false) or v_paused) or v.mfa_mode is null then
    return;
  end if;
  -- A kept session ("Remember this browser") lives until its own date instead (WP-ADM-05).
  if not v.kept and (v.started_at <= now() - make_interval(hours => v.session_max_hours)
     or v.last_seen_at <= now() - make_interval(mins => v.session_idle_minutes)) then
    state := 'ended';
    return;
  end if;
  <<decide>>
  begin
    state := 'ok';
    if p_aal2 is null then
      exit decide;  -- lifecycle only (lists, sign-out, device limit): the MFA rules are not asked
    end if;
    -- The lower of the token's claim and the Auth session's own level, with a confirmed app (review H1).
    aal2 := p_aal2 and v.session_aal = 'aal2' and v.factor_confirmed;
    if (aal2 or v.mfa_mode = 'off') and not p_detail then
      exit decide;
    end if;

    -- "Required for roles" covers the roles listed and — when a privileged standard role is listed — every
    -- privileged custom role too (security review M2: custom roles are not listed one by one).
    v_required := v.mfa_mode = 'required_all'
      or (v.mfa_mode = 'required_roles' and (exists (
            select 1 from platform.role_assignments ra
            where ra.tenant_id = p_tenant_id and ra.membership_id = v.membership_id
              and ra.role_code = any (v.mfa_required_roles)
              and (ra.valid_from is null or ra.valid_from <= now())
              and (ra.valid_until is null or ra.valid_until > now()))
          or (v.mfa_required_roles && array['tenant_admin', 'hr_manager']::text[]
              and private.membership_holds_privileged_custom_role(p_tenant_id, v.membership_id))));
    uses_app := exists (select 1 from private.auth_mfa_factor f
                        join private.mfa_factor_confirmations k on k.factor_id = f.id and k.user_id = f.user_id
                        where f.user_id = p_user_id and f.factor_type = 'totp' and f.status = 'verified'
                          and k.confirmed_at is not null);
    mfa_pending := not uses_app and exists (
      select 1 from private.auth_mfa_factor f
      where f.user_id = p_user_id and f.factor_type = 'totp' and f.status = 'verified');
    if v_required then
      -- No grace for members holding a high-risk permission, by any role, custom roles included (TM-0003
      -- T-IAM-11; security review M2).
      v_no_grace := exists (select 1 from platform.role_assignments ra
                            where ra.tenant_id = p_tenant_id and ra.membership_id = v.membership_id
                              and ra.role_code = any (private.mfa_no_grace_roles())
                              and (ra.valid_from is null or ra.valid_from <= now())
                              and (ra.valid_until is null or ra.valid_until > now()))
                    or private.membership_holds_high_risk(p_tenant_id, v.membership_id);
      mfa_deadline := greatest(v.mfa_required_since, v.member_since)
                      + make_interval(days => case when v_no_grace then 0 else v.mfa_grace_days end);
    end if;
    if aal2 then
      exit decide;
    end if;

    if uses_app and v.mfa_mode <> 'off' then
      state := 'mfa_challenge';
    elsif v_required and now() >= mfa_deadline then
      state := 'mfa_enrol';
    elsif p_detail and v_required then
      state := 'prompt_grace';
    elsif p_detail and v.mfa_prompt_admins and not uses_app
          -- The administrators' prompt: everyone holding a high-risk permission (the Organization Admin, and
          -- custom roles with one — security review M2).
          and private.membership_holds_high_risk(p_tenant_id, v.membership_id)
          and not exists (select 1 from private.mfa_prompt_dismissals d
                          where d.tenant_id = p_tenant_id and d.user_id = p_user_id
                            and d.dismissed_at > now() - private.mfa_prompt_reask_after()) then
      state := 'prompt_admin';
    end if;
  end;
  -- The organization is suspended: the session may see the Subscription page only (MFA states stay).
  if v_paused and state in ('ok', 'prompt_grace', 'prompt_admin') then
    state := 'paused';
  end if;
end
$function$;

-- ---------------------------------------------------------------------------------------------------
-- The Organization Admin's view: also while paused (definition of 20261027100000)
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.organization_plan()
 RETURNS TABLE(has_plan boolean, plan_name text, plan_description text, status text, trial_ends_at timestamp with time zone, max_people integer, people_used integer, max_storage_gb integer, storage_used_bytes bigint, features text[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid := private.current_tenant_id();
  v_user uuid := private.request_user_id();
begin
  -- A suspended organization's Organization Admin: the session is 'paused' there (a paused admin, checked
  -- by private.session_access); the organization is the token's.
  if v_tenant is null and session_user = 'app_server' and (select s.state from private.session_access_state() s) = 'paused' then
    v_tenant := private.try_uuid(private.request_claims() ->> 'tenant_id');
    v_user := private.try_uuid(private.request_claims() ->> 'sub');
  elsif v_tenant is not null and v_user is not null
        and not private.member_has_permission(v_tenant, v_user, 'platform.tenant.manage') then
    v_tenant := null;
  end if;
  if session_user <> 'app_server' or v_tenant is null or v_user is null then
    raise exception 'the plan is shown to the Organization Admin' using errcode = 'insufficient_privilege';
  end if;
  return query
    select p.id is not null, p.name, p.description, t.status, t.trial_ends_at,
           l.max_people, private.tenant_people_used(t.id), l.max_storage_gb, private.tenant_storage_used(t.id),
           coalesce(p.features, private.plan_feature_codes())
    from platform.tenants t
    left join private.plans p on p.id = t.plan_id
    cross join lateral private.tenant_limits(t.id) l
    where t.id = v_tenant;
end
$function$;

grant execute on function private.session_access_state() to plan_guard;
