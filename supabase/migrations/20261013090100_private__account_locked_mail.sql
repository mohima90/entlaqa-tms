-- "Your account was locked" e-mail (PO decision 9 Oct 2026; T-M2-11, FR-IAM-13; docs/engineering/
-- sign-in-protection.md §4) through the account-mail pipeline of T-M2-17 (20261010120000): when sign-in to
-- an account locks after repeated failures, the web app queues a request with the address that was typed;
-- the worker decides whether an account exists and writes it — in its organization's language and brand —
-- what happened, when the lock lifts, the link to the "forgot password" page, and to tell the Organization
-- Admin if the attempts were not theirs. Unknown addresses get nothing (no enumeration: the web app's path
-- is the same either way). At most one per account and lock period (the worker: no `platform.account_locked`
-- e-mail to the person within the lock's minutes) and the per-person hourly cap of every account e-mail.
--
--   private.account_mail_requests  new kind `account_locked` (address as typed, lower-case; lock_minutes).
--   private.request_account_locked_mail(email, lock_minutes)  web app (app_server), no session: queues the
--                           request unconditionally (no account lookup), like the reset request.
--   private.claim_account_mail_request()  also answers `account_locked` (by address, like a reset — without
--                           the one-link-a-minute rule) and returns lock_minutes.

alter table private.account_mail_requests add column lock_minutes smallint;

alter table private.account_mail_requests drop constraint account_mail_requests_kind_check;
alter table private.account_mail_requests add constraint account_mail_requests_kind_check
  check (kind in ('password_reset', 'password_changed', 'account_locked'));
alter table private.account_mail_requests drop constraint account_mail_requests_shape_check;
alter table private.account_mail_requests add constraint account_mail_requests_shape_check check (
  (kind = 'password_reset' and email is not null and user_id is null and tenant_id is null and lock_minutes is null)
  or (kind = 'password_changed' and email is null and user_id is not null and lock_minutes is null)
  or (kind = 'account_locked' and email is not null and user_id is null and tenant_id is null
      and lock_minutes is not null and lock_minutes between 1 and 1440));

-- The web app (app_server, no session), when an account's sign-in lock starts (the attempt that used the
-- account's failure budget up was refused by Auth). Unconditional, answers nothing.
create or replace function private.request_account_locked_mail(p_email text, p_lock_minutes integer)
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
  delete from private.account_mail_requests r where r.created_at < now() - interval '60 minutes';
  if v_email is null or char_length(v_email) not between 3 and 320 or v_email !~ '^[^@\s]+@[^@\s]+$'
     or p_lock_minutes is null or p_lock_minutes not between 1 and 1440 then
    return;
  end if;
  if (select count(*) from (select 1 from private.account_mail_requests limit 10000) w) >= 10000
     or exists (select 1 from private.account_mail_requests r where r.email = v_email and r.kind = 'account_locked') then
    return;
  end if;
  insert into private.account_mail_requests (kind, email, lock_minutes) values ('account_locked', v_email, p_lock_minutes);
end
$$;

comment on function private.request_account_locked_mail(text, integer) is
  'SECURITY-RELEVANT (FR-IAM-13, T-M2-11). Queues the "account locked" e-mail request for a typed address, unconditionally (no account lookup). app_server only.';

-- The worker's lease (20261010120000), now with `account_locked` and the lock's minutes. Same outcomes;
-- `too_soon` (Auth's one-link-a-minute rule) concerns reset links only.
drop function private.claim_account_mail_request();

create function private.claim_account_mail_request()
returns table (id uuid, kind text, outcome text, email text, user_id uuid, tenant_id uuid, person_id uuid,
               locale text, attempts integer, lock_minutes integer)
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
  returning r.id, r.kind, r.email, r.user_id, r.tenant_id, r.attempts, r.lock_minutes into v_request;
  if not found then
    return;
  end if;

  if v_request.kind in ('password_reset', 'account_locked') then
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
                        null::uuid, null::text, v_request.attempts::integer, null::integer;
    return;
  end if;
  if v_account.banned_until is not null and v_account.banned_until > now() then
    return query select v_request.id, v_request.kind, 'banned'::text, null::text, v_account.id, null::uuid,
                        null::uuid, null::text, v_request.attempts::integer, null::integer;
    return;
  end if;
  if v_request.kind = 'password_reset' and v_request.attempts = 1
     and v_account.recovery_sent_at > now() - interval '60 seconds' then
    return query select v_request.id, v_request.kind, 'too_soon'::text, null::text, v_account.id, null::uuid,
                        null::uuid, null::text, v_request.attempts::integer, null::integer;
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
                        null::uuid, null::text, v_request.attempts::integer, null::integer;
    return;
  end if;
  return query select v_request.id, v_request.kind, 'send'::text, v_account.email::text, v_account.id, v_member.tenant_id,
                      v_member.person_id, case when v_member.preferred_locale = 'en' then 'en' else 'ar' end,
                      v_request.attempts::integer, v_request.lock_minutes::integer;
end
$$;

comment on function private.claim_account_mail_request() is
  'SECURITY-RELEVANT (T-M2-17, T-M2-11). Worker: leases the oldest waiting account e-mail request and resolves account, organization and language. app_worker system claims only.';

-- Ownership hand-over as in migration 20260930120100 (non-superuser migration role on hosted Supabase).
grant create on schema private to account_mail_guard;
alter function private.request_account_locked_mail(text, integer) owner to account_mail_guard;
alter function private.claim_account_mail_request() owner to account_mail_guard;
revoke create on schema private from account_mail_guard;

revoke all on function private.request_account_locked_mail(text, integer) from public;
revoke all on function private.claim_account_mail_request() from public;
grant execute on function private.request_account_locked_mail(text, integer) to authenticated;
grant execute on function private.claim_account_mail_request() to authenticated;
