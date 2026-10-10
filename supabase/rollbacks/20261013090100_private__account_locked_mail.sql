-- Rollback of 20261013090100_private__account_locked_mail.sql: the account-mail pipeline as T-M2-10 left it
-- (20261012110000) — its lease, kinds, shapes and request lifetimes — without `account_locked`,
-- `sign_in_unlocked` and `mfa_code_locked`; no Organization Admin unlock. Waiting requests of these kinds
-- are dropped, and held "wrong codes" notices leave the security digests (T-M2-10's digest knows only its
-- own kinds); the locks themselves are unaffected. Roll back the web app and the worker first.
delete from private.account_mail_requests where kind in ('account_locked', 'sign_in_unlocked', 'mfa_code_locked');
update private.security_notice_digests g set held = g.held - 'mfa_code_locked' where g.held ? 'mfa_code_locked';
delete from private.security_notice_digests g where g.held = '{}'::jsonb;
update private.account_mail_requests r
set detail = pg_catalog.jsonb_set(r.detail, '{held}', (r.detail -> 'held') - 'mfa_code_locked')
where r.kind = 'security_digest' and r.detail -> 'held' ? 'mfa_code_locked';
delete from private.account_mail_requests r where r.kind = 'security_digest' and r.detail -> 'held' = '{}'::jsonb;

drop function private.request_mfa_code_locked_mail(uuid, integer);
drop function private.unlock_member_sign_in(uuid, integer);
drop function private.request_sign_in_unlocked_mail(uuid);
drop function private.request_account_locked_mail(text, integer);

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
alter table private.account_mail_requests drop constraint account_mail_requests_kind_check;
alter table private.account_mail_requests add constraint account_mail_requests_kind_check
  check (kind in ('password_reset', 'password_changed', 'mfa_factor_added', 'mfa_factor_removed',
                  'security_policy_changed', 'security_digest'));
alter table private.account_mail_requests drop column lock_minutes;

drop index platform.message_deliveries_template_idx;
