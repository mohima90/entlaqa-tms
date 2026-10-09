-- Password rule "strictest wins" and the lockout settings interface (FR-IAM-13; T-M2-10). PII: none.
--
-- One login, one password (ADR 0003 §1): an account in several organizations follows the STRICTEST
-- password rule of all of them (PO decision 5, 9 Oct 2026; TM-0003 D-IAM-04) — the largest
-- password_min_length over its active memberships in active/trial organizations, never below the
-- platform's 12. Supabase Auth keeps the platform minimum (12) itself; the larger value is checked by the
-- web app wherever a password is set (reset, My profile, invitation acceptance) before Auth is called.
-- The answers are a number only: never which organization asks for it.
--
--   private.password_min_length_of(user)            the rule (helper, SECURITY INVOKER; tenant_guard)
--   private.password_min_length_for_caller()        web app (app_server, user claims of a live session —
--       also the recovery session of a reset, which has no organization): the caller's own rule
--   private.invitation_password_min_length(hash)    web app (app_server, no session): a new account
--       created by accepting an invitation belongs to that organization only, so its rule applies
--   private.tenant_lockout_policy(tenant)           web app (app_server, before sign-in): the lockout
--       settings of an organization (null: the platform default) for the sign-in limiter (T-M2-11)

-- The migration role hands function ownership to the guards (as in 20260930120000 / 20261009090000).
grant tenant_guard to current_user;
grant invitation_guard to current_user;

create or replace function private.password_min_length_of(p_user_id uuid)
returns smallint
language sql stable
set search_path = ''
as $$
  select greatest(12, coalesce(max(p.password_min_length), 12))::smallint
  from platform.tenant_memberships m
  join platform.tenants t on t.id = m.tenant_id
  join platform.security_policies p on p.tenant_id = m.tenant_id
  where m.user_id = p_user_id and m.status = 'active' and t.status in ('active', 'trial');
$$;

comment on function private.password_min_length_of(uuid) is
  'PO decision 5 (D-IAM-04): the strictest minimum password length over the account''s active memberships (at least 12).';

revoke all on function private.password_min_length_of(uuid) from public;
grant execute on function private.password_min_length_of(uuid) to tenant_guard;

create or replace function private.password_min_length_for_caller()
returns smallint
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_claims jsonb := private.request_claims();
  v_user uuid;
begin
  if session_user <> 'app_server' or v_claims is null or coalesce(v_claims ->> 'role', '') <> 'authenticated' then
    return null;
  end if;
  v_user := private.try_uuid(v_claims ->> 'sub');
  if not private.user_session_is_valid(v_user, private.try_uuid(v_claims ->> 'session_id')) then
    return null;
  end if;
  return private.password_min_length_of(v_user);
end
$$;

comment on function private.password_min_length_for_caller() is
  'SECURITY-RELEVANT (FR-IAM-13, PO decision 5). Minimum password length for the signed-in account (live session), NULL otherwise.';

create or replace function private.invitation_password_min_length(p_token_hash bytea)
returns smallint
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_length smallint;
begin
  if session_user <> 'app_server' or p_token_hash is null then
    return 12;
  end if;
  select greatest(12, p.password_min_length)::smallint into v_length
  from platform.invitations i
  join platform.security_policies p on p.tenant_id = i.tenant_id
  where i.token_hash = p_token_hash and i.status = 'pending';
  return coalesce(v_length, 12);
end
$$;

comment on function private.invitation_password_min_length(bytea) is
  'FR-IAM-13 (T-M2-10). Minimum password length for a new account accepting this invitation (its organization''s rule, at least 12). app_server only.';

create or replace function private.tenant_lockout_policy(
  p_tenant_id uuid, out lockout_threshold smallint, out lockout_minutes smallint)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  -- Platform default (screen 6), also for an unknown organization.
  lockout_threshold := 5;
  lockout_minutes := 15;
  if session_user <> 'app_server' or p_tenant_id is null then
    return;
  end if;
  select p.lockout_threshold, p.lockout_minutes into lockout_threshold, lockout_minutes
  from platform.security_policies p
  join platform.tenants t on t.id = p.tenant_id
  where p.tenant_id = p_tenant_id and t.status in ('active', 'trial');
  if not found then
    lockout_threshold := 5;
    lockout_minutes := 15;
  end if;
end
$$;

comment on function private.tenant_lockout_policy(uuid) is
  'FR-IAM-13 (T-M2-10 → T-M2-11). Lockout settings of an organization, or the platform default (5 attempts, 15 minutes). app_server only.';

grant create on schema private to tenant_guard;
alter function private.password_min_length_for_caller() owner to tenant_guard;
alter function private.tenant_lockout_policy(uuid) owner to tenant_guard;
revoke create on schema private from tenant_guard;

grant create on schema private to invitation_guard;
alter function private.invitation_password_min_length(bytea) owner to invitation_guard;
revoke create on schema private from invitation_guard;

revoke all on function private.password_min_length_for_caller() from public;
revoke all on function private.invitation_password_min_length(bytea) from public;
revoke all on function private.tenant_lockout_policy(uuid) from public;
grant execute on function private.password_min_length_for_caller() to authenticated;
grant execute on function private.invitation_password_min_length(bytea) to authenticated;
grant execute on function private.tenant_lockout_policy(uuid) to authenticated;
