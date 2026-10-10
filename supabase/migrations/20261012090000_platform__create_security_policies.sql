-- Security policy per organization (FR-IAM-12, FR-IAM-13; T-M2-10; approved screen 6 «الأمان»; TM-0003
-- T-IAM-24, T-IAM-41, T-IAM-43). ADR 0002 §6 pattern. Class: T. PII: none.
--
--   platform.security_policies  one row per organization, created with it (trigger on platform.tenants;
--     existing organizations: 20261012090010) and never deleted. What each setting does:
--       mfa_mode              off            nobody is asked for a code at sign-in (high-risk actions still
--                                            need one: PO decision D-IAM-01, 6 Oct 2026)
--                             optional       members who set up an authenticator app are asked at sign-in
--                             required_all   every member must set one up and use it at sign-in
--                             required_roles members holding one of mfa_required_roles must (the others:
--                                            optional)
--       mfa_grace_days        days a member covered by a requirement may still sign in without an app
--                             (counted from mfa_required_since, or from joining when later)
--       mfa_prompt_admins     Organization Admins without an app are invited to set one up at sign-in and
--                             may skip it (PO decision 2, 9 Oct 2026); the skip is remembered
--       password_min_length   12–36 characters (PO: no character classes; 36 Arabic letters fill Auth's
--                             72-byte limit, so every rule can be met in Arabic). Strictest-wins over all
--                             of an account's organizations (PO decision 5, 9 Oct 2026): 20261012090200
--       lockout_*             stored and shown here; enforced by the sign-in limiter (T-M2-11)
--       session_*             inactivity, maximum length and devices of sign-in sessions; enforced by
--                             private.current_tenant_id() (20261012100000)
--   Platform floors the organization cannot go below (T-IAM-24): length ≥ 12; lockout cannot be turned off
--   (3–10 attempts, 5–60 minutes); sessions end after at most 24 hours and 8 hours of inactivity.
--   Writers: an Organization Admin at AAL2 only — the action checks platform.security.manage (high risk,
--   AAL2, getUser()); the update policy checks the same here (tenant_admin role in force + aal2 claim).
--   Members read their organization's policy (password rules); only the settings columns are updatable;
--   the trigger stamps updated_* / version and when an MFA requirement started.

create table platform.security_policies (
  tenant_id uuid primary key references platform.tenants (id),
  mfa_mode text not null default 'off',
  mfa_required_roles text[] not null default '{tenant_admin}',
  mfa_grace_days smallint not null default 7,
  mfa_required_since timestamptz,
  mfa_prompt_admins boolean not null default true,
  password_min_length smallint not null default 12,
  lockout_threshold smallint not null default 5,
  lockout_minutes smallint not null default 15,
  session_idle_minutes smallint not null default 30,
  session_max_hours smallint not null default 12,
  session_max_devices smallint not null default 3,
  -- [std] without id (one row per organization): who changed it last, and a concurrency token.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  constraint security_policies_mfa_mode_check
    check (mfa_mode in ('off', 'optional', 'required_all', 'required_roles')),
  constraint security_policies_mfa_required_roles_check
    check (cardinality(mfa_required_roles) <= 14 and array_position(mfa_required_roles, null) is null
           and (mfa_mode <> 'required_roles' or cardinality(mfa_required_roles) > 0)),
  constraint security_policies_mfa_grace_days_check check (mfa_grace_days between 0 and 30),
  constraint security_policies_password_min_length_check check (password_min_length between 12 and 36),
  -- Lockout: the platform default (5 attempts, 15 minutes) or stricter, never more lenient (TM-0003 T-IAM-24;
  -- T-M2-11 clamps the same way at sign-in).
  constraint security_policies_lockout_threshold_check check (lockout_threshold between 3 and 5),
  constraint security_policies_lockout_minutes_check check (lockout_minutes between 15 and 60),
  constraint security_policies_session_idle_minutes_check check (session_idle_minutes between 5 and 480),
  constraint security_policies_session_max_hours_check check (session_max_hours between 1 and 24),
  constraint security_policies_session_max_devices_check check (session_max_devices between 1 and 10),
  constraint security_policies_updated_by_fkey
    foreign key (tenant_id, updated_by) references platform.persons (tenant_id, id)
);
comment on table platform.security_policies is
  'Security settings of an organization (FR-IAM-12/13, screen 6). Owner: platform. Class: T. Changed only by an Organization Admin at AAL2.';

