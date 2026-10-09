-- Authenticator apps: mailbox confirmation, e-mailed notices, removal and resets (FR-IAM-12; T-M2-10; TM-0003
-- T-IAM-10, T-IAM-11; security review H1 / M2). PII: none stored (account ids; token hashes).
--
-- SECURITY-RELEVANT.
--   * Set-up (security review H1, T-IAM-11): after an app is set up in the web app, the account gets an
--     e-mail — our notification service (account e-mails, 20261010120000, worker) — with a single-use
--     CONFIRMATION link (72 hours) and a "not you? remove this app" link (7 days). Only the SHA-256 of each
--     token is stored (private.mfa_factor_confirmations, 20261012090100); the worker creates them when it
--     writes the e-mail, so a delayed worker delays the e-mail, never the set-up. The app counts for AAL2 only
--     once confirmed (private.session_access, private.request_aal2).
--   * "Not you?": removes that app in Auth and ends EVERY session of the account (the e-mail tells to set a
--     new password).
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
--   private.request_mfa_factor_mail(factor)    web app (user claims, live session): the set-up e-mail of
--       the caller's app (NULL: the newest app waiting for confirmation — "send the e-mail again")
--   private.request_mfa_removed_mail(factor)   web app: the notice after the account removed its own app
--   private.issue_mfa_factor_tokens(…)         worker: stores the hashes of the links it e-mails
--   private.account_has_app(user)              worker: the reset e-mail says a code will be asked
--   private.confirm_mfa_factor(token hash)     web app (no session): the confirmation link
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
-- Why an app was removed: by the account (My profile), by its "not you" link, by an Organization Admin, by
-- ENTLAQA support.
alter table private.account_mail_requests add column mfa_reason text;
-- security_policy_changed: which settings changed (names, never values) and who changed them (person id).
alter table private.account_mail_requests add column detail jsonb;
alter table private.account_mail_requests drop constraint account_mail_requests_kind_check;
alter table private.account_mail_requests add constraint account_mail_requests_kind_check
  check (kind in ('password_reset', 'password_changed', 'mfa_factor_added', 'mfa_factor_removed',
                  'security_policy_changed'));
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
      and factor_id is null and mfa_reason is null and jsonb_typeof(detail) = 'object'));
alter table private.account_mail_requests add constraint account_mail_requests_mfa_reason_check
  check (mfa_reason is null or mfa_reason in ('removed', 'not_me', 'admin_reset', 'support_reset'));

-- tenant_guard queues the authenticator notices and the policy-change notices (and only those).
create policy account_mail_requests_tenant_guard on private.account_mail_requests for all to tenant_guard
  using (kind in ('mfa_factor_added', 'mfa_factor_removed', 'security_policy_changed'))
  with check (kind in ('mfa_factor_added', 'mfa_factor_removed', 'security_policy_changed'));
grant select, insert, delete on private.account_mail_requests to tenant_guard;

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
  return query select v_request.id, v_request.kind, 'send'::text, v_account.email::text, v_account.id, v_member.tenant_id,
                      v_member.person_id, case when v_member.preferred_locale = 'en' then 'en' else 'ar' end,
                      v_request.attempts::integer, v_request.factor_id, v_request.mfa_reason, v_request.detail;
end
$$;

comment on function private.claim_account_mail_request() is
  'SECURITY-RELEVANT (T-M2-17, T-M2-10). Worker: leases the oldest waiting account e-mail request and resolves account, organization and language (and, for authenticator notices, the app and why; for policy-change notices, what changed and who changed it). app_worker system claims only.';

grant create on schema private to account_mail_guard;
alter function private.claim_account_mail_request() owner to account_mail_guard;
revoke create on schema private from account_mail_guard;
revoke all on function private.claim_account_mail_request() from public;
grant execute on function private.claim_account_mail_request() to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- tenant_guard: authenticator notices, confirmation, removal, resets
-- ---------------------------------------------------------------------------------------------------
-- Link lifetimes (one place each).
create or replace function private.mfa_confirm_link_lifetime()
returns interval
language sql immutable
set search_path = ''
as $$ select interval '72 hours' $$;

create or replace function private.mfa_remove_link_lifetime()
returns interval
language sql immutable
set search_path = ''
as $$ select interval '7 days' $$;

comment on function private.mfa_confirm_link_lifetime() is
  'T-M2-10 (review H1): how long the e-mailed confirmation link of a new authenticator app works.';
comment on function private.mfa_remove_link_lifetime() is
  'T-M2-10 (review H1): how long the e-mailed "not you? remove this app" link works.';

