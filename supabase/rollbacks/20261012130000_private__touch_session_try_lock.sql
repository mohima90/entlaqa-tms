-- Rollback of 20261012130000_private__touch_session_try_lock.sql: private.touch_session as in 20261012100000
-- (the device limit may wait for the login's lock).
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
