-- Rollback of 20261012110000_private__mfa_factor_mail.sql: the account e-mail functions and table as in
-- 20261010120000 (no authenticator notices), without the authenticator confirmation, removal, purge and reset
-- functions and the policy-change notice.
drop trigger security_policies_changed_mail on platform.security_policies;
drop function private.security_policy_changed_mail();
drop function private.reset_account_mfa(uuid, text);
drop function private.reset_member_mfa(uuid);
drop function private.purge_unconfirmed_mfa_apps(integer);
drop function private.reject_mfa_factor(bytea);
drop function private.account_has_app(uuid);
drop function private.issue_mfa_factor_tokens(uuid, uuid, bytea, bytea);
drop function private.remove_mfa_app(uuid);
drop function private.my_mfa_apps();
drop function private.confirm_mfa_setup(uuid, text);
drop function private.request_mfa_factor_mail(uuid);
drop function private.request_live_user();
drop function private.end_all_account_sessions(uuid, uuid, uuid);
drop function private.remove_account_factors(uuid, uuid[]);
drop function private.queue_mfa_mail(text, uuid, uuid, text, uuid);
drop function private.mfa_remove_link_lifetime();
drop function private.mfa_code_resend_after();
drop function private.mfa_code_max_attempts();
drop function private.mfa_code_lifetime();

drop function private.claim_account_mail_request();
create function private.claim_account_mail_request()
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

grant create on schema private to account_mail_guard;
alter function private.claim_account_mail_request() owner to account_mail_guard;
revoke create on schema private from account_mail_guard;
revoke all on function private.claim_account_mail_request() from public;
grant execute on function private.claim_account_mail_request() to authenticated;

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
  delete from private.account_mail_requests r where r.created_at < now() - interval '60 minutes';
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
  delete from private.account_mail_requests r where r.created_at < now() - interval '60 minutes';
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

drop function private.account_mail_request_expired(text, timestamptz);

drop policy account_mail_requests_tenant_guard on private.account_mail_requests;
revoke all on private.account_mail_requests from tenant_guard;

-- No authenticator notices may wait when this runs (they would break the restored checks).
delete from private.account_mail_requests where kind in ('mfa_factor_added', 'mfa_factor_removed', 'security_policy_changed');
alter table private.account_mail_requests drop constraint account_mail_requests_mfa_reason_check;
alter table private.account_mail_requests drop constraint account_mail_requests_shape_check;
alter table private.account_mail_requests drop constraint account_mail_requests_kind_check;
alter table private.account_mail_requests drop column detail;
alter table private.account_mail_requests drop column mfa_reason;
alter table private.account_mail_requests drop column factor_id;
alter table private.account_mail_requests add constraint account_mail_requests_kind_check
  check (kind in ('password_reset', 'password_changed'));
alter table private.account_mail_requests add constraint account_mail_requests_shape_check check (
    (kind = 'password_reset' and email is not null and user_id is null and tenant_id is null)
    or (kind = 'password_changed' and email is null and user_id is not null));