revoke all on function private.mfa_confirm_link_lifetime() from public;
revoke all on function private.mfa_remove_link_lifetime() from public;
grant execute on function private.mfa_confirm_link_lifetime() to tenant_guard;
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

-- After set-up (or "send the e-mail again"): the set-up e-mail with its links, and the audit row. Any session
-- of the account (also before an organization is chosen). True when an e-mail was queued.
create or replace function private.request_mfa_factor_mail(p_factor_id uuid)
returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_user uuid := private.request_live_user();
  v_factor uuid;
  v_new integer;
begin
  if v_user is null then
    return false;
  end if;
  select f.id into v_factor
  from private.auth_mfa_factor f
  left join private.mfa_factor_confirmations k on k.factor_id = f.id and k.user_id = f.user_id
  where f.user_id = v_user and f.factor_type = 'totp' and f.status = 'verified' and k.confirmed_at is null
    and (p_factor_id is null or f.id = p_factor_id)
  order by f.created_at desc, f.id
  limit 1;
  if v_factor is null then
    return false;
  end if;
  insert into private.mfa_factor_confirmations (factor_id, user_id) values (v_factor, v_user)
  on conflict (factor_id) do nothing;
  get diagnostics v_new = row_count;
  if v_new > 0 then
    perform private.audit_account_event(v_user, 'platform.auth.mfa_enrolled',
                                        jsonb_build_object('method', 'totp', 'confirmed', false), 'account');
  end if;
  return private.queue_mfa_mail('mfa_factor_added', v_user, v_factor, null, private.current_tenant_id());
end
$$;

comment on function private.request_mfa_factor_mail(uuid) is
  'SECURITY-RELEVANT (T-M2-10, review H1, T-IAM-11). After the signed-in account set up an authenticator app: records it as waiting for confirmation, audits it and queues the set-up e-mail (or sends it again). True when queued.';

-- After the account removed its own app in Auth (My profile): the notice and the audit row.
create or replace function private.request_mfa_removed_mail(p_factor_id uuid)
returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_user uuid := private.request_live_user();
begin
  if v_user is null or p_factor_id is null
     or exists (select 1 from private.auth_mfa_factor f where f.id = p_factor_id and f.user_id = v_user) then
    return false;  -- only an app this account no longer has
  end if;
  delete from private.mfa_factor_confirmations k where k.factor_id = p_factor_id and k.user_id = v_user;
  perform private.audit_account_event(v_user, 'platform.auth.mfa_removed',
                                      jsonb_build_object('method', 'totp', 'via', 'profile'), 'account');
  return private.queue_mfa_mail('mfa_factor_removed', v_user, p_factor_id, 'removed', private.current_tenant_id());
end
$$;

comment on function private.request_mfa_removed_mail(uuid) is
  'SECURITY-RELEVANT (T-M2-10). After the signed-in account removed its own authenticator app: audit row and notice. True when queued.';

-- Worker: the hashes of the links it is about to e-mail (each new e-mail replaces the previous links).
-- NULLs when the app is gone or already confirmed (nothing to send).
create or replace function private.issue_mfa_factor_tokens(
  p_factor_id uuid, p_user_id uuid, p_confirm_hash bytea, p_remove_hash bytea,
  out confirm_expires_at timestamptz, out remove_expires_at timestamptz)
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
  if octet_length(p_confirm_hash) is distinct from 32 or octet_length(p_remove_hash) is distinct from 32 then
    raise exception 'token hashes must be SHA-256' using errcode = 'invalid_parameter_value';
  end if;
  update private.mfa_factor_confirmations k
  set confirm_token_hash = p_confirm_hash, confirm_expires_at = now() + private.mfa_confirm_link_lifetime(),
      remove_token_hash = p_remove_hash, remove_expires_at = now() + private.mfa_remove_link_lifetime()
  where k.factor_id = p_factor_id and k.user_id = p_user_id and k.confirmed_at is null
    and exists (select 1 from private.auth_mfa_factor f
                where f.id = k.factor_id and f.user_id = k.user_id and f.status = 'verified')
  returning k.confirm_expires_at, k.remove_expires_at into confirm_expires_at, remove_expires_at;
end
$$;

comment on function private.issue_mfa_factor_tokens(uuid, uuid, bytea, bytea) is
  'SECURITY-RELEVANT (T-M2-10, review H1). Worker: stores the SHA-256 of the set-up e-mail''s confirmation and removal links (replacing earlier ones). app_worker system claims only.';

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