-- May the signed-in member change the policy? An Organization Admin (role in force now) whose session
-- passed an authenticator code (aal2). SECURITY INVOKER: the caller reads its own tenant's roles.
create or replace function private.actor_may_change_security_policy(p_tenant_id uuid)
returns boolean
language sql stable
set search_path = ''
as $$
  select coalesce(private.request_claims() ->> 'aal', '') = 'aal2'
     and 'tenant_admin' = any (private.actor_role_codes(p_tenant_id, private.request_user_id()));
$$;

comment on function private.actor_may_change_security_policy(uuid) is
  'SECURITY-RELEVANT (T-IAM-24, D-IAM-01): an Organization Admin at AAL2 may change the security policy.';

revoke all on function private.actor_may_change_security_policy(uuid) from public;
grant execute on function private.actor_may_change_security_policy(uuid) to authenticated;

-- [std]-style stamps from verified claims, role codes checked against platform.ref_roles, and the start of
-- an MFA requirement (the grace period counts from it): set when members may newly be covered — the
-- requirement starts, widens from roles to everyone, or gains a role — kept otherwise, cleared without one.
create or replace function private.stamp_security_policy()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_requires boolean := new.mfa_mode in ('required_all', 'required_roles');
begin
  if exists (select 1 from unnest(new.mfa_required_roles) r (code)
             where not exists (select 1 from platform.ref_roles x where x.code = r.code)) then
    raise exception 'unknown role in mfa_required_roles' using errcode = 'check_violation',
      constraint = 'security_policies_mfa_required_roles_check';
  end if;
  new.mfa_required_roles := array(select distinct r from unnest(new.mfa_required_roles) r order by r);
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := new.created_at;
    new.updated_by := private.request_person_id();
    new.version := 1;
    new.mfa_required_since := case when v_requires then now() end;
    return new;
  end if;
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'the organization of a security policy cannot change' using errcode = 'insufficient_privilege';
  end if;
  new.created_at := old.created_at;
  new.updated_at := now();
  new.updated_by := private.request_person_id();
  new.version := old.version + 1;
  if not v_requires then
    new.mfa_required_since := null;
  elsif old.mfa_mode not in ('required_all', 'required_roles')
        or (new.mfa_mode = 'required_all' and old.mfa_mode = 'required_roles')
        or (new.mfa_mode = 'required_roles' and old.mfa_mode = 'required_roles'
            and not (new.mfa_required_roles <@ old.mfa_required_roles)) then
    new.mfa_required_since := now();
  else
    new.mfa_required_since := old.mfa_required_since;
  end if;
  return new;
end
$$;

comment on function private.stamp_security_policy() is
  'SECURITY-RELEVANT. Stamps updated_*/version from verified claims and the start of an MFA requirement (grace period).';

revoke all on function private.stamp_security_policy() from public;

create trigger security_policies_stamp before insert or update on platform.security_policies
  for each row execute function private.stamp_security_policy();

-- Every new organization gets the default policy (provisioning is a platform operation).
create or replace function private.create_tenant_security_policy()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into platform.security_policies (tenant_id) values (new.id);
  return new;
end
$$;

comment on function private.create_tenant_security_policy() is
  'Creates the default security policy of a new organization (T-M2-10).';

revoke all on function private.create_tenant_security_policy() from public;

create trigger tenants_security_policy after insert on platform.tenants
  for each row execute function private.create_tenant_security_policy();

alter table platform.security_policies enable row level security;
alter table platform.security_policies force row level security;

create policy tenant_isolation on platform.security_policies
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
create policy security_policies_read on platform.security_policies for select to authenticated using (true);
create policy security_policies_update on platform.security_policies for update to authenticated
  using (private.actor_may_change_security_policy(tenant_id))
  with check (private.actor_may_change_security_policy(tenant_id));
-- Claim validation (session rules, MFA) reads every organization's policy.
create policy security_policies_guard_read on platform.security_policies for select to tenant_guard using (true);
-- The minimum password length of the organization an invitation is for (20261012090200).
create policy security_policies_invitation_read on platform.security_policies for select to invitation_guard
  using (true);

revoke all on platform.security_policies from public, anon;
grant select on platform.security_policies to authenticated;
grant update (mfa_mode, mfa_required_roles, mfa_grace_days, mfa_prompt_admins, password_min_length,
              lockout_threshold, lockout_minutes, session_idle_minutes, session_max_hours, session_max_devices)
  on platform.security_policies to authenticated;
grant select on platform.security_policies to tenant_guard;
grant select (tenant_id, password_min_length) on platform.security_policies to invitation_guard;
