-- MFA policy enforced by the database (FR-IAM-12; T-M2-10; TM-0003 T-IAM-41 / F-IAM-04, T-IAM-11). PII: none.
--
-- SECURITY-RELEVANT. private.current_tenant_id() — the predicate of every tenant policy — now also applies
-- the organization's MFA policy (platform.security_policies, 20261012090000) to a USER session:
--   * mfa_mode optional / required_* and the account has a confirmed authenticator app → the session must
--     have passed a code (AAL2): an AAL1 session reads nothing in the organization until it does;
--   * the member is covered by a requirement (required_all, or required_roles with a listed role in force)
--     and the grace period is over → AAL2 required, so a member without an app must set one up first. Roles
--     holding high-risk permissions get no grace period (private.mfa_no_grace_roles(), TM-0003 T-IAM-11).
-- Without a policy row the session is refused (fail closed; every organization has one).
--
-- What counts as AAL2 (security review H1, TM-0003 T-IAM-11): the LOWER of the access token's `aal` claim and
-- the Auth session's own level (auth.sessions.aal), and only when the code the session passed came from a
-- CONFIRMED app — the factor the Auth session records (auth.sessions.factor_id) is listed in
-- private.mfa_factor_confirmations with confirmed_at. An app counts once its owner proved BOTH the mailbox and
-- the app (security re-review N1, TM-0003 T-IAM-11): the set-up e-mail (account e-mails, worker) carries a
-- one-time code that is accepted only from the Auth session that set the app up — the session that passed
-- the app's first code (auth.sessions.factor_id), at AAL2 (20261012110000, private.confirm_mfa_setup). A
-- password-only attacker who sets up an app cannot confirm it (no mailbox), and the mailbox owner cannot
-- confirm someone else's app (wrong session). Until then the app works in Auth but not here — set-up is never
-- blocked, the factor just does not count yet. This also covers an app set up directly through Auth's API
-- (never confirmed). High-risk permissions need this AAL2 in every mode (registry + defineAction; PO decision
-- D-IAM-01; private.request_aal2()) and, in the database too, a code from the last 15 minutes
-- (private.request_code_fresh(): the `code_at` claim the web app derives from the verified token's amr).
--
--   private.session_access(user, session, tenant, aal2, detail)  tenant_guard only: the one decision —
--       'ok' | 'invalid' (no live session, membership or session context) | 'mfa_challenge' | 'mfa_enrol',
--       and with detail also the prompts the sign-in flow shows while access is allowed:
--       'prompt_grace' (covered, no app yet, grace period running — mfa_deadline says until when) and
--       'prompt_admin' (PO decision 2: an Organization Admin without an app; "not now" asks again after
--       private.mfa_prompt_reask_after()). aal2: what the access token claims (NULL: skip the MFA rules —
--       only whether the session lives in the organization, for session lists and sign-out).
--   private.request_aal2()             the current session's AAL2 as defined above (policies, defineAction).
--   private.request_code_fresh()       the current session's code is from the last private.step_up_max_age()
--       (PO answer, 9 Oct 2026: 15 minutes) — the policy update and the member reset check it here too.
--   private.request_session_facts()    defineAction: may the session act in its organization, and at AAL2?
--   private.session_access_state()     the web app (app_server, user claims): the same for the current
--       session, to send it to the code page or the set-up page instead of "signed out".
--   private.dismiss_mfa_prompt()       "not now" on the Organization Admin prompt.
--   private.tenant_member_mfa(person)  whether a member of the caller's organization uses a confirmed app (or
--       one waiting for confirmation) — for user managers and the member themself.
--   private.auth_mfa_factor / private.auth_session_validity   views of Auth's tables (never a secret or
--       token) for tenant_guard only, owned by the migration role (ADR 0002 §6a rev. 2): SELECT, and DELETE
--       to remove a factor (e-mailed "not you" link, resets) or end a session (security review M1).

-- The migration role hands function ownership to tenant_guard (as in 20260930120000).
grant tenant_guard to current_user;

