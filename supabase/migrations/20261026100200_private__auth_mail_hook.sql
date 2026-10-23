-- «Email me a code»: a second way to sign in, instead of the password, for every user (WP-ADM-05, FR-IAM-12;
-- business flow EP-AUTH-signin-extras, PO answers 21 and 23 Oct 2026). Class: P (platform). No personal data is
-- stored here: the code lives in Supabase Auth (its e-mail OTP, 6 digits, 10 minutes), this migration only holds
-- what the Send Email hook and the audit need.
--
-- The request asks Auth for the code (`signInWithOtp`, existing users only); Auth calls the app's Send Email
-- hook (a Vercel route) which e-mails the code AT ONCE through the organization's sender or the platform
-- sender; the check is Auth's `verifyOtp`. Our own limits (per client, per address, all clients, a pause after
-- 5 wrong codes) run before Auth is asked, on the shared PostgreSQL limiter (no table needed). The web app holds
-- no Auth secret key.
--
--   private.account_sender_is_platform(user)       internal: whose sender may carry an e-mail that opens an
--       account (several active memberships, or a platform role -> the platform sender only; one organization
--       and no platform role -> that organization's own sender when it has one).
--   private.account_needs_platform_sender(user)    worker (system claims): the same answer for the reset link
--       and the authenticator set-up code.
--   private.auth_mail_account(user)                web app (app_server), the Send Email hook after it verified
--       the signature: organization, person, language and sender rule of the account.
--   private.auth_mail_route(tenant)                web app, the hook: the sender settings of the organization
--       and the platform (sealed secrets included - opened only with EMAIL_CREDENTIALS_KEY) and the look.
--   private.audit_sign_in_code_sent(user, tenant)  web app, the hook, after the e-mail was handed to the sender.
--   private.audit_sign_in_code_refused(email, killed)  web app: a wrong code (BR-AUTH-i); nothing for an address
--       without an account; no code and no address in the event.
-- Expand-first: new objects only.

grant account_mail_guard to current_user;
grant email_guard to current_user;

-- ---------------------------------------------------------------------------------------------------
-- Audit events written by account_mail_guard
-- ---------------------------------------------------------------------------------------------------
create policy audit_events_account_mail_guard_insert on platform.audit_events for insert to account_mail_guard
  with check (action in ('platform.auth.sign_in_code_sent', 'platform.auth.sign_in_code_refused')
              and impersonator_user_id is null);
grant insert (tenant_id, actor_user_id, actor_person_id, action, entity_type, entity_id, data)
  on platform.audit_events to account_mail_guard;

-- ---------------------------------------------------------------------------------------------------
-- Whose sender may carry an e-mail that opens an account
-- ---------------------------------------------------------------------------------------------------
create or replace function private.account_sender_is_platform(p_user_id uuid)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    return true;
  end if;
  return (select count(*) from platform.tenant_memberships m
          where m.user_id = p_user_id and m.status = 'active') > 1
         or private.platform_admin_is_active(p_user_id);
end
$$;
comment on function private.account_sender_is_platform(uuid) is
  'SECURITY-RELEVANT (WP-ADM-05 review). True when an e-mail that opens an account must go through the platform sender only: several active memberships or a platform role. Internal.';

create or replace function private.account_needs_platform_sender(p_user_id uuid)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_claims jsonb := private.request_claims();
begin
  if session_user <> 'app_worker' or coalesce(v_claims ->> 'role', '') <> 'system' then
    raise exception 'reserved to the worker' using errcode = 'insufficient_privilege';
  end if;
  return private.account_sender_is_platform(p_user_id);
end
$$;
comment on function private.account_needs_platform_sender(uuid) is
  'SECURITY-RELEVANT (WP-ADM-05 review). True when the reset link or the authenticator set-up code of this account must go through the platform sender only. app_worker, system claims.';

-- ---------------------------------------------------------------------------------------------------
-- The Send Email hook
-- ---------------------------------------------------------------------------------------------------
-- The account Auth is sending to: its address as Auth stores it, the organization whose look and language the
-- e-mail uses (the one most recently selected in a sign-in session, else the oldest active membership - the
-- rule of the other account e-mails), the person and whether the platform sender must carry it. No row: no
-- account, a banned one, or no usable membership - the hook then sends nothing.
create or replace function private.auth_mail_account(p_user_id uuid)
returns table (email text, tenant_id uuid, person_id uuid, locale text, platform_sender boolean)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_account record;
  v_member record;
begin
  if session_user <> 'app_server' then
    raise exception 'reserved to the web app' using errcode = 'insufficient_privilege';
  end if;
  select a.id, a.email, a.banned_until into v_account from private.auth_account a
  where a.id = p_user_id and not coalesce(a.is_sso_user, false) and a.deleted_at is null;
  if v_account.id is null or v_account.email is null
     or (v_account.banned_until is not null and v_account.banned_until > now()) then
    return;
  end if;
  select m.tenant_id, m.person_id, p.preferred_locale into v_member
  from platform.tenant_memberships m
  join platform.tenants t on t.id = m.tenant_id
  join platform.persons p on p.tenant_id = m.tenant_id and p.id = m.person_id
  where m.user_id = v_account.id and m.status = 'active' and t.status in ('active', 'trial') and p.status = 'active'
  order by (select max(c.updated_at) from platform.session_context c
            where c.user_id = m.user_id and c.active_tenant_id = m.tenant_id) desc nulls last,
           m.created_at, m.tenant_id
  limit 1;
  if v_member.tenant_id is null then
    return;
  end if;
  return query select v_account.email::text, v_member.tenant_id, v_member.person_id,
                      case when v_member.preferred_locale = 'en' then 'en' else 'ar' end,
                      private.account_sender_is_platform(v_account.id);
end
$$;
comment on function private.auth_mail_account(uuid) is
  'SECURITY-RELEVANT (WP-ADM-05). The Send Email hook: address, organization, person, language and sender rule of the account Auth is e-mailing. app_server only (the route verifies Auth''s signature first).';

-- The sender rule's inputs for one organization, as private.email_route() gives them to the worker, plus the
-- organization's look for the e-mail. Sealed secrets can be opened only with the key the hook route holds.
create or replace function private.auth_mail_route(p_tenant_id uuid)
returns table (tenant_provider text, tenant_options jsonb, tenant_credentials_sealed text, tenant_from_name text,
               tenant_from_address text, tenant_reply_to text, tenant_enabled boolean, tenant_version integer,
               platform_configured boolean, platform_provider text, platform_options jsonb,
               platform_credentials_sealed text, platform_from_address text, platform_verified boolean,
               platform_version integer, brand_name_ar text, brand_name_en text, default_locale text,
               action_color text, link_color text, logo_asset_id uuid)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if session_user <> 'app_server' then
    raise exception 'reserved to the web app' using errcode = 'insufficient_privilege';
  end if;
  return query
    select s.provider, s.options, s.credentials_sealed, s.from_name, s.from_address, s.reply_to,
           coalesce(s.enabled and s.status = 'verified', false), s.version,
           p.id is not null, p.provider, p.options, p.credentials_sealed, p.from_address,
           coalesce(p.status = 'verified', false), p.version,
           t.name_ar, t.name_en, coalesce(ts.default_locale, 'en'),
           b.email_action_color, b.email_link_color,
           (select a.id from platform.brand_assets a where a.tenant_id = b.tenant_id and a.file_id = b.logo_file_id)
    from platform.tenants t
    left join platform.tenant_settings ts on ts.tenant_id = t.id
    left join private.tenant_email_settings s on s.tenant_id = t.id
    left join private.platform_email_settings p on p.id = 1
    left join platform.tenant_branding b on b.tenant_id = t.id
    where t.id = p_tenant_id and t.status in ('active', 'trial');
end
$$;
comment on function private.auth_mail_route(uuid) is
  'SECURITY-RELEVANT (WP-ADM-05, FR-NTF-11). The sender rule''s inputs (sealed secrets included) and the look for one active organization, for the Send Email hook. app_server only.';

-- «Code sent» in each organization of the account's... the one the e-mail came from (no code, no address).
create or replace function private.audit_sign_in_code_sent(p_user_id uuid, p_tenant_id uuid)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  if session_user <> 'app_server' then
    raise exception 'reserved to the web app' using errcode = 'insufficient_privilege';
  end if;
  insert into platform.audit_events (tenant_id, actor_user_id, actor_person_id, action, entity_type, entity_id, data)
  select p_tenant_id, p_user_id, m.person_id, 'platform.auth.sign_in_code_sent', 'user', p_user_id::text,
         jsonb_build_object('method', 'email_code')
  from platform.tenant_memberships m
  where m.tenant_id = p_tenant_id and m.user_id = p_user_id and m.status = 'active';
end
$$;
comment on function private.audit_sign_in_code_sent(uuid, uuid) is
  'SECURITY-RELEVANT (WP-ADM-05). Audits "sign-in code sent" in the organization (no code, no address). app_server only.';

-- A wrong code (BR-AUTH-i): in each organization of the account typed; nothing for an address without one.
create or replace function private.audit_sign_in_code_refused(p_email text, p_killed boolean)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
  v_user uuid;
begin
  if session_user <> 'app_server' then
    raise exception 'reserved to the web app' using errcode = 'insufficient_privilege';
  end if;
  select a.id into v_user from private.auth_account a
  where a.email = v_email and not coalesce(a.is_sso_user, false) and a.deleted_at is null
  order by a.id limit 1;
  if v_user is null then
    return;
  end if;
  insert into platform.audit_events (tenant_id, actor_user_id, actor_person_id, action, entity_type, entity_id, data)
  select m.tenant_id, v_user, m.person_id, 'platform.auth.sign_in_code_refused', 'user', v_user::text,
         jsonb_build_object('method', 'email_code', 'killed', coalesce(p_killed, false))
  from platform.tenant_memberships m
  join platform.tenants t on t.id = m.tenant_id
  where m.user_id = v_user and m.status = 'active' and t.status in ('active', 'trial');
end
$$;
comment on function private.audit_sign_in_code_refused(text, boolean) is
  'SECURITY-RELEVANT (WP-ADM-05). Audits a refused sign-in code in the account''s organizations (no code, no address). app_server only.';

-- ---------------------------------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------------------------------
-- The look of the e-mail: the organization's e-mail colours and logo (read by the sender's guard only).
create policy tenant_branding_email_guard_read on platform.tenant_branding for select to email_guard using (true);
grant select (tenant_id, email_action_color, email_link_color, logo_file_id) on platform.tenant_branding to email_guard;
create policy brand_assets_email_guard_read on platform.brand_assets for select to email_guard using (true);
grant select (id, tenant_id, file_id) on platform.brand_assets to email_guard;

