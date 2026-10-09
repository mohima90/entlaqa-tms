-- Shared rate limiter (ADR 0011 §4; T-M2-11, SCS-16; TM-0003 T-IAM-01/03/31). One set of counters for
-- every app instance and Vercel function, replacing per-instance memory: sign-in (per account and per
-- client), the My profile current-password check (per user), password reset (request and completion) and
-- invitation links. Class: P (platform, no tenant). PII: none stored — keys are keyed hashes only.
--
--   private.rate_limit_secret    the limiter's HMAC key (one row): generated here from the server's strong
--                                random source, kept as HMAC-SHA-256's inner and outer padded keys. Readable
--                                by rate_limit_guard only — never by app_server, app_worker or authenticated.
--   private.rate_limit_counters  UNLOGGED (ADR 0011 §4): (bucket, key_hash) → hits within a window that ends
--                                at reset_at. key_hash = HMAC-SHA-256(secret, subject); the subject is the
--                                app's SHA-256 of the normalised key (e-mail, client address or user id —
--                                packages/platform-identity/src/auth-limits.ts), so neither a raw key nor an
--                                unkeyed hash of one is stored or ever reaches SQL. Counters are lost on a
--                                crash (unlogged): every limit starts again, which only ever loosens them.
--   rate_limit_guard             NOLOGIN owner of the functions (pattern of account_mail_guard).
--
--   private.rate_limit_hit(bucket, subject, max_hits, window_seconds)  counts one hit and says whether it is
--                                within the limit. The hit that uses the budget up starts a full window: a
--                                locked key stays locked for `window_seconds` from then (security settings
--                                screen 6: "lock for 15 minutes after 5 failures"). Race-safe (INSERT … ON
--                                CONFLICT takes the key's row lock; concurrent hits of one key serialise,
--                                other keys never wait). Each call also removes up to 20 expired counters
--                                (SKIP LOCKED: purging never waits for anyone) — retention is bounded by the
--                                longest window (≤ 24 hours) without any job.
--   private.rate_limit_peek(bucket, subject, max_hits)  whether the key is within its limit now, without
--                                counting (failure counters are checked before Auth and counted after it).
--   private.rate_limit_clear(bucket, subject)           forgets a key (a successful sign-in ends the
--                                account's run of consecutive failures; a completed password reset unlocks).
--
-- Callers: the web app only (session_user app_server, inside its `set local role authenticated`
-- transaction without claims — the pattern of private.request_password_reset_mail). Errors: 42501 wrong
-- caller; 22023 invalid argument.

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
-- private.rate_limit_secret: the HMAC key, as HMAC-SHA-256's padded keys (RFC 2104 with a 64-byte key K:
-- inner = K xor 0x36…, outer = K xor 0x5c…; HMAC(m) = SHA-256(outer ‖ SHA-256(inner ‖ m)))
-- ---------------------------------------------------------------------------------------------------
create table private.rate_limit_secret (
  id boolean primary key default true,
  inner_key bytea not null,
  outer_key bytea not null,
  created_at timestamptz not null default now(),
  constraint rate_limit_secret_single_row check (id),
  constraint rate_limit_secret_inner_length check (octet_length(inner_key) = 64),
  constraint rate_limit_secret_outer_length check (octet_length(outer_key) = 64)
);
comment on table private.rate_limit_secret is
  'SECURITY-RELEVANT (ADR 0011 §4, T-M2-11). HMAC key of the shared rate limiter (padded inner/outer keys). Readable by rate_limit_guard only. Replacing the row restarts every counter.';

-- K: 64 bytes from four version-4 UUIDs — gen_random_uuid() draws on the server's strong random source
-- (pg_strong_random), 122 random bits each: 488 bits in all. Generated in the database, so it is the same
-- for every app instance and never configured, copied or logged anywhere.
do $$
declare
  v_key bytea := pg_catalog.uuid_send(pg_catalog.gen_random_uuid()) || pg_catalog.uuid_send(pg_catalog.gen_random_uuid())
              || pg_catalog.uuid_send(pg_catalog.gen_random_uuid()) || pg_catalog.uuid_send(pg_catalog.gen_random_uuid());
  v_inner bytea := v_key;
  v_outer bytea := v_key;
