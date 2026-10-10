-- Authenticator apps: confirmation by the session that set them up, e-mailed notices, removal and resets
-- (FR-IAM-12; T-M2-10; TM-0003 T-IAM-10, T-IAM-11; security review H1 / M2, re-review N1 / N2). PII: none
-- stored (account ids; the set-up session's browser string; code and token hashes).
--
-- SECURITY-RELEVANT.
--   * Set-up (re-review N1, T-IAM-11 as specified): the Auth session that passed a new app's first code
--     records it (private.request_mfa_factor_mail) and is the ONLY one that can confirm it: the account gets
--     an e-mail — our notification service (account e-mails, 20261010120000, worker) — with a one-time
--     8-digit CODE to type into that window (private.confirm_mfa_setup: that session, aal2 through that app;
--     72 hours; 5 tries) and a "not you? remove this app" link (7 days). Possession of the app AND the mailbox:
--     a password-only attacker cannot confirm (no mailbox) and the mailbox owner cannot confirm someone else's
--     app (another session). Only SHA-256 hashes are stored (private.mfa_factor_confirmations,
--     20261012090100); the worker creates code and token when it writes the e-mail, so a delayed worker
--     delays the e-mail, never the set-up; "send again" works from that session. The app counts for AAL2
--     only once confirmed (private.session_access, private.request_aal2).
--   * Every other session of the account sees "an app was added from another sign-in" (private.my_mfa_apps)
--     and can remove it (private.remove_mfa_app): every OTHER session then ends.
--   * "Not you?" link: removes that app in Auth and ends EVERY session of the account (the e-mail tells to
--     set a new password).
--   * An app still unconfirmed after 72 hours is removed by the worker (private.purge_unconfirmed_mfa_apps,
--     re-review N2) and the owner e-mailed: a waiting app never blocks the owner's password change, reset or
--     set-up (Auth asks for a code from every verified app).
--   * 15 wrong e-mailed codes on one account within 24 hours (any app, any e-mail) remove its waiting apps,
--     end the sessions that passed their code and tell the owner once (final re-review L2).
--   * Security notices are never dropped: up to private.security_notice_daily_ceiling() per account in 24
--     hours are sent one by one, further ones are merged into one digest e-mail an hour (final re-review L1;
--     private.claim_account_mail_request, private.security_notice_digests).
--   * Every removal and reset is e-mailed and audited (in every organization of the account).
--   * A change of the security policy is e-mailed to every Organization Admin of the organization (TM-0003
--     T-IAM-24; security review L5): queued by the database itself (trigger), so no path can skip it.
--   * Lost authenticator (PO answer, 9 Oct 2026; TM-0003 T-IAM-10): an Organization Admin resets it for a
--     member they may manage, at AAL2 with a fresh code (defineAction, platform.user.reset_mfa), only when the
--     login is an active member of NO other organization; otherwise — and for the last Organization Admin —
--     ENTLAQA support after an identity check (docs/engineering/mfa-reset.md: private.reset_account_mfa).
-- Factors are deleted through private.auth_mfa_factor and sessions through private.auth_session_validity
-- (views owned by the migration role; DELETE for tenant_guard only — 20261012090100).
--
--   private.request_mfa_factor_mail(factor)    web app (user claims, the session that set the app up): the
--       set-up e-mail, and "send the e-mail again"
--   private.confirm_mfa_setup(factor, code)    web app (that session): the e-mailed code
--   private.my_mfa_apps()                      web app: the account's apps — confirmed or waiting, here or
--       added from another sign-in (when, which browser)
--   private.remove_mfa_app(factor)             web app: remove a confirmed app (recent code), cancel this
--       session's set-up, or remove an app added from another sign-in (other sessions end)
--   private.issue_mfa_factor_tokens(…)         worker: stores the hashes of the code and link it e-mails
--   private.account_has_app(user)              worker: the reset e-mail says a code will be asked
--   private.purge_unconfirmed_mfa_apps(limit)  worker: apps unconfirmed after 72 hours (re-review N2)
--   private.reject_mfa_factor(token hash)      web app (no session): the "not you" link
--   private.reset_member_mfa(person)           web app: an Organization Admin's reset (checked here too)
--   private.reset_account_mfa(user, reference) operators only (support runbook)
--   private.security_policy_changed_mail()     trigger: queues the policy-change notice for every Organization
--       Admin (login e-mail, in the organization's language and brand; the worker writes it)

grant tenant_guard to current_user;
grant account_mail_guard to current_user;

-- ---------------------------------------------------------------------------------------------------
-- Account e-mails for authenticator apps
-- ---------------------------------------------------------------------------------------------------
alter table private.account_mail_requests add column factor_id uuid;
-- Why an app was removed: by the account (My profile, or its own set-up cancelled), as "not you" (the e-mail's
-- link, or "added from another sign-in"), by an Organization Admin, by ENTLAQA support, never confirmed (the
-- worker, re-review N2), or too many wrong e-mailed codes on the account (final re-review L2).
alter table private.account_mail_requests add column mfa_reason text;
-- security_policy_changed: which settings changed (names, never values) and who changed them (person id).
alter table private.account_mail_requests add column detail jsonb;
alter table private.account_mail_requests drop constraint account_mail_requests_kind_check;
alter table private.account_mail_requests add constraint account_mail_requests_kind_check
  check (kind in ('password_reset', 'password_changed', 'mfa_factor_added', 'mfa_factor_removed',
                  'security_policy_changed', 'security_digest'));
alter table private.account_mail_requests drop constraint account_mail_requests_shape_check;
alter table private.account_mail_requests add constraint account_mail_requests_shape_check check (
  (kind = 'password_reset' and email is not null and user_id is null and tenant_id is null
   and factor_id is null and mfa_reason is null and detail is null)
  or (kind = 'password_changed' and email is null and user_id is not null and factor_id is null and mfa_reason is null
      and detail is null)
  or (kind = 'mfa_factor_added' and email is null and user_id is not null and factor_id is not null
      and mfa_reason is null and detail is null)
  or (kind = 'mfa_factor_removed' and email is null and user_id is not null and mfa_reason is not null and detail is null)
  or (kind = 'security_policy_changed' and email is null and user_id is not null and tenant_id is not null
      and factor_id is null and mfa_reason is null and jsonb_typeof(detail) = 'object')
  or (kind = 'security_digest' and email is null and user_id is not null and factor_id is null
      and mfa_reason is null and jsonb_typeof(detail) = 'object'));
alter table private.account_mail_requests add constraint account_mail_requests_mfa_reason_check
  check (mfa_reason is null or mfa_reason in ('removed', 'not_me', 'admin_reset', 'support_reset', 'expired',
                                              'too_many_codes'));

-- tenant_guard queues the authenticator notices and the policy-change notices (and only those).
create policy account_mail_requests_tenant_guard on private.account_mail_requests for all to tenant_guard
  using (kind in ('mfa_factor_added', 'mfa_factor_removed', 'security_policy_changed'))
  with check (kind in ('mfa_factor_added', 'mfa_factor_removed', 'security_policy_changed'));
grant select, insert, delete on private.account_mail_requests to tenant_guard;

-- ---------------------------------------------------------------------------------------------------
-- Security notices never dropped, never a flood (final re-review L1)
-- ---------------------------------------------------------------------------------------------------
-- Per account and 24 hours: this many security notices are sent one by one (every organization of the
-- account counted: our delivery log); further ones are merged into one digest e-mail an hour.
create or replace function private.security_notice_daily_ceiling()
returns integer
language sql immutable
set search_path = ''
as $$ select 20 $$;

create or replace function private.security_digest_after()
returns interval
language sql immutable
set search_path = ''
as $$ select interval '1 hour' $$;

comment on function private.security_notice_daily_ceiling() is
  'T-M2-10 (final re-review L1): security notices per account and 24 hours sent one by one; further ones are merged into a digest.';
comment on function private.security_digest_after() is
  'T-M2-10 (final re-review L1): a digest of held security notices is sent this long after the first one was held.';

revoke all on function private.security_notice_daily_ceiling() from public;
revoke all on function private.security_digest_after() from public;
grant execute on function private.security_notice_daily_ceiling() to account_mail_guard;
grant execute on function private.security_digest_after() to account_mail_guard;

-- The security notices held for an account's next digest: how many of each kind, since when, in which
-- organization the first was (its language and brand). Ids and counts only. account_mail_guard only (the
-- worker's claim function).
create table private.security_notice_digests (
  user_id uuid primary key references auth.users (id) on delete cascade,
  tenant_id uuid,
  held jsonb not null,
  first_held_at timestamptz not null default now(),
  constraint security_notice_digests_held_check check (jsonb_typeof(held) = 'object')
);
comment on table private.security_notice_digests is
  'SECURITY-RELEVANT (T-M2-10, final re-review L1). Security notices over an account''s daily ceiling, merged for its next digest e-mail (kind counts only). account_mail_guard only.';
alter table private.security_notice_digests enable row level security;
alter table private.security_notice_digests force row level security;
create policy security_notice_digests_guard on private.security_notice_digests for all to account_mail_guard
  using (true) with check (true);
revoke all on private.security_notice_digests from public;
grant select, insert, update, delete on private.security_notice_digests to account_mail_guard;

-- How long a request may wait for the worker: a reset link lives 60 minutes (the request is useless after
-- it); an authenticator notice is useful for a day (a worker on a schedule may answer late).
create or replace function private.account_mail_request_expired(p_kind text, p_created_at timestamptz)
returns boolean
language sql stable
set search_path = ''
as $$
  select p_created_at < now() - case when p_kind in ('password_reset', 'password_changed')
                                     then interval '60 minutes' else interval '24 hours' end;
$$;

comment on function private.account_mail_request_expired(text, timestamptz) is
  'T-M2-17 / T-M2-10: an account e-mail request older than its kind''s lifetime (reset and notice: 60 minutes; authenticator notices: 24 hours).';

revoke all on function private.account_mail_request_expired(text, timestamptz) from public;
grant execute on function private.account_mail_request_expired(text, timestamptz) to account_mail_guard, tenant_guard;

-- ---------------------------------------------------------------------------------------------------
-- The T-M2-17 functions with kind-aware expiry (otherwise as in 20261010120000)
-- ---------------------------------------------------------------------------------------------------
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
  delete from private.account_mail_requests r where private.account_mail_request_expired(r.kind, r.created_at);
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
  delete from private.account_mail_requests r where private.account_mail_request_expired(r.kind, r.created_at);
  if private.request_claims() is not null then
    v_tenant := private.current_tenant_id();
    if v_tenant is null or private.request_user_id() is distinct from p_user_id then
      raise exception 'only for the signed-in user' using errcode = 'insufficient_privilege';
    end if;
  elsif not exists (select 1 from platform.tenant_memberships m
                    join platform.message_deliveries d
                      on d.tenant_id = m.tenant_id and d.recipient_person_id = m.person_id
                    where m.user_id = p_user_id and d.template = 'platform.password_reset'
                      and d.created_at > now() - interval '65 minutes')
        or exists (select 1 from private.auth_account a where a.id = p_user_id and a.recovery_pending) then
    return;  -- no reset e-mail of ours within 65 minutes, or its link was not used: not after a reset
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

-- The return type grows (the authenticator notices' factor and reason): dropped and created again.
drop function private.claim_account_mail_request();
create function private.claim_account_mail_request()
returns table (id uuid, kind text, outcome text, email text, user_id uuid, tenant_id uuid, person_id uuid,
               locale text, attempts integer, factor_id uuid, mfa_reason text, detail jsonb)
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
  where private.account_mail_request_expired(r.kind, r.created_at)
     or (r.attempts >= 5 and coalesce(r.leased_until, now()) <= now());
  -- Digests due (final re-review L1): the notices held since an hour or more go out as one e-mail.
  with due as (
    delete from private.security_notice_digests g
    where g.first_held_at <= now() - private.security_digest_after()
    returning g.user_id, g.tenant_id, g.held, g.first_held_at)
  insert into private.account_mail_requests (kind, user_id, tenant_id, detail)
  select 'security_digest', due.user_id, due.tenant_id,
         jsonb_build_object('held', due.held, 'since', due.first_held_at)
  from due;

  update private.account_mail_requests r
  set leased_until = now() + interval '5 minutes', attempts = r.attempts + 1
  where r.id = (select w.id from private.account_mail_requests w
                where w.not_before <= now() and (w.leased_until is null or w.leased_until <= now())
                order by w.created_at, w.id
                limit 1
                for update skip locked)
  returning r.id, r.kind, r.email, r.user_id, r.tenant_id, r.attempts, r.factor_id, r.mfa_reason, r.detail
    into v_request;
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
                        null::uuid, null::text, v_request.attempts::integer, v_request.factor_id, v_request.mfa_reason,
                        v_request.detail;
    return;
  end if;
  if v_account.banned_until is not null and v_account.banned_until > now() then
    return query select v_request.id, v_request.kind, 'banned'::text, null::text, v_account.id, null::uuid,
                        null::uuid, null::text, v_request.attempts::integer, v_request.factor_id, v_request.mfa_reason,
                        v_request.detail;
    return;
  end if;
  if v_request.kind = 'password_reset' and v_request.attempts = 1
     and v_account.recovery_sent_at > now() - interval '60 seconds' then
    return query select v_request.id, v_request.kind, 'too_soon'::text, null::text, v_account.id, null::uuid,
                        null::uuid, null::text, v_request.attempts::integer, v_request.factor_id, v_request.mfa_reason,
                        v_request.detail;
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
  if v_member.tenant_id is null
     or (v_request.kind = 'security_policy_changed' and v_member.tenant_id is distinct from v_request.tenant_id) then
    return query select v_request.id, v_request.kind, 'no_membership'::text, null::text, v_account.id, null::uuid,
                        null::uuid, null::text, v_request.attempts::integer, v_request.factor_id, v_request.mfa_reason,
                        v_request.detail;
    return;
  end if;
  -- A security notice over the account's daily ceiling (every organization: our delivery log) is merged
  -- into the account's next digest instead of being sent on its own — never dropped (final re-review L1).
  if v_request.kind in ('mfa_factor_added', 'mfa_factor_removed', 'security_policy_changed', 'password_changed')
     and (select count(*) from (
            select 1 from platform.message_deliveries d
            join platform.tenant_memberships m on m.tenant_id = d.tenant_id and m.person_id = d.recipient_person_id
            where m.user_id = v_account.id and d.created_at > now() - interval '24 hours'
              and d.template in ('platform.mfa_factor_added', 'platform.mfa_factor_removed',
                                 'platform.security_policy_changed', 'platform.password_changed',
                                 'platform.security_digest')
            limit private.security_notice_daily_ceiling()) n) >= private.security_notice_daily_ceiling() then
    insert into private.security_notice_digests as g (user_id, tenant_id, held)
    values (v_account.id, v_member.tenant_id, jsonb_build_object(v_request.kind, 1))
    on conflict on constraint security_notice_digests_pkey do update
      set held = g.held || jsonb_build_object(v_request.kind, coalesce((g.held ->> v_request.kind)::integer, 0) + 1);
    delete from private.account_mail_requests r where r.id = v_request.id;
    return query select v_request.id, v_request.kind, 'held'::text, null::text, v_account.id, null::uuid,
                        null::uuid, null::text, v_request.attempts::integer, v_request.factor_id, v_request.mfa_reason,
                        v_request.detail;
    return;
  end if;
  return query select v_request.id, v_request.kind, 'send'::text, v_account.email::text, v_account.id, v_member.tenant_id,
                      v_member.person_id, case when v_member.preferred_locale = 'en' then 'en' else 'ar' end,
                      v_request.attempts::integer, v_request.factor_id, v_request.mfa_reason, v_request.detail;
end
$$;

comment on function private.claim_account_mail_request() is
  'SECURITY-RELEVANT (T-M2-17, T-M2-10). Worker: leases the oldest waiting account e-mail request and resolves account, organization and language (and, for authenticator notices, the app and why; for policy-change notices, what changed and who changed it). Security notices over the account''s daily ceiling are held for its hourly digest (outcome held); due digests are queued. app_worker system claims only.';

grant create on schema private to account_mail_guard;
alter function private.claim_account_mail_request() owner to account_mail_guard;
revoke create on schema private from account_mail_guard;
revoke all on function private.claim_account_mail_request() from public;
grant execute on function private.claim_account_mail_request() to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- tenant_guard: authenticator notices, confirmation, removal, resets
-- ---------------------------------------------------------------------------------------------------
-- The set-up e-mail's code and link (one place each). The code lives at least as long as the session that set
-- the app up can (a sign-in session ends after at most 24 hours): a worker that sends late still leaves time.
create or replace function private.mfa_code_lifetime()
returns interval
language sql immutable
set search_path = ''
as $$ select interval '72 hours' $$;

create or replace function private.mfa_code_max_attempts()
returns smallint
language sql immutable
set search_path = ''
as $$ select 5::smallint $$;

create or replace function private.mfa_code_resend_after()
returns interval
language sql immutable
set search_path = ''
as $$ select interval '2 minutes' $$;

create or replace function private.mfa_remove_link_lifetime()
returns interval
language sql immutable
set search_path = ''
as $$ select interval '7 days' $$;

-- Final re-review L2: wrong e-mailed codes per ACCOUNT (any app, any e-mail) within the window before its waiting
-- apps are removed.
create or replace function private.mfa_code_account_max_failures()
returns integer
language sql immutable
set search_path = ''
as $$ select 15 $$;

create or replace function private.mfa_code_failure_window()
returns interval
language sql immutable
set search_path = ''
as $$ select interval '24 hours' $$;

comment on function private.mfa_code_account_max_failures() is
  'T-M2-10 (final re-review L2): wrong e-mailed set-up codes per account within private.mfa_code_failure_window() before its waiting apps are removed.';
comment on function private.mfa_code_failure_window() is
  'T-M2-10 (final re-review L2): the window of the per-account count of wrong e-mailed set-up codes.';
revoke all on function private.mfa_code_account_max_failures() from public;
revoke all on function private.mfa_code_failure_window() from public;
grant execute on function private.mfa_code_account_max_failures() to tenant_guard;
grant execute on function private.mfa_code_failure_window() to tenant_guard;

-- Each wrong e-mailed code (account and time only; final re-review L2). tenant_guard only.
create table private.mfa_setup_code_failures (
  user_id uuid not null references auth.users (id) on delete cascade,
  failed_at timestamptz not null default now()
);
create index mfa_setup_code_failures_user_idx on private.mfa_setup_code_failures (user_id, failed_at);
comment on table private.mfa_setup_code_failures is
  'SECURITY-RELEVANT (T-M2-10, final re-review L2). Wrong e-mailed set-up codes per account (time only), kept for private.mfa_code_failure_window(). tenant_guard only.';
alter table private.mfa_setup_code_failures enable row level security;
alter table private.mfa_setup_code_failures force row level security;
create policy mfa_setup_code_failures_guard on private.mfa_setup_code_failures for all to tenant_guard
  using (true) with check (true);
revoke all on private.mfa_setup_code_failures from public;
grant select, insert, delete on private.mfa_setup_code_failures to tenant_guard;

comment on function private.mfa_code_lifetime() is
  'T-M2-10 (re-review N1): how long the e-mailed code of a new authenticator app works — and how long an app may stay unconfirmed before the worker removes it (N2).';
comment on function private.mfa_code_max_attempts() is
  'T-M2-10 (re-review N1): wrong tries before the e-mailed code dies (a new e-mail brings a new one).';
comment on function private.mfa_code_resend_after() is
  'T-M2-10 (re-review N1/N3): the least time between two set-up e-mails of one app ("send again").';
comment on function private.mfa_remove_link_lifetime() is
  'T-M2-10 (review H1): how long the e-mailed "not you? remove this app" link works.';

revoke all on function private.mfa_code_lifetime() from public;
revoke all on function private.mfa_code_max_attempts() from public;
revoke all on function private.mfa_code_resend_after() from public;
revoke all on function private.mfa_remove_link_lifetime() from public;
grant execute on function private.mfa_code_lifetime() to tenant_guard;
grant execute on function private.mfa_code_max_attempts() to tenant_guard;
grant execute on function private.mfa_code_resend_after() to tenant_guard;
grant execute on function private.mfa_remove_link_lifetime() to tenant_guard;

-- Internal: queues an authenticator notice (at most 10,000 waiting; one waiting per account, kind and app).
create or replace function private.queue_mfa_mail(
  p_kind text, p_user_id uuid, p_factor_id uuid, p_reason text, p_tenant_id uuid)
returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  delete from private.account_mail_requests r
  where r.kind in ('mfa_factor_added', 'mfa_factor_removed') and private.account_mail_request_expired(r.kind, r.created_at);
  if (select count(*) from (select 1 from private.account_mail_requests limit 10000) w) >= 10000
     or exists (select 1 from private.account_mail_requests r
                where r.user_id = p_user_id and r.kind = p_kind and r.factor_id is not distinct from p_factor_id
                  and (r.leased_until is null or r.leased_until <= now())) then
    return false;
  end if;
  insert into private.account_mail_requests (kind, user_id, tenant_id, factor_id, mfa_reason)
  values (p_kind, p_user_id, p_tenant_id, p_factor_id, p_reason);
  return true;
end
$$;

comment on function private.queue_mfa_mail(text, uuid, uuid, text, uuid) is
  'T-M2-10. Internal: queues an authenticator notice for the worker (set-up with its links, removal). tenant_guard only.';

-- Internal: deletes the account's authenticator apps in Auth (all, or the given ones). Returns how many.
create or replace function private.remove_account_factors(p_user_id uuid, p_factor_ids uuid[])
returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from private.auth_mfa_factor f
  where f.user_id = p_user_id and (p_factor_ids is null or f.id = any (p_factor_ids));
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

comment on function private.remove_account_factors(uuid, uuid[]) is
  'SECURITY-RELEVANT (T-M2-10, TM-0003 T-IAM-10). Internal: deletes authenticator apps of an account in Auth (through private.auth_mfa_factor). tenant_guard only.';

-- Internal: every session of the account ends (marker and Auth session).
create or replace function private.end_all_account_sessions(p_user_id uuid, p_tenant_id uuid, p_revoked_by uuid)
returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  return private.end_sessions(
    p_user_id, array(select s.id from private.auth_session_validity s where s.user_id = p_user_id),
    p_tenant_id, 'security', p_revoked_by);
end
$$;

comment on function private.end_all_account_sessions(uuid, uuid, uuid) is
  'SECURITY-RELEVANT (T-M2-10). Internal: ends every session of an account (after its authenticator app was removed or reset). tenant_guard only.';

-- The caller's live user session, or NULL.
create or replace function private.request_live_user()
returns uuid
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
  return v_user;
end
$$;

comment on function private.request_live_user() is
  'T-M2-10. Internal: the account of the current user session when it is live (app_server, user claims), else NULL. tenant_guard only.';

-- After set-up, or "send the e-mail again": the set-up e-mail (code and "not you" link) of THIS session's app,
-- and the audit row. Only the Auth session that passed the app's first code (Auth records the factor on that
-- session; re-review N1) records it, and only it asks again — never another session of the account. Also
-- before an organization is chosen.
--   queued | waiting (an e-mail is already on its way) | too_soon (the last one is under
--   private.mfa_code_resend_after() old) | refused
create or replace function private.request_mfa_factor_mail(p_factor_id uuid)
returns text
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_claims jsonb := private.request_claims();
  v_user uuid := private.request_live_user();
  v_session uuid := private.try_uuid(v_claims ->> 'session_id');
  v_row record;
  v_agent text;
begin
  if v_user is null or v_session is null or p_factor_id is null
     or not exists (select 1 from private.auth_mfa_factor f
                    where f.id = p_factor_id and f.user_id = v_user and f.factor_type = 'totp' and f.status = 'verified') then
    return 'refused';
  end if;
  select k.session_id, k.confirmed_at, k.code_issued_at into v_row
  from private.mfa_factor_confirmations k
  where k.factor_id = p_factor_id and k.user_id = v_user
  for update;
  if found then
    if v_row.confirmed_at is not null or v_row.session_id <> v_session then
      return 'refused';
    end if;
    if v_row.code_issued_at > now() - private.mfa_code_resend_after() then
      return 'too_soon';
    end if;
  else
    -- First request: this session passed the app's first code (aal2 through this factor, claim and Auth).
    select s.user_agent into v_agent
    from private.auth_session_validity s
    where s.id = v_session and s.user_id = v_user and s.aal = 'aal2' and s.factor_id = p_factor_id;
    if not found or coalesce(v_claims ->> 'aal', '') <> 'aal2' then
      return 'refused';
    end if;
    insert into private.mfa_factor_confirmations (factor_id, user_id, session_id, setup_user_agent)
    values (p_factor_id, v_user, v_session,
            case when char_length(v_agent) <= 512 then v_agent end);
    perform private.audit_account_event(v_user, 'platform.auth.mfa_enrolled',
                                        jsonb_build_object('method', 'totp', 'confirmed', false), 'account');
  end if;
  if private.queue_mfa_mail('mfa_factor_added', v_user, p_factor_id, null, private.current_tenant_id()) then
    return 'queued';
  end if;
  return 'waiting';
end
$$;

comment on function private.request_mfa_factor_mail(uuid) is
  'SECURITY-RELEVANT (T-M2-10, re-review N1, T-IAM-11). After the signed-in session set up an authenticator app (it passed its first code): records the app as waiting, with that session, audits it and queues the set-up e-mail; later "send again" from that session only. queued | waiting | too_soon | refused.';

-- The e-mailed code, entered in the session that set the app up (re-review N1): possession of the app (that
-- session passed its code, aal2 through this factor) and of the mailbox (the code). Single use; dies after
-- private.mfa_code_max_attempts() wrong tries (the counter is kept: this function returns, never raises). Per
-- account, private.mfa_code_account_max_failures() wrong codes within private.mfa_code_failure_window() remove
-- every waiting app of the account (final re-review L2).
--   confirmed | invalid | expired | locked | removed (too many wrong codes on the account) | refused (not this
--   session's waiting app)
create or replace function private.confirm_mfa_setup(p_factor_id uuid, p_code text)
returns text
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_claims jsonb := private.request_claims();
  v_user uuid := private.request_live_user();
  v_session uuid := private.try_uuid(v_claims ->> 'session_id');
  v record;
  v_attempts smallint;
  v_apps uuid[];
begin
  if v_user is null or v_session is null or p_factor_id is null then
    return 'refused';
  end if;
  select k.session_id, k.confirmed_at, k.code_hash, k.code_expires_at, k.code_attempts into v
  from private.mfa_factor_confirmations k
  where k.factor_id = p_factor_id and k.user_id = v_user
  for update;
  if not found or v.confirmed_at is not null or v.session_id <> v_session
     or coalesce(v_claims ->> 'aal', '') <> 'aal2'
     or not exists (select 1 from private.auth_session_validity s
                    where s.id = v_session and s.user_id = v_user and s.aal = 'aal2' and s.factor_id = p_factor_id)
     or not exists (select 1 from private.auth_mfa_factor f
                    where f.id = p_factor_id and f.user_id = v_user and f.status = 'verified') then
    return 'refused';
  end if;
  if v.code_hash is null then
    return case when v.code_attempts >= private.mfa_code_max_attempts() then 'locked' else 'invalid' end;
  end if;
  if v.code_expires_at <= now() then
    return 'expired';
  end if;
  if p_code is null or p_code !~ '^[0-9]{8}$'
     or sha256(convert_to(p_factor_id::text || ':' || p_code, 'UTF8')) <> v.code_hash then
    v_attempts := v.code_attempts + 1;
    update private.mfa_factor_confirmations k
    set code_attempts = v_attempts,
        code_hash = case when v_attempts >= private.mfa_code_max_attempts() then null else k.code_hash end,
        code_expires_at = case when v_attempts >= private.mfa_code_max_attempts() then null else k.code_expires_at end
    where k.factor_id = p_factor_id;
    -- Per account (final re-review L2): new apps and new e-mails reset an app's tries, not the account's.
    delete from private.mfa_setup_code_failures x
    where x.user_id = v_user and x.failed_at < now() - private.mfa_code_failure_window();
    insert into private.mfa_setup_code_failures (user_id) values (v_user);
    if (select count(*) from private.mfa_setup_code_failures x where x.user_id = v_user)
       >= private.mfa_code_account_max_failures() then
      -- Every waiting app of the account goes, the sessions that passed their code end (this one too), the
      -- owner is told once; the count starts again.
      v_apps := array(select f.id from private.auth_mfa_factor f
                      left join private.mfa_factor_confirmations c on c.factor_id = f.id and c.user_id = f.user_id
                      where f.user_id = v_user and f.factor_type = 'totp' and f.status = 'verified'
                        and c.confirmed_at is null);
      perform private.end_sessions(
        v_user, array(select s.id from private.auth_session_validity s
                      where s.user_id = v_user and s.factor_id = any (v_apps)),
        private.current_tenant_id(), 'security', null);
      perform private.remove_account_factors(v_user, v_apps);
      delete from private.mfa_setup_code_failures x where x.user_id = v_user;
      perform private.audit_account_event(v_user, 'platform.auth.mfa_removed',
                                          jsonb_build_object('method', 'totp', 'via', 'too_many_codes',
                                                             'apps', cardinality(v_apps)), 'platform');
      perform private.queue_mfa_mail('mfa_factor_removed', v_user, null, 'too_many_codes', null);
      return 'removed';
    end if;
    return case when v_attempts >= private.mfa_code_max_attempts() then 'locked' else 'invalid' end;
  end if;
  update private.mfa_factor_confirmations k
  set confirmed_at = now(), code_hash = null, code_expires_at = null, code_attempts = 0
  where k.factor_id = p_factor_id;
  perform private.audit_account_event(v_user, 'platform.auth.mfa_confirmed', jsonb_build_object('method', 'totp'),
                                      'account');
  return 'confirmed';
end
$$;

comment on function private.confirm_mfa_setup(uuid, text) is
  'SECURITY-RELEVANT (T-M2-10, re-review N1, T-IAM-11). The e-mailed code of a new authenticator app, accepted only from the Auth session that set it up (aal2 through that app): from now on it counts for AAL2. Single use, expires, dies after 5 wrong tries; 15 wrong codes on the account within 24 hours remove its waiting apps (final re-review L2).';

-- The account's authenticator apps (verified in Auth) as this session sees them: confirmed or waiting, set up
-- by THIS session or another one (when, with which browser). For the /mfa page and My profile. An app not
-- recorded yet (its set-up e-mail could not be asked for) is "here" for the Auth session that passed its code
-- ("send the e-mail again" then records it).
create or replace function private.my_mfa_apps()
returns table (factor_id uuid, confirmed boolean, here boolean, set_up_at timestamptz, user_agent text)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_user uuid := private.request_live_user();
  v_session uuid := private.try_uuid(private.request_claims() ->> 'session_id');
begin
  if v_user is null then
    return;
  end if;
  return query
    select f.id, k.confirmed_at is not null,
           case when k.factor_id is not null then k.session_id = v_session
                else exists (select 1 from private.auth_session_validity s
                             where s.id = v_session and s.user_id = v_user and s.factor_id = f.id) end,
           coalesce(k.created_at, f.created_at), k.setup_user_agent
    from private.auth_mfa_factor f
    left join private.mfa_factor_confirmations k on k.factor_id = f.id and k.user_id = f.user_id
    where f.user_id = v_user and f.factor_type = 'totp' and f.status = 'verified'
    order by (k.confirmed_at is not null) desc, coalesce(k.created_at, f.created_at) desc, f.id;
end
$$;

comment on function private.my_mfa_apps() is
  'T-M2-10 (re-review N1). The signed-in account''s authenticator apps: confirmed or waiting, set up by this session or another (when, which browser). app_server, user claims of a live session.';

-- Removing an app from the web app (also the explicit factor id, never "the first one"). An unfinished set-up
-- (not verified in Auth) is simply deleted (final re-review L1). A VERIFIED app:
--   * a CONFIRMED app (My profile): this session at AAL2 through a confirmed app with a code from the last 15
--     minutes — otherwise step_up;
--   * a WAITING app set up by this session: cancelled;
--   * a WAITING app set up by ANOTHER session ("an app was added from another sign-in" → Remove, re-review
--     N1): removed, and every OTHER session of the account ends (whoever set it up keeps nothing).
-- Audited and e-mailed. Auth's own unenroll is not used: the database knows which app it removes.
--   removed | step_up | refused
create or replace function private.remove_mfa_app(p_factor_id uuid)
returns text
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_claims jsonb := private.request_claims();
  v_user uuid := private.request_live_user();
  v_session uuid := private.try_uuid(v_claims ->> 'session_id');
  v_tenant uuid := private.current_tenant_id();
  v record;
  v_found boolean;
  v_status text;
  v_via text;
  v_reason text;
begin
  if v_user is null or v_session is null or p_factor_id is null then
    return 'refused';
  end if;
  select f.status::text into v_status from private.auth_mfa_factor f
  where f.id = p_factor_id and f.user_id = v_user and f.factor_type = 'totp';
  if not found then
    return 'refused';
  end if;
  if v_status <> 'verified' then
    -- An unfinished set-up never counted and nobody was told of it: it is simply deleted — no session ends, no
    -- e-mail, no audit row (final re-review L1: no loop of "create, remove" can flood the owner).
    perform private.remove_account_factors(v_user, array[p_factor_id]);
    return 'removed';
  end if;
  select k.session_id, k.confirmed_at into v
  from private.mfa_factor_confirmations k
  where k.factor_id = p_factor_id and k.user_id = v_user
  for update;
  v_found := found;
  if v_found and v.confirmed_at is not null then
    if not (private.request_aal2() and private.request_code_fresh()) then
      return 'step_up';
    end if;
    v_via := 'profile';
    v_reason := 'removed';
  elsif v_found and v.session_id = v_session then
    v_via := 'cancelled';
    v_reason := 'removed';
  else
    -- Set up elsewhere (or outside the web app): whoever did it keeps no session.
    v_via := 'notice';
    v_reason := 'not_me';
    perform private.end_sessions(
      v_user, array(select s.id from private.auth_session_validity s where s.user_id = v_user and s.id <> v_session),
      v_tenant, 'security', v_user);
  end if;
  perform private.remove_account_factors(v_user, array[p_factor_id]);
  perform private.audit_account_event(v_user, 'platform.auth.mfa_removed',
                                      jsonb_build_object('method', 'totp', 'via', v_via), 'account');
  perform private.queue_mfa_mail('mfa_factor_removed', v_user, p_factor_id, v_reason, v_tenant);
  return 'removed';
end
$$;

comment on function private.remove_mfa_app(uuid) is
  'SECURITY-RELEVANT (T-M2-10, re-review N1). The signed-in account removes one of its authenticator apps: a confirmed one at AAL2 with a recent code; one waiting for this session''s confirmation; or one added from another sign-in (every other session then ends). Audited and e-mailed. removed | step_up | refused.';

-- Worker: the hashes of the code and link it is about to e-mail (each new e-mail replaces the previous code and
-- link, and resets the tries). NULLs when the app is gone or already confirmed (nothing to send). Also when and
-- with which browser the app was set up (the e-mail says so).
create or replace function private.issue_mfa_factor_tokens(
  p_factor_id uuid, p_user_id uuid, p_code_hash bytea, p_remove_hash bytea,
  out code_expires_at timestamptz, out remove_expires_at timestamptz, out set_up_at timestamptz,
  out setup_user_agent text)
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
  if octet_length(p_code_hash) is distinct from 32 or octet_length(p_remove_hash) is distinct from 32 then
    raise exception 'code and token hashes must be SHA-256' using errcode = 'invalid_parameter_value';
  end if;
  update private.mfa_factor_confirmations k
  set code_hash = p_code_hash, code_expires_at = now() + private.mfa_code_lifetime(), code_issued_at = now(),
      code_attempts = 0,
      remove_token_hash = p_remove_hash, remove_expires_at = now() + private.mfa_remove_link_lifetime()
  where k.factor_id = p_factor_id and k.user_id = p_user_id and k.confirmed_at is null
    and exists (select 1 from private.auth_mfa_factor f
                where f.id = k.factor_id and f.user_id = k.user_id and f.status = 'verified')
  returning k.code_expires_at, k.remove_expires_at, k.created_at, k.setup_user_agent
    into code_expires_at, remove_expires_at, set_up_at, setup_user_agent;
end
$$;

comment on function private.issue_mfa_factor_tokens(uuid, uuid, bytea, bytea) is
  'SECURITY-RELEVANT (T-M2-10, re-review N1). Worker: stores the SHA-256 of the set-up e-mail''s code (with the factor id) and "not you" link (replacing earlier ones); returns their lifetimes and when / with which browser the app was set up. app_worker system claims only.';

-- Worker: does the account use an app (verified in Auth)? The reset e-mail then says a code will be asked.
create or replace function private.account_has_app(p_user_id uuid)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_claims jsonb := private.request_claims();
begin
  if session_user <> 'app_worker' or coalesce(v_claims ->> 'role', '') <> 'system'
     or coalesce(btrim(v_claims ->> 'job_id'), '') = '' then
    raise exception 'reserved to the worker' using errcode = 'insufficient_privilege';
  end if;
  return exists (select 1 from private.auth_mfa_factor f
                 where f.user_id = p_user_id and f.factor_type = 'totp' and f.status = 'verified');
end
$$;

comment on function private.account_has_app(uuid) is
  'T-M2-10. Worker: whether an account has a verified authenticator app in Auth (the reset e-mail asks for its code). app_worker system claims only.';

-- The "not you?" link: removes that app and ends every session of the account. Single use.
--   removed | expired | invalid
create or replace function private.reject_mfa_factor(p_token_hash bytea)
returns text
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v record;
begin
  if session_user <> 'app_server' then
    raise exception 'reserved to the web app' using errcode = 'insufficient_privilege';
  end if;
  if octet_length(p_token_hash) is distinct from 32 then
    return 'invalid';
  end if;
  select k.factor_id, k.user_id, k.remove_expires_at into v
  from private.mfa_factor_confirmations k
  where k.remove_token_hash = p_token_hash
  for update;
  if not found then
    return 'invalid';
  end if;
  if v.remove_expires_at <= now() then
    return 'expired';
  end if;
  update private.mfa_factor_confirmations k
  set remove_token_hash = null, remove_expires_at = null, code_hash = null, code_expires_at = null
  where k.factor_id = v.factor_id;
  perform private.remove_account_factors(v.user_id, array[v.factor_id]);
  perform private.end_all_account_sessions(v.user_id, null, null);
  perform private.audit_account_event(v.user_id, 'platform.auth.mfa_removed',
                                      jsonb_build_object('method', 'totp', 'via', 'email_link'), 'account');
  perform private.queue_mfa_mail('mfa_factor_removed', v.user_id, v.factor_id, 'not_me', null);
  return 'removed';
end
$$;

comment on function private.reject_mfa_factor(bytea) is
  'SECURITY-RELEVANT (T-M2-10, review H1, T-IAM-11). The e-mailed "not you? remove this app" link: removes that authenticator app in Auth and ends every session of the account. Single use. app_server only.';

-- Worker (re-review N2): an app still unconfirmed after private.mfa_code_lifetime() — or set up outside the
-- web app and never recorded — is removed, so a waiting app nobody confirmed never blocks the owner (Auth asks
-- a code from every verified app for a password change, a reset or a new set-up). The sessions that passed
-- its code end; the account is e-mailed and the removal audited. Returns how many apps were removed.
create or replace function private.purge_unconfirmed_mfa_apps(p_limit integer)
returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_claims jsonb := private.request_claims();
  v record;
  v_count integer := 0;
begin
  if session_user <> 'app_worker' or coalesce(v_claims ->> 'role', '') <> 'system'
     or coalesce(btrim(v_claims ->> 'job_id'), '') = '' then
    raise exception 'reserved to the worker' using errcode = 'insufficient_privilege';
  end if;
  delete from private.mfa_setup_code_failures x where x.failed_at < now() - private.mfa_code_failure_window();
  for v in
    select f.id, f.user_id
    from private.auth_mfa_factor f
    left join private.mfa_factor_confirmations k on k.factor_id = f.id and k.user_id = f.user_id
    where f.factor_type = 'totp' and f.status = 'verified' and k.confirmed_at is null
      and coalesce(k.created_at, f.created_at) < now() - private.mfa_code_lifetime()
    order by coalesce(k.created_at, f.created_at), f.id
    limit greatest(coalesce(p_limit, 0), 0)
  loop
    perform private.end_sessions(
      v.user_id, array(select s.id from private.auth_session_validity s where s.user_id = v.user_id and s.factor_id = v.id),
      null, 'security', null);
    perform private.remove_account_factors(v.user_id, array[v.id]);
    perform private.audit_account_event(v.user_id, 'platform.auth.mfa_removed',
                                        jsonb_build_object('method', 'totp', 'via', 'expired'), 'platform');
    perform private.queue_mfa_mail('mfa_factor_removed', v.user_id, v.id, 'expired', null);
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$$;

comment on function private.purge_unconfirmed_mfa_apps(integer) is
  'SECURITY-RELEVANT (T-M2-10, re-review N2). Worker: removes authenticator apps still unconfirmed after private.mfa_code_lifetime() (or never recorded), ends the sessions that passed their code, audits and e-mails it. app_worker system claims only.';

-- An Organization Admin resets a member's authenticator apps (PO answer, 9 Oct 2026; TM-0003 T-IAM-10).
-- Checked here as in the web app: Organization Admin role in force, AAL2 with a confirmed app and a code from
-- the last 15 minutes (private.request_code_fresh — also checked by defineAction), a member they may manage,
-- not themself (My profile), and a login that is an active member of NO other organization (otherwise
-- ENTLAQA support). Every session of the member ends; the member is e-mailed. The web app audits the action.
--   reset | no_app | other_organization | self | not_found ; 42501 for a caller who may not
create or replace function private.reset_member_mfa(p_person_id uuid)
returns text
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_tenant uuid := private.current_tenant_id();
  v_actor uuid := private.request_user_id();
  v_member uuid;
begin
  if v_tenant is null or v_actor is null
     or not ('tenant_admin' = any (private.actor_role_codes(v_tenant, v_actor)))
     or not private.request_aal2() or not private.request_code_fresh() then
    raise exception 'only an Organization Admin with an authenticator code resets authenticator apps'
      using errcode = 'insufficient_privilege';
  end if;
  if p_person_id is null or not private.actor_may_manage_person(v_tenant, p_person_id) then
    raise exception 'not a member this administrator may manage' using errcode = 'insufficient_privilege';
  end if;
  select m.user_id into v_member from platform.tenant_memberships m
  where m.tenant_id = v_tenant and m.person_id = p_person_id and m.user_id is not null;
  if v_member is null then
    return 'not_found';
  end if;
  if v_member = v_actor then
    return 'self';
  end if;
  if exists (select 1 from platform.tenant_memberships m join platform.tenants t on t.id = m.tenant_id
             where m.user_id = v_member and m.tenant_id <> v_tenant and m.status = 'active'
               and t.status in ('active', 'trial')) then
    return 'other_organization';
  end if;
  if private.remove_account_factors(v_member, null) = 0 then
    return 'no_app';
  end if;
  perform private.end_all_account_sessions(v_member, v_tenant, v_actor);
  perform private.queue_mfa_mail('mfa_factor_removed', v_member, null, 'admin_reset', v_tenant);
  return 'reset';
end
$$;

comment on function private.reset_member_mfa(uuid) is
  'SECURITY-RELEVANT (FR-IAM-12, T-M2-10, TM-0003 T-IAM-10). An Organization Admin at AAL2 resets the authenticator apps of a member they may manage whose login belongs to no other organization: apps deleted in Auth, every session ended, the member e-mailed.';

-- ENTLAQA support (operators only, after the identity check of docs/engineering/mfa-reset.md): every
-- authenticator app of the account is removed, every session ends, the account is e-mailed and the reset is
-- audited in each of its organizations with the support reference (a ticket id — never personal data).
-- Returns how many apps were removed.
create or replace function private.reset_account_mfa(p_user_id uuid, p_reference text)
returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if session_user in ('app_server', 'app_worker', 'app_queue', 'authenticated', 'anon') then
    raise exception 'operators only' using errcode = 'insufficient_privilege';
  end if;
  if p_user_id is null or p_reference is null or p_reference !~ '^[A-Za-z0-9._:-]{3,64}$' then
    raise exception 'an account id and a support reference (ticket id, 3 to 64 of A-Z a-z 0-9 . _ : -) are required'
      using errcode = 'invalid_parameter_value';
  end if;
  v_count := private.remove_account_factors(p_user_id, null);
  perform private.end_all_account_sessions(p_user_id, null, null);
  perform private.audit_account_event(p_user_id, 'platform.auth.mfa_reset',
                                      jsonb_build_object('by', 'support', 'reference', p_reference, 'apps', v_count),
                                      'platform');
  if v_count > 0 then
    perform private.queue_mfa_mail('mfa_factor_removed', p_user_id, null, 'support_reset', null);
  end if;
  return v_count;
end
$$;

comment on function private.reset_account_mfa(uuid, text) is
  'SECURITY-RELEVANT (T-M2-10, TM-0003 T-IAM-10). ENTLAQA support only (operator, docs/engineering/mfa-reset.md): removes every authenticator app of an account, ends its sessions, e-mails it and audits the reset with the support reference.';

-- ---------------------------------------------------------------------------------------------------
-- A changed security policy is e-mailed to every Organization Admin (TM-0003 T-IAM-24; review L5)
-- ---------------------------------------------------------------------------------------------------
-- Trigger (after a change of the settings): one notice per Organization Admin of the organization (role in
-- force, active membership), naming the settings that changed (never their values) and who changed them.
-- Sent to the admins' login e-mail in the organization's language and brand by the worker.
create or replace function private.security_policy_changed_mail()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_changed text[];
begin
  v_changed := array_remove(array[
    case when old.mfa_mode is distinct from new.mfa_mode then 'mfaMode' end,
    case when old.mfa_required_roles is distinct from new.mfa_required_roles then 'mfaRequiredRoles' end,
    case when old.mfa_grace_days is distinct from new.mfa_grace_days then 'mfaGraceDays' end,
    case when old.mfa_prompt_admins is distinct from new.mfa_prompt_admins then 'mfaPromptAdmins' end,
    case when old.password_min_length is distinct from new.password_min_length then 'passwordMinLength' end,
    case when old.lockout_threshold is distinct from new.lockout_threshold then 'lockoutThreshold' end,
    case when old.lockout_minutes is distinct from new.lockout_minutes then 'lockoutMinutes' end,
    case when old.session_idle_minutes is distinct from new.session_idle_minutes then 'sessionIdleMinutes' end,
    case when old.session_max_hours is distinct from new.session_max_hours then 'sessionMaxHours' end,
    case when old.session_max_devices is distinct from new.session_max_devices then 'sessionMaxDevices' end
  ], null);
  if cardinality(v_changed) = 0 then
    return null;
  end if;
  delete from private.account_mail_requests r
  where r.kind = 'security_policy_changed' and private.account_mail_request_expired(r.kind, r.created_at);
  insert into private.account_mail_requests (kind, user_id, tenant_id, detail)
  select distinct 'security_policy_changed', m.user_id, new.tenant_id,
         jsonb_build_object('changed', to_jsonb(v_changed), 'changed_by', new.updated_by, 'changed_at', now())
  from platform.tenant_memberships m
  join platform.role_assignments ra on ra.tenant_id = m.tenant_id and ra.membership_id = m.id
  where m.tenant_id = new.tenant_id and m.status = 'active' and m.user_id is not null
    and ra.role_code = 'tenant_admin'
    and (ra.valid_from is null or ra.valid_from <= now()) and (ra.valid_until is null or ra.valid_until > now())
    and (select count(*) from (select 1 from private.account_mail_requests limit 10000) w) < 10000;
  return null;
end
$$;

comment on function private.security_policy_changed_mail() is
  'SECURITY-RELEVANT (T-M2-10, TM-0003 T-IAM-24). Trigger: queues the security-policy-change notice for every Organization Admin of the organization (setting names and editor only). tenant_guard only.';

create trigger security_policies_changed_mail after update on platform.security_policies
  for each row execute function private.security_policy_changed_mail();

-- Ownership hand-over as in migration 20260930120100 (non-superuser migration role on hosted Supabase).
grant create on schema private to tenant_guard;
alter function private.security_policy_changed_mail() owner to tenant_guard;
alter function private.queue_mfa_mail(text, uuid, uuid, text, uuid) owner to tenant_guard;
alter function private.remove_account_factors(uuid, uuid[]) owner to tenant_guard;
alter function private.end_all_account_sessions(uuid, uuid, uuid) owner to tenant_guard;
alter function private.request_live_user() owner to tenant_guard;
alter function private.request_mfa_factor_mail(uuid) owner to tenant_guard;
alter function private.confirm_mfa_setup(uuid, text) owner to tenant_guard;
alter function private.my_mfa_apps() owner to tenant_guard;
alter function private.remove_mfa_app(uuid) owner to tenant_guard;
alter function private.issue_mfa_factor_tokens(uuid, uuid, bytea, bytea) owner to tenant_guard;
alter function private.account_has_app(uuid) owner to tenant_guard;
alter function private.reject_mfa_factor(bytea) owner to tenant_guard;
alter function private.purge_unconfirmed_mfa_apps(integer) owner to tenant_guard;
alter function private.reset_member_mfa(uuid) owner to tenant_guard;
alter function private.reset_account_mfa(uuid, text) owner to tenant_guard;
revoke create on schema private from tenant_guard;

revoke all on function private.security_policy_changed_mail() from public;
revoke all on function private.queue_mfa_mail(text, uuid, uuid, text, uuid) from public;
revoke all on function private.remove_account_factors(uuid, uuid[]) from public;
revoke all on function private.end_all_account_sessions(uuid, uuid, uuid) from public;
revoke all on function private.request_live_user() from public;
revoke all on function private.request_mfa_factor_mail(uuid) from public;
revoke all on function private.confirm_mfa_setup(uuid, text) from public;
revoke all on function private.my_mfa_apps() from public;
revoke all on function private.remove_mfa_app(uuid) from public;
revoke all on function private.issue_mfa_factor_tokens(uuid, uuid, bytea, bytea) from public;
revoke all on function private.account_has_app(uuid) from public;
revoke all on function private.reject_mfa_factor(bytea) from public;
revoke all on function private.purge_unconfirmed_mfa_apps(integer) from public;
revoke all on function private.reset_member_mfa(uuid) from public;
revoke all on function private.reset_account_mfa(uuid, text) from public;
grant execute on function private.queue_mfa_mail(text, uuid, uuid, text, uuid) to tenant_guard;
grant execute on function private.remove_account_factors(uuid, uuid[]) to tenant_guard;
grant execute on function private.end_all_account_sessions(uuid, uuid, uuid) to tenant_guard;
grant execute on function private.request_live_user() to tenant_guard;
-- Called inside `set local role authenticated` transactions; each function checks the LOGIN role itself.
grant execute on function private.request_mfa_factor_mail(uuid) to authenticated;
grant execute on function private.confirm_mfa_setup(uuid, text) to authenticated;
grant execute on function private.my_mfa_apps() to authenticated;
grant execute on function private.remove_mfa_app(uuid) to authenticated;
grant execute on function private.issue_mfa_factor_tokens(uuid, uuid, bytea, bytea) to authenticated;
grant execute on function private.account_has_app(uuid) to authenticated;
grant execute on function private.reject_mfa_factor(bytea) to authenticated;
grant execute on function private.purge_unconfirmed_mfa_apps(integer) to authenticated;
grant execute on function private.reset_member_mfa(uuid) to authenticated;
-- Operators only: the migration role (ENTLAQA support runs the runbook as the migration role).
grant execute on function private.reset_account_mfa(uuid, text) to current_user;
grant execute on function private.actor_role_codes(uuid, uuid) to tenant_guard;
