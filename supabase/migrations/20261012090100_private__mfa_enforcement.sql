-- MFA policy enforced by the database (FR-IAM-12; T-M2-10; TM-0003 T-IAM-41 / F-IAM-04). PII: none.
--
-- SECURITY-RELEVANT. private.current_tenant_id() — the predicate of every tenant policy — now also applies
-- the organization's MFA policy (platform.security_policies, 20261012090000) to a USER session:
--   * mfa_mode optional / required_* and the account has a verified authenticator app → the session must
--     have passed a code (aal2): an AAL1 session reads nothing in the organization until it does;
--   * the member is covered by a requirement (required_all, or required_roles with a listed role in force)
--     and the grace period is over → aal2 required, so a member without an app must set one up first.
-- Without a policy row the session is refused (fail closed; every organization has one). AAL comes from
-- the verified access token (`aal` claim, forwarded by withUserTx). High-risk permissions need AAL2 in
-- every mode (registry + defineAction; PO decision D-IAM-01).
--
--   private.session_access(user, session, tenant, aal2, detail)  tenant_guard only: the one decision —
--       'ok' | 'invalid' (no live session, membership or session context) | 'mfa_challenge' | 'mfa_enrol',
--       and with detail also the prompts the sign-in flow shows while access is allowed:
--       'prompt_grace' (covered, no app yet, grace period running — mfa_deadline says until when) and
--       'prompt_admin' (PO decision 2: an Organization Admin without an app, not skipped yet).
--   private.session_access_state()     the web app (app_server, user claims): the same for the current
--       session, to send it to the code page or the set-up page instead of "signed out".
--   private.dismiss_mfa_prompt()       "not now" on the Organization Admin prompt, remembered per
--       organization (private.mfa_prompt_dismissals).
--   private.tenant_member_mfa(person)  whether a member of the caller's organization uses an
--       authenticator app (user profile, screen 3) — for user managers and the member themself.
--   private.auth_mfa_factor            security-barrier view of auth.mfa_factors (no secret) for
--       tenant_guard only (pattern of private.auth_session_validity, ADR 0002 §6a rev. 2).

-- The migration role hands function ownership to tenant_guard (as in 20260930120000).
grant tenant_guard to current_user;

-- ---------------------------------------------------------------------------------------------------
-- Auth factors for tenant_guard (never the TOTP secret)
-- ---------------------------------------------------------------------------------------------------
create or replace view private.auth_mfa_factor
with (security_barrier = true)  -- defensive only: the view has no WHERE clause
as select f.id, f.user_id, f.factor_type::text as factor_type, f.status::text as status, f.created_at, f.updated_at
   from auth.mfa_factors f;

comment on view private.auth_mfa_factor is
  'SECURITY-RELEVANT (T-M2-10): auth.mfa_factors (id, user_id, factor_type, status, created_at, updated_at — never the secret) for tenant_guard only. Owned by the migration role.';

revoke all on private.auth_mfa_factor from public;
grant select on private.auth_mfa_factor to tenant_guard;

do $$
declare
  v_owner name := (select pg_get_userbyid(relowner) from pg_class where oid = 'private.auth_mfa_factor'::regclass);
  v_column text;
begin
  foreach v_column in array array['id', 'user_id', 'factor_type', 'status', 'created_at', 'updated_at'] loop
    if not (has_schema_privilege(v_owner, 'auth', 'usage')
            and has_column_privilege(v_owner, 'auth.mfa_factors', v_column, 'select')) then
      raise exception 'role % (owner of private.auth_mfa_factor) cannot read auth.mfa_factors (%)', v_owner, v_column;
    end if;
  end loop;
  if not has_table_privilege('tenant_guard', 'private.auth_mfa_factor', 'select') then
    raise exception 'tenant_guard cannot read private.auth_mfa_factor';
  end if;
end
$$;

