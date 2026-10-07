-- Account e-mails through our notification service (FR-NTF-02 as clarified in BRD v2.5, FR-IAM-13,
-- FR-IAM-16; T-M2-17; docs/engineering/password-reset.md). The password-reset e-mail and the "password
-- changed" notice are sent by the worker in the organization's language and brand, not by Supabase
-- Auth's own mailer. Class: P (platform). PII: the e-mail address typed on the forgot page, until the
-- request is answered (minutes) — never in events, job payloads, logs or the delivery log's content
-- after sending.
--
--   private.account_mail_requests  platform-level queue of account e-mails (no tenant yet: a reset is
--                           requested by a visitor without session or organization). Written only by
--                           the two request functions (web app, app_server), read and removed only by
--                           the worker functions (app_worker, system claims). Nobody else has any
--                           privilege; RLS forced. A row lives until the worker has queued the e-mail
--                           (in the organization's delivery log, same transaction) or decided that none
--                           is sent; at most 60 minutes (the link's lifetime) either way.
--   account_mail_guard      NOLOGIN owner of the functions below (no BYPASSRLS; explicit grants and
--                           policies `to account_mail_guard`, pattern of tenant_guard / invitation_guard).
--   private.auth_account    security-barrier view of auth.users (id, email, banned_until, recovery_sent_at,
--                           is_sso_user, deleted_at) for account_mail_guard only.
--
--   private.request_password_reset_mail(email)      web app (app_server), no session: queues a reset
--                           request UNCONDITIONALLY — whether an account exists is decided by the worker,
--                           so nothing on the request path depends on it (no account enumeration).
--   private.request_password_changed_mail(user)     web app (app_server): after a reset (no claims) or a
--                           My profile change (the signed-in user's own claims: the session's organization).
--   private.claim_account_mail_request()            worker (app_worker, system claims): leases the oldest
--                           waiting request and says whom to write, in which organization and language.
--   private.finish_account_mail_request(id)         worker: removes an answered request (in the tenant
--                           transaction that queues the e-mail, or after deciding to send nothing).
--   private.retry_account_mail_request(id)          worker: a temporary failure — try again later, at most
--                           5 attempts.

-- ---------------------------------------------------------------------------------------------------
-- Role account_mail_guard (attribute policy as in 20260930120000)
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'account_mail_guard') then
    create role account_mail_guard nologin noinherit nobypassrls;
  end if;
end
$$;

do $$
declare
  r record;
begin
  select rolname, rolcanlogin, rolinherit, rolsuper, rolbypassrls, rolreplication, rolcreatedb, rolcreaterole
    into r from pg_roles where rolname = 'account_mail_guard';
  if r.rolsuper or r.rolbypassrls or r.rolreplication then
    raise exception 'role account_mail_guard must be NOSUPERUSER NOBYPASSRLS NOREPLICATION; fix it as a superuser first';
  end if;
  if r.rolinherit or r.rolcreatedb or r.rolcreaterole or r.rolcanlogin then
    alter role account_mail_guard nologin noinherit nocreatedb nocreaterole;
  end if;
  if exists (select 1 from pg_auth_members m join pg_roles g on g.oid = m.roleid join pg_roles u on u.oid = m.member
             where g.rolname = 'account_mail_guard' and (m.inherit_option or m.set_option)
               and not u.rolsuper and u.rolname <> current_user) then
    raise exception 'role account_mail_guard must have no members besides the migration role';
  end if;
end
$$;

-- The migration role must be able to hand function ownership to account_mail_guard.
grant account_mail_guard to current_user;
grant usage on schema platform, private to account_mail_guard;

-- ---------------------------------------------------------------------------------------------------
-- private.account_mail_requests
-- ---------------------------------------------------------------------------------------------------
create table private.account_mail_requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  -- password_reset: the address typed on the forgot page (lower-case). Nothing else about the visitor.
  email text,
  -- password_changed: the account whose password changed.
  user_id uuid references auth.users (id) on delete cascade,
  -- password_changed from My profile: the organization of the signed-in session (its brand and language).
  tenant_id uuid references platform.tenants (id),
  created_at timestamptz not null default now(),
  -- Worker bookkeeping: attempts so far, earliest next attempt, lease of the worker answering it.
  attempts smallint not null default 0,
  not_before timestamptz not null default now(),
  leased_until timestamptz,
  constraint account_mail_requests_kind_check check (kind in ('password_reset', 'password_changed')),
  constraint account_mail_requests_shape_check check (
    (kind = 'password_reset' and email is not null and user_id is null and tenant_id is null)
    or (kind = 'password_changed' and email is null and user_id is not null)),
  constraint account_mail_requests_email_check check (
    email is null or (char_length(email) between 3 and 320 and email = lower(email) and email ~ '^[^@\s]+@[^@\s]+$')),
  constraint account_mail_requests_attempts_check check (attempts between 0 and 100)
);
comment on table private.account_mail_requests is
  'SECURITY-RELEVANT (FR-NTF-02, FR-IAM-13; T-M2-17). Account e-mails waiting for the worker (no tenant yet). Only account_mail_guard''s functions reach it. Rows live minutes, at most 60.';

