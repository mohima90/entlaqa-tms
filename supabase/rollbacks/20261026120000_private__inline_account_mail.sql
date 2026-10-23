-- Rollback of 20261026120000_private__inline_account_mail.sql: account e-mails are sent by the worker only again.
-- The worker's lease as 20261013090100 left it; the cluster-wide roles are kept.

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

revoke execute on function private.email_waiting_codes() from authenticated;
drop function if exists private.recovery_target(uuid, text, text);
drop function if exists private.account_mail_consume(bytea, uuid, text, bytea, bytea);
drop function if exists private.inline_recovery_queue(uuid, text, integer, text, text, text, text, text, text, bytea);
drop function if exists private.inline_recovery_facts(uuid);
drop function if exists private.inline_account_mail_done(bytea, uuid);
drop function if exists private.inline_account_mail_queue(bytea, uuid, text, integer, text, text, text, text, bytea, bytea);
drop function if exists private.inline_account_mail_claim(bytea, integer);
drop function if exists private.inline_account_mail_tag(bytea);

create or replace function private.claim_account_mail_request()
returns table (id uuid, kind text, outcome text, email text, user_id uuid, tenant_id uuid, person_id uuid,
               locale text, attempts integer, factor_id uuid, mfa_reason text, detail jsonb, lock_minutes integer)
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
  -- Digests due (T-M2-10 final re-review L1): the notices held since an hour or more go out as one e-mail.
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
  returning r.id, r.kind, r.email, r.user_id, r.tenant_id, r.attempts, r.factor_id, r.mfa_reason, r.detail,
            r.lock_minutes
    into v_request;
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
                        null::uuid, null::text, v_request.attempts::integer, v_request.factor_id, v_request.mfa_reason,
                        v_request.detail, null::integer;
    return;
  end if;
  if v_account.banned_until is not null and v_account.banned_until > now() then
    return query select v_request.id, v_request.kind, 'banned'::text, null::text, v_account.id, null::uuid,
                        null::uuid, null::text, v_request.attempts::integer, v_request.factor_id, v_request.mfa_reason,
                        v_request.detail, null::integer;
    return;
  end if;
  if v_request.kind = 'password_reset' and v_request.attempts = 1
     and v_account.recovery_sent_at > now() - interval '60 seconds' then
    return query select v_request.id, v_request.kind, 'too_soon'::text, null::text, v_account.id, null::uuid,
                        null::uuid, null::text, v_request.attempts::integer, v_request.factor_id, v_request.mfa_reason,
                        v_request.detail, null::integer;
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
                        v_request.detail, null::integer;
    return;
  end if;
  -- A security notice over the account's daily ceiling (every organization: our delivery log) is merged
  -- into the account's next digest instead of being sent on its own — never dropped (final re-review L1).
  if v_request.kind in ('mfa_factor_added', 'mfa_factor_removed', 'security_policy_changed', 'password_changed',
                        'mfa_code_locked')
     and (select count(*) from (
            select 1 from platform.message_deliveries d
            join platform.tenant_memberships m on m.tenant_id = d.tenant_id and m.person_id = d.recipient_person_id
            where m.user_id = v_account.id and d.created_at > now() - interval '24 hours'
              and d.template in ('platform.mfa_factor_added', 'platform.mfa_factor_removed',
                                 'platform.security_policy_changed', 'platform.password_changed',
                                 'platform.mfa_code_locked', 'platform.security_digest')
            limit private.security_notice_daily_ceiling()) n) >= private.security_notice_daily_ceiling() then
    insert into private.security_notice_digests as g (user_id, tenant_id, held)
    values (v_account.id, v_member.tenant_id, jsonb_build_object(v_request.kind, 1))
    on conflict on constraint security_notice_digests_pkey do update
      set held = g.held || jsonb_build_object(v_request.kind, coalesce((g.held ->> v_request.kind)::integer, 0) + 1);
    delete from private.account_mail_requests r where r.id = v_request.id;
    return query select v_request.id, v_request.kind, 'held'::text, null::text, v_account.id, null::uuid,
                        null::uuid, null::text, v_request.attempts::integer, v_request.factor_id, v_request.mfa_reason,
                        v_request.detail, null::integer;
    return;
  end if;
  return query select v_request.id, v_request.kind, 'send'::text, v_account.email::text, v_account.id, v_member.tenant_id,
                      v_member.person_id, case when v_member.preferred_locale = 'en' then 'en' else 'ar' end,
                      v_request.attempts::integer, v_request.factor_id, v_request.mfa_reason, v_request.detail,
                      v_request.lock_minutes::integer;
end
$$;

comment on function private.claim_account_mail_request() is
  'SECURITY-RELEVANT (T-M2-17, T-M2-10, T-M2-11). Worker: leases the oldest waiting account e-mail request and resolves account, organization and language (and, for authenticator notices, the app and why; for policy-change notices, what changed and who changed it; for the lockout and wrong-codes e-mails, the pause''s minutes). Security notices over the account''s daily ceiling are held for its hourly digest (outcome held); due digests are queued. app_worker system claims only.';

drop function if exists private.account_mail_claim_core(bytea);
drop function if exists private.account_mail_base_template(text);
drop function if exists private.user_has_totp_app(uuid);
drop function if exists private.mfa_setup_issue(uuid, uuid, bytea, bytea);
drop function if exists private.mfa_setup_peek(uuid, uuid);

drop policy message_deliveries_inline_insert_account on platform.message_deliveries;
revoke select (name_ar, name_en) on platform.tenants from account_mail_guard;
revoke select (display_name_ar, display_name_en) on platform.persons from account_mail_guard;

drop index if exists private.account_mail_requests_inline_idx;
alter table private.account_mail_requests
  drop constraint account_mail_requests_inline_hash_check,
  drop column inline_claim_attempt,
  drop column resolved_person_id,
  drop column resolved_tenant_id,
  drop column resolved_email,
  drop column created_txid,
  drop column inline_claim_hash;