begin
  for i in 0..63 loop
    v_inner := pg_catalog.set_byte(v_inner, i, pg_catalog.get_byte(v_key, i) # 54);  -- 0x36
    v_outer := pg_catalog.set_byte(v_outer, i, pg_catalog.get_byte(v_key, i) # 92);  -- 0x5c
  end loop;
  insert into private.rate_limit_secret (inner_key, outer_key) values (v_inner, v_outer);
end
$$;

-- Row level security after the key is in (the migration role needs no policy of its own).
alter table private.rate_limit_secret enable row level security;
alter table private.rate_limit_secret force row level security;
create policy rate_limit_secret_guard_read on private.rate_limit_secret for select to rate_limit_guard using (true);
revoke all on private.rate_limit_secret from public;
grant select on private.rate_limit_secret to rate_limit_guard;

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
  'SECURITY-RELEVANT (ADR 0011 §4, T-M2-11). Shared rate-limit counters: keyed hashes only (never a raw or unkeyed key). Unlogged; expired rows are purged by the hit function. Only rate_limit_guard''s functions reach it.';

create index rate_limit_counters_reset_at_idx on private.rate_limit_counters (reset_at);

alter table private.rate_limit_counters enable row level security;
alter table private.rate_limit_counters force row level security;
create policy rate_limit_counters_guard on private.rate_limit_counters for all to rate_limit_guard
  using (true) with check (true);
revoke all on private.rate_limit_counters from public;
grant select, insert, update, delete on private.rate_limit_counters to rate_limit_guard;

-- ---------------------------------------------------------------------------------------------------
-- Functions (owner rate_limit_guard)
-- ---------------------------------------------------------------------------------------------------

-- The keyed hash of a subject (SECURITY INVOKER: callable only by the owner's definer functions).
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
  'SECURITY-RELEVANT (T-M2-11). HMAC-SHA-256 of a rate-limit subject under the limiter''s key. Called by the rate_limit_* definer functions only.';

-- Argument checks shared by the three functions (SECURITY INVOKER; raises 42501 / 22023).
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

create or replace function private.rate_limit_hit(p_bucket text, p_subject bytea, p_max_hits integer,
                                                  p_window_seconds integer)
returns table (allowed boolean, remaining integer, retry_after_seconds integer, key_ref text)
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_key bytea;
  v_window interval;
  v_hits integer;
  v_reset_at timestamptz;
begin
  perform private.rate_limit_check_call(p_bucket, p_subject);
  if p_max_hits is null or p_max_hits not between 1 and 1000000
     or p_window_seconds is null or p_window_seconds not between 1 and 86400 then
    raise exception 'a limit is 1–1,000,000 hits in 1–86,400 seconds' using errcode = 'invalid_parameter_value';
  end if;
  v_key := private.rate_limit_key(p_subject);
  if v_key is null then
    raise exception 'the rate limiter has no key' using errcode = 'object_not_in_prerequisite_state';
  end if;
  v_window := pg_catalog.make_interval(secs => p_window_seconds);

  insert into private.rate_limit_counters as c (bucket, key_hash, hits, reset_at)
  values (p_bucket, v_key, 1, pg_catalog.now() + v_window)
  on conflict (bucket, key_hash) do update
  set hits = case when c.reset_at <= pg_catalog.now() then 1 else least(c.hits + 1, p_max_hits + 1) end,
      -- A new window when the old one is over; the hit that uses the budget up starts a full window
      -- (the lock lasts p_window_seconds from then); otherwise the window keeps its end.
      reset_at = case when c.reset_at <= pg_catalog.now() then pg_catalog.now() + v_window
                      when c.hits + 1 = p_max_hits then pg_catalog.now() + v_window
                      else c.reset_at end
  returning c.hits, c.reset_at into v_hits, v_reset_at;

  -- Retention without a job: a few expired counters go with every hit. AFTER the upsert and with SKIP
  -- LOCKED, so this part never waits: a transaction holds at most one counter it may wait for (the web
  -- app runs one counting call per transaction), and no two hits can wait for each other (no deadlock).
  delete from private.rate_limit_counters c
  where (c.bucket, c.key_hash) in (select x.bucket, x.key_hash from private.rate_limit_counters x
                                   where x.reset_at <= pg_catalog.now()
                                   order by x.reset_at
                                   limit 20
                                   for update skip locked);

  return query select v_hits <= p_max_hits,
                      greatest(p_max_hits - v_hits, 0),
                      case when v_hits >= p_max_hits
                           then greatest(ceil(extract(epoch from v_reset_at - pg_catalog.now()))::integer, 1)
                           else 0 end,
                      'rk_' || pg_catalog.encode(pg_catalog.substr(v_key, 1, 12), 'hex');
end
$$;

comment on function private.rate_limit_hit(text, bytea, integer, integer) is
  'SECURITY-RELEVANT (ADR 0011 §4, T-M2-11). Counts one hit of a key (keyed hash of the subject) and answers whether it is within max_hits per window. app_server only.';

create or replace function private.rate_limit_peek(p_bucket text, p_subject bytea, p_max_hits integer)
returns table (allowed boolean, remaining integer, retry_after_seconds integer, key_ref text)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_key bytea;
  v_hits integer;
  v_reset_at timestamptz;
begin
  perform private.rate_limit_check_call(p_bucket, p_subject);
  if p_max_hits is null or p_max_hits not between 1 and 1000000 then
    raise exception 'a limit is 1–1,000,000 hits' using errcode = 'invalid_parameter_value';
  end if;
  v_key := private.rate_limit_key(p_subject);
  if v_key is null then
    raise exception 'the rate limiter has no key' using errcode = 'object_not_in_prerequisite_state';
  end if;
  select c.hits, c.reset_at into v_hits, v_reset_at
  from private.rate_limit_counters c
  where c.bucket = p_bucket and c.key_hash = v_key and c.reset_at > pg_catalog.now();
  v_hits := coalesce(v_hits, 0);
  return query select v_hits < p_max_hits,
                      greatest(p_max_hits - v_hits, 0),
                      case when v_hits >= p_max_hits
                           then greatest(ceil(extract(epoch from v_reset_at - pg_catalog.now()))::integer, 1)
                           else 0 end,
                      'rk_' || pg_catalog.encode(pg_catalog.substr(v_key, 1, 12), 'hex');
end
$$;

comment on function private.rate_limit_peek(text, bytea, integer) is
  'SECURITY-RELEVANT (ADR 0011 §4, T-M2-11). Whether a key is within max_hits now, without counting. app_server only.';

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
  'SECURITY-RELEVANT (ADR 0011 §4, T-M2-11). Forgets a key''s counter (after a successful sign-in or a completed password reset). app_server only.';

-- Ownership hand-over as in migration 20260930120100 (non-superuser migration role on hosted Supabase).
grant create on schema private to rate_limit_guard;
alter function private.rate_limit_key(bytea) owner to rate_limit_guard;
alter function private.rate_limit_check_call(text, bytea) owner to rate_limit_guard;
alter function private.rate_limit_hit(text, bytea, integer, integer) owner to rate_limit_guard;
alter function private.rate_limit_peek(text, bytea, integer) owner to rate_limit_guard;
alter function private.rate_limit_clear(text, bytea) owner to rate_limit_guard;
revoke create on schema private from rate_limit_guard;

revoke all on function private.rate_limit_key(bytea) from public;
revoke all on function private.rate_limit_check_call(text, bytea) from public;
revoke all on function private.rate_limit_hit(text, bytea, integer, integer) from public;
revoke all on function private.rate_limit_peek(text, bytea, integer) from public;
revoke all on function private.rate_limit_clear(text, bytea) from public;
-- Called inside the web app's `set local role authenticated` transaction without claims; each function
-- checks the LOGIN role (session_user = app_server) itself.
grant execute on function private.rate_limit_hit(text, bytea, integer, integer) to authenticated;
grant execute on function private.rate_limit_peek(text, bytea, integer) to authenticated;
grant execute on function private.rate_limit_clear(text, bytea) to authenticated;