-- ---------------------------------------------------------------------------------------------------
-- Auth factors and sessions for tenant_guard (never the TOTP secret, never a token)
-- ---------------------------------------------------------------------------------------------------
create or replace view private.auth_mfa_factor
with (security_barrier = true)  -- defensive only: the view has no WHERE clause
as select f.id, f.user_id, f.factor_type::text as factor_type, f.status::text as status, f.created_at, f.updated_at
   from auth.mfa_factors f;

comment on view private.auth_mfa_factor is
  'SECURITY-RELEVANT (T-M2-10): auth.mfa_factors (id, user_id, factor_type, status, created_at, updated_at — never the secret) for tenant_guard only (SELECT; DELETE to remove a factor). Owned by the migration role.';

revoke all on private.auth_mfa_factor from public;
grant select, delete on private.auth_mfa_factor to tenant_guard;

-- The session view keeps its first three columns (20260930120100); also when a session started, last
-- changed (refresh), its browser/device, its assurance level and the factor it passed.
create or replace view private.auth_session_validity
with (security_barrier = true)  -- defensive only: the view has no WHERE clause
as select s.id, s.user_id, s.not_after, s.created_at, s.updated_at, s.user_agent, s.aal::text as aal, s.factor_id
   from auth.sessions s;

comment on view private.auth_session_validity is
  'SECURITY-RELEVANT (ADR 0002 §6a rev. 2, T-M2-10): auth.sessions (id, user_id, not_after, created_at, updated_at, user_agent, aal, factor_id — never a token) for tenant_guard only (SELECT; DELETE to end a session). Owned by the migration role.';

revoke all on private.auth_session_validity from public;
grant select, delete on private.auth_session_validity to tenant_guard;

