-- Sign-in refusal for logins that belong nowhere any more (FR-IAM-05, T-M2-09; TM-0003 T-IAM-39/40;
-- replaces the worker's Auth bans after the security review). The database already refuses every tenant
-- request of a deactivated member at once (private.current_tenant_id(): no active membership). On top of
-- that, Supabase Auth issues NO token — neither at sign-in nor at refresh — for an account that
--   * has at least one membership,
--   * none of them active in an active or trial organization, and
--   * no pending, unexpired invitation for its e-mail in an active or trial organization (an existing
--     account must be able to "sign in to accept", T-M2-07).
-- Accounts without any membership are never refused: platform staff, break-glass accounts, invitees who
-- just created their account. The decision is made live on every token, so a reactivation, a reinstated
-- organization or a new invitation lets the account in again at once, with no queue and no Auth admin
-- call; and a tenant action can never lock a login out of another organization (T-IAM-40).
--
-- Mechanism: the Custom Access Token Hook (ADR 0002 §3, migration 20260930120400; supabase_auth_admin)
-- asks private.account_sign_in_refused(user id) — SECURITY DEFINER, owner NOLOGIN membership_guard,
-- EXECUTE for supabase_auth_admin only — and answers Auth's documented error object
-- {"error": {"http_code": 403, "message": …}} instead of claims. GoTrue then issues no token and keeps no
-- session or refresh-token row (self-hosted smoke). The hook fails CLOSED: any error inside it is caught
-- and answered with the same refusal (a raised error would reach the client as a 500).
-- Only someone who knows the account's password (or holds a refresh token) can see the refusal: a wrong
-- password is answered `invalid_credentials` before the hook runs.

-- ---------------------------------------------------------------------------------------------------
-- What membership_guard reads besides memberships (granted in 20261011090000)
-- ---------------------------------------------------------------------------------------------------
-- Auth accounts' e-mail (pattern of private.auth_session_validity / private.auth_account, ADR 0002 §6a).
create or replace view private.auth_account_email
with (security_barrier = true)  -- defensive only: the view has no WHERE clause
as select u.id, u.email from auth.users u;

comment on view private.auth_account_email is
  'SECURITY-RELEVANT (T-M2-09): auth.users (id, email) for membership_guard only (sign-in refusal). Owned by the migration role.';

revoke all on private.auth_account_email from public;
grant select on private.auth_account_email to membership_guard;

do $$
declare
  v_owner name := (select pg_get_userbyid(relowner) from pg_class where oid = 'private.auth_account_email'::regclass);
  v_column text;
begin
  foreach v_column in array array['id', 'email'] loop
    if not (has_schema_privilege(v_owner, 'auth', 'usage') and has_column_privilege(v_owner, 'auth.users', v_column, 'select')) then
      raise exception 'role % (owner of private.auth_account_email) cannot read auth.users (%)', v_owner, v_column;
    end if;
  end loop;
  if not has_table_privilege('membership_guard', 'private.auth_account_email', 'select') then
    raise exception 'membership_guard cannot read private.auth_account_email';
  end if;
end
$$;

-- Organizations' status and pending invitations by e-mail.
create policy tenants_membership_guard_read on platform.tenants for select to membership_guard using (true);
grant select (id, status) on platform.tenants to membership_guard;
create policy invitations_membership_guard_read on platform.invitations for select to membership_guard
  using (true);
grant select (tenant_id, email, status, expires_at) on platform.invitations to membership_guard;
-- Pending invitations of an e-mail across organizations (every token of such an account looks here).
create index invitations_pending_email_idx on platform.invitations (email) where status = 'pending';

-- ---------------------------------------------------------------------------------------------------
-- The rule
-- ---------------------------------------------------------------------------------------------------
-- True when Auth must not issue a token to this account (see the header). Invitation e-mails are stored
-- lower-case (invitations_email_check); the account's e-mail is lower-cased for the comparison. An
-- unknown or missing account id is refused.
create or replace function private.account_sign_in_refused(p_user_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_user_id is null
      or (exists (select 1 from platform.tenant_memberships m where m.user_id = p_user_id)
          and not exists (
            select 1
            from platform.tenant_memberships m
            join platform.tenants t on t.id = m.tenant_id
            where m.user_id = p_user_id and m.status = 'active' and t.status in ('active', 'trial'))
          and not exists (
            select 1
            from private.auth_account_email a
            join platform.invitations i on i.email = lower(a.email)
            join platform.tenants t on t.id = i.tenant_id
            where a.id = p_user_id and i.status = 'pending' and i.expires_at > now()
              and t.status in ('active', 'trial')));
$$;

comment on function private.account_sign_in_refused(uuid) is
  'SECURITY-RELEVANT (FR-IAM-05, T-M2-09, TM-0003 T-IAM-39/40). May Auth issue a token to this account? Refused when it has memberships but none active in a served organization and no pending invitation there. supabase_auth_admin (the access-token hook) only; owner membership_guard.';

-- ---------------------------------------------------------------------------------------------------
-- The Custom Access Token Hook (as in 20260930120400, plus the refusal)
-- ---------------------------------------------------------------------------------------------------
create or replace function private.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  -- Neutral: says nothing about memberships (only someone with the right password or a refresh token
  -- reaches it; the web app shows every refused sign-in alike).
  v_deny constant jsonb := '{"error": {"http_code": 403, "message": "Sign-in is not available for this account."}}';
  v_claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  v_user uuid := private.try_uuid(event ->> 'user_id');
  v_session uuid := private.try_uuid(event -> 'claims' ->> 'session_id');
  v_tenant uuid;
  v_person uuid;
begin
  begin
    -- No token at all for an account that belongs nowhere any more (sign-in and refresh alike).
    if private.account_sign_in_refused(v_user) is not false then
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
        and t.status in ('active', 'trial');
    end if;

    if v_tenant is not null then
      v_claims := v_claims || jsonb_build_object('tenant_id', v_tenant, 'person_id', v_person);
    end if;

    return jsonb_set(event, '{claims}', v_claims);
  exception when others then
    -- Fail closed: no token. Only the SQLSTATE is logged (no account id, no e-mail).
    raise warning 'custom_access_token_hook: token refused after an error (SQLSTATE %)', sqlstate;
    return v_deny;
  end;
end
$$;

comment on function private.custom_access_token_hook(jsonb) is
  'SECURITY-RELEVANT (ADR 0002 §3, T-M2-09). Supabase Custom Access Token Hook: refuses tokens of accounts that belong nowhere any more (private.account_sign_in_refused); otherwise tenant_id/person_id for the session''s active tenant. Fails closed.';

-- Ownership hand-over as in migration 20260930120100 (non-superuser migration role on hosted Supabase).
-- The hook itself stays with the migration role (as before).
grant create on schema private to membership_guard;
alter function private.account_sign_in_refused(uuid) owner to membership_guard;
revoke create on schema private from membership_guard;

revoke all on function private.account_sign_in_refused(uuid) from public, anon, authenticated, service_role;
-- Auth only (supabase_auth_admin has USAGE on schema private since 20260930120400).
grant execute on function private.account_sign_in_refused(uuid) to supabase_auth_admin;
