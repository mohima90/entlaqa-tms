-- «Email me a code»: a second way to sign in, instead of the password, for every user (WP-ADM-05, FR-IAM-12;
-- business flow EP-AUTH-signin-extras, PO answers 21 Oct and 23 Oct 2026). Class: P (platform).
-- PII: the address typed on the sign-in page, until the code is used or expires (minutes, at most 30) -
-- never in events, job payloads, logs or the audit trail.
--
-- The rules: 6 digits, valid 10 minutes, single use; 5 wrong tries kill the code; a new code at most once a
-- minute per address; the answer is the same whether or not the address has an account (the request row is
-- written unconditionally; the WORKER decides, and an unknown address gets a row that no code can ever
-- match, with the same tries and the same expiry); only a keyed hash of the code is stored (HMAC-SHA-256 of
-- id and code under a key that lives in this database); nothing here ever logs a code.
--
--   private.sign_in_codes   platform-level queue and state of sign-in codes (no tenant yet: the person is not
--                           signed in). Reached only through the functions below (owner account_mail_guard,
--                           the account-mail family; RLS forced, no other privilege).
--       mode `code`        the person asked for a code by e-mail; the worker mints a one-time Auth sign-in
--                          token (the Auth secret key stays in the worker, ADR 0002 §7), generates the code,
--                          stores code HASH and token here and e-mails the code in the organization's look
--                          through the organization's own sender (or the platform sender).
--       mode `remembered`  the browser presented a remembered-browser cookie that is valid for this account
--                          (private.remembered_browser_ok): no code is e-mailed; the worker only mints the
--                          token and the web app takes it after re-checking the browser.
--   private.sign_in_code_secret  the HMAC key (one row; readable by account_mail_guard only).
--   private.sign_in_code_hmac(id, code)                          internal.
--   private.request_sign_in_code(email, remember_hash)           web app (app_server), no session.
--   private.verify_sign_in_code(id, email, code)                 web app (app_server), no session: ok (hands
--                          out the token once), wrong (tries left are counted by the application's limiter),
--                          locked (5 wrong tries), expired (also: used, replaced, unknown, another address).
--   private.take_remembered_sign_in(id, email, remember_hash)    web app: pending | ok | gone.
--   private.claim_sign_in_code_request() / issue_sign_in_code(…) / sign_in_code_dead_end(id) /
--   retry_sign_in_code_request(id)                               worker (app_worker, system claims).
-- Expand-first: new objects only.

-- ---------------------------------------------------------------------------------------------------
-- The key
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

-- ---------------------------------------------------------------------------------------------------
-- The codes
-- ---------------------------------------------------------------------------------------------------
create table private.sign_in_codes (
  id uuid primary key default gen_random_uuid(),
  mode text not null,
  -- The address typed (lower-case, trimmed). PII; the row lives at most 30 minutes.
  email text not null,
  -- The account: set by the request for a remembered browser, by the worker when the code is issued.
  user_id uuid,
  tenant_id uuid references platform.tenants (id),
  -- remembered: SHA-256 of the cookie's token, re-checked when the token is taken.
  remember_hash bytea,
  state text not null default 'requested',
  -- HMAC(id, code); null for an address without an account (nothing can match).
  code_hash bytea,
  -- The one-time Auth sign-in token minted by the worker; cleared when taken or dead.
  link_token text,
  tries smallint not null default 0,
  created_at timestamptz not null default now(),
  issued_at timestamptz,
  expires_at timestamptz,
  -- Worker bookkeeping, as private.account_mail_requests.
  attempts smallint not null default 0,
  not_before timestamptz not null default now(),
  leased_until timestamptz,
  constraint sign_in_codes_mode_check check (mode in ('code', 'remembered')),
  constraint sign_in_codes_state_check check (state in ('requested', 'issued', 'locked')),
  constraint sign_in_codes_email_check check (
    char_length(email) between 3 and 320 and email = lower(email) and email ~ '^[^@\s]+@[^@\s]+$'),
  constraint sign_in_codes_tries_check check (tries between 0 and 5),
  constraint sign_in_codes_attempts_check check (attempts between 0 and 100),
  constraint sign_in_codes_code_hash_check check (code_hash is null or octet_length(code_hash) = 32),
  constraint sign_in_codes_remember_check check (
    (mode = 'remembered' and user_id is not null and remember_hash is not null and octet_length(remember_hash) = 32)
    or (mode = 'code' and remember_hash is null)),
  constraint sign_in_codes_token_check check (link_token is null or char_length(link_token) between 16 and 200)
);
comment on table private.sign_in_codes is
  'SECURITY-RELEVANT (WP-ADM-05, FR-IAM-12). Sign-in codes by e-mail: the request, the keyed hash of the code, the one-time Auth token, the tries. Only account_mail_guard''s functions reach it. Rows live at most 30 minutes.';
comment on column private.sign_in_codes.email is 'pii:direct - until the code is used or expires';

create index sign_in_codes_waiting_idx on private.sign_in_codes (created_at) where state = 'requested';
create index sign_in_codes_email_idx on private.sign_in_codes (email, created_at desc);

alter table private.sign_in_codes enable row level security;
alter table private.sign_in_codes force row level security;
create policy sign_in_codes_guard on private.sign_in_codes for all to account_mail_guard using (true) with check (true);
revoke all on private.sign_in_codes from public;
grant select, insert, update, delete on private.sign_in_codes to account_mail_guard;

-- A new request wakes the workers like a new event (channel jadarat_events, ADR 0004 §4).
create trigger sign_in_codes_notify after insert on private.sign_in_codes
  for each statement execute function private.notify_event_dispatcher();

-- ---------------------------------------------------------------------------------------------------
-- Internal: the keyed hash of a code, bound to its request
-- ---------------------------------------------------------------------------------------------------
create or replace function private.sign_in_code_hmac(p_id uuid, p_code text)
returns bytea
language sql stable security definer
set search_path = ''
as $$
  select pg_catalog.sha256(s.outer_key || pg_catalog.sha256(s.inner_key || pg_catalog.convert_to(p_id::text || ':' || p_code, 'UTF8')))
  from private.sign_in_code_secret s
  where s.id
$$;
comment on function private.sign_in_code_hmac(uuid, text) is
  'SECURITY-RELEVANT (WP-ADM-05). HMAC-SHA-256 of a sign-in code bound to its request id, under the database-held key. Called by account_mail_guard''s functions only.';

-- ---------------------------------------------------------------------------------------------------
-- Web app: «Email me a code» (no session). Always answers with a request id, whether or not the address
-- has an account; `too_soon` (a code was requested less than a minute ago for this address) answers no id.
-- ---------------------------------------------------------------------------------------------------
create or replace function private.request_sign_in_code(p_email text, p_remember_hash bytea default null)
returns table (request_id uuid, outcome text, retry_after integer)
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
  v_recent timestamptz;
  v_user uuid;
  v_ok boolean;
  v_id uuid;
begin
  if session_user <> 'app_server' then
    raise exception 'reserved to the web app' using errcode = 'insufficient_privilege';
  end if;
  delete from private.sign_in_codes c where c.created_at < now() - interval '30 minutes';
  if v_email is null or char_length(v_email) not between 3 and 320 or v_email !~ '^[^@\s]+@[^@\s]+$'
     or (p_remember_hash is not null and octet_length(p_remember_hash) <> 32) then
    -- Nothing is queued, the answer is the same.
    return query select gen_random_uuid(), 'queued'::text, 0;
    return;
  end if;
  if (select count(*) from (select 1 from private.sign_in_codes limit 10000) w) >= 10000 then
    -- A flood while no worker runs cannot grow the table. The person gets the same answer; the caller logs the
    -- outcome `full` (security review L5), which is never shown.
    return query select gen_random_uuid(), 'full'::text, 0;
    return;
  end if;
  -- One request at a time per address (security review L4): the one-a-minute rule cannot be raced.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('jadarat.sign_in_code:' || v_email, 0));
  select max(c.created_at) into v_recent from private.sign_in_codes c where c.email = v_email and c.mode = 'code';
  if v_recent is not null and v_recent > now() - interval '60 seconds' then
    return query select null::uuid, 'too_soon'::text,
                        greatest(1, ceil(extract(epoch from (v_recent + interval '60 seconds' - now())))::integer);
    return;
  end if;
  if p_remember_hash is not null then
    select a.id into v_user from private.auth_account a
    where a.email = v_email and not coalesce(a.is_sso_user, false) and a.deleted_at is null
    order by a.id limit 1;
    -- Always evaluated, with a placeholder when there is no account, so the work does not tell (review L1).
    v_ok := private.remembered_browser_ok(coalesce(v_user, '00000000-0000-0000-0000-000000000000'::uuid), p_remember_hash);
    if v_user is not null and v_ok then
      insert into private.sign_in_codes (mode, email, user_id, remember_hash)
      values ('remembered', v_email, v_user, p_remember_hash) returning id into v_id;
      return query select v_id, 'remembered'::text, 0;
      return;
    end if;
  end if;
  insert into private.sign_in_codes (mode, email) values ('code', v_email) returning id into v_id;
  return query select v_id, 'queued'::text, 0;