-- Fail loudly, never silently, when the migration role lacks a privilege the views need (hosted Supabase:
-- `postgres` is not a superuser; its ACL on Auth's tables is checked here, and by scripts/sql/verify-deployment.sql).
do $$
declare
  v_owner name;
  v_column text;
begin
  v_owner := (select pg_get_userbyid(relowner) from pg_class where oid = 'private.auth_mfa_factor'::regclass);
  foreach v_column in array array['id', 'user_id', 'factor_type', 'status', 'created_at', 'updated_at'] loop
    if not (has_schema_privilege(v_owner, 'auth', 'usage')
            and has_column_privilege(v_owner, 'auth.mfa_factors', v_column, 'select')) then
      raise exception 'role % (owner of private.auth_mfa_factor) cannot read auth.mfa_factors (%)', v_owner, v_column;
    end if;
  end loop;
  if not has_table_privilege(v_owner, 'auth.mfa_factors', 'delete') then
    raise exception 'role % (owner of private.auth_mfa_factor) cannot delete from auth.mfa_factors (factor removal, T-M2-10)', v_owner;
  end if;
  if not has_table_privilege(v_owner, 'auth.mfa_factors', 'references') then
    raise exception 'role % cannot reference auth.mfa_factors (private.mfa_factor_confirmations, T-M2-10)', v_owner;
  end if;

  v_owner := (select pg_get_userbyid(relowner) from pg_class where oid = 'private.auth_session_validity'::regclass);
  foreach v_column in array array['id', 'user_id', 'not_after', 'created_at', 'updated_at', 'user_agent', 'aal',
                                   'factor_id'] loop
    if not (has_schema_privilege(v_owner, 'auth', 'usage')
            and has_column_privilege(v_owner, 'auth.sessions', v_column, 'select')) then
      raise exception 'role % (owner of private.auth_session_validity) cannot read auth.sessions (%)', v_owner, v_column;
    end if;
  end loop;
  if not has_table_privilege(v_owner, 'auth.sessions', 'delete') then
    raise exception 'role % (owner of private.auth_session_validity) cannot delete from auth.sessions (ending sessions, security review M1)', v_owner;
  end if;

  if not (has_table_privilege('tenant_guard', 'private.auth_mfa_factor', 'select')
          and has_table_privilege('tenant_guard', 'private.auth_mfa_factor', 'delete')
          and has_table_privilege('tenant_guard', 'private.auth_session_validity', 'select')
          and has_table_privilege('tenant_guard', 'private.auth_session_validity', 'delete')) then
    raise exception 'tenant_guard must read and delete through private.auth_mfa_factor and private.auth_session_validity';
  end if;
end
$$;

-- ---------------------------------------------------------------------------------------------------
-- Confirmed apps (security review H1, TM-0003 T-IAM-11)
-- ---------------------------------------------------------------------------------------------------
-- One row per Auth factor set up through the web app, recorded by the Auth session that set it up (it passed
-- the app's first code: Auth records the factor on that session). confirmed_at: that same session entered the
-- one-time code of the set-up e-mail (mailbox AND app proved, re-review N1). The code is 8 digits: only its
-- SHA-256 (with the factor id) is kept, it expires (private.mfa_code_lifetime()) and dies after
-- private.mfa_code_max_attempts() wrong tries. The e-mail also carries a "not you? remove this app" link (its
-- token's SHA-256 only). setup_user_agent: that session's browser at set-up, shown to the account's other
-- sessions ("an app was added from another sign-in") and in the e-mail.
create table private.mfa_factor_confirmations (
  factor_id uuid primary key references auth.mfa_factors (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id uuid not null,
  setup_user_agent text,
  confirmed_at timestamptz,
  code_hash bytea,
  code_expires_at timestamptz,
  code_issued_at timestamptz,
  code_attempts smallint not null default 0,
  remove_token_hash bytea,
  remove_expires_at timestamptz,
  created_at timestamptz not null default now(),
  constraint mfa_factor_confirmations_code_hash_check check (code_hash is null or octet_length(code_hash) = 32),
  constraint mfa_factor_confirmations_code_attempts_check check (code_attempts between 0 and 5),
  constraint mfa_factor_confirmations_remove_hash_check check (remove_token_hash is null or octet_length(remove_token_hash) = 32),
  constraint mfa_factor_confirmations_user_agent_check check (setup_user_agent is null or char_length(setup_user_agent) <= 512)
);
comment on table private.mfa_factor_confirmations is
  'SECURITY-RELEVANT (FR-IAM-12, T-M2-10, TM-0003 T-IAM-11, re-review N1). Authenticator apps, the Auth session that set each up, and whether that session entered the e-mailed code (mailbox and app proved); an app counts for AAL2 only once confirmed. Code and token hashes only. tenant_guard only.';

create index mfa_factor_confirmations_user_id_idx on private.mfa_factor_confirmations (user_id);
create unique index mfa_factor_confirmations_remove_hash_idx on private.mfa_factor_confirmations (remove_token_hash)
  where remove_token_hash is not null;

alter table private.mfa_factor_confirmations enable row level security;
alter table private.mfa_factor_confirmations force row level security;
create policy mfa_factor_confirmations_guard on private.mfa_factor_confirmations for all to tenant_guard
  using (true) with check (true);
revoke all on private.mfa_factor_confirmations from public;
grant select, insert, update, delete on private.mfa_factor_confirmations to tenant_guard;

-- ---------------------------------------------------------------------------------------------------
-- Platform constants (one place each)
-- ---------------------------------------------------------------------------------------------------
-- PO decision (answer of 9 Oct 2026): "not now" on the Organization Admin prompt asks again after 30 days.
create or replace function private.mfa_prompt_reask_after()
returns interval
language sql immutable
set search_path = ''
as $$ select interval '30 days' $$;

comment on function private.mfa_prompt_reask_after() is
  'PO decision (T-M2-10): "not now" on the Organization Admin authenticator prompt is remembered this long. The only place of the value.';

-- Roles holding high-risk permissions (platform.role.assign_privileged, platform.tenant.manage,
-- platform.security.manage): no grace period when a requirement covers them (TM-0003 T-IAM-11). Kept equal to
-- the role matrix by a unit test (packages/platform-rbac/src/system-roles.test.ts).
create or replace function private.mfa_no_grace_roles()
returns text[]
language sql immutable
set search_path = ''
as $$ select array['tenant_admin']::text[] $$;

comment on function private.mfa_no_grace_roles() is
  'TM-0003 T-IAM-11 (T-M2-10): roles holding high-risk permissions — no MFA grace period. Equal to the role matrix (unit test).';

-- PO answer (9 Oct 2026; review L3): a high-risk action needs an authenticator code from the last 15 minutes
-- (the web app's STEP_UP_MAX_AGE_SECONDS is the same value; a unit test and pgTAP 68 keep them equal).
create or replace function private.step_up_max_age()
returns interval
language sql immutable
set search_path = ''
as $$ select interval '15 minutes' $$;

comment on function private.step_up_max_age() is
  'PO answer (T-M2-10, review L3): how recent the authenticator code of a high-risk action must be. Equal to STEP_UP_MAX_AGE_SECONDS.';

revoke all on function private.mfa_prompt_reask_after() from public;
revoke all on function private.mfa_no_grace_roles() from public;
revoke all on function private.step_up_max_age() from public;
grant execute on function private.mfa_prompt_reask_after() to tenant_guard;
grant execute on function private.mfa_no_grace_roles() to tenant_guard;
grant execute on function private.step_up_max_age() to tenant_guard;

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
  'Organization Admins who chose "not now" on the authenticator-app prompt (PO decision 2, 9 Oct 2026; asked again after private.mfa_prompt_reask_after()). tenant_guard only.';

create index mfa_prompt_dismissals_user_id_idx on private.mfa_prompt_dismissals (user_id);

alter table private.mfa_prompt_dismissals enable row level security;
alter table private.mfa_prompt_dismissals force row level security;
create policy mfa_prompt_dismissals_guard on private.mfa_prompt_dismissals for all to tenant_guard
  using (true) with check (true);
revoke all on private.mfa_prompt_dismissals from public;
grant select, insert, update on private.mfa_prompt_dismissals to tenant_guard;

-- What the decision reads besides the session, membership and policy: when the member joined (grace
-- period), its id, and its roles in force (required_roles, the admin prompt, no-grace roles).
grant select (id, created_at) on platform.tenant_memberships to tenant_guard;
grant select (tenant_id, membership_id, role_code, valid_from, valid_until) on platform.role_assignments to tenant_guard;
create policy role_assignments_tenant_guard_read on platform.role_assignments for select to tenant_guard using (true);

-- ---------------------------------------------------------------------------------------------------
-- The decision
-- ---------------------------------------------------------------------------------------------------
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
  if p_user_id is null or p_session_id is null or p_tenant_id is null
     or not private.user_session_is_valid(p_user_id, p_session_id) then
    return;
  end if;
  -- The session acts in this organization (ADR 0002 §3), as an active member of an active/trial one; its
  -- own assurance level and whether the factor it passed is a confirmed app.
  select m.id as membership_id, m.created_at as member_since, p.mfa_mode, p.mfa_required_roles,
         p.mfa_grace_days, p.mfa_required_since, p.mfa_prompt_admins,
         s.aal as session_aal, k.factor_id is not null as factor_confirmed
    into v
  from private.auth_session_validity s
  join platform.session_context c on c.session_id = s.id and c.user_id = s.user_id
  join platform.tenant_memberships m on m.tenant_id = c.active_tenant_id and m.user_id = c.user_id
  join platform.tenants t on t.id = m.tenant_id
  join platform.security_policies p on p.tenant_id = m.tenant_id
  left join private.mfa_factor_confirmations k
    on k.factor_id = s.factor_id and k.user_id = s.user_id and k.confirmed_at is not null
  where s.id = p_session_id and s.user_id = p_user_id and c.active_tenant_id = p_tenant_id
    and m.status = 'active' and t.status in ('active', 'trial');
  if not found then
    return;
  end if;
  state := 'ok';
  if p_aal2 is null then
    return;  -- lifecycle only (lists, sign-out): the MFA rules are not asked
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
  'SECURITY-RELEVANT (ADR 0002 §6a, T-IAM-41, T-IAM-11). May this user session act in this organization now (ok), and if not why; with detail also the MFA prompts, whether the account uses a confirmed app or one awaits confirmation, and the effective AAL2. aal2 NULL: lifecycle only. tenant_guard only.';

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

-- The current session's AAL2 (review H1): claim aal2, Auth session aal2, through a confirmed app, live.
create or replace function private.request_aal2()
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_claims jsonb := private.request_claims();
  v_user uuid;
  v_session uuid;
begin
  if session_user <> 'app_server' or v_claims is null or coalesce(v_claims ->> 'role', '') <> 'authenticated'
     or coalesce(v_claims ->> 'aal', '') <> 'aal2' then
    return false;
  end if;
  v_user := private.try_uuid(v_claims ->> 'sub');
  v_session := private.try_uuid(v_claims ->> 'session_id');
  return private.user_session_is_valid(v_user, v_session)
     and exists (select 1
                 from private.auth_session_validity s
                 join private.mfa_factor_confirmations k
                   on k.factor_id = s.factor_id and k.user_id = s.user_id and k.confirmed_at is not null
                 where s.id = v_session and s.user_id = v_user and s.aal = 'aal2');
end
$$;

comment on function private.request_aal2() is
  'SECURITY-RELEVANT (T-M2-10, review H1, D-IAM-01). The current user session is at AAL2: the token claims it, the Auth session is aal2, and the code came from a confirmed app.';

-- The current session's code is recent enough for a high-risk action (review L3, re-review info): the
-- `code_at` claim (seconds since the epoch of the newest authenticator code in the verified access token's
-- amr — the web app derives it, withUserTx) is not older than private.step_up_max_age(). Only meaningful
-- together with private.request_aal2().
create or replace function private.request_code_fresh()
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_claims jsonb := private.request_claims();
  v_at text;
begin
  if session_user <> 'app_server' or v_claims is null or coalesce(v_claims ->> 'role', '') <> 'authenticated' then
    return false;
  end if;
  v_at := v_claims ->> 'code_at';
  if v_at is null or v_at !~ '^[0-9]{1,12}$' then
    return false;
  end if;
  return to_timestamp(v_at::bigint) >= now() - private.step_up_max_age();
end
$$;

comment on function private.request_code_fresh() is
  'SECURITY-RELEVANT (T-M2-10, review L3). The current user session passed its authenticator code within private.step_up_max_age() (the code_at claim). With private.request_aal2() for high-risk changes.';

-- defineAction (every authorized action and query): may the current session act in its organization (the
-- same decision as every tenant policy), and is it at AAL2? One call.
create or replace function private.request_session_facts(out active boolean, out aal2 boolean)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  active := private.current_tenant_id() is not null;
  aal2 := active and private.request_aal2();
end
$$;

comment on function private.request_session_facts() is
  'SECURITY-RELEVANT (T-M2-10, review L1). For defineAction: the current session may act in its organization (active) and is at AAL2.';

-- May the signed-in member change the policy? An Organization Admin (role in force now) whose session
-- passed a code from a confirmed app (AAL2, review H1) in the last 15 minutes (review L3: checked here too,
-- not only by the web app). SECURITY INVOKER: the caller reads its own roles.
create or replace function private.actor_may_change_security_policy(p_tenant_id uuid)
returns boolean
language sql stable
set search_path = ''
as $$
  select private.request_aal2() and private.request_code_fresh()
     and 'tenant_admin' = any (private.actor_role_codes(p_tenant_id, private.request_user_id()));
$$;

comment on function private.actor_may_change_security_policy(uuid) is
  'SECURITY-RELEVANT (T-IAM-24, D-IAM-01, review L3): an Organization Admin at AAL2 (confirmed app, private.request_aal2) with a code from the last 15 minutes (private.request_code_fresh) may change the security policy.';

-- The current session's state for the web app: where to send a session the database refuses.
create or replace function private.session_access_state(
  out state text, out mfa_deadline timestamptz, out uses_app boolean, out mfa_pending boolean, out aal2 boolean)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_claims jsonb := private.request_claims();
  v_access record;
begin
  state := 'invalid';
  uses_app := false;
  mfa_pending := false;
  aal2 := false;
  if session_user <> 'app_server' or v_claims is null or coalesce(v_claims ->> 'role', '') <> 'authenticated' then
    return;
  end if;
  select a.* into v_access
  from private.session_access(private.try_uuid(v_claims ->> 'sub'), private.try_uuid(v_claims ->> 'session_id'),
                              private.try_uuid(v_claims ->> 'tenant_id'), coalesce(v_claims ->> 'aal', '') = 'aal2',
                              true) a;
  state := v_access.state;
  mfa_deadline := v_access.mfa_deadline;
  uses_app := coalesce(v_access.uses_app, false);
  mfa_pending := coalesce(v_access.mfa_pending, false);
  aal2 := coalesce(v_access.aal2, false);
end
$$;

comment on function private.session_access_state() is
  'SECURITY-RELEVANT (T-M2-10). The current user session''s access state in its organization, its apps and its effective AAL2 (app_server, user claims only).';

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
  'PO decision 2 (T-M2-10): the signed-in member chose "not now" on the authenticator-app prompt in the current organization (asked again after private.mfa_prompt_reask_after()).';

create or replace function private.tenant_member_mfa(p_person_id uuid)
returns table (uses_app boolean, since timestamptz, pending boolean)
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
    select coalesce(bool_or(k.confirmed_at is not null), false),
           min(f.updated_at) filter (where k.confirmed_at is not null),
           coalesce(bool_or(f.id is not null and k.confirmed_at is null), false)
    from platform.tenant_memberships m
    left join private.auth_mfa_factor f on f.user_id = m.user_id and f.factor_type = 'totp' and f.status = 'verified'
    left join private.mfa_factor_confirmations k on k.factor_id = f.id and k.user_id = f.user_id
    where m.tenant_id = v_tenant and m.person_id = p_person_id
    group by m.user_id;
end
$$;

comment on function private.tenant_member_mfa(uuid) is
  'Whether a member of the caller''s organization uses a confirmed authenticator app (and since when), or has one waiting for e-mail confirmation (screen 3). User managers and the member themself only.';

-- Ownership hand-over as in migration 20260930120100 (non-superuser migration role on hosted Supabase).
grant create on schema private to tenant_guard;
alter function private.session_access(uuid, uuid, uuid, boolean, boolean) owner to tenant_guard;
alter function private.request_aal2() owner to tenant_guard;
alter function private.request_code_fresh() owner to tenant_guard;
alter function private.request_session_facts() owner to tenant_guard;
alter function private.session_access_state() owner to tenant_guard;
alter function private.dismiss_mfa_prompt() owner to tenant_guard;
alter function private.tenant_member_mfa(uuid) owner to tenant_guard;
revoke create on schema private from tenant_guard;

revoke all on function private.session_access(uuid, uuid, uuid, boolean, boolean) from public;
revoke all on function private.request_aal2() from public;
revoke all on function private.request_code_fresh() from public;
revoke all on function private.request_session_facts() from public;
revoke all on function private.session_access_state() from public;
revoke all on function private.dismiss_mfa_prompt() from public;
revoke all on function private.tenant_member_mfa(uuid) from public;
grant execute on function private.session_access(uuid, uuid, uuid, boolean, boolean) to tenant_guard;
grant execute on function private.request_aal2() to authenticated;
grant execute on function private.request_code_fresh() to authenticated;
grant execute on function private.request_session_facts() to authenticated;
grant execute on function private.session_access_state() to authenticated;
grant execute on function private.dismiss_mfa_prompt() to authenticated;
grant execute on function private.tenant_member_mfa(uuid) to authenticated;
-- The definer functions call these helpers as tenant_guard.
grant execute on function private.actor_role_codes(uuid, uuid) to tenant_guard;
grant execute on function private.actor_manages_users(uuid) to tenant_guard;
grant execute on function private.request_person_id() to tenant_guard;
