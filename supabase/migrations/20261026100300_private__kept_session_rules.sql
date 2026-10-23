-- «Remember this browser» = «keep me signed in» (WP-ADM-05, FR-IAM-12; PO 23 Oct 2026): the session rules let a
-- KEPT session (private.kept_sessions, 20261026100100) live until its own date - the strictest organization's
-- 1 / 7 / 14 / 30 days - instead of the organization's idle and maximum-length rules and the platform's 24
-- hours. Everything else still ends it: sign-out, «End sessions», deactivation, a password change or reset, the
-- device limit, «Forget all», and the date itself. Markers of ended sessions are kept 31 days (they outlive the
-- longest kept session) instead of 25 hours.
--
--   private.user_session_is_valid   the platform's 24-hour floor does not apply to a kept session
--   private.session_access          idle / maximum length / 24 hours do not apply to a kept session
--   private.switch_active_tenant    nor does the target organization's idle / maximum-length check
--   private.touch_session           activity is recorded for a kept session beyond the idle limit too
--   private.purge_ended_sessions    the worker ends a kept session at its date, not at 24 hours / idle / max
-- Same signatures and owners; the bodies of the latest migrations plus the kept-session conditions.

grant tenant_guard to current_user;

CREATE OR REPLACE FUNCTION private.user_session_is_valid(p_user_id uuid, p_session_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      and (s.created_at > now() - interval '24 hours'
           or exists (select 1 from private.kept_sessions ks
                      where ks.session_id = s.id and ks.user_id = s.user_id and ks.kept_until > now()))
      and not exists (select 1 from private.revoked_sessions r where r.session_id = s.id)
  );
end
$function$;

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
  left join private.kept_sessions ks on ks.session_id = s.id and ks.user_id = s.user_id and ks.kept_until > now()
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
  if v.active_tenant_id is distinct from p_tenant_id or v.member_status is distinct from 'active'
     or not coalesce(v.tenant_status in ('active', 'trial'), false) or v.mfa_mode is null then
    return;
  end if;
  -- A kept session ("Remember this browser") lives until its own date instead (WP-ADM-05).
  if not v.kept and (v.started_at <= now() - make_interval(hours => v.session_max_hours)
     or v.last_seen_at <= now() - make_interval(mins => v.session_idle_minutes)) then
    state := 'ended';
    return;
  end if;
  state := 'ok';
  if p_aal2 is null then
    return;  -- lifecycle only (lists, sign-out, device limit): the MFA rules are not asked
  end if;
  -- The lower of the token's claim and the Auth session's own level, with a confirmed app (review H1).
  aal2 := p_aal2 and v.session_aal = 'aal2' and v.factor_confirmed;
  if (aal2 or v.mfa_mode = 'off') and not p_detail then
    return;
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
    return;
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
end
$function$;

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
  if not private.has_active_membership(v_user, p_tenant_id) then
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
         exists (select 1 from private.kept_sessions ks where ks.session_id = s.id and ks.user_id = s.user_id and ks.kept_until > now())
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

CREATE OR REPLACE FUNCTION private.touch_session()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_claims jsonb := private.request_claims();
  v_user uuid;
  v_session uuid;
  v_tenant uuid;
  v_applied boolean;
begin
  if session_user <> 'app_server' or v_claims is null or coalesce(v_claims ->> 'role', '') <> 'authenticated' then
    return;
  end if;
  v_user := private.try_uuid(v_claims ->> 'sub');
  v_session := private.try_uuid(v_claims ->> 'session_id');
  v_tenant := private.try_uuid(v_claims ->> 'tenant_id');
  if v_user is null or v_session is null or v_tenant is null then
    return;
  end if;
  -- At most once a minute, never for a session already inactive too long, and without waiting for a
  -- concurrent request of the same session (SKIP LOCKED): the row is locked only when it is moved.
  perform 1
  from platform.session_context c
  join platform.security_policies p on p.tenant_id = c.active_tenant_id
  where c.session_id = v_session and c.user_id = v_user and c.active_tenant_id = v_tenant
    and c.last_seen_at < now() - interval '1 minute'
    and (c.last_seen_at > now() - make_interval(mins => p.session_idle_minutes)
         or exists (select 1 from private.kept_sessions ks
                    where ks.session_id = c.session_id and ks.user_id = c.user_id and ks.kept_until > now()))
  for update of c skip locked;
  if not found then
    return;
  end if;
  update platform.session_context c set last_seen_at = now() where c.session_id = v_session
  returning c.device_limit_applied into v_applied;
  -- The device limit ends other sessions of the login (private.end_sessions: the login's lock). A request
  -- holds its own session_context row from here on, so it never WAITS for that lock (a deactivation or a
  -- force sign-out of the same login could be waiting for this row — integration follow-up): taken without
  -- waiting, or left to the next touch (device_limit_applied stays false).
  if not v_applied
     and (private.session_access(v_user, v_session, v_tenant, coalesce(v_claims ->> 'aal', '') = 'aal2', false)).state = 'ok' then
    if pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('platform.login_sessions:' || v_user::text, 0)) then
      perform private.enforce_device_limit(v_user, v_session, v_tenant);
    end if;
  end if;