end
$$;
comment on function private.request_sign_in_code(text, bytea) is
  'SECURITY-RELEVANT (WP-ADM-05). Queues a sign-in code for the typed address unconditionally (no account lookup, but for a valid remembered browser, which then needs no code); at most one per address a minute. app_server only.';

-- ---------------------------------------------------------------------------------------------------
-- Web app: check a code (no session)
-- ---------------------------------------------------------------------------------------------------
create or replace function private.verify_sign_in_code(p_id uuid, p_email text, p_code text)
returns table (outcome text, link_token text)
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
  v_row private.sign_in_codes%rowtype;
  v_hash bytea;
begin
  if session_user <> 'app_server' then
    raise exception 'reserved to the web app' using errcode = 'insufficient_privilege';
  end if;
  if p_code is null or p_code !~ '^[0-9]{6}$' or p_id is null or v_email is null then
    raise exception 'invalid sign-in code request' using errcode = 'invalid_parameter_value';
  end if;
  select * into v_row from private.sign_in_codes c
  where c.id = p_id and c.mode = 'code' and c.email = v_email
  for update;
  -- Unknown, another address, expired (10 minutes after issue; a request nobody answered, 10 after it was made).
  if not found or coalesce(v_row.expires_at, v_row.created_at + interval '10 minutes') <= now() then
    if found then
      delete from private.sign_in_codes c where c.id = p_id;
    end if;
    return query select 'expired'::text, null::text;
    return;
  end if;
  if v_row.state = 'locked' then
    return query select 'locked'::text, null::text;
    return;
  end if;
  v_hash := private.sign_in_code_hmac(v_row.id, p_code);
  if v_row.code_hash is not null and v_row.code_hash = v_hash then
    -- Single use: the row goes, the token is handed out once.
    delete from private.sign_in_codes c where c.id = p_id;
    return query select 'ok'::text, v_row.link_token;
    return;
  end if;
  update private.sign_in_codes c
  set tries = c.tries + 1,
      state = case when c.tries + 1 >= 5 then 'locked' else c.state end,
      link_token = case when c.tries + 1 >= 5 then null else c.link_token end
  where c.id = p_id
  returning c.state into v_row.state;
  -- "Code refused" in the organization's audit trail (BR-AUTH-i, security review L6) - only for an account that has
  -- a code (an address without one has no organization); no code, no address.
  if v_row.user_id is not null and v_row.tenant_id is not null then
    insert into platform.audit_events (tenant_id, actor_user_id, actor_person_id, action, entity_type, entity_id, data)
    select v_row.tenant_id, v_row.user_id, m.person_id, 'platform.auth.sign_in_code_refused', 'user', v_row.user_id::text,
           jsonb_build_object('method', 'email_code', 'killed', v_row.state = 'locked')
    from platform.tenant_memberships m
    where m.tenant_id = v_row.tenant_id and m.user_id = v_row.user_id and m.status = 'active';
  end if;
  return query select case when v_row.state = 'locked' then 'locked' else 'wrong' end, null::text;