create index account_mail_requests_waiting_idx on private.account_mail_requests (created_at);
create index account_mail_requests_email_idx on private.account_mail_requests (email) where email is not null;
create index account_mail_requests_user_idx on private.account_mail_requests (user_id) where user_id is not null;

alter table private.account_mail_requests enable row level security;
alter table private.account_mail_requests force row level security;

create policy account_mail_requests_guard on private.account_mail_requests for all to account_mail_guard
  using (true) with check (true);

revoke all on private.account_mail_requests from public;
grant select, insert, update, delete on private.account_mail_requests to account_mail_guard;

-- A new request wakes the workers like a new event (channel jadarat_events, ADR 0004 §4): daemon workers
-- queue the account-mail sweep at once; the minutely schedule covers any gap.
create trigger account_mail_requests_notify after insert on private.account_mail_requests
  for each statement execute function private.notify_event_dispatcher();

-- ---------------------------------------------------------------------------------------------------
-- Auth accounts for account_mail_guard (pattern of private.auth_session_validity, ADR 0002 §6a rev. 2)
-- ---------------------------------------------------------------------------------------------------
create or replace view private.auth_account
with (security_barrier = true)  -- defensive only: the view has no WHERE clause
as select u.id, u.email, u.banned_until, u.recovery_sent_at, u.is_sso_user, u.deleted_at from auth.users u;

comment on view private.auth_account is
  'SECURITY-RELEVANT (T-M2-17): auth.users (id, email, banned_until, recovery_sent_at, is_sso_user, deleted_at) for account_mail_guard only. Owned by the migration role.';

revoke all on private.auth_account from public;
grant select on private.auth_account to account_mail_guard;

do $$
declare
  v_owner name := (select pg_get_userbyid(relowner) from pg_class where oid = 'private.auth_account'::regclass);
  v_column text;
begin
  foreach v_column in array array['id', 'email', 'banned_until', 'recovery_sent_at', 'is_sso_user', 'deleted_at'] loop
    if not (has_schema_privilege(v_owner, 'auth', 'usage') and has_column_privilege(v_owner, 'auth.users', v_column, 'select')) then
      raise exception 'role % (owner of private.auth_account) cannot read auth.users (%)', v_owner, v_column;
    end if;
  end loop;
  if not has_table_privilege('account_mail_guard', 'private.auth_account', 'select') then
    raise exception 'account_mail_guard cannot read private.auth_account';
  end if;
end
$$;

-- ---------------------------------------------------------------------------------------------------
-- What the worker functions read in the platform tables (explicit grants + policies `to account_mail_guard`)
-- ---------------------------------------------------------------------------------------------------
create policy tenants_account_mail_guard_read on platform.tenants for select to account_mail_guard using (true);
grant select (id, status) on platform.tenants to account_mail_guard;
create policy tenant_memberships_account_mail_guard_read on platform.tenant_memberships for select
  to account_mail_guard using (true);
grant select (tenant_id, user_id, person_id, status, created_at) on platform.tenant_memberships to account_mail_guard;
create policy persons_account_mail_guard_read on platform.persons for select to account_mail_guard using (true);
grant select (tenant_id, id, status, preferred_locale) on platform.persons to account_mail_guard;
create policy session_context_account_mail_guard_read on platform.session_context for select
  to account_mail_guard using (true);
grant select (user_id, active_tenant_id, updated_at) on platform.session_context to account_mail_guard;

grant execute on function private.try_uuid(text) to account_mail_guard;
grant execute on function private.request_claims() to account_mail_guard;
grant execute on function private.request_user_id() to account_mail_guard;
grant execute on function private.current_tenant_id() to account_mail_guard;

-- ---------------------------------------------------------------------------------------------------
-- Functions (owner account_mail_guard). Errors: 42501 wrong caller.
-- ---------------------------------------------------------------------------------------------------

-- At most this many requests wait at any time (a flood while no worker runs cannot grow the table
-- without bound); further requests are dropped silently, like a limited one on the request path.
-- One waiting request per address or account: a repeat before the worker answered adds nothing.

-- Screen 10: the web app (app_server, no session) queues a reset request for the address typed on the
-- forgot page, unconditionally — this function never looks at accounts, and answers nothing.
create or replace function private.request_password_reset_mail(p_email text)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
begin
  if session_user <> 'app_server' then
    raise exception 'reserved to the web app' using errcode = 'insufficient_privilege';
  end if;
  if v_email is null or char_length(v_email) not between 3 and 320 or v_email !~ '^[^@\s]+@[^@\s]+$' then
    return;
  end if;
  if (select count(*) from (select 1 from private.account_mail_requests limit 10000) w) >= 10000
     or exists (select 1 from private.account_mail_requests r where r.email = v_email and r.kind = 'password_reset') then
    return;
  end if;
  insert into private.account_mail_requests (kind, email) values ('password_reset', v_email);
