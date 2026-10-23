-- «Email me a code»: a second way to sign in, instead of the password, for every user (WP-ADM-05, FR-IAM-12;
-- business flow EP-AUTH-signin-extras, PO answers 21 and 23 Oct 2026). Class: P (platform). No address is stored
-- here: a code row holds the account's id, a keyed hash of OUR six-digit code, and Auth's one-time token hash
-- sealed by the web tier.
--
-- The request asks Auth for a sign-in (`signInWithOtp`, existing users only); Auth calls the app's Send Email
-- hook (a Vercel route). The hook does NOT e-mail Auth's own token: Auth's OTP is long (10 digits) and can be
-- guessed against its public /verify, which no limiter of ours sees (security re-review H1). The hook makes
-- its own six-digit code, stores its keyed hash here with Auth's `token_hash` (sealed - encrypted by the web
-- tier with a key the database never sees), and e-mails OUR code at once through the organization's sender or
-- the platform sender. The check is ours: the typed code is compared here (5 wrong tries kill it, 10 minutes,
-- single use) behind the shared limiters, and only a right code releases the sealed token hash, which the
-- server then redeems with `verifyOtp({ token_hash, type })`. Nobody holds a short code Auth would accept.
-- The web app holds no Auth secret key.
--
--   private.sign_in_code_secret / sign_in_codes   the HMAC key and the codes (one live code per account; owner
--       of the functions: account_mail_guard; RLS forced; no other privilege).
--   private.sign_in_code_hmac(user, code)          internal.
--   private.account_sender_is_platform(user)       internal: whose sender may carry an e-mail that opens an
--       account (several active memberships, or a platform role -> the platform sender only; one organization
--       and no platform role -> that organization's own sender when it has one).
--   private.account_needs_platform_sender(user)    worker (system claims): the same answer for the reset link
--       and the authenticator set-up code.
--   private.auth_mail_account(user)                internal: organization, person, language and sender rule.
--   private.auth_mail_route(tenant)                internal: the sender settings of the organization and the
--       platform (sealed secrets included - opened only with EMAIL_CREDENTIALS_KEY) and the look. NOT callable
--       by the web app on its own (security re-review M-B): the only way to the sealed secrets is
--       auth_mail_issue, which stores a sign-in code for a real, usable account in the same call.
--   private.auth_mail_issue(user, code, sealed, type)   web app (app_server), the Send Email hook after it
--       verified the signature: stores the code (replacing the account's earlier one) and hands back account,
--       sender settings and look; no rows (nothing stored) for an account that cannot be e-mailed.
--   private.verify_sign_in_code(email, code)       web app, no session: ok (releases the sealed token hash
--       once), wrong (a try counted), killed (the 5th wrong try removed the code), none (no live code).
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
-- The codes (security re-review H1)
-- ---------------------------------------------------------------------------------------------------
create table private.sign_in_code_secret (
  id boolean primary key default true,
  inner_key bytea not null,
  outer_key bytea not null,
  created_at timestamptz not null default now(),
  constraint sign_in_code_secret_single_row check (id),
  constraint sign_in_code_secret_key_length check (octet_length(inner_key) = 64 and octet_length(outer_key) = 64)
);
comment on table private.sign_in_code_secret is
  'SECURITY-RELEVANT (WP-ADM-05). HMAC key (padded inner/outer, as the rate limiter''s) of the sign-in codes; readable by account_mail_guard only.';
insert into private.sign_in_code_secret (inner_key, outer_key)
select k.inner_key, k.outer_key from private.rate_limit_generate_keys() k;
alter table private.sign_in_code_secret enable row level security;
alter table private.sign_in_code_secret force row level security;
create policy sign_in_code_secret_guard_read on private.sign_in_code_secret for select to account_mail_guard using (true);
revoke all on private.sign_in_code_secret from public;
grant select on private.sign_in_code_secret to account_mail_guard;

create table private.sign_in_codes (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- HMAC(user id, code) under the database-held key: the six digits are never stored.
  code_hash bytea not null,
  -- Auth's one-time `token_hash` of this sign-in, ENCRYPTED by the web tier (AES-256-GCM, a key derived from
  -- SEND_EMAIL_HOOK_SECRET, bound to the account): a copy of this table is not a way into any account.
  token_hash_sealed text not null,
  -- The Auth e-mail type the token was issued for: what verifyOtp must be told.
  action_type text not null,
  tries smallint not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint sign_in_codes_code_hash_check check (octet_length(code_hash) = 32),
  constraint sign_in_codes_sealed_check check (char_length(token_hash_sealed) between 20 and 2000),
  constraint sign_in_codes_action_check check (action_type = 'magiclink'),
  constraint sign_in_codes_tries_check check (tries between 0 and 4),
  constraint sign_in_codes_life_check check (expires_at > created_at and expires_at <= created_at + interval '15 minutes')
);
comment on table private.sign_in_codes is
  'SECURITY-RELEVANT (WP-ADM-05, FR-IAM-12). One live sign-in code per account: keyed hash of the e-mailed code, the sealed Auth token hash, the tries (the 5th wrong one removes the row), the expiry (10 minutes). Only account_mail_guard''s functions reach it.';
comment on column private.sign_in_codes.token_hash_sealed is
  'Encrypted by the web tier; the database cannot read it. Released once, to the right code.';
create index sign_in_codes_expires_at_idx on private.sign_in_codes (expires_at);
alter table private.sign_in_codes enable row level security;
alter table private.sign_in_codes force row level security;
create policy sign_in_codes_guard on private.sign_in_codes for all to account_mail_guard using (true) with check (true);
revoke all on private.sign_in_codes from public;
grant select, insert, update, delete on private.sign_in_codes to account_mail_guard;

-- The keyed hash of a code, bound to its account.
create or replace function private.sign_in_code_hmac(p_user_id uuid, p_code text)
returns bytea
language sql stable security definer
set search_path = ''
as $$
  select pg_catalog.sha256(s.outer_key || pg_catalog.sha256(s.inner_key || pg_catalog.convert_to(p_user_id::text || ':' || p_code, 'UTF8')))
  from private.sign_in_code_secret s
  where s.id
$$;
comment on function private.sign_in_code_hmac(uuid, text) is
  'SECURITY-RELEVANT (WP-ADM-05). HMAC-SHA-256 of a sign-in code bound to its account, under the database-held key. Internal.';

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

-- The Send Email hook, in one call (security re-review M-B): checks the account, stores OUR code for it and hands
-- back what the e-mail needs. The sender settings (sealed secrets included) are therefore reachable only
-- together with a stored code for an account that can be e-mailed - not as a standalone read.
create or replace function private.auth_mail_issue(p_user_id uuid, p_code text, p_sealed text, p_action text)
returns table (email text, tenant_id uuid, person_id uuid, locale text, platform_sender boolean,
               tenant_provider text, tenant_options jsonb, tenant_credentials_sealed text, tenant_from_name text,
               tenant_from_address text, tenant_reply_to text, tenant_enabled boolean, tenant_version integer,
               platform_configured boolean, platform_provider text, platform_options jsonb,
               platform_credentials_sealed text, platform_from_address text, platform_verified boolean,
               platform_version integer, brand_name_ar text, brand_name_en text, default_locale text,
               action_color text, link_color text, logo_asset_id uuid)
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  a record;
  r record;
begin
  if session_user <> 'app_server' then
    raise exception 'reserved to the web app' using errcode = 'insufficient_privilege';
  end if;
  if p_code is null or p_code !~ '^[0-9]{6}$' or p_sealed is null or char_length(p_sealed) not between 20 and 2000
     or p_action is distinct from 'magiclink' then
    raise exception 'invalid sign-in code' using errcode = 'invalid_parameter_value';
  end if;
  select * into a from private.auth_mail_account(p_user_id);
  if not found then
    return;
  end if;
  select * into r from private.auth_mail_route(a.tenant_id);
  if not found then
    return;
  end if;
  delete from private.sign_in_codes c where c.expires_at < now() - interval '1 hour';
  insert into private.sign_in_codes as c (user_id, code_hash, token_hash_sealed, action_type, tries, created_at, expires_at)
  values (p_user_id, private.sign_in_code_hmac(p_user_id, p_code), p_sealed, p_action, 0, now(), now() + interval '10 minutes')
  on conflict (user_id) do update
    set code_hash = excluded.code_hash, token_hash_sealed = excluded.token_hash_sealed,
        action_type = excluded.action_type, tries = 0, created_at = excluded.created_at, expires_at = excluded.expires_at;
  return query select a.email, a.tenant_id, a.person_id, a.locale, a.platform_sender,
                      r.tenant_provider, r.tenant_options, r.tenant_credentials_sealed, r.tenant_from_name,
                      r.tenant_from_address, r.tenant_reply_to, r.tenant_enabled, r.tenant_version,
                      r.platform_configured, r.platform_provider, r.platform_options,
                      r.platform_credentials_sealed, r.platform_from_address, r.platform_verified,
                      r.platform_version, r.brand_name_ar, r.brand_name_en, r.default_locale,
                      r.action_color, r.link_color, r.logo_asset_id;
end
$$;
comment on function private.auth_mail_issue(uuid, text, text, text) is
  'SECURITY-RELEVANT (WP-ADM-05, FR-NTF-11). The Send Email hook: stores the sign-in code of an account that can be e-mailed and returns its address, organization, language, sender settings (sealed secrets included) and look. No rows: nothing stored. app_server only.';

-- Check a typed code (no session): the keyed hash is compared, a wrong one is counted, the 5th removes the code,
-- a right one is removed and releases the sealed token hash ONCE. The same work for an address without an account.
create or replace function private.verify_sign_in_code(p_email text, p_code text)
returns table (outcome text, user_id uuid, token_hash_sealed text, action_type text)
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
  v_user uuid;
  v_row private.sign_in_codes%rowtype;
  v_hash bytea;
begin
  if session_user <> 'app_server' then
    raise exception 'reserved to the web app' using errcode = 'insufficient_privilege';
  end if;
  if p_code is null or p_code !~ '^[0-9]{6}$' or v_email is null or char_length(v_email) not between 3 and 320 then
    raise exception 'invalid sign-in code request' using errcode = 'invalid_parameter_value';
  end if;
  select a.id into v_user from private.auth_account a
  where a.email = v_email and not coalesce(a.is_sso_user, false) and a.deleted_at is null
  order by a.id limit 1;
  -- Always hashed, with a placeholder account when there is none, so the work does not tell.
  v_hash := private.sign_in_code_hmac(coalesce(v_user, '00000000-0000-0000-0000-000000000000'::uuid), p_code);
  if v_user is null then
    return query select 'none'::text, null::uuid, null::text, null::text;
    return;
  end if;
  select * into v_row from private.sign_in_codes c where c.user_id = v_user for update;
  if not found then
    return query select 'none'::text, v_user, null::text, null::text;
    return;
  end if;
  if v_row.expires_at <= now() then
    delete from private.sign_in_codes c where c.user_id = v_user;
    return query select 'none'::text, v_user, null::text, null::text;
    return;
  end if;
  if v_row.code_hash = v_hash then
    delete from private.sign_in_codes c where c.user_id = v_user;
    return query select 'ok'::text, v_user, v_row.token_hash_sealed, v_row.action_type;
    return;
  end if;
  if v_row.tries + 1 >= 5 then
    delete from private.sign_in_codes c where c.user_id = v_user;
    return query select 'killed'::text, v_user, null::text, null::text;
    return;
  end if;
  update private.sign_in_codes c set tries = c.tries + 1 where c.user_id = v_user;
  return query select 'wrong'::text, v_user, null::text, null::text;
end
$$;
comment on function private.verify_sign_in_code(text, text) is
  'SECURITY-RELEVANT (WP-ADM-05, FR-IAM-12). Checks a typed sign-in code against its keyed hash: ok (code removed, sealed token hash released once), wrong (a try counted), killed (the 5th wrong try removed the code), none (no live code). app_server only.';

-- «Code sent», in the organization the e-mail came from (no code, no address).
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
alter function private.auth_mail_issue(uuid, text, text, text) owner to account_mail_guard;
alter function private.sign_in_code_hmac(uuid, text) owner to account_mail_guard;
alter function private.verify_sign_in_code(text, text) owner to account_mail_guard;
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
revoke all on function private.auth_mail_issue(uuid, text, text, text) from public;
revoke all on function private.sign_in_code_hmac(uuid, text) from public;
revoke all on function private.verify_sign_in_code(text, text) from public;
-- Called inside `set local role authenticated` transactions (claim-less for the hook); each function checks the
-- LOGIN role (session_user) itself.
grant execute on function private.account_needs_platform_sender(uuid) to authenticated;
grant execute on function private.auth_mail_issue(uuid, text, text, text) to authenticated;
grant execute on function private.verify_sign_in_code(text, text) to authenticated;
grant execute on function private.audit_sign_in_code_sent(uuid, uuid) to authenticated;
grant execute on function private.audit_sign_in_code_refused(text, boolean) to authenticated;
-- The account and sender-settings reads are INTERNAL (security re-review M-B): only auth_mail_issue (owner
-- account_mail_guard) reaches them; the web app cannot read sealed provider secrets on its own.
grant execute on function private.auth_mail_route(uuid) to account_mail_guard;
-- The sender-rule helper is called by the guard's own functions.
grant execute on function private.platform_admin_is_active(uuid) to account_mail_guard;