end
$function$;

CREATE OR REPLACE FUNCTION private.purge_ended_sessions(p_limit integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_claims jsonb := private.request_claims();
  v_limit integer := least(greatest(coalesce(p_limit, 0), 0), 1000);
  v_candidates uuid[];
  v_users uuid[];
  v_user uuid;
  v_taken uuid[];
  v_ids uuid[];
  v_locked uuid[];
  v_id uuid;
  v_count integer := 0;
begin
  if session_user <> 'app_worker' or coalesce(v_claims ->> 'role', '') <> 'system'
     or coalesce(btrim(v_claims ->> 'job_id'), '') = '' then
    raise exception 'reserved to the worker' using errcode = 'insufficient_privilege';
  end if;
  delete from private.revoked_sessions r where r.revoked_at < now() - interval '31 days';
  -- Kept sessions whose Auth session is gone, and long expired ones (WP-ADM-05).
  delete from private.kept_sessions ks
  where ks.kept_until <= now() - interval '1 day'
     or not exists (select 1 from private.auth_session_validity s where s.id = ks.session_id);
  -- Auth sessions with a marker, older than the platform's 24 hours, or ended by their organization's
  -- inactivity or maximum-length rule — the first p_limit by session id.
  select array_agg(e.id order by e.id) into v_candidates
  from (
    select e.id
    from (
      select s.id
      from private.revoked_sessions r
      join private.auth_session_validity s on s.id = r.session_id and s.user_id = r.user_id
      union
      select s.id
      from private.auth_session_validity s
      left join platform.session_context c on c.session_id = s.id and c.user_id = s.user_id
      left join platform.security_policies p on p.tenant_id = c.active_tenant_id
      left join private.kept_sessions ks on ks.session_id = s.id and ks.user_id = s.user_id
      where ((ks.session_id is null
              and (s.created_at <= now() - interval '24 hours'
                   or s.created_at <= now() - make_interval(hours => p.session_max_hours)
                   or c.last_seen_at <= now() - make_interval(mins => p.session_idle_minutes)))
             or ks.kept_until <= now())
        and not exists (select 1 from private.revoked_sessions r where r.session_id = s.id)
    ) e
    order by e.id
    limit v_limit
  ) e;
  if v_candidates is null then
    return 0;
  end if;
  -- Their logins' locks, without waiting (user-id order): a login whose sessions another transaction is
  -- ending is skipped.
  select array_agg(distinct s.user_id order by s.user_id) into v_users
  from private.auth_session_validity s where s.id = any (v_candidates);
  v_taken := '{}';
  foreach v_user in array coalesce(v_users, '{}') loop
    if pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('platform.login_sessions:' || v_user::text, 0)) then
      v_taken := v_taken || v_user;
    end if;
  end loop;
  select array_agg(s.id order by s.id) into v_ids
  from private.auth_session_validity s
  where s.id = any (v_candidates) and s.user_id = any (v_taken);
  if v_ids is null then
    return 0;
  end if;
  -- Their sign-in context rows, without waiting: a session in use right now (a request recording its
  -- activity, an organization switch, a deactivation) is skipped.
  select array_agg(c.session_id) into v_locked
  from (select c.session_id
        from platform.session_context c
        where c.session_id = any (v_ids)
        order by c.session_id
        for update of c skip locked) c;
  select array_agg(x.id order by x.id) into v_ids
  from unnest(v_ids) as x (id)
  where x.id = any (coalesce(v_locked, '{}'))
     or not exists (select 1 from platform.session_context c where c.session_id = x.id);
  if v_ids is null then
    return 0;
  end if;
  -- Sessions ended by time get an 'expired' marker first (a browser that comes back is told why).
  insert into private.revoked_sessions (session_id, user_id, tenant_id, reason)
  select s.id, s.user_id, c.active_tenant_id, 'expired'
  from private.auth_session_validity s
  left join platform.session_context c on c.session_id = s.id and c.user_id = s.user_id
  where s.id = any (v_ids) and not exists (select 1 from private.revoked_sessions r where r.session_id = s.id)
  order by s.id
  on conflict (session_id) do nothing;
  foreach v_id in array v_ids loop
    delete from private.auth_session_validity s where s.id = v_id;
    if found then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end
$function$;