end
$$;

comment on function private.request_password_reset_mail(text) is
  'SECURITY-RELEVANT (FR-IAM-13, T-M2-17). Queues a password-reset e-mail request for an address, unconditionally (no account lookup). app_server only.';

-- After a password change, the web app (app_server) queues the "password changed" notice:
--   * after a reset (screen 11): without claims — the worker picks the organization;
--   * after a My profile change (FR-IAM-16): with the signed-in user's own claims — p_user_id must be
--     that user, and the session's organization is recorded for the notice.
create or replace function private.request_password_changed_mail(p_user_id uuid)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  if session_user <> 'app_server' or p_user_id is null then
    raise exception 'reserved to the web app' using errcode = 'insufficient_privilege';
  end if;
  if private.request_claims() is not null then
    v_tenant := private.current_tenant_id();
    if v_tenant is null or private.request_user_id() is distinct from p_user_id then
      raise exception 'only for the signed-in user' using errcode = 'insufficient_privilege';
    end if;
  end if;
  if not exists (select 1 from private.auth_account a where a.id = p_user_id)
     or (select count(*) from (select 1 from private.account_mail_requests limit 10000) w) >= 10000
     or exists (select 1 from private.account_mail_requests r
                where r.user_id = p_user_id and r.kind = 'password_changed') then
    return;
  end if;
  insert into private.account_mail_requests (kind, user_id, tenant_id) values ('password_changed', p_user_id, v_tenant);
end
$$;

comment on function private.request_password_changed_mail(uuid) is
  'SECURITY-RELEVANT (FR-IAM-13/16, T-M2-17). Queues the "password changed" notice of an account (the signed-in user''s own, or after a reset). app_server only.';

