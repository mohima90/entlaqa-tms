-- Shared rate limiter and sign-in protection (ADR 0011 §4; T-M2-11, SCS-16, FR-IAM-13; TM-0003 T-IAM-01/03/31;
-- PO decisions 9 Oct 2026). One set of counters for every app instance and Vercel function, replacing
-- per-instance memory: sign-in (per account, per trusted browser of an account and per client), the My
-- profile current-password check (per user), password reset (request and completion) and invitation links.
-- Class: P (platform, no tenant). PII: none stored — keys are keyed hashes only.
--
--   private.rate_limit_secret    the limiter's two HMAC keys (one row): the COUNTER key (counters and trusted
--                                browsers are found by it) and the LOG key (the `rk_…` references in log
--                                lines), so a log line never repeats a stored key. Generated here from the
--                                server's strong random source, kept as HMAC-SHA-256's inner and outer padded
--                                keys. Readable by rate_limit_guard only — never by app_server, app_worker or
--                                authenticated. The pseudonymisation rests on the database's confidentiality:
--                                whoever reads this table (pg_read_all_data, a backup) can test guesses
--                                against references and counters (docs/engineering/sign-in-protection.md §2).
--                                private.rotate_rate_limit_keys() replaces both keys.
--   private.rate_limit_counters  UNLOGGED (ADR 0011 §4): (bucket, key_hash) → hits within a window that ends
--                                at reset_at. key_hash = HMAC-SHA-256(counter key, subject); the subject is
--                                the app's SHA-256 of the normalised key (e-mail, client address, user id —
--                                packages/platform-identity/src/auth-limits.ts), so neither a raw key nor an
--                                unkeyed hash of one is stored or ever reaches SQL. Counters are lost on a
--                                crash, an HA failover or a replica's promotion (unlogged: emptied by crash
--                                recovery, not replicated): every limit starts again, which only ever
--                                loosens them for one window.
--   private.sign_in_trusted_devices  browsers an account trusts (PO decisions 9 Oct 2026: screen 6 «تذكّر
--                                الجهاز الموثوق», TM-0003 IA-02 "cookie + hashed server record"; trust is
--                                OPT-IN — «تذكّر هذا المتصفح», unticked by default): (keyed hash of the account
--                                subject, keyed hash of the browser's random token) → expiry. A trusted
--                                browser is not stopped by its account's lock, only by its own failure budget.
--                                The token lives in an HttpOnly cookie; only its hash reaches SQL. Every token
--                                stored here was minted by the web app: a presented token is reused only when
--                                it is already here (for any account), otherwise the app's fresh one is.
--   rate_limit_guard             NOLOGIN owner of the functions (pattern of account_mail_guard).
--
-- Entry points of the web app (session_user app_server, inside its `set local role authenticated`
-- transaction — without claims, the pattern of private.request_password_reset_mail, except the
-- Organization Admin functions, which run with the admin's claims):
--   rate_limit_hit / _clear / _give_back   generic counters (password check, reset, invitations,
--                                authenticator codes — failures only: given back when right). The hit that
--                                uses a budget up starts a full window: a locked key stays locked for the
--                                whole window from then. Race-safe (INSERT … ON CONFLICT takes the key's row
--                                lock; concurrent hits of one key serialise, other keys never wait). There is
--                                no "peek": every read of a limit counts (security review T-M2-11).
--   rate_limit_sign_in_check     BEFORE Auth is asked, in one round trip: counts the attempt for the client,
--                                then provisionally a failure for the client and for the account — or, for a
--                                browser the account trusts, for that browser — and refuses when a budget is
--                                used up (security review T-M2-11: counting first bounds parallel guesses).
--   rate_limit_sign_in_succeeded the password was right: the client's provisional failure is refunded, the
--                                account's (or the browser's) run of failures ends; with «تذكّر هذا المتصفح»
--                                ticked, the browser is trusted (again) for the account.
--   rate_limit_sign_in_not_checked  Auth refused to compare the password (its own rate limit): the
--                                account's (or browser's) provisional failure is given back; the client's stays.
--   rate_limit_sign_in_reset     a completed password reset: the account's lock ends, the browser that
--                                completed it becomes trusted (the owner is not stranded while an attacker
--                                keeps the account locked) and every other browser is forgotten.
--   rate_limit_forget_other_devices  after a My profile password change: every trusted browser of the
--                                account but the current one is forgotten.
--   member_sign_in_lock          Organization Admin (own organization's ACTIVE members only): whether a
--                                member's account is locked. Unlocking: 20261013090100.
--   sign_in_account_in_tenant    whether a typed address is an active member of the host's organization
--                                (only then does that organization's lockout policy apply).
-- Owner only: rotate_rate_limit_keys() (new keys; every counter and trusted browser restarts).
-- Each counting function also removes up to 20 expired counters and trusted browsers (SKIP LOCKED: purging
-- never waits) — retention is bounded by the longest window (≤ 24 hours) or trust period without any job.
-- Lock order, the same in every function (no deadlock): the client's counters, then the account's advisory
-- lock (only where trusted browsers change), then the account's or the browser's counter, then the
-- account's trusted browsers; the purge last (SKIP LOCKED).
-- Errors: 42501 wrong caller; 22023 invalid argument.

-- ---------------------------------------------------------------------------------------------------
-- Role rate_limit_guard (attribute policy as in 20260930120000)
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'rate_limit_guard') then
    create role rate_limit_guard nologin noinherit nobypassrls;
  end if;
end
$$;

do $$
declare
  r record;
begin
  select rolname, rolcanlogin, rolinherit, rolsuper, rolbypassrls, rolreplication, rolcreatedb, rolcreaterole
    into r from pg_roles where rolname = 'rate_limit_guard';
  if r.rolsuper or r.rolbypassrls or r.rolreplication then
    raise exception 'role rate_limit_guard must be NOSUPERUSER NOBYPASSRLS NOREPLICATION; fix it as a superuser first';
  end if;
  if r.rolinherit or r.rolcreatedb or r.rolcreaterole or r.rolcanlogin then
    alter role rate_limit_guard nologin noinherit nocreatedb nocreaterole;
  end if;
  if exists (select 1 from pg_auth_members m join pg_roles g on g.oid = m.roleid join pg_roles u on u.oid = m.member
             where g.rolname = 'rate_limit_guard' and (m.inherit_option or m.set_option)
               and not u.rolsuper and u.rolname <> current_user) then
    raise exception 'role rate_limit_guard must have no members besides the migration role';
  end if;
end
$$;

-- The migration role must be able to hand function ownership to rate_limit_guard.
grant rate_limit_guard to current_user;
grant usage on schema private to rate_limit_guard;

-- ---------------------------------------------------------------------------------------------------
-- Key generation (SECURITY INVOKER; executable by its owner only — the migration, then rate_limit_guard)
-- ---------------------------------------------------------------------------------------------------
-- Two 64-byte keys K, each from four version-4 UUIDs — gen_random_uuid() draws on the server's strong
-- random source (pg_strong_random), 122 random bits each: 488 bits per key. Returned as HMAC-SHA-256's
-- padded keys (RFC 2104: inner = K xor 0x36…, outer = K xor 0x5c…; HMAC(m) = SHA-256(outer ‖ SHA-256(inner
-- ‖ m))). Generated in the database, so the keys are the same for every app instance and never configured,
-- copied or logged anywhere.
create or replace function private.rate_limit_generate_keys(out inner_key bytea, out outer_key bytea,
                                                            out log_inner_key bytea, out log_outer_key bytea)
language plpgsql volatile
set search_path = ''
as $$
declare
  v_counter bytea := pg_catalog.uuid_send(pg_catalog.gen_random_uuid()) || pg_catalog.uuid_send(pg_catalog.gen_random_uuid())
                  || pg_catalog.uuid_send(pg_catalog.gen_random_uuid()) || pg_catalog.uuid_send(pg_catalog.gen_random_uuid());
  v_log bytea := pg_catalog.uuid_send(pg_catalog.gen_random_uuid()) || pg_catalog.uuid_send(pg_catalog.gen_random_uuid())
              || pg_catalog.uuid_send(pg_catalog.gen_random_uuid()) || pg_catalog.uuid_send(pg_catalog.gen_random_uuid());
begin
  inner_key := v_counter;
  outer_key := v_counter;
  log_inner_key := v_log;
  log_outer_key := v_log;
  for i in 0..63 loop
    inner_key := pg_catalog.set_byte(inner_key, i, pg_catalog.get_byte(v_counter, i) # 54);   -- 0x36
    outer_key := pg_catalog.set_byte(outer_key, i, pg_catalog.get_byte(v_counter, i) # 92);   -- 0x5c
    log_inner_key := pg_catalog.set_byte(log_inner_key, i, pg_catalog.get_byte(v_log, i) # 54);
    log_outer_key := pg_catalog.set_byte(log_outer_key, i, pg_catalog.get_byte(v_log, i) # 92);
  end loop;
end
$$;

comment on function private.rate_limit_generate_keys() is
  'SECURITY-RELEVANT (T-M2-11). New counter and log keys of the rate limiter (HMAC-SHA-256 padded keys). Owner only.';

revoke all on function private.rate_limit_generate_keys() from public;

-- ---------------------------------------------------------------------------------------------------
-- private.rate_limit_secret
-- ---------------------------------------------------------------------------------------------------
create table private.rate_limit_secret (
  id boolean primary key default true,
  inner_key bytea not null,
  outer_key bytea not null,
  log_inner_key bytea not null,
  log_outer_key bytea not null,
  created_at timestamptz not null default now(),
  constraint rate_limit_secret_single_row check (id),
  constraint rate_limit_secret_key_length check (
    octet_length(inner_key) = 64 and octet_length(outer_key) = 64
    and octet_length(log_inner_key) = 64 and octet_length(log_outer_key) = 64)
);
comment on table private.rate_limit_secret is
  'SECURITY-RELEVANT (ADR 0011 §4, T-M2-11). Counter and log HMAC keys of the shared rate limiter (padded inner/outer keys). Readable by rate_limit_guard only. private.rotate_rate_limit_keys() replaces them (every counter and trusted browser restarts).';

insert into private.rate_limit_secret (inner_key, outer_key, log_inner_key, log_outer_key)
select k.inner_key, k.outer_key, k.log_inner_key, k.log_outer_key from private.rate_limit_generate_keys() k;

-- Row level security after the keys are in (the migration role needs no policy of its own).
alter table private.rate_limit_secret enable row level security;
alter table private.rate_limit_secret force row level security;
create policy rate_limit_secret_guard_read on private.rate_limit_secret for select to rate_limit_guard using (true);
create policy rate_limit_secret_guard_rotate on private.rate_limit_secret for update to rate_limit_guard
  using (true) with check (true);
revoke all on private.rate_limit_secret from public;
grant select, update on private.rate_limit_secret to rate_limit_guard;

-- ---------------------------------------------------------------------------------------------------
-- private.rate_limit_counters
-- ---------------------------------------------------------------------------------------------------
create unlogged table private.rate_limit_counters (
  bucket text not null,
  key_hash bytea not null,
  hits integer not null,
  reset_at timestamptz not null,
  primary key (bucket, key_hash),
  constraint rate_limit_counters_bucket_check check (bucket ~ '^[a-z][a-z0-9_.]{2,62}$'),
  constraint rate_limit_counters_key_hash_check check (octet_length(key_hash) = 32),
  constraint rate_limit_counters_hits_check check (hits between 1 and 1000001)
);
comment on table private.rate_limit_counters is
  'SECURITY-RELEVANT (ADR 0011 §4, T-M2-11). Shared rate-limit counters: keyed hashes only (never a raw or unkeyed key). Unlogged; expired rows are purged by the counting functions. Only rate_limit_guard''s functions reach it.';

create index rate_limit_counters_reset_at_idx on private.rate_limit_counters (reset_at);

alter table private.rate_limit_counters enable row level security;
alter table private.rate_limit_counters force row level security;
create policy rate_limit_counters_guard on private.rate_limit_counters for all to rate_limit_guard
  using (true) with check (true);
revoke all on private.rate_limit_counters from public;
grant select, insert, update, delete on private.rate_limit_counters to rate_limit_guard;

-- ---------------------------------------------------------------------------------------------------
-- private.sign_in_trusted_devices
-- ---------------------------------------------------------------------------------------------------
create table private.sign_in_trusted_devices (
  account_key bytea not null,
  device_key bytea not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (account_key, device_key),
  constraint sign_in_trusted_devices_account_key_check check (octet_length(account_key) = 32),
  constraint sign_in_trusted_devices_device_key_check check (octet_length(device_key) = 32),
  constraint sign_in_trusted_devices_expiry_check check (expires_at > created_at)
);
comment on table private.sign_in_trusted_devices is
  'SECURITY-RELEVANT (T-M2-11, PO decision 9 Oct 2026). Browsers trusted by an account (keyed hashes of the account subject and of the browser''s cookie token) until expires_at. Only rate_limit_guard''s functions reach it.';

create index sign_in_trusted_devices_expires_at_idx on private.sign_in_trusted_devices (expires_at);
-- Whether the server knows a presented token (for any account) before reusing it.
create index sign_in_trusted_devices_device_key_idx on private.sign_in_trusted_devices (device_key);

alter table private.sign_in_trusted_devices enable row level security;
alter table private.sign_in_trusted_devices force row level security;
create policy sign_in_trusted_devices_guard on private.sign_in_trusted_devices for all to rate_limit_guard
  using (true) with check (true);
revoke all on private.sign_in_trusted_devices from public;
grant select, insert, update, delete on private.sign_in_trusted_devices to rate_limit_guard;

-- ---------------------------------------------------------------------------------------------------
-- What the Organization Admin functions read (explicit grants + policies `to rate_limit_guard`, limited to
-- the caller's organization). Auth accounts through private.auth_user_email (id, email).
-- ---------------------------------------------------------------------------------------------------
grant usage on schema platform to rate_limit_guard;
create policy tenant_memberships_rate_limit_guard_read on platform.tenant_memberships for select
  to rate_limit_guard using (tenant_id = (select private.current_tenant_id()));
grant select (id, tenant_id, user_id, person_id, status) on platform.tenant_memberships to rate_limit_guard;
create policy role_assignments_rate_limit_guard_read on platform.role_assignments for select
  to rate_limit_guard using (tenant_id = (select private.current_tenant_id()));
grant select (tenant_id, membership_id, role_code, valid_from, valid_until) on platform.role_assignments
  to rate_limit_guard;
grant select on private.auth_user_email to rate_limit_guard;

grant execute on function private.try_uuid(text) to rate_limit_guard;
grant execute on function private.request_claims() to rate_limit_guard;
grant execute on function private.request_user_id() to rate_limit_guard;
grant execute on function private.current_tenant_id() to rate_limit_guard;
grant execute on function private.actor_role_codes(uuid, uuid) to rate_limit_guard;
grant execute on function private.has_active_membership(uuid, uuid) to rate_limit_guard;

-- ---------------------------------------------------------------------------------------------------
-- Helpers (owner rate_limit_guard, SECURITY INVOKER: called by its definer functions only)
-- ---------------------------------------------------------------------------------------------------

-- The keyed hash of a subject under the COUNTER key: how counters and trusted browsers are found.
create or replace function private.rate_limit_key(p_subject bytea)
returns bytea
language sql stable
set search_path = ''
as $$
  select pg_catalog.sha256(s.outer_key || pg_catalog.sha256(s.inner_key || p_subject))
  from private.rate_limit_secret s
  where s.id
$$;

comment on function private.rate_limit_key(bytea) is
  'SECURITY-RELEVANT (T-M2-11). HMAC-SHA-256 of a rate-limit subject under the counter key. Called by the rate limiter''s definer functions only.';

-- The reference of a subject in log lines: `rk_` + 12 bytes of its HMAC under the LOG key (hex). Correlates
-- log lines; reveals nothing, and is no prefix of any stored key.
create or replace function private.rate_limit_ref(p_subject bytea)
returns text
language sql stable
set search_path = ''
as $$
  select 'rk_' || pg_catalog.encode(pg_catalog.substr(
           pg_catalog.sha256(s.log_outer_key || pg_catalog.sha256(s.log_inner_key || p_subject)), 1, 12), 'hex')
  from private.rate_limit_secret s
  where s.id
$$;

comment on function private.rate_limit_ref(bytea) is
  'SECURITY-RELEVANT (T-M2-11). Log reference (rk_…) of a rate-limit subject under the log key. Called by the rate limiter''s definer functions only.';

-- Caller and argument checks shared by the entry points (raises 42501 / 22023).
create or replace function private.rate_limit_check_call(p_bucket text, p_subject bytea)
returns void
language plpgsql stable
set search_path = ''
as $$
begin
  if session_user <> 'app_server' then
    raise exception 'reserved to the web app' using errcode = 'insufficient_privilege';
  end if;
  if p_bucket is null or p_bucket !~ '^[a-z][a-z0-9_.]{2,62}$' then
    raise exception 'invalid rate-limit bucket' using errcode = 'invalid_parameter_value';
  end if;
  -- The app's SHA-256 of the normalised key: exactly 32 bytes, so no readable key can be passed by mistake.
  if p_subject is null or octet_length(p_subject) <> 32 then
    raise exception 'a rate-limit subject is a 32-byte hash' using errcode = 'invalid_parameter_value';
  end if;
end
$$;

-- Counts one hit of a counter key. `p_lock`: the hit that uses the budget up starts a full window (a lock
-- lasts the whole window from then — security settings screen 6: "lock for 15 minutes after 5 failures");
-- otherwise the window keeps its end (a plain rate). A new window when the old one is over. Hits stop
-- growing one above the budget.
create or replace function private.rate_limit_count(p_bucket text, p_key bytea, p_max_hits integer,
                                                    p_window_seconds integer, p_lock boolean,
                                                    out o_hits integer, out o_reset_at timestamptz)
language plpgsql volatile
set search_path = ''
as $$
declare
  v_window interval;
begin
  if p_max_hits is null or p_max_hits not between 1 and 1000000
     or p_window_seconds is null or p_window_seconds not between 1 and 86400 then
    raise exception 'a limit is 1–1,000,000 hits in 1–86,400 seconds' using errcode = 'invalid_parameter_value';
  end if;
  if p_key is null then
    raise exception 'the rate limiter has no key' using errcode = 'object_not_in_prerequisite_state';
  end if;
  v_window := pg_catalog.make_interval(secs => p_window_seconds);
  insert into private.rate_limit_counters as c (bucket, key_hash, hits, reset_at)
  values (p_bucket, p_key, 1, pg_catalog.now() + v_window)
  on conflict (bucket, key_hash) do update
  set hits = case when c.reset_at <= pg_catalog.now() then 1 else least(c.hits + 1, p_max_hits + 1) end,
      reset_at = case when c.reset_at <= pg_catalog.now() then pg_catalog.now() + v_window
                      when p_lock and c.hits + 1 = p_max_hits then pg_catalog.now() + v_window
                      else c.reset_at end
  returning c.hits, c.reset_at into o_hits, o_reset_at;
end
$$;

-- Gives one provisional hit back (a sign-in that turned out right, or was refused before Auth).
create or replace function private.rate_limit_refund(p_bucket text, p_key bytea)
returns void
language plpgsql volatile
set search_path = ''
as $$
begin
  update private.rate_limit_counters c set hits = c.hits - 1
  where c.bucket = p_bucket and c.key_hash = p_key and c.hits > 1 and c.reset_at > pg_catalog.now();
  if not found then
    delete from private.rate_limit_counters c where c.bucket = p_bucket and c.key_hash = p_key and c.hits <= 1;
  end if;
end
$$;

-- Retention without a job: a few expired counters and trusted browsers go with every counting call. LAST
-- in each transaction and with SKIP LOCKED, so it never waits: rows are otherwise locked in one order
-- (client counters, then the account's advisory lock where trusted browsers change, then the account's or
-- browser's counter, then the account's trusted browsers), and no two calls can wait for each other (no
-- deadlock).
create or replace function private.rate_limit_purge()
returns void
language sql volatile
set search_path = ''
as $$
  delete from private.rate_limit_counters c
  where (c.bucket, c.key_hash) in (select x.bucket, x.key_hash from private.rate_limit_counters x
                                   where x.reset_at <= pg_catalog.now()
                                   order by x.reset_at
                                   limit 20
                                   for update skip locked);
  delete from private.sign_in_trusted_devices d
  where (d.account_key, d.device_key) in (select x.account_key, x.device_key from private.sign_in_trusted_devices x
                                          where x.expires_at <= pg_catalog.now()
                                          order by x.expires_at
                                          limit 20
                                          for update skip locked);
$$;

-- An address normalised exactly as the web app does it (auth-limits.ts normalizeAccountEmail): trimmed,
-- Unicode NFC, U+0130 (İ) → i and U+03A3 (Σ) → σ, lower-case. Auth (GoTrue) lower-cases with Go's simple
-- case mapping: İ → i and Σ → σ, where full Unicode lower-casing gives i + U+0307 and, at the end of a
-- word, ς — without the two mappings, typing İ or Σ would count against a different subject than the
-- account's and get a fresh failure budget (security review T-M2-11). The web app passes addresses
-- already normalised, so `lower` here never depends on the database's collation for them.
create or replace function private.rate_limit_normalize_email(p_email text)
returns text
language sql immutable
set search_path = ''
as $$
  select pg_catalog.lower(pg_catalog.translate(pg_catalog.normalize(pg_catalog.btrim(p_email), 'NFC'),
                                               U&'\0130\03A3', U&'i\03C3'))
$$;

-- The sign-in subject of an Auth account's address, exactly as the web app derives it from a typed
-- e-mail (auth-limits.ts accountSubject: the normalised address, SHA-256 under the domain prefix). Auth
-- stores addresses trimmed and lower-case, so both agree for every account. Guard (security review
-- T-M2-11): an address that is not printable ASCII after normalisation gets ONE shared subject (key
-- newline + 'non-ascii', which no printable address can equal) — Auth accepts ASCII addresses only, so no
-- account has such an address, and any remaining case-mapping difference between JavaScript and Go cannot
-- give a fresh failure budget per spelling.
create or replace function private.rate_limit_account_subject(p_email text)
returns bytea
language sql stable
set search_path = ''
as $$
  select pg_catalog.sha256(pg_catalog.convert_to(
           'jadarat.rate-limit.v1' || pg_catalog.chr(10) || 'account' || pg_catalog.chr(10)
           || case when n.email ~ '^[ -~]*$' then n.email
                   else pg_catalog.chr(10) || 'non-ascii' end, 'UTF8'))
  from (select private.rate_limit_normalize_email(p_email) as email) n
$$;

-- The serialisation point of an account's trusted browsers (a sign-in adding one, a password reset
-- removing all of them): transaction-level advisory lock on the account's keyed hash.
create or replace function private.rate_limit_lock_account_devices(p_account_key bytea)
returns void
language sql volatile
set search_path = ''
as $$
  select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
           'private.sign_in_trusted_devices:' || pg_catalog.encode(p_account_key, 'hex'), 0));
$$;

-- The browser token a sign-in or a password reset makes trusted: the one the browser presented when the
-- server knows it (an unexpired trusted browser of any account — one browser keeps one cookie for every
-- account it is trusted by), otherwise the fresh one the web app minted for this request. So the server
-- never starts trusting a token it did not issue (security review T-M2-11): 'presented' or 'fresh'.
create or replace function private.rate_limit_choose_device(p_device bytea)
returns text
language sql stable
set search_path = ''
as $$
  select case when p_device is not null
                   and exists (select 1 from private.sign_in_trusted_devices d
                               where d.device_key = private.rate_limit_key(p_device) and d.expires_at > pg_catalog.now())
              then 'presented' else 'fresh' end
$$;

-- Trusts a browser (keyed hash) for an account (keyed hash) until now + p_trust_days, under the account's
-- advisory lock (the caller takes it). At most 10 trusted browsers per account: the ones whose trust ends
-- first go. Returns the trust's end.
create or replace function private.rate_limit_trust_device(p_account_key bytea, p_device_key bytea, p_trust_days integer)
returns timestamptz
language plpgsql volatile
set search_path = ''
as $$
declare
  v_until timestamptz := pg_catalog.now() + pg_catalog.make_interval(days => p_trust_days);
begin
  insert into private.sign_in_trusted_devices as d (account_key, device_key, expires_at)
  values (p_account_key, p_device_key, v_until)
  on conflict (account_key, device_key) do update set expires_at = excluded.expires_at;
  delete from private.sign_in_trusted_devices d
  where d.account_key = p_account_key
    and d.device_key in (select x.device_key from private.sign_in_trusted_devices x
                         where x.account_key = p_account_key
                         order by x.expires_at desc, x.device_key
                         offset 10);
  return v_until;
end
$$;

-- An Organization Admin's request about a member of THEIR organization: the account key (the counter key
-- of its address) and the Auth account of an ACTIVE member, or nulls when the person has no active
-- membership there — a revoked, suspended or invited member is no longer (or not yet) the organization's
-- to unlock or inspect (security review T-M2-11 M1). Raises 42501 for anyone but an active Organization
-- Admin (tenant_admin) of the session's organization (the web app checks platform.user.unlock_sign_in
-- first; this is the database's own check).
create or replace function private.rate_limit_member_account(p_person_id uuid, out o_account_key bytea,
                                                             out o_user_id uuid)
language plpgsql stable
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_actor uuid;
  v_email text;
  v_user uuid;
begin
  if session_user <> 'app_server' or coalesce(private.request_claims() ->> 'role', '') <> 'authenticated' then
    raise exception 'reserved to signed-in members of the web app' using errcode = 'insufficient_privilege';
  end if;
  v_tenant := private.current_tenant_id();
  v_actor := private.request_user_id();
  if v_tenant is null or v_actor is null
     or not ('tenant_admin' = any (private.actor_role_codes(v_tenant, v_actor))) then
    raise exception 'only an Organization Admin' using errcode = 'insufficient_privilege';
  end if;
  select e.email, m.user_id into v_email, v_user
  from platform.tenant_memberships m
  join private.auth_user_email e on e.id = m.user_id
  where m.tenant_id = v_tenant and m.person_id = p_person_id and m.status = 'active';
  if v_email is not null then
    o_account_key := private.rate_limit_key(private.rate_limit_account_subject(v_email));
    o_user_id := v_user;
  end if;
end
$$;

-- ---------------------------------------------------------------------------------------------------
-- Generic counters (owner rate_limit_guard, SECURITY DEFINER, app_server)
-- ---------------------------------------------------------------------------------------------------
create or replace function private.rate_limit_hit(p_bucket text, p_subject bytea, p_max_hits integer,
                                                  p_window_seconds integer)
returns table (allowed boolean, remaining integer, retry_after_seconds integer, key_ref text)
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_hits integer;
  v_reset_at timestamptz;
begin
  perform private.rate_limit_check_call(p_bucket, p_subject);
  select c.o_hits, c.o_reset_at into v_hits, v_reset_at
  from private.rate_limit_count(p_bucket, private.rate_limit_key(p_subject), p_max_hits, p_window_seconds, true) c;
  perform private.rate_limit_purge();
  -- now() is the transaction's start: one that waited for the row lock may see a window that began after
  -- it started — the seconds left never exceed the window.
  return query select v_hits <= p_max_hits,
                      greatest(p_max_hits - v_hits, 0),
                      case when v_hits >= p_max_hits
                           then least(greatest(ceil(extract(epoch from v_reset_at - pg_catalog.now()))::integer, 1),
                                      p_window_seconds)
                           else 0 end,
                      private.rate_limit_ref(p_subject);
end
$$;

comment on function private.rate_limit_hit(text, bytea, integer, integer) is
  'SECURITY-RELEVANT (ADR 0011 §4, T-M2-11). Counts one hit of a key (keyed hash of the subject) and answers whether it is within max_hits per window. app_server only.';

create or replace function private.rate_limit_clear(p_bucket text, p_subject bytea)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  perform private.rate_limit_check_call(p_bucket, p_subject);
  delete from private.rate_limit_counters c
  where c.bucket = p_bucket and c.key_hash = private.rate_limit_key(p_subject);
end
$$;

comment on function private.rate_limit_clear(text, bytea) is
  'SECURITY-RELEVANT (ADR 0011 §4, T-M2-11). Forgets a key''s counter. app_server only.';

-- Gives one hit back (failures-only counting outside sign-in, e.g. authenticator codes: counted before
-- Auth is asked, given back when Auth accepted — T-M2-10 security review, TM-0003 T-IAM-12).
create or replace function private.rate_limit_give_back(p_bucket text, p_subject bytea)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  perform private.rate_limit_check_call(p_bucket, p_subject);
  perform private.rate_limit_refund(p_bucket, private.rate_limit_key(p_subject));
end
$$;

comment on function private.rate_limit_give_back(text, bytea) is
  'SECURITY-RELEVANT (T-M2-11). Gives one hit of a key back (an attempt that turned out right). app_server only.';

-- Whether the typed address belongs to an account with an active membership in an organization (the
-- host's): an organization's own lockout policy applies to its members only — anyone else gets the
-- platform default, so a lax organization's host cannot loosen the lock of another organization's
-- accounts (T-M2-10 security review). The address is compared (normalised as for the account's subject),
-- never stored or returned.
create or replace function private.sign_in_account_in_tenant(p_email text, p_tenant_id uuid)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if session_user <> 'app_server' then
    raise exception 'reserved to the web app' using errcode = 'insufficient_privilege';
  end if;
  if p_email is null or p_tenant_id is null then
    return false;
  end if;
  return exists (select 1 from private.auth_user_email e
                 where e.email = private.rate_limit_normalize_email(p_email)
                   and private.has_active_membership(e.id, p_tenant_id));
end
$$;

comment on function private.sign_in_account_in_tenant(text, uuid) is
  'SECURITY-RELEVANT (T-M2-11, T-M2-10 review). Whether a typed address is an active member of an organization (its lockout policy then applies). app_server only.';

-- ---------------------------------------------------------------------------------------------------
-- Sign-in (owner rate_limit_guard, SECURITY DEFINER, app_server)
-- ---------------------------------------------------------------------------------------------------

-- Before Auth is asked. Counts, in this order (one row lock after the other, never back):
--   1. sign_in.client_attempts  every attempt of the client (protects Auth's shared budget);
--   2. sign_in.client_failures  a provisional failure of the client (wrong passwords per address);
--   3. sign_in.device_failures  for a browser the account trusts (p_device: the hash of its cookie token,
--                               a valid row in sign_in_trusted_devices): a provisional failure of
--                               that browser for that account — the account's lock does not apply;
--      sign_in.account_failures otherwise: a provisional failure of the typed account (existing or not).
-- The first budget used up refuses the attempt (refused_by) and nothing after it is counted; an attempt the
-- account (or browser) refuses gives the client's provisional failure back (it is no wrong password). The
-- attempt that uses the account's budget up still reaches Auth; the next one is refused. `remaining`: the
-- account's (or browser's) failures left after this attempt, `client_remaining` the client's.
create or replace function private.rate_limit_sign_in_check(
  p_client bytea, p_account bytea, p_device bytea,
  p_client_attempts_max integer, p_client_attempts_window_seconds integer,
  p_client_failures_max integer, p_client_failures_window_seconds integer,
  p_account_max integer, p_account_window_seconds integer,
  p_device_max integer, p_device_window_seconds integer)
returns table (allowed boolean, refused_by text, retry_after_seconds integer, remaining integer,
               client_remaining integer, trusted boolean, subject_ref text, client_ref text)
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_client_key bytea;
  v_account_key bytea;
  v_hits integer;
  v_reset_at timestamptz;
  v_failures integer;
  v_account_hits integer;
  v_max integer;
  v_trusted boolean := false;
  v_refused text;
begin
  perform private.rate_limit_check_call('sign_in.client_failures', p_client);
  perform private.rate_limit_check_call('sign_in.account_failures', p_account);
  if p_device is not null and octet_length(p_device) <> 32 then
    raise exception 'a rate-limit subject is a 32-byte hash' using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from unnest(array[p_client_attempts_max, p_client_failures_max, p_account_max, p_device_max]) m
             where m is null or m not between 1 and 1000000)
     or exists (select 1 from unnest(array[p_client_attempts_window_seconds, p_client_failures_window_seconds,
                                           p_account_window_seconds, p_device_window_seconds]) w
                where w is null or w not between 1 and 86400) then
    raise exception 'a limit is 1–1,000,000 hits in 1–86,400 seconds' using errcode = 'invalid_parameter_value';
  end if;
  v_client_key := private.rate_limit_key(p_client);
  v_account_key := private.rate_limit_key(p_account);

  select c.o_hits, c.o_reset_at into v_hits, v_reset_at
  from private.rate_limit_count('sign_in.client_attempts', v_client_key, p_client_attempts_max,
                                p_client_attempts_window_seconds, false) c;
  if v_hits > p_client_attempts_max then
    v_refused := 'sign_in.client_attempts';
  else
    select c.o_hits, c.o_reset_at into v_failures, v_reset_at
    from private.rate_limit_count('sign_in.client_failures', v_client_key, p_client_failures_max,
                                  p_client_failures_window_seconds, false) c;
    if v_failures > p_client_failures_max then
      v_refused := 'sign_in.client_failures';
    else
      if p_device is not null then
        v_trusted := exists (select 1 from private.sign_in_trusted_devices d
                             where d.account_key = v_account_key and d.device_key = private.rate_limit_key(p_device)
                               and d.expires_at > pg_catalog.now());
      end if;
      if v_trusted then
        v_max := p_device_max;
        select c.o_hits, c.o_reset_at into v_account_hits, v_reset_at
        from private.rate_limit_count('sign_in.device_failures', private.rate_limit_key(p_account || p_device),
                                      p_device_max, p_device_window_seconds, true) c;
      else
        v_max := p_account_max;
        select c.o_hits, c.o_reset_at into v_account_hits, v_reset_at
        from private.rate_limit_count('sign_in.account_failures', v_account_key, p_account_max,
                                      p_account_window_seconds, true) c;
      end if;
      if v_account_hits > v_max then
        v_refused := case when v_trusted then 'sign_in.device_failures' else 'sign_in.account_failures' end;
        perform private.rate_limit_refund('sign_in.client_failures', v_client_key);
        v_failures := v_failures - 1;
      end if;
    end if;
  end if;
  perform private.rate_limit_purge();

  -- The seconds left never exceed the refusing budget's window (see rate_limit_hit: now() is the
  -- transaction's start, and a transaction may have waited for the row lock).
  return query select v_refused is null,
                      v_refused,
                      case when v_refused is null then 0
                           else least(greatest(ceil(extract(epoch from v_reset_at - pg_catalog.now()))::integer, 1),
                                      case v_refused
                                        when 'sign_in.client_attempts' then p_client_attempts_window_seconds
                                        when 'sign_in.client_failures' then p_client_failures_window_seconds
                                        when 'sign_in.device_failures' then p_device_window_seconds
                                        else p_account_window_seconds end) end,
                      case when v_account_hits is null then 0 else greatest(v_max - v_account_hits, 0) end,
                      case when v_failures is null then 0 else greatest(p_client_failures_max - v_failures, 0) end,
                      v_trusted,
                      private.rate_limit_ref(p_account),
                      private.rate_limit_ref(p_client);
end
$$;

comment on function private.rate_limit_sign_in_check(bytea, bytea, bytea, integer, integer, integer, integer, integer, integer, integer, integer) is
  'SECURITY-RELEVANT (T-M2-11, FR-IAM-13). Before Auth: counts a sign-in attempt for the client and provisionally a failure for the client and the account (or a browser the account trusts); refuses when a budget is used up. app_server only.';

-- After Auth accepted the password (p_trusted: what the check answered for the presented browser p_device,
-- null when it presented none). The client's provisional failure is refunded; the account's run of
-- failures ends (an unknown browser) — or that browser's run (a trusted browser: the account's lock stays,
-- it was not this browser's to end). With p_remember («تذكّر هذا المتصفح» ticked — PO decision: trust is
-- opt-in), the browser is trusted for the account until now + p_trust_days (again, if it was: a sliding
-- trust renewed by ticked sign-ins only): under the presented token when the server knows it, otherwise
-- under the web app's fresh one (p_fresh_device). Without it, nothing about trust changes — a trusted
-- browser's trust is not renewed and ends on its date. Returns the trust's end and which token was trusted
-- ('presented' / 'fresh'; both null without p_remember): the web app writes that token's cookie.
create or replace function private.rate_limit_sign_in_succeeded(p_client bytea, p_account bytea, p_device bytea,
                                                                p_fresh_device bytea, p_trusted boolean,
                                                                p_remember boolean, p_trust_days integer)
returns table (trusted_until timestamptz, device text)
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_account_key bytea;
  v_choice text;
  v_until timestamptz;
begin
  perform private.rate_limit_check_call('sign_in.client_failures', p_client);
  perform private.rate_limit_check_call('sign_in.account_failures', p_account);
  if p_device is not null or p_trusted then
    perform private.rate_limit_check_call('sign_in.device_failures', p_device);
  end if;
  if p_trusted is null or p_remember is null then
    raise exception 'say whether the browser was trusted and is to be remembered' using errcode = 'invalid_parameter_value';
  end if;
  if p_remember then
    perform private.rate_limit_check_call('sign_in.device_failures', p_fresh_device);
    if p_trust_days is null or p_trust_days not between 1 and 400 then
      raise exception 'a browser is trusted for 1–400 days' using errcode = 'invalid_parameter_value';
    end if;
  end if;
  v_account_key := private.rate_limit_key(p_account);

  perform private.rate_limit_refund('sign_in.client_failures', private.rate_limit_key(p_client));
  -- The account's advisory lock before its counters (the order of rate_limit_sign_in_reset: no deadlock).
  if p_remember then
    perform private.rate_limit_lock_account_devices(v_account_key);
  end if;
  if p_trusted then
    delete from private.rate_limit_counters c
    where c.bucket = 'sign_in.device_failures' and c.key_hash = private.rate_limit_key(p_account || p_device);
  else
    delete from private.rate_limit_counters c
    where c.bucket = 'sign_in.account_failures' and c.key_hash = v_account_key;
  end if;

  if p_remember then
    v_choice := private.rate_limit_choose_device(p_device);
    v_until := private.rate_limit_trust_device(
      v_account_key, private.rate_limit_key(case when v_choice = 'presented' then p_device else p_fresh_device end),
      p_trust_days);
  end if;
  perform private.rate_limit_purge();
  return query select v_until, v_choice;
end
$$;

comment on function private.rate_limit_sign_in_succeeded(bytea, bytea, bytea, bytea, boolean, boolean, integer) is
  'SECURITY-RELEVANT (T-M2-11, PO decisions 9 Oct 2026). After a successful sign-in: refunds the client''s provisional failure, ends the account''s (or the trusted browser''s) run of failures and — only when the browser is to be remembered — trusts it for the account (a token the server knows, else the fresh one). app_server only.';

-- Auth answered before comparing the password (its own rate limit, HTTP 429): no wrong password, so the
-- account's (or the trusted browser's) provisional failure is given back; the client's failure and attempt
-- stay counted (the client is the one Auth limited). p_trusted: what the check answered.
create or replace function private.rate_limit_sign_in_not_checked(p_account bytea, p_device bytea, p_trusted boolean)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  perform private.rate_limit_check_call('sign_in.account_failures', p_account);
  if p_trusted is null then
    raise exception 'say whether the browser was trusted' using errcode = 'invalid_parameter_value';
  end if;
  if p_trusted then
    perform private.rate_limit_check_call('sign_in.device_failures', p_device);
    perform private.rate_limit_refund('sign_in.device_failures', private.rate_limit_key(p_account || p_device));
  else
    perform private.rate_limit_refund('sign_in.account_failures', private.rate_limit_key(p_account));
  end if;
end
$$;

comment on function private.rate_limit_sign_in_not_checked(bytea, bytea, boolean) is
  'SECURITY-RELEVANT (T-M2-11). Auth did not compare the password (its rate limit): gives the account''s (or trusted browser''s) provisional failure back; the client''s stays. app_server only.';

-- A completed password reset (the owner proved control of the mailbox — TM-0003 T-IAM-32): the account's
-- lock ends; the browser that completed the reset is trusted for the account (the presented token when the
-- server knows it, else the web app's fresh one; its own run of failures ends) — so an attacker who keeps
-- the account locked cannot keep its owner out (security review T-M2-11 M2) — and every OTHER browser the
-- account trusted is forgotten. Returns how many were forgotten, which token is now trusted ('presented' /
-- 'fresh': the web app writes its cookie) and until when.
create or replace function private.rate_limit_sign_in_reset(p_account bytea, p_device bytea, p_fresh_device bytea,
                                                            p_trust_days integer)
returns table (revoked integer, device text, trusted_until timestamptz)
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_account_key bytea;
  v_device bytea;
  v_device_key bytea;
  v_choice text;
  v_revoked integer;
  v_until timestamptz;
begin
  perform private.rate_limit_check_call('sign_in.account_failures', p_account);
  if p_device is not null then
    perform private.rate_limit_check_call('sign_in.device_failures', p_device);
  end if;
  perform private.rate_limit_check_call('sign_in.device_failures', p_fresh_device);
  if p_trust_days is null or p_trust_days not between 1 and 400 then
    raise exception 'a browser is trusted for 1–400 days' using errcode = 'invalid_parameter_value';
  end if;
  v_account_key := private.rate_limit_key(p_account);
  -- The account's advisory lock first, then its counters (the order of rate_limit_sign_in_succeeded).
  perform private.rate_limit_lock_account_devices(v_account_key);
  delete from private.rate_limit_counters c
  where c.bucket = 'sign_in.account_failures' and c.key_hash = v_account_key;

  v_choice := private.rate_limit_choose_device(p_device);
  v_device := case when v_choice = 'presented' then p_device else p_fresh_device end;
  v_device_key := private.rate_limit_key(v_device);
  delete from private.rate_limit_counters c
  where c.bucket = 'sign_in.device_failures' and c.key_hash = private.rate_limit_key(p_account || v_device);
  delete from private.sign_in_trusted_devices d where d.account_key = v_account_key and d.device_key <> v_device_key;
  get diagnostics v_revoked = row_count;
  v_until := private.rate_limit_trust_device(v_account_key, v_device_key, p_trust_days);
  return query select v_revoked, v_choice, v_until;
end
$$;

comment on function private.rate_limit_sign_in_reset(bytea, bytea, bytea, integer) is
  'SECURITY-RELEVANT (T-M2-11, PO decision 9 Oct 2026, security review M2). After a completed password reset: ends the account''s sign-in lock, trusts the browser that completed it and forgets every other browser the account trusted. app_server only.';

-- After a password change on My profile (the signed-in owner; security review T-M2-11 L2): every browser
-- the account trusted is forgotten except the current one (p_device: its token, null when it has none).
-- Returns how many were.
create or replace function private.rate_limit_forget_other_devices(p_account bytea, p_device bytea)
returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_account_key bytea;
  v_revoked integer;
begin
  perform private.rate_limit_check_call('sign_in.account_failures', p_account);
  if p_device is not null then
    perform private.rate_limit_check_call('sign_in.device_failures', p_device);
  end if;
  v_account_key := private.rate_limit_key(p_account);
  perform private.rate_limit_lock_account_devices(v_account_key);
  delete from private.sign_in_trusted_devices d
  where d.account_key = v_account_key
    and (p_device is null or d.device_key <> private.rate_limit_key(p_device));
  get diagnostics v_revoked = row_count;
  return v_revoked;
end
$$;

comment on function private.rate_limit_forget_other_devices(bytea, bytea) is
  'SECURITY-RELEVANT (T-M2-11, security review L2). After a My profile password change: forgets every browser the account trusted except the current one. app_server only.';

-- ---------------------------------------------------------------------------------------------------
-- Organization Admin (owner rate_limit_guard, SECURITY DEFINER, app_server with the admin's claims)
-- ---------------------------------------------------------------------------------------------------

-- Whether an active member's account is locked now (p_max_failures: the account budget the web app
-- applies). Anyone else — another organization's person, a revoked or suspended member — is "not locked".
create or replace function private.member_sign_in_lock(p_person_id uuid, p_max_failures integer)
returns table (locked boolean, retry_after_seconds integer)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_key bytea;
  v_hits integer;
  v_reset_at timestamptz;
begin
  if p_max_failures is null or p_max_failures not between 1 and 1000000 then
    raise exception 'a limit is 1–1,000,000 hits' using errcode = 'invalid_parameter_value';
  end if;
  select a.o_account_key into v_key from private.rate_limit_member_account(p_person_id) a;
  if v_key is not null then
    select c.hits, c.reset_at into v_hits, v_reset_at
    from private.rate_limit_counters c
    where c.bucket = 'sign_in.account_failures' and c.key_hash = v_key and c.reset_at > pg_catalog.now();
  end if;
  return query select coalesce(v_hits, 0) >= p_max_failures,
                      case when coalesce(v_hits, 0) >= p_max_failures
                           then greatest(ceil(extract(epoch from v_reset_at - pg_catalog.now()))::integer, 1)
                           else 0 end;
end
$$;

comment on function private.member_sign_in_lock(uuid, integer) is
  'SECURITY-RELEVANT (T-M2-11, PO decision 9 Oct 2026). Whether an active member of the caller''s organization is locked out of sign-in. Organization Admin (tenant_admin) claims only.';

-- ---------------------------------------------------------------------------------------------------
-- Key rotation (owner only: the migration role, a member of rate_limit_guard — never the app roles)
-- ---------------------------------------------------------------------------------------------------
create or replace function private.rotate_rate_limit_keys()
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if session_user in ('app_server', 'app_worker', 'app_queue', 'authenticator')
     or not pg_catalog.pg_has_role(session_user, 'rate_limit_guard', 'MEMBER') then
    raise exception 'reserved to the database owner' using errcode = 'insufficient_privilege';
  end if;
  update private.rate_limit_secret s
  set inner_key = k.inner_key, outer_key = k.outer_key, log_inner_key = k.log_inner_key,
      log_outer_key = k.log_outer_key, created_at = pg_catalog.now()
  from private.rate_limit_generate_keys() k
  where s.id;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'the rate limiter must have exactly one key row (% changed)', v_rows
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  -- Counters and trusted browsers were found by the old key: all of them start again.
  delete from private.rate_limit_counters c where true;
  delete from private.sign_in_trusted_devices d where true;
end
$$;

comment on function private.rotate_rate_limit_keys() is
  'SECURITY-RELEVANT (T-M2-11). Replaces the rate limiter''s counter and log keys (exactly one row); every counter and trusted browser restarts. Database owner only (docs/engineering/sign-in-protection.md §2).';

-- Ownership hand-over as in migration 20260930120100 (non-superuser migration role on hosted Supabase).
grant create on schema private to rate_limit_guard;
alter function private.rate_limit_generate_keys() owner to rate_limit_guard;
alter function private.rate_limit_key(bytea) owner to rate_limit_guard;
alter function private.rate_limit_ref(bytea) owner to rate_limit_guard;
alter function private.rate_limit_check_call(text, bytea) owner to rate_limit_guard;
alter function private.rate_limit_count(text, bytea, integer, integer, boolean) owner to rate_limit_guard;
alter function private.rate_limit_refund(text, bytea) owner to rate_limit_guard;
alter function private.rate_limit_purge() owner to rate_limit_guard;
alter function private.rate_limit_normalize_email(text) owner to rate_limit_guard;
alter function private.rate_limit_account_subject(text) owner to rate_limit_guard;
alter function private.rate_limit_lock_account_devices(bytea) owner to rate_limit_guard;
alter function private.rate_limit_choose_device(bytea) owner to rate_limit_guard;
alter function private.rate_limit_trust_device(bytea, bytea, integer) owner to rate_limit_guard;
alter function private.rate_limit_member_account(uuid) owner to rate_limit_guard;
alter function private.rate_limit_hit(text, bytea, integer, integer) owner to rate_limit_guard;
alter function private.rate_limit_clear(text, bytea) owner to rate_limit_guard;
alter function private.rate_limit_give_back(text, bytea) owner to rate_limit_guard;
alter function private.sign_in_account_in_tenant(text, uuid) owner to rate_limit_guard;
alter function private.rate_limit_sign_in_check(bytea, bytea, bytea, integer, integer, integer, integer, integer, integer, integer, integer) owner to rate_limit_guard;
alter function private.rate_limit_sign_in_succeeded(bytea, bytea, bytea, bytea, boolean, boolean, integer) owner to rate_limit_guard;
alter function private.rate_limit_sign_in_not_checked(bytea, bytea, boolean) owner to rate_limit_guard;
alter function private.rate_limit_sign_in_reset(bytea, bytea, bytea, integer) owner to rate_limit_guard;
alter function private.rate_limit_forget_other_devices(bytea, bytea) owner to rate_limit_guard;
alter function private.member_sign_in_lock(uuid, integer) owner to rate_limit_guard;
alter function private.rotate_rate_limit_keys() owner to rate_limit_guard;
revoke create on schema private from rate_limit_guard;

revoke all on function private.rate_limit_key(bytea) from public;
revoke all on function private.rate_limit_ref(bytea) from public;
revoke all on function private.rate_limit_check_call(text, bytea) from public;
revoke all on function private.rate_limit_count(text, bytea, integer, integer, boolean) from public;
revoke all on function private.rate_limit_refund(text, bytea) from public;
revoke all on function private.rate_limit_purge() from public;
revoke all on function private.rate_limit_normalize_email(text) from public;
revoke all on function private.rate_limit_account_subject(text) from public;
revoke all on function private.rate_limit_lock_account_devices(bytea) from public;
revoke all on function private.rate_limit_choose_device(bytea) from public;
revoke all on function private.rate_limit_trust_device(bytea, bytea, integer) from public;
revoke all on function private.rate_limit_member_account(uuid) from public;
revoke all on function private.rate_limit_hit(text, bytea, integer, integer) from public;
revoke all on function private.rate_limit_clear(text, bytea) from public;
revoke all on function private.rate_limit_give_back(text, bytea) from public;
revoke all on function private.sign_in_account_in_tenant(text, uuid) from public;
revoke all on function private.rate_limit_sign_in_check(bytea, bytea, bytea, integer, integer, integer, integer, integer, integer, integer, integer) from public;
revoke all on function private.rate_limit_sign_in_succeeded(bytea, bytea, bytea, bytea, boolean, boolean, integer) from public;
revoke all on function private.rate_limit_sign_in_not_checked(bytea, bytea, boolean) from public;
revoke all on function private.rate_limit_sign_in_reset(bytea, bytea, bytea, integer) from public;
revoke all on function private.rate_limit_forget_other_devices(bytea, bytea) from public;
revoke all on function private.member_sign_in_lock(uuid, integer) from public;
revoke all on function private.rotate_rate_limit_keys() from public;
-- Called inside the web app's `set local role authenticated` transactions; each function checks the LOGIN
-- role (session_user = app_server) itself — and the Organization Admin function the claims.
grant execute on function private.rate_limit_hit(text, bytea, integer, integer) to authenticated;
grant execute on function private.rate_limit_clear(text, bytea) to authenticated;
grant execute on function private.rate_limit_give_back(text, bytea) to authenticated;
grant execute on function private.sign_in_account_in_tenant(text, uuid) to authenticated;
grant execute on function private.rate_limit_sign_in_check(bytea, bytea, bytea, integer, integer, integer, integer, integer, integer, integer, integer) to authenticated;
grant execute on function private.rate_limit_sign_in_succeeded(bytea, bytea, bytea, bytea, boolean, boolean, integer) to authenticated;
grant execute on function private.rate_limit_sign_in_not_checked(bytea, bytea, boolean) to authenticated;
grant execute on function private.rate_limit_sign_in_reset(bytea, bytea, bytea, integer) to authenticated;
grant execute on function private.rate_limit_forget_other_devices(bytea, bytea) to authenticated;
grant execute on function private.member_sign_in_lock(uuid, integer) to authenticated;