-- The confirmation link (no session needed: opening the e-mailed link proves the mailbox). Single use.
--   confirmed | expired | invalid (unknown, used, or the app is gone)
create or replace function private.confirm_mfa_factor(p_token_hash bytea)
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
  select k.factor_id, k.user_id, k.confirm_expires_at into v
  from private.mfa_factor_confirmations k
  where k.confirm_token_hash = p_token_hash
  for update;
  if not found or not exists (select 1 from private.auth_mfa_factor f
                              where f.id = v.factor_id and f.user_id = v.user_id and f.status = 'verified') then
    return 'invalid';
  end if;
  if v.confirm_expires_at <= now() then
    return 'expired';
  end if;
  update private.mfa_factor_confirmations k
  set confirmed_at = now(), confirm_token_hash = null, confirm_expires_at = null
  where k.factor_id = v.factor_id;
  perform private.audit_account_event(v.user_id, 'platform.auth.mfa_confirmed', jsonb_build_object('method', 'totp'),
                                      'account');
  return 'confirmed';
end
$$;

comment on function private.confirm_mfa_factor(bytea) is
  'SECURITY-RELEVANT (T-M2-10, review H1, T-IAM-11). The e-mailed confirmation link of a new authenticator app (mailbox proved): from now on it counts for AAL2. Single use. app_server only.';

-- The "not you?" link: removes that app in Auth and ends every session of the account. Single use.
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
  update private.mfa_factor_confirmations k set remove_token_hash = null, remove_expires_at = null
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

-- An Organization Admin resets a member's authenticator apps (PO answer, 9 Oct 2026; TM-0003 T-IAM-10).
-- Checked here as in the web app: Organization Admin role in force, AAL2 with a confirmed app (the freshness
-- of the code is the web app's: defineAction), a member they may manage, not themself (My profile), and a
-- login that is an active member of NO other organization (otherwise ENTLAQA support). Every session of the
-- member ends; the member is e-mailed. The web app audits the action.
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
     or not ('tenant_admin' = any (private.actor_role_codes(v_tenant, v_actor))) or not private.request_aal2() then
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
alter function private.request_mfa_removed_mail(uuid) owner to tenant_guard;
alter function private.issue_mfa_factor_tokens(uuid, uuid, bytea, bytea) owner to tenant_guard;
alter function private.account_has_app(uuid) owner to tenant_guard;
alter function private.confirm_mfa_factor(bytea) owner to tenant_guard;
alter function private.reject_mfa_factor(bytea) owner to tenant_guard;
alter function private.reset_member_mfa(uuid) owner to tenant_guard;
alter function private.reset_account_mfa(uuid, text) owner to tenant_guard;
revoke create on schema private from tenant_guard;

revoke all on function private.security_policy_changed_mail() from public;
revoke all on function private.queue_mfa_mail(text, uuid, uuid, text, uuid) from public;
revoke all on function private.remove_account_factors(uuid, uuid[]) from public;
revoke all on function private.end_all_account_sessions(uuid, uuid, uuid) from public;
revoke all on function private.request_live_user() from public;
revoke all on function private.request_mfa_factor_mail(uuid) from public;
revoke all on function private.request_mfa_removed_mail(uuid) from public;
revoke all on function private.issue_mfa_factor_tokens(uuid, uuid, bytea, bytea) from public;
revoke all on function private.account_has_app(uuid) from public;
revoke all on function private.confirm_mfa_factor(bytea) from public;
revoke all on function private.reject_mfa_factor(bytea) from public;
revoke all on function private.reset_member_mfa(uuid) from public;
revoke all on function private.reset_account_mfa(uuid, text) from public;
grant execute on function private.queue_mfa_mail(text, uuid, uuid, text, uuid) to tenant_guard;
grant execute on function private.remove_account_factors(uuid, uuid[]) to tenant_guard;
grant execute on function private.end_all_account_sessions(uuid, uuid, uuid) to tenant_guard;
grant execute on function private.request_live_user() to tenant_guard;
-- Called inside `set local role authenticated` transactions; each function checks the LOGIN role itself.
grant execute on function private.request_mfa_factor_mail(uuid) to authenticated;
grant execute on function private.request_mfa_removed_mail(uuid) to authenticated;
grant execute on function private.issue_mfa_factor_tokens(uuid, uuid, bytea, bytea) to authenticated;
grant execute on function private.account_has_app(uuid) to authenticated;
grant execute on function private.confirm_mfa_factor(bytea) to authenticated;
grant execute on function private.reject_mfa_factor(bytea) to authenticated;
grant execute on function private.reset_member_mfa(uuid) to authenticated;
-- Operators only: the migration role (ENTLAQA support runs the runbook as the migration role).
grant execute on function private.reset_account_mfa(uuid, text) to current_user;
grant execute on function private.actor_role_codes(uuid, uuid) to tenant_guard;