-- Worker (app_worker, system claims with or without a tenant): leases the oldest waiting request (5
-- minutes, one more attempt) and answers who gets which e-mail:
--   outcome  send             tenant, person, language and address to write to
--            unknown_account  no Auth account with that address (or the account is gone)
--            banned           the account is banned in Auth
--            too_soon         a reset link was issued for the account less than 60 seconds ago (first
--                             attempt only; Auth's own one-e-mail-a-minute rule)
--            no_membership    no active membership in an active or trial organization (signs in nowhere)
-- Organization (R1 rule, docs/engineering/password-reset.md §3): for a My profile change, the session's
-- organization while the membership there is still active; otherwise the one most recently selected in a
-- sign-in session (platform.session_context), else the oldest active membership. Language: the person's
-- preferred language in that organization. Requests older than 60 minutes (the link's lifetime) are
-- removed unanswered; a request whose attempts are used up is removed too.
create or replace function private.claim_account_mail_request()
returns table (id uuid, kind text, outcome text, email text, user_id uuid, tenant_id uuid, person_id uuid,
               locale text, attempts integer)
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_claims jsonb := private.request_claims();
  v_request record;
  v_account record;
  v_member record;
begin
  if session_user <> 'app_worker' or coalesce(v_claims ->> 'role', '') <> 'system'
     or coalesce(btrim(v_claims ->> 'job_id'), '') = '' then
    raise exception 'reserved to the worker' using errcode = 'insufficient_privilege';
  end if;
  delete from private.account_mail_requests r
  where r.created_at < now() - interval '60 minutes' or (r.attempts >= 5 and coalesce(r.leased_until, now()) <= now());

  update private.account_mail_requests r
  set leased_until = now() + interval '5 minutes', attempts = r.attempts + 1
  where r.id = (select w.id from private.account_mail_requests w
                where w.not_before <= now() and (w.leased_until is null or w.leased_until <= now())
                order by w.created_at, w.id
                limit 1
                for update skip locked)
  returning r.id, r.kind, r.email, r.user_id, r.tenant_id, r.attempts into v_request;
  if not found then
    return;
  end if;

  if v_request.kind = 'password_reset' then
    select a.id, a.email, a.banned_until, a.recovery_sent_at into v_account
    from private.auth_account a
    where a.email = v_request.email and not coalesce(a.is_sso_user, false) and a.deleted_at is null
    order by a.id
    limit 1;
  else
    select a.id, a.email, a.banned_until, a.recovery_sent_at into v_account
    from private.auth_account a
    where a.id = v_request.user_id and a.deleted_at is null;
  end if;
  if v_account.id is null or v_account.email is null then
    return query select v_request.id, v_request.kind, 'unknown_account'::text, null::text, null::uuid, null::uuid,
                        null::uuid, null::text, v_request.attempts::integer;
    return;
  end if;
  if v_account.banned_until is not null and v_account.banned_until > now() then
    return query select v_request.id, v_request.kind, 'banned'::text, null::text, v_account.id, null::uuid,
                        null::uuid, null::text, v_request.attempts::integer;
    return;
  end if;
  if v_request.kind = 'password_reset' and v_request.attempts = 1
     and v_account.recovery_sent_at > now() - interval '60 seconds' then
    return query select v_request.id, v_request.kind, 'too_soon'::text, null::text, v_account.id, null::uuid,
                        null::uuid, null::text, v_request.attempts::integer;
    return;
  end if;

  select m.tenant_id, m.person_id, p.preferred_locale into v_member
  from platform.tenant_memberships m
  join platform.tenants t on t.id = m.tenant_id
  join platform.persons p on p.tenant_id = m.tenant_id and p.id = m.person_id
  where m.user_id = v_account.id and m.status = 'active' and t.status in ('active', 'trial') and p.status = 'active'
  order by (m.tenant_id = v_request.tenant_id) desc nulls last,
           (select max(c.updated_at) from platform.session_context c
            where c.user_id = m.user_id and c.active_tenant_id = m.tenant_id) desc nulls last,
           m.created_at, m.tenant_id
  limit 1;
  if v_member.tenant_id is null then
    return query select v_request.id, v_request.kind, 'no_membership'::text, null::text, v_account.id, null::uuid,
                        null::uuid, null::text, v_request.attempts::integer;
    return;
  end if;
  return query select v_request.id, v_request.kind, 'send'::text, v_account.email::text, v_account.id, v_member.tenant_id,
                      v_member.person_id, case when v_member.preferred_locale = 'en' then 'en' else 'ar' end,
                      v_request.attempts::integer;
end
$$;

comment on function private.claim_account_mail_request() is
  'SECURITY-RELEVANT (T-M2-17). Worker: leases the oldest waiting account e-mail request and resolves account, organization and language. app_worker system claims only.';

-- Worker: the request is answered (e-mail queued in the same transaction, or nothing to send).
create or replace function private.finish_account_mail_request(p_id uuid)
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
  delete from private.account_mail_requests r where r.id = p_id;
  return found;
end
$$;

comment on function private.finish_account_mail_request(uuid) is
  'SECURITY-RELEVANT (T-M2-17). Worker: removes an answered account e-mail request. app_worker system claims only.';

-- Worker: a temporary failure (Auth or the database). The lease ends; the next attempt waits 15 s, 30 s,
-- 60 s, 120 s. After the 5th attempt the request is removed (false: given up).
create or replace function private.retry_account_mail_request(p_id uuid)
returns boolean
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
  select r.attempts into v_attempts from private.account_mail_requests r where r.id = p_id for update;
  if not found then
    return false;
  end if;
  if v_attempts >= 5 then
    delete from private.account_mail_requests r where r.id = p_id;
    return false;
  end if;
  update private.account_mail_requests r
  set leased_until = null, not_before = now() + make_interval(secs => 15 * power(2, greatest(v_attempts - 1, 0)))
  where r.id = p_id;
  return true;
end
$$;

comment on function private.retry_account_mail_request(uuid) is
  'SECURITY-RELEVANT (T-M2-17). Worker: puts an account e-mail request back after a temporary failure (back-off), or removes it after 5 attempts. app_worker system claims only.';

-- Ownership hand-over as in migration 20260930120100 (non-superuser migration role on hosted Supabase).
grant create on schema private to account_mail_guard;
alter function private.request_password_reset_mail(text) owner to account_mail_guard;
alter function private.request_password_changed_mail(uuid) owner to account_mail_guard;
alter function private.claim_account_mail_request() owner to account_mail_guard;
alter function private.finish_account_mail_request(uuid) owner to account_mail_guard;
alter function private.retry_account_mail_request(uuid) owner to account_mail_guard;
revoke create on schema private from account_mail_guard;

revoke all on function private.request_password_reset_mail(text) from public;
revoke all on function private.request_password_changed_mail(uuid) from public;
revoke all on function private.claim_account_mail_request() from public;
revoke all on function private.finish_account_mail_request(uuid) from public;
revoke all on function private.retry_account_mail_request(uuid) from public;
-- Called inside `set local role authenticated` transactions (withUserTx / withSystemTx and their
-- claim-less variants); each function checks the LOGIN role (session_user) itself.
grant execute on function private.request_password_reset_mail(text) to authenticated;
grant execute on function private.request_password_changed_mail(uuid) to authenticated;
grant execute on function private.claim_account_mail_request() to authenticated;
grant execute on function private.finish_account_mail_request(uuid) to authenticated;
grant execute on function private.retry_account_mail_request(uuid) to authenticated;
