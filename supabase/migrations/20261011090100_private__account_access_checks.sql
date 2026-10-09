-- Auth ban of accounts that sign in nowhere (FR-IAM-05, T-M2-09; the T-M2-08 follow-up in
-- docs/engineering/password-reset.md §4). Defence in depth: the database already refuses every tenant
-- request of a deactivated member at once (private.current_tenant_id(): no active membership) and the
-- sign-in flow finds no organization. On top of that, an Auth account that has NO active membership in
-- any active or trial organization — and no pending invitation that would bring it back — is banned in
-- Supabase Auth, so it cannot sign in or refresh a token at all and gets no reset e-mail; it is unbanned
-- as soon as that changes (reactivation, a new membership, an invitation to accept). Never a ban from a
-- tenant action as such (TM-0003 T-IAM-40): another organization's active membership keeps the account.
--
-- Only the WORKER holds the Auth admin key (ADR 0002 §7): the database queues a check per account, the
-- worker (platform task `platform.account_access`) asks the database what to do and calls Auth's admin
-- API (PUT /admin/users/{id} with ban_duration). Class: P (platform). PII: none (account ids only).
--
--   private.account_access_checks  one waiting check per Auth account (no tenant: an account may belong to
--                           several organizations). Written by the membership / invitation triggers below,
--                           read and removed by the worker functions only.
--   private.account_bans    the accounts WE banned (so we never lift a ban somebody else set).
--   private.auth_account_access  security-barrier view of auth.users (id, email, banned_until, is_sso_user)
--                           for membership_guard only.
--   private.claim_account_access_check()   worker: leases the oldest due check and says ban / unban / none.
--   private.finish_account_access_check(…) worker: records what Auth did and removes the check — unless the
--                           account changed again meanwhile (then it is decided again at once).
--   private.retry_account_access_check(…)  worker: Auth could not answer; back-off up to an hour, never
--                           given up (the account row's removal also removes the check).

-- ---------------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------------
create table private.account_access_checks (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- The last change that asked for this check (a newer change while the worker is busy keeps it waiting).
  requested_at timestamptz not null default clock_timestamp(),
  attempts integer not null default 0,
  not_before timestamptz not null default now(),
  leased_until timestamptz,
  constraint account_access_checks_attempts_check check (attempts between 0 and 10000)
);
comment on table private.account_access_checks is
  'SECURITY-RELEVANT (FR-IAM-05, T-M2-09). Auth accounts whose ban must be decided again by the worker. Only membership_guard''s functions reach it.';
create index account_access_checks_due_idx on private.account_access_checks (requested_at);

create table private.account_bans (
  user_id uuid primary key references auth.users (id) on delete cascade,
  banned_at timestamptz not null default now()
);
comment on table private.account_bans is
  'SECURITY-RELEVANT (FR-IAM-05, T-M2-09). Auth accounts the worker banned because they sign in nowhere; only these are unbanned again.';

alter table private.account_access_checks enable row level security;
alter table private.account_access_checks force row level security;
alter table private.account_bans enable row level security;
alter table private.account_bans force row level security;

create policy account_access_checks_guard on private.account_access_checks for all to membership_guard
  using (true) with check (true);
create policy account_bans_guard on private.account_bans for all to membership_guard
  using (true) with check (true);

revoke all on private.account_access_checks, private.account_bans from public;
grant select, insert, update, delete on private.account_access_checks, private.account_bans to membership_guard;

-- A new check wakes the workers like a new event (channel jadarat_events, ADR 0004 §4): daemon workers run
-- the platform task at once; the minutely schedule covers any gap.
create trigger account_access_checks_notify after insert on private.account_access_checks
  for each statement execute function private.notify_event_dispatcher();

-- ---------------------------------------------------------------------------------------------------
-- Auth accounts for membership_guard (pattern of private.auth_session_validity, ADR 0002 §6a rev. 2)
-- ---------------------------------------------------------------------------------------------------
create or replace view private.auth_account_access
with (security_barrier = true)  -- defensive only: the view has no WHERE clause
as select u.id, u.email, u.banned_until, u.is_sso_user from auth.users u;

comment on view private.auth_account_access is
  'SECURITY-RELEVANT (T-M2-09): auth.users (id, email, banned_until, is_sso_user) for membership_guard only. Owned by the migration role.';

revoke all on private.auth_account_access from public;
grant select on private.auth_account_access to membership_guard;

do $$
declare
  v_owner name := (select pg_get_userbyid(relowner) from pg_class where oid = 'private.auth_account_access'::regclass);
  v_column text;
begin
  foreach v_column in array array['id', 'email', 'banned_until', 'is_sso_user'] loop
    if not (has_schema_privilege(v_owner, 'auth', 'usage') and has_column_privilege(v_owner, 'auth.users', v_column, 'select')) then
      raise exception 'role % (owner of private.auth_account_access) cannot read auth.users (%)', v_owner, v_column;
    end if;
  end loop;
  if not has_table_privilege('membership_guard', 'private.auth_account_access', 'select') then
    raise exception 'membership_guard cannot read private.auth_account_access';
  end if;
end
$$;

-- What the decision reads besides memberships (granted in 20261011090000): organizations' status and
-- pending invitations by e-mail.
create policy tenants_membership_guard_read on platform.tenants for select to membership_guard using (true);
grant select (id, status) on platform.tenants to membership_guard;
create policy invitations_membership_guard_read on platform.invitations for select to membership_guard
  using (true);
grant select (tenant_id, email, status, expires_at) on platform.invitations to membership_guard;
-- Pending invitations of an e-mail across organizations (the decision below).
create index invitations_pending_email_idx on platform.invitations (email) where status = 'pending';

-- ---------------------------------------------------------------------------------------------------
-- Functions (owner membership_guard)
-- ---------------------------------------------------------------------------------------------------
-- Should the account be banned now? No active membership in an active or trial organization, and no
-- pending, unexpired invitation for its e-mail in one (an existing account must be able to sign in to
-- accept it, T-M2-07 "sign in to accept"). SECURITY INVOKER: called only by the definer functions below.
create or replace function private.account_should_be_banned(p_user_id uuid)
returns boolean
language sql stable
set search_path = ''
as $$
  select not exists (
           select 1
           from platform.tenant_memberships m
           join platform.tenants t on t.id = m.tenant_id
           where m.user_id = p_user_id and m.status = 'active' and t.status in ('active', 'trial'))
     and not exists (
           select 1
           from private.auth_account_access a
           join platform.invitations i on i.email = lower(a.email)
           join platform.tenants t on t.id = i.tenant_id
           where a.id = p_user_id and i.status = 'pending' and i.expires_at > now()
             and t.status in ('active', 'trial'));
$$;

comment on function private.account_should_be_banned(uuid) is
  'SECURITY-RELEVANT (T-M2-09). True when the Auth account signs in nowhere (no active membership, no pending invitation in a served organization). membership_guard only.';

-- Queues (or renews) the check of one account. SECURITY INVOKER: called only by the definer triggers.
create or replace function private.queue_account_access_check(p_user_id uuid)
returns void
language sql volatile
set search_path = ''
as $$
  insert into private.account_access_checks as c (user_id) values (p_user_id)
  on conflict (user_id) do update
    set requested_at = clock_timestamp(), not_before = now(), attempts = 0;
$$;

comment on function private.queue_account_access_check(uuid) is
  'T-M2-09. Queues the Auth ban decision of one account for the worker. membership_guard only.';

-- A membership became active or stopped being active (any writer: deactivation, reactivation, invitation
-- acceptance, provisioning): decide again whether the account signs in anywhere.
create or replace function private.membership_access_changed()
returns trigger
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' and new.status = 'active')
     or (tg_op = 'UPDATE' and (old.status = 'active') is distinct from (new.status = 'active')) then
    perform private.queue_account_access_check(new.user_id);
  end if;
  return null;
end
$$;

comment on function private.membership_access_changed() is
  'SECURITY-RELEVANT (T-M2-09). Trigger: a membership entering or leaving active queues the account''s Auth ban decision. membership_guard.';

-- An invitation was created or ended (accepted, revoked): an existing account with that e-mail may need to
-- sign in to accept it — or no longer.
create or replace function private.invitation_access_changed()
returns trigger
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  if (tg_op = 'INSERT' and new.status <> 'pending')
     or (tg_op = 'UPDATE' and new.status is not distinct from old.status) then
    return null;
  end if;
  select a.id into v_user
  from private.auth_account_access a
  where a.email = new.email and not a.is_sso_user
  order by a.id
  limit 1;
  if v_user is not null then
    perform private.queue_account_access_check(v_user);
  end if;
  return null;
end
$$;

comment on function private.invitation_access_changed() is
  'SECURITY-RELEVANT (T-M2-09). Trigger: an invitation created, accepted or revoked queues the Auth ban decision of an existing account with its e-mail. membership_guard.';

-- Worker (app_worker, system claims with a job id, no tenant): leases the oldest due check for 5 minutes
-- and says what to do in Auth:
--   ban     the account signs in nowhere and is not (or not by us) banned
--   unban   it signs in somewhere again and we banned it
--   none    nothing to change (also: banned by someone else while it signs in somewhere — left alone)
create or replace function private.claim_account_access_check()
returns table (user_id uuid, action text, requested_at timestamptz, attempts integer)
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_claims jsonb := private.request_claims();
  v_check record;
  v_should boolean;
  v_ours boolean;
  v_banned boolean;
begin
  if session_user <> 'app_worker' or coalesce(v_claims ->> 'role', '') <> 'system'
     or coalesce(btrim(v_claims ->> 'job_id'), '') = '' then
    raise exception 'reserved to the worker' using errcode = 'insufficient_privilege';
  end if;
  update private.account_access_checks c
  set leased_until = now() + interval '5 minutes', attempts = least(c.attempts + 1, 10000)
  where c.user_id = (select w.user_id from private.account_access_checks w
                     where w.not_before <= now() and (w.leased_until is null or w.leased_until <= now())
                     order by w.requested_at, w.user_id
                     limit 1
                     for update skip locked)
  returning c.user_id, c.requested_at, c.attempts into v_check;
  if not found then
    return;
  end if;
  v_should := private.account_should_be_banned(v_check.user_id);
  v_ours := exists (select 1 from private.account_bans b where b.user_id = v_check.user_id);
  v_banned := exists (select 1 from private.auth_account_access a
                      where a.id = v_check.user_id and a.banned_until > now());
  return query select v_check.user_id,
    case when v_should and not (v_ours and v_banned) then 'ban'
         when not v_should and v_ours then 'unban'
         else 'none' end,
    v_check.requested_at, v_check.attempts::integer;
end
$$;

comment on function private.claim_account_access_check() is
  'SECURITY-RELEVANT (T-M2-09). Worker: leases the oldest due Auth ban check and says ban / unban / none. app_worker system claims only.';

-- Worker: what happened in Auth — banned, unbanned, unchanged (nothing to do), gone (no such account in
-- Auth any more) or refused (Auth refused the request for good; logged by the worker). The check is
-- removed when no newer change asked for it meanwhile; otherwise it is due again at once. True when
-- removed.
create or replace function private.finish_account_access_check(p_user_id uuid, p_requested_at timestamptz, p_outcome text)
returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_claims jsonb := private.request_claims();
begin
  if session_user <> 'app_worker' or coalesce(v_claims ->> 'role', '') <> 'system'
     or coalesce(btrim(v_claims ->> 'job_id'), '') = '' then
    raise exception 'reserved to the worker' using errcode = 'insufficient_privilege';
  end if;
  if p_user_id is null or p_requested_at is null
     or p_outcome is null or p_outcome not in ('banned', 'unbanned', 'unchanged', 'gone', 'refused') then
    raise exception 'unknown outcome of an account access check' using errcode = 'invalid_parameter_value';
  end if;
  if p_outcome = 'banned' then
    insert into private.account_bans as b (user_id) values (p_user_id)
    on conflict (user_id) do update set banned_at = now();
  elsif p_outcome in ('unbanned', 'gone') then
    delete from private.account_bans b where b.user_id = p_user_id;
  end if;
  delete from private.account_access_checks c where c.user_id = p_user_id and c.requested_at = p_requested_at;
  if found then
    return true;
  end if;
  update private.account_access_checks c set leased_until = null, not_before = now(), attempts = 0
  where c.user_id = p_user_id;
  return false;
end
$$;

comment on function private.finish_account_access_check(uuid, timestamptz, text) is
  'SECURITY-RELEVANT (T-M2-09). Worker: records what Auth did and removes the check (unless asked for again meanwhile). app_worker system claims only.';

-- Worker: Auth (or the database) could not answer. The lease ends; the next attempt waits 15 s, 30 s, 1 min,
-- … up to an hour. Never given up: the ban is defence in depth and must follow eventually. Returns the
-- attempts so far (0: the check is gone).
create or replace function private.retry_account_access_check(p_user_id uuid)
returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_claims jsonb := private.request_claims();
  v_attempts integer;
begin
  if session_user <> 'app_worker' or coalesce(v_claims ->> 'role', '') <> 'system'
     or coalesce(btrim(v_claims ->> 'job_id'), '') = '' then
    raise exception 'reserved to the worker' using errcode = 'insufficient_privilege';
  end if;
  update private.account_access_checks c
  set leased_until = null,
      not_before = now() + least(make_interval(secs => 15 * power(2, greatest(least(c.attempts - 1, 8), 0))),
                                 interval '1 hour')
  where c.user_id = p_user_id
  returning c.attempts into v_attempts;
  return coalesce(v_attempts, 0);
end
$$;

comment on function private.retry_account_access_check(uuid) is
  'SECURITY-RELEVANT (T-M2-09). Worker: puts an account access check back after a temporary failure (back-off up to an hour). app_worker system claims only.';

create trigger tenant_memberships_access_check after insert or update of status on platform.tenant_memberships
  for each row execute function private.membership_access_changed();
create trigger invitations_access_check after insert or update of status on platform.invitations
  for each row execute function private.invitation_access_changed();

-- Ownership hand-over as in migration 20260930120100 (non-superuser migration role on hosted Supabase).
grant create on schema private to membership_guard;
alter function private.account_should_be_banned(uuid) owner to membership_guard;
alter function private.queue_account_access_check(uuid) owner to membership_guard;
alter function private.membership_access_changed() owner to membership_guard;
alter function private.invitation_access_changed() owner to membership_guard;
alter function private.claim_account_access_check() owner to membership_guard;
alter function private.finish_account_access_check(uuid, timestamptz, text) owner to membership_guard;
alter function private.retry_account_access_check(uuid) owner to membership_guard;
revoke create on schema private from membership_guard;

revoke all on function private.account_should_be_banned(uuid) from public;
revoke all on function private.queue_account_access_check(uuid) from public;
revoke all on function private.membership_access_changed() from public;
revoke all on function private.invitation_access_changed() from public;
revoke all on function private.claim_account_access_check() from public;
revoke all on function private.finish_account_access_check(uuid, timestamptz, text) from public;
revoke all on function private.retry_account_access_check(uuid) from public;
-- Called inside `set local role authenticated` transactions (withPlatformTx); each function checks the
-- LOGIN role (session_user) and the claims itself.
grant execute on function private.claim_account_access_check() to authenticated;
grant execute on function private.finish_account_access_check(uuid, timestamptz, text) to authenticated;
grant execute on function private.retry_account_access_check(uuid) to authenticated;

-- Accounts that already sign in nowhere (memberships, none active in a served organization) are decided
-- once at deployment. The migration role reads every organization (it bypasses row-level security).
insert into private.account_access_checks (user_id)
select distinct m.user_id
from platform.tenant_memberships m
where not exists (select 1 from platform.tenant_memberships a
                  join platform.tenants t on t.id = a.tenant_id
                  where a.user_id = m.user_id and a.status = 'active' and t.status in ('active', 'trial'))
on conflict (user_id) do nothing;
