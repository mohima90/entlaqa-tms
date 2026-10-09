-- Sign-in session rules, list and sign-out from the database (FR-IAM-13; T-M2-10; approved screens 3 and 6;
-- TM-0003 T-IAM-43 / F-IAM-05, T-IAM-39, T-IAM-40). PII: the browser/device description of a session
-- (Auth's user agent), shown to the account and its organization's user managers only.
--
-- SECURITY-RELEVANT. The organization's session rules (platform.security_policies) are applied by
-- private.session_access() — and so by private.current_tenant_id(), on every statement — to a user session
-- acting in it:
--   * inactivity: platform.session_context.last_seen_at, moved forward by private.touch_session() at most
--     once a minute (withUserTx calls it with the claims, before any query; it never revives a session that
--     is already inactive too long);
--   * maximum length: from the Auth session's start (auth.sessions.created_at);
--   * devices: when a session enters the organization, its oldest other live sessions there beyond the
--     limit end (switch_active_tenant).
-- An ended session reads nothing (state 'ended'); the web app then signs it out at Auth with its own token
-- (the web app holds no Auth secret key, ADR 0002 §7). Ending a session is a marker in the database,
-- immediate for every statement:
--   private.revoked_sessions   the sessions ended by their account ("end session"), a user manager of the
--       organization (force sign-out, screen 3), or the device limit. Removed with the Auth session.
-- Platform floor for every user session, also before an organization is chosen: 24 hours from sign-in
-- (private.user_session_is_valid), the most any organization may allow.
--
--   private.touch_session()                       withUserTx: activity of the current session
--   private.my_sessions()                         My profile: the account's live sessions
--   private.end_my_sessions(session)              My profile: end one other session, or all others
--   private.tenant_member_sessions(person)        user profile (screen 3): a member's live sessions in the
--       caller's organization — user managers only (private.actor_may_manage_person)
--   private.end_member_sessions(person, session)  force sign-out of one or all of them (same rule; never
--       another organization's sessions — T-IAM-40)

-- The migration role hands function ownership to tenant_guard (as in 20260930120000).
grant tenant_guard to current_user;

-- ---------------------------------------------------------------------------------------------------
-- What tenant_guard reads of Auth sessions: also when a session started, last changed (refresh), its
-- browser/device and its assurance level. (The view keeps its first three columns; ADR 0002 §6a rev. 2.)
-- ---------------------------------------------------------------------------------------------------
create or replace view private.auth_session_validity
with (security_barrier = true)  -- defensive only: the view has no WHERE clause
as select s.id, s.user_id, s.not_after, s.created_at, s.updated_at, s.user_agent, s.aal::text as aal
   from auth.sessions s;

comment on view private.auth_session_validity is
  'SECURITY-RELEVANT (ADR 0002 §6a rev. 2, T-M2-10): auth.sessions (id, user_id, not_after, created_at, updated_at, user_agent, aal) for tenant_guard only. Owned by the migration role.';

do $$
declare
  v_owner name := (select pg_get_userbyid(relowner) from pg_class
                   where oid = 'private.auth_session_validity'::regclass);
  v_column text;
begin
  foreach v_column in array array['id', 'user_id', 'not_after', 'created_at', 'updated_at', 'user_agent', 'aal'] loop
    if not (has_schema_privilege(v_owner, 'auth', 'usage')
            and has_column_privilege(v_owner, 'auth.sessions', v_column, 'select')) then
      raise exception 'role % (owner of private.auth_session_validity) cannot read auth.sessions (%)', v_owner, v_column;
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------------------------------
-- Activity of a session in its organization
-- ---------------------------------------------------------------------------------------------------
alter table platform.session_context add column last_seen_at timestamptz not null default now();
comment on column platform.session_context.last_seen_at is
  'Last activity of the session in its organization (inactivity rule, T-M2-10); moved forward at most once a minute.';

-- ---------------------------------------------------------------------------------------------------
-- Ended sessions
-- ---------------------------------------------------------------------------------------------------
create table private.revoked_sessions (
  session_id uuid primary key references auth.sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The organization whose administrator or device limit ended it (NULL: the account itself).
  tenant_id uuid references platform.tenants (id),
  reason text not null,
  -- The account that ended it (NULL: the device limit).
  revoked_by uuid,
  revoked_at timestamptz not null default now(),
  constraint revoked_sessions_reason_check check (reason in ('user', 'admin', 'device_limit'))
);
comment on table private.revoked_sessions is
  'SECURITY-RELEVANT (FR-IAM-13, T-M2-10). Sign-in sessions ended by their account, a user manager or the device limit: refused at once by private.user_session_is_valid(). tenant_guard only.';

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
  out state text, out mfa_deadline timestamptz)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v record;
  v_required boolean;
  v_has_app boolean;
begin
  state := 'invalid';
  if p_user_id is null or p_session_id is null or p_tenant_id is null then
    return;
  end if;
  -- One statement for the session, its context, the membership, the organization and its policy.
  select s.created_at as started_at, c.active_tenant_id, c.last_seen_at,
         m.id as membership_id, m.created_at as member_since, m.status as member_status, t.status as tenant_status,
         p.mfa_mode, p.mfa_required_roles, p.mfa_grace_days, p.mfa_required_since, p.mfa_prompt_admins,
         p.session_idle_minutes, p.session_max_hours,
         exists (select 1 from private.revoked_sessions r where r.session_id = s.id) as revoked
    into v
  from private.auth_session_validity s
  left join platform.session_context c on c.session_id = s.id and c.user_id = s.user_id
  left join platform.tenant_memberships m on m.tenant_id = p_tenant_id and m.user_id = s.user_id
  left join platform.tenants t on t.id = p_tenant_id
  left join platform.security_policies p on p.tenant_id = p_tenant_id
  where s.id = p_session_id and s.user_id = p_user_id and (s.not_after is null or s.not_after > now());
  if not found then
    return;  -- no live Auth session of this user
  end if;
  if v.revoked or coalesce(v.started_at <= now() - interval '24 hours', true) then
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
  if p_aal2 or (v.mfa_mode = 'off' and not p_detail) then
    return;
  end if;

  v_required := v.mfa_mode = 'required_all'
    or (v.mfa_mode = 'required_roles' and exists (
          select 1 from platform.role_assignments ra
          where ra.tenant_id = p_tenant_id and ra.membership_id = v.membership_id
            and ra.role_code = any (v.mfa_required_roles)
            and (ra.valid_from is null or ra.valid_from <= now())
            and (ra.valid_until is null or ra.valid_until > now())));
  v_has_app := exists (select 1 from private.auth_mfa_factor f
                       where f.user_id = p_user_id and f.factor_type = 'totp' and f.status = 'verified');
  if v_required then
    mfa_deadline := greatest(v.mfa_required_since, v.member_since) + make_interval(days => v.mfa_grace_days);
  end if;

  if v_has_app and v.mfa_mode <> 'off' then
    state := 'mfa_challenge';
  elsif v_required and now() >= mfa_deadline then
    state := 'mfa_enrol';
  elsif p_detail and v_required then
    state := 'prompt_grace';
  elsif p_detail and v.mfa_prompt_admins and not v_has_app
        and exists (select 1 from platform.role_assignments ra
                    where ra.tenant_id = p_tenant_id and ra.membership_id = v.membership_id
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
  'SECURITY-RELEVANT (ADR 0002 §6a, T-IAM-41, T-IAM-43). May this user session act in this organization now (ok), and if not why (invalid | ended | mfa_challenge | mfa_enrol); with detail also the MFA prompts. tenant_guard only.';

-- ---------------------------------------------------------------------------------------------------
-- Entering an organization: an ended session cannot move on; the device limit applies
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
  v_switched boolean;
  v_max_devices smallint;
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
  select c.active_tenant_id into v_current
  from platform.session_context c where c.session_id = v_session and c.user_id = v_user;
  if v_current is not null
     and (private.session_access(v_user, v_session, v_current, true, false)).state = 'ended' then
    return false;
  end if;

  insert into platform.session_context as c (session_id, user_id, active_tenant_id, updated_at, last_seen_at)
  values (v_session, v_user, p_tenant_id, now(), now())
  on conflict (session_id) do update
    set active_tenant_id = excluded.active_tenant_id,
        updated_at = excluded.updated_at,
        last_seen_at = excluded.last_seen_at
    where c.user_id = excluded.user_id;
  v_switched := found;
  if not v_switched then
    return false;
  end if;

  -- Device limit (screen 6): the oldest other live sessions of the account in this organization end.
  select p.session_max_devices into v_max_devices from platform.security_policies p where p.tenant_id = p_tenant_id;
  insert into private.revoked_sessions (session_id, user_id, tenant_id, reason)
  select o.session_id, v_user, p_tenant_id, 'device_limit'
  from (
    select c.session_id, row_number() over (order by s.created_at desc, c.session_id desc) as n
    from platform.session_context c
    join private.auth_session_validity s on s.id = c.session_id and s.user_id = c.user_id
    where c.user_id = v_user and c.active_tenant_id = p_tenant_id and c.session_id <> v_session
      and (private.session_access(v_user, c.session_id, p_tenant_id, true, false)).state = 'ok'
  ) o
  where o.n >= coalesce(v_max_devices, 1)
  on conflict (session_id) do nothing;
  -- Markers older than the platform's 24 hours protect nothing any more (those sessions are invalid).
  delete from private.revoked_sessions r where r.revoked_at < now() - interval '25 hours';
  return true;
end
$$;

comment on function private.switch_active_tenant(uuid) is
  'SECURITY-RELEVANT (ADR 0002 §3, T-M2-10). Sets the active tenant of the caller''s current Auth session only, unless its organization''s rules ended it; applies the device limit.';

-- ---------------------------------------------------------------------------------------------------
-- Activity
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
  if found then
    update platform.session_context c set last_seen_at = now() where c.session_id = v_session;
  end if;
end
$$;

comment on function private.touch_session() is
  'T-M2-10. Moves the current session''s last activity forward (at most once a minute; never after the inactivity limit). Called by withUserTx.';

-- ---------------------------------------------------------------------------------------------------
-- Lists and sign-out
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
  if session_user <> 'app_server' or v_claims is null or coalesce(v_claims ->> 'role', '') <> 'authenticated' then
    return;
  end if;
  v_user := private.try_uuid(v_claims ->> 'sub');
  v_session := private.try_uuid(v_claims ->> 'session_id');
  if not private.user_session_is_valid(v_user, v_session) then
    return;
  end if;
  return query
    select s.id, s.created_at, greatest(s.created_at, s.updated_at, c.last_seen_at), s.user_agent,
           coalesce(s.aal = 'aal2', false), c.active_tenant_id, t.name_ar, t.name_en, s.id = v_session
    from private.auth_session_validity s
    left join platform.session_context c on c.session_id = s.id and c.user_id = s.user_id
    left join platform.tenants t on t.id = c.active_tenant_id
    where s.user_id = v_user
      and private.user_session_is_valid(v_user, s.id)
      and (c.session_id is null
           or (private.session_access(v_user, s.id, c.active_tenant_id, true, false)).state <> 'ended')
    order by s.id = v_session desc, 3 desc;
end
$$;

comment on function private.my_sessions() is
  'FR-IAM-13 (T-M2-10). The signed-in account''s live sign-in sessions (current one first).';

create or replace function private.end_my_sessions(p_session_id uuid)
returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_claims jsonb := private.request_claims();
  v_user uuid;
  v_session uuid;
  v_count integer;
begin
  if session_user <> 'app_server' or v_claims is null or coalesce(v_claims ->> 'role', '') <> 'authenticated' then
    return 0;
  end if;
  v_user := private.try_uuid(v_claims ->> 'sub');
  v_session := private.try_uuid(v_claims ->> 'session_id');
  if not private.user_session_is_valid(v_user, v_session) then
    return 0;
  end if;
  -- Another live session of the account (as listed by private.my_sessions), or all others (NULL); the
  -- current one signs out instead.
  insert into private.revoked_sessions (session_id, user_id, tenant_id, reason, revoked_by)
  select s.id, v_user, null, 'user', v_user
  from private.auth_session_validity s
  left join platform.session_context c on c.session_id = s.id and c.user_id = s.user_id
  where s.user_id = v_user and s.id <> v_session and (p_session_id is null or s.id = p_session_id)
    and private.user_session_is_valid(v_user, s.id)
    and (c.session_id is null
         or (private.session_access(v_user, s.id, c.active_tenant_id, true, false)).state <> 'ended')
  on conflict (session_id) do nothing;
  get diagnostics v_count = row_count;
  delete from private.revoked_sessions r where r.revoked_at < now() - interval '25 hours';
  return v_count;
end
$$;

comment on function private.end_my_sessions(uuid) is
  'FR-IAM-13 (T-M2-10). Ends one other sign-in session of the signed-in account, or all others (NULL). Returns how many.';

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
      and (private.session_access(m.user_id, s.id, v_tenant, true, false)).state = 'ok'
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
  v_count integer;
begin
  if v_tenant is null or p_person_id is null then
    return 0;
  end if;
  if not private.actor_may_manage_person(v_tenant, p_person_id) then
    raise exception 'only user managers may end this member''s sign-in sessions' using errcode = 'insufficient_privilege';
  end if;
  -- Only sessions acting in this organization (T-IAM-40); never the caller's own current session.
  insert into private.revoked_sessions (session_id, user_id, tenant_id, reason, revoked_by)
  select c.session_id, m.user_id, v_tenant, 'admin', v_actor
  from platform.tenant_memberships m
  join platform.session_context c on c.user_id = m.user_id and c.active_tenant_id = v_tenant
  where m.tenant_id = v_tenant and m.person_id = p_person_id
    and (p_session_id is null or c.session_id = p_session_id)
    and c.session_id is distinct from v_session
    and (private.session_access(m.user_id, c.session_id, v_tenant, true, false)).state = 'ok'
  on conflict (session_id) do nothing;
  get diagnostics v_count = row_count;
  delete from private.revoked_sessions r where r.revoked_at < now() - interval '25 hours';
  return v_count;
end
$$;

comment on function private.end_member_sessions(uuid, uuid) is
  'FR-IAM-13 (T-M2-10, screen 3). Force sign-out: ends one or all (NULL) of a member''s sessions in the caller''s organization; user managers only. Returns how many.';

-- Ownership hand-over as in migration 20260930120100 (non-superuser migration role on hosted Supabase).
grant create on schema private to tenant_guard;
alter function private.touch_session() owner to tenant_guard;
alter function private.my_sessions() owner to tenant_guard;
alter function private.end_my_sessions(uuid) owner to tenant_guard;
alter function private.tenant_member_sessions(uuid) owner to tenant_guard;
alter function private.end_member_sessions(uuid, uuid) owner to tenant_guard;
revoke create on schema private from tenant_guard;

revoke all on function private.touch_session() from public;
revoke all on function private.my_sessions() from public;
revoke all on function private.end_my_sessions(uuid) from public;
revoke all on function private.tenant_member_sessions(uuid) from public;
revoke all on function private.end_member_sessions(uuid, uuid) from public;
grant execute on function private.touch_session() to authenticated;
grant execute on function private.my_sessions() to authenticated;
grant execute on function private.end_my_sessions(uuid) to authenticated;
grant execute on function private.tenant_member_sessions(uuid) to authenticated;
grant execute on function private.end_member_sessions(uuid, uuid) to authenticated;