-- ---------------------------------------------------------------------------------------------------
-- "Not now" on the Organization Admin prompt (PO decision 2), per organization and account
-- ---------------------------------------------------------------------------------------------------
create table private.mfa_prompt_dismissals (
  tenant_id uuid not null references platform.tenants (id),
  user_id uuid not null references auth.users (id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
comment on table private.mfa_prompt_dismissals is
  'Organization Admins who chose "not now" on the authenticator-app prompt (PO decision 2, 9 Oct 2026). tenant_guard only.';

create index mfa_prompt_dismissals_user_id_idx on private.mfa_prompt_dismissals (user_id);

alter table private.mfa_prompt_dismissals enable row level security;
alter table private.mfa_prompt_dismissals force row level security;
create policy mfa_prompt_dismissals_guard on private.mfa_prompt_dismissals for all to tenant_guard
  using (true) with check (true);
revoke all on private.mfa_prompt_dismissals from public;
grant select, insert, update on private.mfa_prompt_dismissals to tenant_guard;

-- What the decision reads besides the session, membership and policy: when the member joined (grace
-- period), its id, and its roles in force (required_roles, the admin prompt).
grant select (id, created_at) on platform.tenant_memberships to tenant_guard;
grant select (tenant_id, membership_id, role_code, valid_from, valid_until) on platform.role_assignments to tenant_guard;
create policy role_assignments_tenant_guard_read on platform.role_assignments for select to tenant_guard using (true);

-- ---------------------------------------------------------------------------------------------------
-- The decision
-- ---------------------------------------------------------------------------------------------------
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

create or replace function private.current_tenant_id()
returns uuid
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_claims jsonb := private.request_claims();
  v_role text;
  v_tenant uuid;
begin
  if v_claims is null then
    return null;
  end if;

  v_role := v_claims ->> 'role';
  v_tenant := private.try_uuid(v_claims ->> 'tenant_id');
  if v_tenant is null then
    return null;
  end if;

  if v_role = 'authenticated' and session_user = 'app_server' then
    -- Live session of this user, active membership in an active/trial tenant, the session still acting in
    -- this tenant (a pre-switch token is refused), and the organization's MFA policy (T-M2-10).
    if (private.session_access(private.try_uuid(v_claims ->> 'sub'), private.try_uuid(v_claims ->> 'session_id'),
                               v_tenant, coalesce(v_claims ->> 'aal', '') = 'aal2', false)).state = 'ok' then
      return v_tenant;
    end if;
    return null;
  end if;

  if v_role = 'system' and session_user = 'app_worker' then
    if coalesce(btrim(v_claims ->> 'job_id'), '') <> ''
       and exists (select 1 from platform.tenants t where t.id = v_tenant and t.status in ('active', 'trial')) then
      return v_tenant;
    end if;
    return null;
  end if;

  return null;
end
$$;

comment on function private.current_tenant_id() is
  'SECURITY-RELEVANT (ADR 0002 §6a, T-M2-10). Tenant of the validated request claims (session, membership, session context, MFA policy), else NULL. Use as (select private.current_tenant_id()).';

-- The current session's state for the web app: where to send a session the database refuses.
create or replace function private.session_access_state(out state text, out mfa_deadline timestamptz)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_claims jsonb := private.request_claims();
  v_access record;
begin
  state := 'invalid';
  if session_user <> 'app_server' or v_claims is null or coalesce(v_claims ->> 'role', '') <> 'authenticated' then
    return;
  end if;
  select a.state, a.mfa_deadline into v_access
  from private.session_access(private.try_uuid(v_claims ->> 'sub'), private.try_uuid(v_claims ->> 'session_id'),
                              private.try_uuid(v_claims ->> 'tenant_id'), coalesce(v_claims ->> 'aal', '') = 'aal2',
                              true) a;
  state := v_access.state;
  mfa_deadline := v_access.mfa_deadline;
end
$$;

comment on function private.session_access_state() is
  'SECURITY-RELEVANT (T-M2-10). The current user session''s access state in its organization (app_server, user claims only).';

create or replace function private.dismiss_mfa_prompt()
returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_tenant uuid := private.current_tenant_id();
  v_user uuid := private.request_user_id();
begin
  if v_tenant is null or v_user is null then
    return false;
  end if;
  insert into private.mfa_prompt_dismissals as d (tenant_id, user_id) values (v_tenant, v_user)
  on conflict (tenant_id, user_id) do update set dismissed_at = now();
  return true;
end
$$;

comment on function private.dismiss_mfa_prompt() is
  'PO decision 2 (T-M2-10): the signed-in member chose "not now" on the authenticator-app prompt in the current organization.';

create or replace function private.tenant_member_mfa(p_person_id uuid)
returns table (uses_app boolean, since timestamptz)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_tenant uuid := private.current_tenant_id();
begin
  if v_tenant is null
     or not (p_person_id = private.request_person_id() or private.actor_manages_users(v_tenant)) then
    return;
  end if;
  return query
    select bool_or(f.id is not null), min(f.updated_at)
    from platform.tenant_memberships m
    left join private.auth_mfa_factor f on f.user_id = m.user_id and f.factor_type = 'totp' and f.status = 'verified'
    where m.tenant_id = v_tenant and m.person_id = p_person_id
    group by m.user_id;
end
$$;

comment on function private.tenant_member_mfa(uuid) is
  'Whether a member of the caller''s organization uses an authenticator app, and since when (screen 3). User managers and the member themself only.';

-- Ownership hand-over as in migration 20260930120100 (non-superuser migration role on hosted Supabase).
grant create on schema private to tenant_guard;
alter function private.session_access(uuid, uuid, uuid, boolean, boolean) owner to tenant_guard;
alter function private.session_access_state() owner to tenant_guard;
alter function private.dismiss_mfa_prompt() owner to tenant_guard;
alter function private.tenant_member_mfa(uuid) owner to tenant_guard;
revoke create on schema private from tenant_guard;

revoke all on function private.session_access(uuid, uuid, uuid, boolean, boolean) from public;
revoke all on function private.session_access_state() from public;
revoke all on function private.dismiss_mfa_prompt() from public;
revoke all on function private.tenant_member_mfa(uuid) from public;
grant execute on function private.session_access(uuid, uuid, uuid, boolean, boolean) to tenant_guard;
grant execute on function private.session_access_state() to authenticated;
grant execute on function private.dismiss_mfa_prompt() to authenticated;
grant execute on function private.tenant_member_mfa(uuid) to authenticated;
-- The definer functions call these helpers as tenant_guard.
grant execute on function private.actor_role_codes(uuid, uuid) to tenant_guard;
grant execute on function private.actor_manages_users(uuid) to tenant_guard;
grant execute on function private.request_person_id() to tenant_guard;
