-- T-M2-10 integration follow-up (FR-IAM-13): the device limit on activity never waits for the login lock.
--
-- private.touch_session() (every withUserTx of a session in an organization) moves the session's last
-- activity and holds its platform.session_context row from then on. Before, it could apply the device limit
-- through private.end_sessions and wait for the login's lock (20261012120000); a transaction holding that
-- lock and waiting for this row — a deactivation, a force sign-out or the purge — could then deadlock with
-- it. Now the device limit is applied only when pg_try_advisory_xact_lock on the login succeeds at once;
-- otherwise device_limit_applied stays false and the next touch (a minute later at the earliest) applies it.
-- Deleting an Auth session can still wait briefly for Auth's own row lock (e.g. a refresh of that very
-- session in flight); Auth takes none of our locks, so that cannot deadlock.
--
-- A separate migration (not an edit of 20261012120000) so that it applies in the right order whether or not
-- 20261012120000 was already deployed.

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
$$;

comment on function private.touch_session() is
  'T-M2-10 (integration follow-up). Moves the current session''s last activity forward (at most once a minute; never after the inactivity limit) and applies the device limit if it was not yet — only when the login''s lock is free (never waits; else at the next touch). Called by withUserTx.';