-- Ownership hand-over as in migration 20260930120100 (non-superuser migration role on hosted Supabase).
grant create on schema private to account_mail_guard, email_guard;
alter function private.account_sender_is_platform(uuid) owner to account_mail_guard;
alter function private.account_needs_platform_sender(uuid) owner to account_mail_guard;
alter function private.auth_mail_account(uuid) owner to account_mail_guard;
alter function private.audit_sign_in_code_sent(uuid, uuid) owner to account_mail_guard;
alter function private.audit_sign_in_code_refused(text, boolean) owner to account_mail_guard;
alter function private.auth_mail_route(uuid) owner to email_guard;
revoke create on schema private from account_mail_guard, email_guard;

revoke all on function private.account_sender_is_platform(uuid) from public;
revoke all on function private.account_needs_platform_sender(uuid) from public;
revoke all on function private.auth_mail_account(uuid) from public;
revoke all on function private.audit_sign_in_code_sent(uuid, uuid) from public;
revoke all on function private.audit_sign_in_code_refused(text, boolean) from public;
revoke all on function private.auth_mail_route(uuid) from public;
-- Called inside `set local role authenticated` transactions (claim-less for the hook); each function checks the
-- LOGIN role (session_user) itself.
grant execute on function private.account_needs_platform_sender(uuid) to authenticated;
grant execute on function private.auth_mail_account(uuid) to authenticated;
grant execute on function private.audit_sign_in_code_sent(uuid, uuid) to authenticated;
grant execute on function private.audit_sign_in_code_refused(text, boolean) to authenticated;
grant execute on function private.auth_mail_route(uuid) to authenticated;
-- The sender-rule helper is called by the guard's own functions.
grant execute on function private.platform_admin_is_active(uuid) to account_mail_guard;
