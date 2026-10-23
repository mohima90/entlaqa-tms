-- «Remember this browser» = «keep me signed in» (WP-ADM-05, FR-IAM-12; business flow EP-AUTH-signin-extras, PO
-- answers 23 Oct 2026 - the last one supersedes the earlier «sign in with no code» idea). Class: P (platform).
--
-- On the code screen, ticking «Remember this browser» keeps THIS sign-in session alive for the organization's
-- period (Off / 1 / 7 / 14 / 30 days, default Off: platform.security_policies.remembered_browser_days; the
-- strictest organization of the account wins). Not ticked: the session ends when the browser closes (and under
-- the organization's own idle / maximum-length rules). There is no sign-in without a code: a kept session is an
-- ordinary Auth session whose limits are relaxed to the chosen period.
--
--   private.kept_sessions       one row per kept Auth session: until when. Reached only through the functions
--                               below and the session rules (owner tenant_guard; RLS forced; no other grant).
--                               The session rules (20261026100300) let a kept session live until `kept_until`
--                               instead of the organization's idle / maximum-length rules and the platform's
--                               24 hours; everything else that ends a session still does: the account's own
--                               sign-out, «End sessions» by a user manager, deactivation, a password change
--                               (other sessions) or reset (all), the device limit, «Forget all».
--   private.keep_session()      web app, user claims, right after a code sign-in with the tick ticked: the
--                               number of days kept (0: nothing - an organization has it Off).
--   private.my_kept_sessions()  My profile: the account's own kept sessions (with the browser description).
--   private.forget_kept_sessions()  My profile «Forget all»: the account's sessions stop being kept (they then
--                               follow the organization's normal rules).
-- Expand-first: new objects only.

grant tenant_guard to current_user;

create table private.kept_sessions (
  session_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kept_until timestamptz not null,
  created_at timestamptz not null default now(),
  constraint kept_sessions_period_check check (kept_until > created_at)
);
comment on table private.kept_sessions is
  'SECURITY-RELEVANT (WP-ADM-05). Auth sessions kept signed in until kept_until ("Remember this browser"): the session rules let them live that long. tenant_guard only.';
create index kept_sessions_user_id_idx on private.kept_sessions (user_id);
create index kept_sessions_kept_until_idx on private.kept_sessions (kept_until);

alter table private.kept_sessions enable row level security;
alter table private.kept_sessions force row level security;
create policy kept_sessions_guard on private.kept_sessions for all to tenant_guard using (true) with check (true);
revoke all on private.kept_sessions from public;
grant select, insert, update, delete on private.kept_sessions to tenant_guard;

-- The period setting is read by the guard that keeps sessions.
grant select (tenant_id, remembered_browser_days) on platform.security_policies to tenant_guard;

-- Keeping a session is audited like the other account-level security events (no browser data).
create policy audit_events_tenant_guard_keep_insert on platform.audit_events for insert to tenant_guard
  with check (action = 'platform.auth.browser_remembered' and impersonator_user_id is null);

-- ---------------------------------------------------------------------------------------------------
-- Keeping the current session
-- ---------------------------------------------------------------------------------------------------
create or replace function private.keep_session()
returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_claims jsonb := private.request_claims();
  v_user uuid := private.request_user_id();
  v_session uuid := private.try_uuid(v_claims ->> 'session_id');
  v_days integer;
  v_tenant uuid;
  v_access record;
begin
  if session_user <> 'app_server' or v_user is null or v_session is null
     or coalesce(v_claims ->> 'role', '') <> 'authenticated' then
    raise exception 'reserved to a signed-in user' using errcode = 'insufficient_privilege';
  end if;
  if not private.user_session_is_valid(v_user, v_session) then
    return 0;
  end if;
  -- Only a session that has finished signing in is kept (security re-review L3): it acts in an organization AND
  -- that organization's second step (the authenticator app), when it asks for one, is done. The caller asks
  -- again once the second step is complete.
  select c.active_tenant_id into v_tenant from platform.session_context c
  where c.session_id = v_session and c.user_id = v_user;
  if v_tenant is null then
    return 0;
  end if;
  select * into v_access from private.session_access(v_user, v_session, v_tenant, coalesce(v_claims ->> 'aal', '') = 'aal2', false);
  if v_access.state is distinct from 'ok' or coalesce(v_access.mfa_pending, false) then
    return 0;
  end if;
  -- The strictest organization wins: nothing is kept when any organization of the account has the setting Off
  -- (or has no policy row), or when the account is a member nowhere.
  select min(coalesce(p.remembered_browser_days, 0))::integer into v_days
  from platform.tenant_memberships m
  join platform.tenants t on t.id = m.tenant_id
  left join platform.security_policies p on p.tenant_id = m.tenant_id
  where m.user_id = v_user and m.status = 'active' and t.status in ('active', 'trial');
  if coalesce(v_days, 0) = 0 then
    delete from private.kept_sessions k where k.session_id = v_session and k.user_id = v_user;
    return 0;
  end if;
  insert into private.kept_sessions (session_id, user_id, kept_until)
  values (v_session, v_user, now() + make_interval(days => v_days))
  on conflict (session_id) do update set kept_until = excluded.kept_until, created_at = now()
  where private.kept_sessions.user_id = excluded.user_id;
  perform private.audit_account_event(v_user, 'platform.auth.browser_remembered',
                                      jsonb_build_object('method', 'email_code'), 'account');
  return v_days;
end
$$;
comment on function private.keep_session() is
  'SECURITY-RELEVANT (WP-ADM-05). Keeps the current session signed in for the strictest organization''s days (0: nothing kept). app_server, user claims.';

-- ---------------------------------------------------------------------------------------------------
-- My profile
-- ---------------------------------------------------------------------------------------------------
create or replace function private.my_kept_sessions()
returns table (session_id uuid, kept_until timestamptz, started_at timestamptz, user_agent text, is_current boolean)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_claims jsonb := private.request_claims();
  v_user uuid := private.request_user_id();
  v_session uuid := private.try_uuid(v_claims ->> 'session_id');
begin
  if session_user <> 'app_server' or v_user is null or coalesce(v_claims ->> 'role', '') <> 'authenticated' then
    raise exception 'reserved to a signed-in user' using errcode = 'insufficient_privilege';
  end if;
  return query
  select k.session_id, k.kept_until, s.created_at, s.user_agent, k.session_id = v_session
  from private.kept_sessions k
  join private.auth_session_validity s on s.id = k.session_id and s.user_id = k.user_id
  where k.user_id = v_user and k.kept_until > now()
    and (s.not_after is null or s.not_after > now())
    and not exists (select 1 from private.revoked_sessions r where r.session_id = k.session_id)
  order by s.created_at desc, k.session_id;
end
$$;
comment on function private.my_kept_sessions() is
  'SECURITY-RELEVANT (WP-ADM-05). The caller''s own live kept sessions. app_server, user claims.';

create or replace function private.forget_kept_sessions()
returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_claims jsonb := private.request_claims();
  v_user uuid := private.request_user_id();
  v_count integer;
begin
  if session_user <> 'app_server' or v_user is null or coalesce(v_claims ->> 'role', '') <> 'authenticated' then
    raise exception 'reserved to a signed-in user' using errcode = 'insufficient_privilege';
  end if;
  delete from private.kept_sessions k where k.user_id = v_user;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;
comment on function private.forget_kept_sessions() is
  'SECURITY-RELEVANT (WP-ADM-05). The caller''s sessions stop being kept signed in (they follow the organization''s normal rules). app_server, user claims.';

-- Ownership hand-over as in migration 20260930120100 (non-superuser migration role on hosted Supabase).
grant create on schema private to tenant_guard;
alter function private.keep_session() owner to tenant_guard;
alter function private.my_kept_sessions() owner to tenant_guard;
alter function private.forget_kept_sessions() owner to tenant_guard;
revoke create on schema private from tenant_guard;

revoke all on function private.keep_session() from public;
revoke all on function private.my_kept_sessions() from public;
revoke all on function private.forget_kept_sessions() from public;
grant execute on function private.keep_session() to authenticated;
grant execute on function private.my_kept_sessions() to authenticated;
grant execute on function private.forget_kept_sessions() to authenticated;