end
$$;
comment on function private.verify_sign_in_code(uuid, text, text) is
  'SECURITY-RELEVANT (WP-ADM-05). Checks a sign-in code against its keyed hash: ok (token handed out once, the row removed), wrong (a try counted; the 5th kills the code), locked, expired. app_server only.';

-- ---------------------------------------------------------------------------------------------------
-- Web app: take the sign-in token of a remembered browser (no session)
-- ---------------------------------------------------------------------------------------------------
create or replace function private.take_remembered_sign_in(p_id uuid, p_email text, p_remember_hash bytea, p_new_hash bytea)
returns table (outcome text, link_token text)
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
  v_row private.sign_in_codes%rowtype;
begin
  if session_user <> 'app_server' then
    raise exception 'reserved to the web app' using errcode = 'insufficient_privilege';
  end if;
  if p_id is null or v_email is null or p_remember_hash is null or octet_length(p_remember_hash) <> 32
     or p_new_hash is null or octet_length(p_new_hash) <> 32 or p_new_hash = p_remember_hash then
    raise exception 'invalid remembered sign-in request' using errcode = 'invalid_parameter_value';
  end if;
  select * into v_row from private.sign_in_codes c
  where c.id = p_id and c.mode = 'remembered' and c.email = v_email and c.remember_hash = p_remember_hash
  for update;
  if not found then
    return query select 'gone'::text, null::text;
    return;
  end if;
  if v_row.created_at < now() - interval '5 minutes' or (v_row.expires_at is not null and v_row.expires_at <= now()) then
    delete from private.sign_in_codes c where c.id = p_id;
    return query select 'gone'::text, null::text;
    return;
  end if;
  if v_row.state <> 'issued' or v_row.link_token is null then
    return query select 'pending'::text, null::text;
    return;
  end if;
  -- The browser may have been forgotten, or the organization's setting shortened, since the request.
  delete from private.sign_in_codes c where c.id = p_id;
  if not private.remembered_browser_ok(v_row.user_id, p_remember_hash) then
    return query select 'gone'::text, null::text;
    return;
  end if;
  -- The token is rotated on every use (security review H2): the browser gets the new one with this answer, the old
  -- one is useless from now on. The dates are not extended.
  update platform.remembered_browsers r set last_used_at = now(), token_hash = p_new_hash
  where r.user_id = v_row.user_id and r.token_hash = p_remember_hash;
  return query select 'ok'::text, v_row.link_token;
