-- Sign-in session rules, list and sign-out from the database (FR-IAM-13; T-M2-10; approved screens 3 and 6;
-- TM-0003 T-IAM-43 / F-IAM-05, T-IAM-39, T-IAM-40). PII: the browser/device description of a session
-- (Auth's user agent), shown to the account and its organization's user managers only.
--
-- SECURITY-RELEVANT. The organization's session rules (platform.security_policies) are applied by
-- private.session_access() — and so by private.current_tenant_id(), on every statement — to a user session
-- acting in it:
--   * inactivity: platform.session_context.last_seen_at, moved forward by private.touch_session() at most
--     once a minute (withUserTx calls it with the claims, before any query; it never revives a session that
--     is already inactive too long); entering another organization checks that organization's limit too;
--   * maximum length: from the Auth session's start (auth.sessions.created_at);
--   * devices: once a session may act in the organization (its own AAL — review L1), its oldest other live
--     sessions there beyond the limit end (private.enforce_device_limit; audited).
-- An ended session reads nothing (state 'ended'). Ending a session (security review M1) does both:
--   private.revoked_sessions   a marker — why it ended (the account, a user manager, the device limit,
--       expiry, a security reset) — so the next request of that browser is refused with "your session has
--       ended" at once; kept 25 hours, also after Auth forgot the session;
--   the Auth session itself is deleted (through private.auth_session_validity, DELETE for tenant_guard
--       only): its refresh token stops working at Auth. The web app holds no Auth secret key (ADR 0002 §7).
-- Sessions that ended by the rules (inactivity, maximum length, the platform's 24 hours) are deleted the same
-- way by the worker (private.purge_ended_sessions, every minute) or when the browser comes back.
-- Platform floor for every user session, also before an organization is chosen: 24 hours from sign-in
-- (private.user_session_is_valid), the most any organization may allow.
--
--   private.touch_session()                       withUserTx: activity of the current session (and the
--       device limit once it may act, if not applied yet)
--   private.apply_device_limit()                  web app: right after the authenticator code completed a
--       sign-in
--   private.my_sessions()                         My profile: the account's live sessions
--   private.end_my_sessions(session)              My profile: end one other session, or all others
--   private.tenant_member_sessions(person)        user profile (screen 3): a member's live sessions in the
--       caller's organization — user managers only (private.actor_may_manage_person)
--   private.end_member_sessions(person, session)  force sign-out of one or all of them (same rule; never
--       another organization's sessions — T-IAM-40)
--   private.purge_ended_sessions(limit)           worker (app_worker, system claims): deletes ended sessions

-- The migration role hands function ownership to tenant_guard (as in 20260930120000).
grant tenant_guard to current_user;

-- ---------------------------------------------------------------------------------------------------
-- Activity of a session in its organization
-- ---------------------------------------------------------------------------------------------------
alter table platform.session_context add column last_seen_at timestamptz not null default now();
comment on column platform.session_context.last_seen_at is
  'Last activity of the session in its organization (inactivity rule, T-M2-10); moved forward at most once a minute.';
alter table platform.session_context add column device_limit_applied boolean not null default false;
comment on column platform.session_context.device_limit_applied is
  'The organization''s device limit was applied once the session could act there (T-M2-10, review L1).';

-- ---------------------------------------------------------------------------------------------------
-- Ended sessions
-- ---------------------------------------------------------------------------------------------------
-- No foreign key to auth.sessions: the marker outlives the Auth session it ended (the browser still holding
-- that session's access token is told why), and goes after 25 hours (longer than any session lives).
create table private.revoked_sessions (
  session_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The organization whose administrator, device limit or rules ended it (NULL: the account itself, or a
  -- reset of its authenticator app).
  tenant_id uuid references platform.tenants (id),
  reason text not null,
  -- The account that ended it (NULL: the device limit, expiry, the platform).
  revoked_by uuid,
  revoked_at timestamptz not null default now(),
  constraint revoked_sessions_reason_check
    check (reason in ('user', 'admin', 'device_limit', 'expired', 'security'))
);
comment on table private.revoked_sessions is
  'SECURITY-RELEVANT (FR-IAM-13, T-M2-10). Sign-in sessions ended by their account, a user manager, the device limit, expiry or a security reset: refused at once (private.user_session_is_valid, private.session_access); kept 25 hours. tenant_guard only.';

create index revoked_sessions_user_id_idx on private.revoked_sessions (user_id);
create index revoked_sessions_revoked_at_idx on private.revoked_sessions (revoked_at);

alter table private.revoked_sessions enable row level security;
alter table private.revoked_sessions force row level security;
create policy revoked_sessions_guard on private.revoked_sessions for all to tenant_guard using (true) with check (true);
revoke all on private.revoked_sessions from public;
grant select, insert, delete on private.revoked_sessions to tenant_guard;

-- private.actor_may_manage_person() as tenant_guard: whether the member holds a privileged role.
grant select (code, is_privileged) on platform.ref_roles to tenant_guard;
create policy ref_roles_tenant_guard_read on platform.ref_roles for select to tenant_guard using (true);
grant execute on function private.actor_may_manage_person(uuid, uuid) to tenant_guard;
grant execute on function private.membership_is_privileged(uuid, uuid) to tenant_guard;

-- Account-level security audit (device-limit evictions here; authenticator set-up, confirmation, removal
-- and resets in 20261012110000): written by tenant_guard's reviewed functions into each organization the
-- account is an active member of, with an allow-list of actions.
create policy audit_events_tenant_guard_insert on platform.audit_events for insert to tenant_guard
  with check (action in ('platform.auth.sessions_evicted', 'platform.auth.mfa_enrolled', 'platform.auth.mfa_confirmed',
                         'platform.auth.mfa_removed', 'platform.auth.mfa_reset')
              and impersonator_user_id is null);
grant insert (tenant_id, actor_user_id, actor_person_id, action, entity_type, entity_id, data)
  on platform.audit_events to tenant_guard;

-- One audit row per organization of the account (active memberships in active/trial organizations; or only
-- p_tenant_id when given). Actor: the account itself (its person in each organization), or p_actor_user_id
-- (an Organization Admin acting in p_tenant_id), or nobody (the platform). No personal data in p_data.
create or replace function private.audit_account_event(
  p_user_id uuid, p_action text, p_data jsonb, p_actor text, p_tenant_id uuid default null,
  p_actor_user_id uuid default null)
returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_actor not in ('account', 'admin', 'platform') then
    raise exception 'unknown actor kind' using errcode = 'invalid_parameter_value';
  end if;
  insert into platform.audit_events (tenant_id, actor_user_id, actor_person_id, action, entity_type, entity_id, data)
  select m.tenant_id,
         case p_actor when 'account' then p_user_id when 'admin' then p_actor_user_id end,
         case p_actor when 'account' then m.person_id
                      when 'admin' then (select a.person_id from platform.tenant_memberships a
                                         where a.tenant_id = m.tenant_id and a.user_id = p_actor_user_id) end,
         p_action, 'user', p_user_id::text, coalesce(p_data, '{}'::jsonb)
  from platform.tenant_memberships m
  join platform.tenants t on t.id = m.tenant_id
  where m.user_id = p_user_id and m.status = 'active' and t.status in ('active', 'trial')
    and (p_tenant_id is null or m.tenant_id = p_tenant_id);
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

comment on function private.audit_account_event(uuid, text, jsonb, text, uuid, uuid) is
  'SECURITY-RELEVANT (T-M2-10, TM-0003 T-IAM-25/26). Internal: an account-level security event in each organization of the account (or one). tenant_guard only.';

-- Ends sessions of one account: the marker first (immediate, with the reason), then the Auth session itself.
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

-- ---------------------------------------------------------------------------------------------------
-- Session validity: not ended, at most 24 hours old (platform floor)
-- ---------------------------------------------------------------------------------------------------
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
      and s.created_at > now() - interval '24 hours'
      and not exists (select 1 from private.revoked_sessions r where r.session_id = s.id)
  );
end
$$;

comment on function private.user_session_is_valid(uuid, uuid) is
  'SECURITY DEFINER (owner tenant_guard): true when the Auth session exists for the user, is not expired, not ended (private.revoked_sessions) and at most 24 hours old.';

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
         c.active_tenant_id, c.last_seen_at,
         m.id as membership_id, m.created_at as member_since, m.status as member_status, t.status as tenant_status,
         p.mfa_mode, p.mfa_required_roles, p.mfa_grace_days, p.mfa_required_since, p.mfa_prompt_admins,
         p.session_idle_minutes, p.session_max_hours
    into v
  from private.auth_session_validity s
  left join private.mfa_factor_confirmations k
    on k.factor_id = s.factor_id and k.user_id = s.user_id and k.confirmed_at is not null
  left join platform.session_context c on c.session_id = s.id and c.user_id = s.user_id
  left join platform.tenant_memberships m on m.tenant_id = p_tenant_id and m.user_id = s.user_id
  left join platform.tenants t on t.id = p_tenant_id
  left join platform.security_policies p on p.tenant_id = p_tenant_id
  where s.id = p_session_id and s.user_id = p_user_id and (s.not_after is null or s.not_after > now());
  if not found then
    return;  -- no live Auth session of this user
  end if;
  if coalesce(v.started_at <= now() - interval '24 hours', true) then
    state := 'ended';
    return;
  end if;
  -- The session acts in this organization (ADR 0002 §3), as an active member of an active/trial one.
  if v.active_tenant_id is distinct from p_tenant_id or v.member_status is distinct from 'active'
     or not coalesce(v.tenant_status in ('active', 'trial'), false) or v.mfa_mode is null then
    return;
  end if;
  if v.started_at <= now() - make_interval(hours => v.session_max_hours)
     or v.last_seen_at <= now() - make_interval(mins => v.session_idle_minutes) then
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
  'SECURITY-RELEVANT (ADR 0002 §6a, T-IAM-41, T-IAM-43, T-IAM-11). May this user session act in this organization now (ok), and if not why (invalid | ended | mfa_challenge | mfa_enrol); with detail also the MFA prompts, the apps and the effective AAL2. aal2 NULL: lifecycle only. tenant_guard only.';

-- ---------------------------------------------------------------------------------------------------
-- Device limit (screen 6): once the session may act in the organization with its own AAL (review L1)
-- ---------------------------------------------------------------------------------------------------
create or replace function private.enforce_device_limit(p_user_id uuid, p_session_id uuid, p_tenant_id uuid)
returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_max_devices smallint;
  v_victims uuid[];
  v_count integer := 0;
begin
  select p.session_max_devices into v_max_devices from platform.security_policies p where p.tenant_id = p_tenant_id;
  -- The oldest other live sessions of the account in this organization beyond the limit end.
  select array_agg(o.session_id) into v_victims
  from (
    select c.session_id, row_number() over (order by s.created_at desc, c.session_id desc) as n
    from platform.session_context c
    join private.auth_session_validity s on s.id = c.session_id and s.user_id = c.user_id
    where c.user_id = p_user_id and c.active_tenant_id = p_tenant_id and c.session_id <> p_session_id
      and (private.session_access(p_user_id, c.session_id, p_tenant_id, null, false)).state = 'ok'
  ) o
  where o.n >= coalesce(v_max_devices, 1);
  if v_victims is not null then
    v_count := private.end_sessions(p_user_id, v_victims, p_tenant_id, 'device_limit', null);
    if v_count > 0 then
      perform private.audit_account_event(p_user_id, 'platform.auth.sessions_evicted',
                                          jsonb_build_object('reason', 'device_limit', 'count', v_count),
                                          'account', p_tenant_id);
    end if;
  end if;
  update platform.session_context c set device_limit_applied = true
  where c.session_id = p_session_id and c.user_id = p_user_id;
  return v_count;
end
$$;

comment on function private.enforce_device_limit(uuid, uuid, uuid) is
  'SECURITY-RELEVANT (FR-IAM-13, T-M2-10, review L1/L5). Internal: the device limit for a session that may act in the organization — the oldest other live sessions beyond it end (audited). tenant_guard only.';

-- ---------------------------------------------------------------------------------------------------
-- Entering an organization: an ended session cannot move on; the target's own rules; the device limit
-- ---------------------------------------------------------------------------------------------------
create or replace function private.switch_active_tenant(p_tenant_id uuid)
returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
declare
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
  if not private.user_session_is_valid(v_user, v_session)
     or not private.has_active_membership(v_user, p_tenant_id) then
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
  select s.created_at into v_started from private.auth_session_validity s where s.id = v_session and s.user_id = v_user;
  select p.session_idle_minutes, p.session_max_hours into v_policy
  from platform.security_policies p where p.tenant_id = p_tenant_id;
  if not found
     or coalesce(v_last_seen, v_started) <= now() - make_interval(mins => v_policy.session_idle_minutes)
     or v_started <= now() - make_interval(hours => v_policy.session_max_hours) then
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
  delete from private.revoked_sessions r where r.revoked_at < now() - interval '25 hours';
  return true;
end
$$;

comment on function private.switch_active_tenant(uuid) is
  'SECURITY-RELEVANT (ADR 0002 §3, T-M2-10). Sets the active tenant of the caller''s current Auth session only, unless the current or the target organization''s rules end it; applies the device limit once the session may act there.';

-- ---------------------------------------------------------------------------------------------------
-- Activity (and the device limit of a session that became able to act later, e.g. after a code)
-- ---------------------------------------------------------------------------------------------------
create or replace function private.touch_session()
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
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
    and c.last_seen_at > now() - make_interval(mins => p.session_idle_minutes)
  for update of c skip locked;
  if not found then
    return;
  end if;
  update platform.session_context c set last_seen_at = now() where c.session_id = v_session
  returning c.device_limit_applied into v_applied;
  if not v_applied
     and (private.session_access(v_user, v_session, v_tenant, coalesce(v_claims ->> 'aal', '') = 'aal2', false)).state = 'ok' then
    perform private.enforce_device_limit(v_user, v_session, v_tenant);
  end if;
end
$$;

comment on function private.touch_session() is
  'T-M2-10. Moves the current session''s last activity forward (at most once a minute; never after the inactivity limit) and applies the device limit if it was not yet. Called by withUserTx.';

-- Right after the authenticator code completed a sign-in (the session can act now): the device limit at
-- once. Returns how many other sessions ended.
create or replace function private.apply_device_limit()
returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_tenant uuid := private.current_tenant_id();
  v_claims jsonb := private.request_claims();
  v_user uuid;
  v_session uuid;
begin
  if session_user <> 'app_server' or v_tenant is null or coalesce(v_claims ->> 'role', '') <> 'authenticated' then
    return 0;
  end if;
  v_user := private.try_uuid(v_claims ->> 'sub');
  v_session := private.try_uuid(v_claims ->> 'session_id');
  -- Only a session that may act in its organization with its OWN assurance level (review L1), and only once.
  if (private.session_access(v_user, v_session, v_tenant, coalesce(v_claims ->> 'aal', '') = 'aal2', false)).state <> 'ok'
     or exists (select 1 from platform.session_context c
                where c.session_id = v_session and c.user_id = v_user and c.device_limit_applied) then
    return 0;
  end if;
  return private.enforce_device_limit(v_user, v_session, v_tenant);
end
$$;

comment on function private.apply_device_limit() is
  'FR-IAM-13 (T-M2-10, review L1). The device limit for the current session, once it may act in its organization with its own assurance level (once per organization entered). Returns how many other sessions ended.';

-- ---------------------------------------------------------------------------------------------------
-- Lists and sign-out (the caller's session must be allowed to act in its organization — review L1)
-- ---------------------------------------------------------------------------------------------------
create or replace function private.my_sessions()
returns table (session_id uuid, started_at timestamptz, last_active_at timestamptz, user_agent text,
               with_code boolean, tenant_id uuid, tenant_name_ar text, tenant_name_en text, is_current boolean)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_claims jsonb := private.request_claims();
  v_user uuid;
  v_session uuid;
begin
  if private.current_tenant_id() is null then
    return;
  end if;
  v_user := private.try_uuid(v_claims ->> 'sub');
  v_session := private.try_uuid(v_claims ->> 'session_id');
  return query
    select s.id, s.created_at, greatest(s.created_at, s.updated_at, c.last_seen_at), s.user_agent,
           coalesce(s.aal = 'aal2', false), c.active_tenant_id, t.name_ar, t.name_en, s.id = v_session
    from private.auth_session_validity s
    left join platform.session_context c on c.session_id = s.id and c.user_id = s.user_id
    left join platform.tenants t on t.id = c.active_tenant_id
    where s.user_id = v_user
      and private.user_session_is_valid(v_user, s.id)
      and (c.session_id is null
           or (private.session_access(v_user, s.id, c.active_tenant_id, null, false)).state <> 'ended')
    order by s.id = v_session desc, 3 desc;
end
$$;

comment on function private.my_sessions() is
  'FR-IAM-13 (T-M2-10). The signed-in account''s live sign-in sessions (current one first), for a session allowed to act in its organization.';

create or replace function private.end_my_sessions(p_session_id uuid)
returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_claims jsonb := private.request_claims();
  v_user uuid;
  v_session uuid;
  v_ids uuid[];
begin
  if private.current_tenant_id() is null then
    return 0;
  end if;
  v_user := private.try_uuid(v_claims ->> 'sub');
  v_session := private.try_uuid(v_claims ->> 'session_id');
  -- Another live session of the account (as listed by private.my_sessions), or all others (NULL); the
  -- current one signs out instead.
  select array_agg(s.id) into v_ids
  from private.auth_session_validity s
  left join platform.session_context c on c.session_id = s.id and c.user_id = s.user_id
  where s.user_id = v_user and s.id <> v_session and (p_session_id is null or s.id = p_session_id)
    and private.user_session_is_valid(v_user, s.id)
    and (c.session_id is null
         or (private.session_access(v_user, s.id, c.active_tenant_id, null, false)).state <> 'ended');
  delete from private.revoked_sessions r where r.revoked_at < now() - interval '25 hours';
  return private.end_sessions(v_user, v_ids, null, 'user', v_user);
end
$$;

comment on function private.end_my_sessions(uuid) is
  'FR-IAM-13 (T-M2-10). Ends one other sign-in session of the signed-in account, or all others (NULL) — marker and Auth session. Returns how many.';

create or replace function private.tenant_member_sessions(p_person_id uuid)
returns table (session_id uuid, started_at timestamptz, last_active_at timestamptz, user_agent text,
               with_code boolean, is_current boolean)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_tenant uuid := private.current_tenant_id();
  v_session uuid := private.try_uuid(private.request_claims() ->> 'session_id');
begin
  if v_tenant is null or p_person_id is null or not private.actor_may_manage_person(v_tenant, p_person_id) then
    return;
  end if;
  return query
    select s.id, s.created_at, greatest(s.created_at, s.updated_at, c.last_seen_at), s.user_agent,
           coalesce(s.aal = 'aal2', false), s.id = v_session
    from platform.tenant_memberships m
    join platform.session_context c on c.user_id = m.user_id and c.active_tenant_id = v_tenant
    join private.auth_session_validity s on s.id = c.session_id and s.user_id = c.user_id
    where m.tenant_id = v_tenant and m.person_id = p_person_id
      and (private.session_access(m.user_id, s.id, v_tenant, null, false)).state = 'ok'
    order by 3 desc;
end
$$;

comment on function private.tenant_member_sessions(uuid) is
  'FR-IAM-13 (T-M2-10, screen 3). A member''s live sign-in sessions in the caller''s organization; user managers only (private.actor_may_manage_person).';

create or replace function private.end_member_sessions(p_person_id uuid, p_session_id uuid)
returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_tenant uuid := private.current_tenant_id();
  v_actor uuid := private.request_user_id();
  v_session uuid := private.try_uuid(private.request_claims() ->> 'session_id');
  v_member uuid;
  v_ids uuid[];
begin
  if v_tenant is null or p_person_id is null then
    return 0;
  end if;
  if not private.actor_may_manage_person(v_tenant, p_person_id) then
    raise exception 'only user managers may end this member''s sign-in sessions' using errcode = 'insufficient_privilege';
  end if;
  select m.user_id into v_member from platform.tenant_memberships m
  where m.tenant_id = v_tenant and m.person_id = p_person_id and m.user_id is not null;
  if v_member is null then
    return 0;
  end if;
  -- Only sessions acting in this organization (T-IAM-40); never the caller's own current session.
  select array_agg(c.session_id) into v_ids
  from platform.session_context c
  where c.user_id = v_member and c.active_tenant_id = v_tenant
    and (p_session_id is null or c.session_id = p_session_id)
    and c.session_id is distinct from v_session
    and (private.session_access(v_member, c.session_id, v_tenant, null, false)).state = 'ok';
  delete from private.revoked_sessions r where r.revoked_at < now() - interval '25 hours';
  return private.end_sessions(v_member, v_ids, v_tenant, 'admin', v_actor);
end
$$;

comment on function private.end_member_sessions(uuid, uuid) is
  'FR-IAM-13 (T-M2-10, screen 3). Force sign-out: ends one or all (NULL) of a member''s sessions in the caller''s organization — marker and Auth session; user managers only. Returns how many.';

-- ---------------------------------------------------------------------------------------------------
-- Worker: Auth forgets sessions that ended (review M1)
-- ---------------------------------------------------------------------------------------------------
-- Every minute (worker platform task): Auth sessions with a marker, older than the platform's 24 hours, or
-- ended by their organization's inactivity or maximum-length rule are deleted (the last two get an
-- 'expired' marker first, so a browser that comes back is told why). At most p_limit a call; returns how
-- many. Old markers go too.
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

-- Ownership hand-over as in migration 20260930120100 (non-superuser migration role on hosted Supabase).
grant create on schema private to tenant_guard;
alter function private.audit_account_event(uuid, text, jsonb, text, uuid, uuid) owner to tenant_guard;
alter function private.end_sessions(uuid, uuid[], uuid, text, uuid) owner to tenant_guard;
alter function private.enforce_device_limit(uuid, uuid, uuid) owner to tenant_guard;
alter function private.touch_session() owner to tenant_guard;
alter function private.apply_device_limit() owner to tenant_guard;
alter function private.my_sessions() owner to tenant_guard;
alter function private.end_my_sessions(uuid) owner to tenant_guard;
alter function private.tenant_member_sessions(uuid) owner to tenant_guard;
alter function private.end_member_sessions(uuid, uuid) owner to tenant_guard;
alter function private.purge_ended_sessions(integer) owner to tenant_guard;
revoke create on schema private from tenant_guard;

revoke all on function private.audit_account_event(uuid, text, jsonb, text, uuid, uuid) from public;
revoke all on function private.end_sessions(uuid, uuid[], uuid, text, uuid) from public;
revoke all on function private.enforce_device_limit(uuid, uuid, uuid) from public;
revoke all on function private.touch_session() from public;
revoke all on function private.apply_device_limit() from public;
revoke all on function private.my_sessions() from public;
revoke all on function private.end_my_sessions(uuid) from public;
revoke all on function private.tenant_member_sessions(uuid) from public;
revoke all on function private.end_member_sessions(uuid, uuid) from public;
revoke all on function private.purge_ended_sessions(integer) from public;
grant execute on function private.audit_account_event(uuid, text, jsonb, text, uuid, uuid) to tenant_guard;
grant execute on function private.end_sessions(uuid, uuid[], uuid, text, uuid) to tenant_guard;
grant execute on function private.enforce_device_limit(uuid, uuid, uuid) to tenant_guard;
grant execute on function private.touch_session() to authenticated;
grant execute on function private.apply_device_limit() to authenticated;
grant execute on function private.my_sessions() to authenticated;
grant execute on function private.end_my_sessions(uuid) to authenticated;
grant execute on function private.tenant_member_sessions(uuid) to authenticated;
grant execute on function private.end_member_sessions(uuid, uuid) to authenticated;
grant execute on function private.purge_ended_sessions(integer) to authenticated;