end
$$;
comment on function private.take_remembered_sign_in(uuid, text, bytea, bytea) is
  'SECURITY-RELEVANT (WP-ADM-05). Hands out the minted sign-in token of a remembered browser once, after checking again that the browser is still remembered, and replaces the browser''s token hash with a new one. app_server only.';

-- Web app: is this browser remembered for the typed address? (security review M3: such a browser is not stopped by
-- the address's pause of code checks.) Only a browser that already proved the account learns anything.
create or replace function private.remembered_browser_for_email(p_email text, p_hash bytea)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
  v_user uuid;
begin
  if session_user <> 'app_server' then
    raise exception 'reserved to the web app' using errcode = 'insufficient_privilege';
  end if;
  if v_email is null or p_hash is null or octet_length(p_hash) <> 32 then
    return false;
  end if;
  select a.id into v_user from private.auth_account a
  where a.email = v_email and not coalesce(a.is_sso_user, false) and a.deleted_at is null
  order by a.id limit 1;
  return private.remembered_browser_ok(coalesce(v_user, '00000000-0000-0000-0000-000000000000'::uuid), p_hash)
         and v_user is not null;
end
$$;
comment on function private.remembered_browser_for_email(text, bytea) is
  'SECURITY-RELEVANT (WP-ADM-05). Is the browser (token hash) remembered for the account with this address? app_server only.';

-- ---------------------------------------------------------------------------------------------------
-- Worker: lease the oldest waiting request and say whom to write (as private.claim_account_mail_request)
--   outcome  send            tenant, person, language and address to write to (or, for a remembered
--                            browser, whose token to mint)
--            unknown_account no Auth account with that address (or the account is gone)
--            banned          the account is banned in Auth
--            no_membership   no active membership in an active or trial organization
-- ---------------------------------------------------------------------------------------------------
create or replace function private.claim_sign_in_code_request()
returns table (id uuid, mode text, outcome text, email text, user_id uuid, tenant_id uuid, person_id uuid,
               locale text, attempts integer, platform_sender boolean)
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_claims jsonb := private.request_claims();
  v_request record;
  v_account record;
  v_member record;
  v_platform boolean;
begin
  if session_user <> 'app_worker' or coalesce(v_claims ->> 'role', '') <> 'system'
     or coalesce(btrim(v_claims ->> 'job_id'), '') = '' then
    raise exception 'reserved to the worker' using errcode = 'insufficient_privilege';
  end if;
  delete from private.sign_in_codes r
  where r.created_at < now() - interval '30 minutes' or (r.attempts >= 5 and coalesce(r.leased_until, now()) <= now());

  update private.sign_in_codes r
  set leased_until = now() + interval '2 minutes', attempts = r.attempts + 1
  where r.id = (select w.id from private.sign_in_codes w
                where w.state = 'requested' and w.created_at > now() - interval '10 minutes'
                  and w.not_before <= now() and (w.leased_until is null or w.leased_until <= now())
                order by w.created_at, w.id
                limit 1
                for update skip locked)
  returning r.id, r.mode, r.email, r.user_id, r.attempts into v_request;
  if not found then
    return;
  end if;

  if v_request.mode = 'remembered' then
    select a.id, a.email, a.banned_until into v_account from private.auth_account a
    where a.id = v_request.user_id and a.deleted_at is null;
  else
    select a.id, a.email, a.banned_until into v_account from private.auth_account a
    where a.email = v_request.email and not coalesce(a.is_sso_user, false) and a.deleted_at is null
    order by a.id limit 1;
  end if;
  if v_account.id is null or v_account.email is null then
    return query select v_request.id, v_request.mode, 'unknown_account'::text, null::text, null::uuid, null::uuid,
                        null::uuid, null::text, v_request.attempts::integer, false;
    return;
  end if;
  if v_account.banned_until is not null and v_account.banned_until > now() then
    return query select v_request.id, v_request.mode, 'banned'::text, null::text, null::uuid, null::uuid,
                        null::uuid, null::text, v_request.attempts::integer, false;
    return;
  end if;
  -- The organization whose look, sender and language the e-mail uses: the one most recently selected in a
  -- sign-in session, else the oldest active membership (the rule of the other account e-mails).
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
    return query select v_request.id, v_request.mode, 'no_membership'::text, null::text, null::uuid, null::uuid,
                        null::uuid, null::text, v_request.attempts::integer, false;
    return;
  end if;
  -- Whose sender may carry the code (security review M1): the organization's own only when the person belongs to
  -- exactly this one organization and holds no platform role; otherwise the platform sender, so one organization's
  -- mail server never sees the codes of an account that signs in to others.
  v_platform := (select count(*) from platform.tenant_memberships m2 join platform.tenants t2 on t2.id = m2.tenant_id
                 where m2.user_id = v_account.id and m2.status = 'active' and t2.status in ('active', 'trial')) > 1
                or private.platform_admin_is_active(v_account.id);
  return query select v_request.id, v_request.mode, 'send'::text, v_account.email::text, v_account.id,
                      v_member.tenant_id, v_member.person_id,
                      case when v_member.preferred_locale = 'en' then 'en' else 'ar' end,
                      v_request.attempts::integer, v_platform;
end
$$;
comment on function private.claim_sign_in_code_request() is
  'SECURITY-RELEVANT (WP-ADM-05). Worker: leases the oldest waiting sign-in code request and resolves account, organization and language. app_worker system claims only.';

-- Worker: the code (or, for a remembered browser, only the token) is ready. Stores the keyed hash, the
-- token and the expiry (10 minutes; a remembered browser's token: 5), replaces every older code of the
-- address ("only the newest code works") and audits "code sent" in the organization (no code, no address).
create or replace function private.issue_sign_in_code(p_id uuid, p_user_id uuid, p_tenant_id uuid, p_code text,
                                                      p_link_token text)
returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_claims jsonb := private.request_claims();
  v_row private.sign_in_codes%rowtype;
begin
  if session_user <> 'app_worker' or coalesce(v_claims ->> 'role', '') <> 'system'
     or coalesce(btrim(v_claims ->> 'job_id'), '') = '' then
    raise exception 'reserved to the worker' using errcode = 'insufficient_privilege';
  end if;
  if p_link_token is null or char_length(p_link_token) not between 16 and 200 then
    raise exception 'invalid sign-in token' using errcode = 'invalid_parameter_value';
  end if;
  select * into v_row from private.sign_in_codes c where c.id = p_id and c.state = 'requested' for update;
  if not found then
    return false;
  end if;
  if v_row.mode = 'code' then
    if p_code is null or p_code !~ '^[0-9]{6}$' then
      raise exception 'invalid sign-in code' using errcode = 'invalid_parameter_value';
    end if;
    -- Only the newest code works: every older request of the address goes (a newer one still waiting stays).
    delete from private.sign_in_codes c
    where c.email = v_row.email and c.mode = 'code' and (c.created_at, c.id) < (v_row.created_at, v_row.id);
    update private.sign_in_codes c
    set state = 'issued', code_hash = private.sign_in_code_hmac(p_id, p_code), link_token = p_link_token,
        user_id = p_user_id, tenant_id = p_tenant_id, issued_at = now(), expires_at = now() + interval '10 minutes',
        tries = 0, leased_until = null
    where c.id = p_id;
    insert into platform.audit_events (tenant_id, actor_user_id, actor_person_id, action, entity_type, entity_id, data)
    select p_tenant_id, p_user_id, m.person_id, 'platform.auth.sign_in_code_sent', 'user', p_user_id::text,
           jsonb_build_object('method', 'email_code')
    from platform.tenant_memberships m
    where m.tenant_id = p_tenant_id and m.user_id = p_user_id and m.status = 'active';
  else
    update private.sign_in_codes c
    set state = 'issued', link_token = p_link_token, tenant_id = p_tenant_id, issued_at = now(),
        expires_at = now() + interval '5 minutes', leased_until = null
    where c.id = p_id;
  end if;
  return true;
end
$$;
comment on function private.issue_sign_in_code(uuid, uuid, uuid, text, text) is
  'SECURITY-RELEVANT (WP-ADM-05). Worker: stores the keyed hash of a new code and its one-time Auth token, replaces older codes of the address, audits "code sent". app_worker system claims only.';

-- Worker: an address nobody can sign in with. The row stays, looks like any other (same tries, same expiry),
-- and no code can ever match - the screen is the same whether or not the address has an account.
create or replace function private.sign_in_code_dead_end(p_id uuid)
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
  delete from private.sign_in_codes c where c.id = p_id and c.mode = 'remembered';
  update private.sign_in_codes c
  set state = 'issued', code_hash = null, link_token = null, issued_at = now(),
      expires_at = c.created_at + interval '10 minutes', leased_until = null
  where c.id = p_id and c.state = 'requested';
  return found;
end
$$;
comment on function private.sign_in_code_dead_end(uuid) is
  'SECURITY-RELEVANT (WP-ADM-05). Worker: answers a request for an address with no usable account without any code (the row looks like any other until it expires). app_worker system claims only.';

-- Worker: a temporary failure (Auth, the database): try again later, at most 5 attempts.
create or replace function private.retry_sign_in_code_request(p_id uuid)
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
  select r.attempts into v_attempts from private.sign_in_codes r where r.id = p_id for update;
  if not found then
    return false;
  end if;
  if v_attempts >= 5 then
    delete from private.sign_in_codes r where r.id = p_id;
    return false;
  end if;
  update private.sign_in_codes r
  set leased_until = null, not_before = now() + make_interval(secs => 5 * power(2, greatest(v_attempts - 1, 0)))
  where r.id = p_id;
  return true;
end
$$;
comment on function private.retry_sign_in_code_request(uuid) is
  'SECURITY-RELEVANT (WP-ADM-05). Worker: puts a sign-in code request back after a temporary failure (back-off), or removes it after 5 attempts. app_worker system claims only.';

-- Ownership hand-over as in migration 20260930120100 (non-superuser migration role on hosted Supabase).
grant create on schema private to account_mail_guard;
alter function private.sign_in_code_hmac(uuid, text) owner to account_mail_guard;
alter function private.request_sign_in_code(text, bytea) owner to account_mail_guard;
alter function private.verify_sign_in_code(uuid, text, text) owner to account_mail_guard;
alter function private.take_remembered_sign_in(uuid, text, bytea, bytea) owner to account_mail_guard;
alter function private.remembered_browser_for_email(text, bytea) owner to account_mail_guard;
alter function private.claim_sign_in_code_request() owner to account_mail_guard;
alter function private.issue_sign_in_code(uuid, uuid, uuid, text, text) owner to account_mail_guard;
alter function private.sign_in_code_dead_end(uuid) owner to account_mail_guard;
alter function private.retry_sign_in_code_request(uuid) owner to account_mail_guard;
revoke create on schema private from account_mail_guard;

revoke all on function private.sign_in_code_hmac(uuid, text) from public;
revoke all on function private.request_sign_in_code(text, bytea) from public;
revoke all on function private.verify_sign_in_code(uuid, text, text) from public;
revoke all on function private.take_remembered_sign_in(uuid, text, bytea, bytea) from public;
revoke all on function private.remembered_browser_for_email(text, bytea) from public;
revoke all on function private.claim_sign_in_code_request() from public;
revoke all on function private.issue_sign_in_code(uuid, uuid, uuid, text, text) from public;
revoke all on function private.sign_in_code_dead_end(uuid) from public;
revoke all on function private.retry_sign_in_code_request(uuid) from public;
-- Called inside `set local role authenticated` transactions (claim-less for the web app's pre-session calls);
-- each function checks the LOGIN role (session_user) itself.
grant execute on function private.request_sign_in_code(text, bytea) to authenticated;
grant execute on function private.verify_sign_in_code(uuid, text, text) to authenticated;
grant execute on function private.take_remembered_sign_in(uuid, text, bytea, bytea) to authenticated;
grant execute on function private.remembered_browser_for_email(text, bytea) to authenticated;
-- The claim asks whether the account is a Platform Super Admin (the sender rule).
grant execute on function private.platform_admin_is_active(uuid) to account_mail_guard;
grant execute on function private.claim_sign_in_code_request() to authenticated;
grant execute on function private.issue_sign_in_code(uuid, uuid, uuid, text, text) to authenticated;
grant execute on function private.sign_in_code_dead_end(uuid) to authenticated;
grant execute on function private.retry_sign_in_code_request(uuid) to authenticated;
