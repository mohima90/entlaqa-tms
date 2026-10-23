-- Account e-mails sent the moment the action commits (WP-ADM-05 follow-up; PO 23 Oct 2026: "every e-mail arrives
-- immediately" - the password reset, the set-up code of an authenticator app, the notices). Class: T
-- (platform.message_deliveries, private.account_mail_requests) + P. PII: the account e-mail queue's and the
-- delivery log's usual rules (an address only while the message waits).
--
-- Built on 20261026110000 (the inline invitation / test e-mail core: a delivery queued with the SHA-256 of a
-- request secret, claimed under the lease the worker's sender shares, finished by the web app) and on the
-- account e-mail queue of 20261010120000 / 20261012110000 / 20261013090100.
--
-- THE SAFETY NET IS THE QUEUE THAT ALREADY EXISTS. An action still queues its account e-mail request as before
-- (password changed, authenticator set-up / removal, security-policy change, sign-in unlocked, account locked,
-- wrong codes). In the same transaction it TAGS the requests that transaction created with the SHA-256 of a
-- secret only that web request holds; the tag moves the request's `not_before` two minutes ahead so the worker
-- leaves it alone for a moment. After the response the web app CLAIMS its requests with the secret, writes the
-- e-mail (the worker's own wording), and queues the delivery AND removes the request in ONE transaction; the
-- delivery is then sent under the shared lease. Whatever fails, the worker finishes the job: an untouched request
-- is leased by the worker after the two minutes, a claimed one when its (shorter) lease ends, an unfinished
-- delivery by the inline rescue task. Nothing is sent twice (the delivery's source_key is unique per
-- organization).
--
-- The worker's answer to a request (who gets it, in which organization and language, banned / no membership /
-- over the daily ceiling -> digest) is the SAME code: private.account_mail_claim_core(hash) is the body of
-- claim_account_mail_request, now used by both.
--
-- Password reset through Auth's Send Email hook (type recovery): Auth has already created the token; the hook
-- route reads the facts (inline_recovery_facts), queues the e-mail as a delivery (inline_recovery_queue, at most
-- 5 reset e-mails an hour per person in the database, on top of the route's limiter) and sends it under the
-- shared lease. No Auth admin key anywhere in the web tier.
--
-- Security shape:
--   * Everything new is owned by account_mail_guard (the role that already reads accounts and memberships) or,
--     for the authenticator tables, by tenant_guard; neither can log in. The web app reaches them only through
--     the functions below, each of which checks the LOGIN role (app_server).
--   * A request is claimed only with the secret of the transaction that created it (tag: created_txid =
--     pg_current_xact_id()); the recipient, organization and person come from the database (resolved at the claim
--     and stored on the request), never from the web app; the template must be the kind's own, and the
--     platform-only variant is REQUIRED for an account that belongs to several organizations or holds a platform
--     role (WP-ADM-05 security review M1).
--   * The sender settings (sealed secrets) are returned only together with the claim of a delivery
--     (inline_mail_claim, unchanged).
-- Expand-first: new columns, a new function body shared by the old function, and new functions.

-- ---------------------------------------------------------------------------------------------------
-- The queue: who may claim a request, and what the claim resolved
-- ---------------------------------------------------------------------------------------------------
alter table private.account_mail_requests
  add column inline_claim_hash bytea,
  add column created_txid xid8 not null default pg_current_xact_id(),
  add column resolved_email text,
  add column resolved_tenant_id uuid,
  add column resolved_person_id uuid,
  add column inline_claim_attempt smallint,
  add constraint account_mail_requests_inline_hash_check
    check (inline_claim_hash is null or octet_length(inline_claim_hash) = 32);

comment on column private.account_mail_requests.inline_claim_hash is
  'SHA-256 of the secret only the web request that created the request holds: the key to claim it for an immediate e-mail (WP-ADM-05 follow-up).';
comment on column private.account_mail_requests.created_txid is
  'The transaction that created the request: only that transaction may tag it for an immediate e-mail.';
comment on column private.account_mail_requests.inline_claim_attempt is
  'The attempt number the immediate claim leased the request under: a web runner whose lease ran out (the worker leased it again, attempts grew) can no longer queue or remove it.';
comment on column private.account_mail_requests.resolved_email is
  'Set by the immediate claim: the account''s address, so the queue function cannot be told another one. Removed with the request.';

create index account_mail_requests_inline_idx on private.account_mail_requests (inline_claim_hash)
  where inline_claim_hash is not null;

-- ---------------------------------------------------------------------------------------------------
-- What account_mail_guard needs beyond the worker functions: names for the e-mail, the delivery log
-- ---------------------------------------------------------------------------------------------------
grant select (display_name_ar, display_name_en) on platform.persons to account_mail_guard;
grant select (name_ar, name_en) on platform.tenants to account_mail_guard;
-- (account_mail_guard keeps its four read columns of the delivery log and no write: the delivery itself is inserted
-- by inline_mail_guard, below.)
create policy message_deliveries_inline_insert_account on platform.message_deliveries for insert to inline_mail_guard
  with check (inline_claim_hash is not null and (source_key like 'account:%' or source_key like 'recovery:%'));

-- The authenticator tables belong to tenant_guard: three internal functions it owns, executable by
-- account_mail_guard ONLY (no other role, not the web app, can call them).
create or replace function private.mfa_setup_peek(p_factor_id uuid, p_user_id uuid,
                                                  out set_up_at timestamptz, out setup_user_agent text)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  select k.created_at, k.setup_user_agent into set_up_at, setup_user_agent
  from private.mfa_factor_confirmations k
  where k.factor_id = p_factor_id and k.user_id = p_user_id and k.confirmed_at is null
    and exists (select 1 from private.auth_mfa_factor f
                where f.id = k.factor_id and f.user_id = k.user_id and f.status = 'verified');
end
$$;
comment on function private.mfa_setup_peek(uuid, uuid) is
  'WP-ADM-05 follow-up. When and with which browser an unconfirmed authenticator app was set up; nothing when it is gone or confirmed. Internal: account_mail_guard only.';

create or replace function private.mfa_setup_issue(
  p_factor_id uuid, p_user_id uuid, p_code_hash bytea, p_remove_hash bytea)
returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_done integer;
begin
  if octet_length(p_code_hash) is distinct from 32 or octet_length(p_remove_hash) is distinct from 32 then
    raise exception 'code and token hashes must be SHA-256' using errcode = 'invalid_parameter_value';
  end if;
  update private.mfa_factor_confirmations k
  set code_hash = p_code_hash, code_expires_at = now() + private.mfa_code_lifetime(), code_issued_at = now(),
      code_attempts = 0,
      remove_token_hash = p_remove_hash, remove_expires_at = now() + private.mfa_remove_link_lifetime()
  where k.factor_id = p_factor_id and k.user_id = p_user_id and k.confirmed_at is null
    and exists (select 1 from private.auth_mfa_factor f
                where f.id = k.factor_id and f.user_id = k.user_id and f.status = 'verified');
  get diagnostics v_done = row_count;
  return v_done = 1;
end
$$;
comment on function private.mfa_setup_issue(uuid, uuid, bytea, bytea) is
  'SECURITY-RELEVANT (WP-ADM-05 follow-up; the worker''s issue_mfa_factor_tokens without the worker check). Stores the hashes of the set-up e-mail''s code and link. Internal: account_mail_guard only.';

create or replace function private.user_has_totp_app(p_user_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from private.auth_mfa_factor f
                 where f.user_id = p_user_id and f.factor_type = 'totp' and f.status = 'verified');
$$;
comment on function private.user_has_totp_app(uuid) is
  'WP-ADM-05 follow-up. Does the account have a verified authenticator app (the reset e-mail then says a code will be asked)? Internal: account_mail_guard only.';

-- ---------------------------------------------------------------------------------------------------
-- The kind's own template
-- ---------------------------------------------------------------------------------------------------
create or replace function private.account_mail_base_template(p_kind text)
returns text
language sql immutable
set search_path = ''
as $$
  select case p_kind
    when 'password_reset' then 'platform.password_reset'
    when 'password_changed' then 'platform.password_changed'
    when 'mfa_factor_added' then 'platform.mfa_factor_added'
    when 'mfa_factor_removed' then 'platform.mfa_factor_removed'
    when 'security_policy_changed' then 'platform.security_policy_changed'
    when 'security_digest' then 'platform.security_digest'
    when 'account_locked' then 'platform.account_locked'
    when 'sign_in_unlocked' then 'platform.sign_in_unlocked'
    when 'mfa_code_locked' then 'platform.mfa_code_locked'
  end;
$$;
comment on function private.account_mail_base_template(text) is
  'WP-ADM-05 follow-up. The e-mail template of an account e-mail request kind. Internal: account_mail_guard only.';

-- ---------------------------------------------------------------------------------------------------
-- The worker's lease and answer as ONE body: private.account_mail_claim_core(hash)
-- ---------------------------------------------------------------------------------------------------
-- p_hash null: the worker's claim (20261013090100) - the oldest waiting request, expired ones swept, due digests
-- queued. p_hash given: the immediate claim - the oldest unleased request tagged with that hash, with a lease of
-- two minutes (a request nobody finishes is the worker's again soon). Same answers either way.
create or replace function private.account_mail_claim_core(p_hash bytea)
returns table (id uuid, kind text, outcome text, email text, user_id uuid, tenant_id uuid, person_id uuid,
               locale text, attempts integer, factor_id uuid, mfa_reason text, detail jsonb, lock_minutes integer)
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_request record;
  v_account record;
  v_member record;
begin
  if p_hash is null then
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
  end if;

  update private.account_mail_requests r
  set leased_until = now() + case when p_hash is null then interval '5 minutes' else interval '2 minutes' end,
      attempts = r.attempts + 1
  where r.id = (select w.id from private.account_mail_requests w
                where (w.leased_until is null or w.leased_until <= now())
                  and (case when p_hash is null then w.not_before <= now() else w.inline_claim_hash = p_hash end)
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
  -- into the account's next digest instead of being sent on its own - never dropped (final re-review L1).
  if v_request.kind in ('mfa_factor_added', 'mfa_factor_removed', 'security_policy_changed', 'password_changed',
                        'mfa_code_locked')
     and (select count(*) from (
            select 1 from platform.message_deliveries d
            join platform.tenant_memberships m on m.tenant_id = d.tenant_id and m.person_id = d.recipient_person_id
            where m.user_id = v_account.id and d.created_at > now() - interval '24 hours'
              and d.template in ('platform.mfa_factor_added', 'platform.mfa_factor_added_platform',
                                 'platform.mfa_factor_removed',
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
comment on function private.account_mail_claim_core(bytea) is
  'SECURITY-RELEVANT (T-M2-17, T-M2-10, T-M2-11, WP-ADM-05 follow-up). The body of the account e-mail lease for the worker (null) and for the web app''s immediate claim (the hash of its secret): resolves account, organization and language, or why nothing is sent; security notices over the daily ceiling are held for the digest. Internal: account_mail_guard only.';

-- The worker's entry point, unchanged in behavior.
create or replace function private.claim_account_mail_request()
returns table (id uuid, kind text, outcome text, email text, user_id uuid, tenant_id uuid, person_id uuid,
               locale text, attempts integer, factor_id uuid, mfa_reason text, detail jsonb, lock_minutes integer)
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
  return query select * from private.account_mail_claim_core(null);
end
$$;
comment on function private.claim_account_mail_request() is
  'SECURITY-RELEVANT (T-M2-17, T-M2-10, T-M2-11). Worker: leases the oldest waiting account e-mail request and resolves account, organization and language (and, for authenticator notices, the app and why; for policy-change notices, what changed and who changed it; for the lockout and wrong-codes e-mails, the pause''s minutes). Security notices over the account''s daily ceiling are held for its hourly digest (outcome held); due digests are queued. app_worker system claims only.';

-- ---------------------------------------------------------------------------------------------------
-- Tag (in the action's transaction)
-- ---------------------------------------------------------------------------------------------------
-- The requests THIS transaction created, for the caller's own account or organization (a transaction without
-- claims - the sign-in lock, a completed reset - tags what it created itself). The worker leaves them alone for
-- two minutes.
create or replace function private.inline_account_mail_tag(p_hash bytea)
returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_user uuid := private.request_user_id();
  v_tenant uuid := private.current_tenant_id();
  v_done integer;
begin
  if session_user <> 'app_server' then
    raise exception 'reserved to the web app' using errcode = 'insufficient_privilege';
  end if;
  if p_hash is null or octet_length(p_hash) <> 32 then
    raise exception 'invalid inline e-mail key' using errcode = 'invalid_parameter_value';
  end if;
  update private.account_mail_requests r
  set inline_claim_hash = p_hash, not_before = greatest(r.not_before, now() + interval '2 minutes')
  where r.created_txid = pg_current_xact_id() and r.inline_claim_hash is null and r.kind <> 'password_reset'
    and (v_user is null or r.user_id = v_user or (v_tenant is not null and r.tenant_id = v_tenant));
  get diagnostics v_done = row_count;
  return v_done;
end
$$;
comment on function private.inline_account_mail_tag(bytea) is
  'SECURITY-RELEVANT (WP-ADM-05 follow-up). Marks the account e-mail requests the calling transaction created with the SHA-256 of a secret only that web request holds (the key to claim them for an immediate e-mail); the worker leaves them alone for two minutes. app_server only.';

-- ---------------------------------------------------------------------------------------------------
-- Claim (after the commit): the next tagged request, everything the e-mail needs
-- ---------------------------------------------------------------------------------------------------
-- outcome: send | held | unknown_account | banned | too_soon | no_membership | factor_gone | none (nothing waits).
-- Every outcome but `send` has removed the request already (the worker's `finish` / the digest).
create or replace function private.inline_account_mail_claim(p_secret bytea, p_locked_quiet_minutes integer)
returns table (outcome text, request_id uuid, kind text, user_id uuid, tenant_id uuid, person_id uuid, email text,
               locale text, attempts integer, factor_id uuid, mfa_reason text, detail jsonb, lock_minutes integer,
               organization_ar text, organization_en text, recipient_ar text, recipient_en text,
               recent_count integer, quiet_count integer, tenant_recent_count integer, platform_sender boolean,
               changed_by_ar text, changed_by_en text, set_up_at timestamptz, setup_user_agent text,
               action_color text, link_color text, logo_asset_id uuid)
language plpgsql volatile security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  c record;
  v_template text;
  v_quiet integer;
  v_by uuid;
begin
  if session_user <> 'app_server' then
    raise exception 'reserved to the web app' using errcode = 'insufficient_privilege';
  end if;
  if p_secret is null or octet_length(p_secret) <> 32
     or p_locked_quiet_minutes is null or p_locked_quiet_minutes not between 0 and 1440 then
    outcome := 'none';
    return next;
    return;
  end if;
  select * into c from private.account_mail_claim_core(pg_catalog.sha256(p_secret));
  if c.id is null then
    outcome := 'none';
    return next;
    return;
  end if;
  request_id := c.id;
  kind := c.kind;
  if c.outcome <> 'send' then
    -- The worker's `finishAccountMailRequest` for a request that is not sent (held ones are gone already).
    delete from private.account_mail_requests r where r.id = c.id;
    outcome := c.outcome;
    return next;
    return;
  end if;
  user_id := c.user_id;
  tenant_id := c.tenant_id;
  person_id := c.person_id;
  email := c.email;
  locale := c.locale;
  attempts := c.attempts;
  factor_id := c.factor_id;
  mfa_reason := c.mfa_reason;
  detail := c.detail;
  lock_minutes := c.lock_minutes;
  v_template := private.account_mail_base_template(c.kind);
  v_quiet := case c.kind when 'account_locked' then p_locked_quiet_minutes
                         when 'mfa_code_locked' then least(greatest(coalesce(c.lock_minutes, 1), 1), 1440)
                         else 0 end;
  select t.name_ar, t.name_en into organization_ar, organization_en
  from platform.tenants t where t.id = c.tenant_id;
  select coalesce(p.display_name_ar, p.display_name_en), p.display_name_en into recipient_ar, recipient_en
  from platform.persons p where p.tenant_id = c.tenant_id and p.id = c.person_id;
  select count(*) filter (where d.recipient_person_id = c.person_id and d.created_at > now() - interval '1 hour'),
         count(*) filter (where d.recipient_person_id = c.person_id
                            and d.created_at > now() - make_interval(mins => v_quiet)),
         count(*) filter (where d.created_at > now() - interval '1 hour')
    into recent_count, quiet_count, tenant_recent_count
  from platform.message_deliveries d
  -- (the platform-only variant of the set-up e-mail counts with it, as do the other caps)
  where d.tenant_id = c.tenant_id and d.template in (v_template, v_template || '_platform')
    and d.created_at > now() - interval '25 hours';
  platform_sender := private.account_sender_is_platform(c.user_id);
  select r.action_color, r.link_color, r.logo_asset_id into action_color, link_color, logo_asset_id
  from private.auth_mail_route(c.tenant_id) r;
  if c.kind = 'security_policy_changed' then
    v_by := private.try_uuid(c.detail ->> 'changed_by');
    if v_by is not null then
      select coalesce(p.display_name_ar, p.display_name_en), p.display_name_en into changed_by_ar, changed_by_en
      from platform.persons p where p.tenant_id = c.tenant_id and p.id = v_by;
    end if;
  elsif c.kind = 'mfa_factor_added' then
    select s.set_up_at, s.setup_user_agent into set_up_at, setup_user_agent
    from private.mfa_setup_peek(c.factor_id, c.user_id) s;
    if set_up_at is null then
      -- The app is gone or already confirmed: nothing to send.
      delete from private.account_mail_requests r where r.id = c.id;
      outcome := 'factor_gone';
      return next;
      return;
    end if;
  end if;
  -- What the queue function may send to: stored here, so the web app cannot name another address.
  update private.account_mail_requests r
  set resolved_email = lower(c.email), resolved_tenant_id = c.tenant_id, resolved_person_id = c.person_id,
      inline_claim_attempt = c.attempts
  where r.id = c.id;
  outcome := 'send';
  return next;
end
$$;
comment on function private.inline_account_mail_claim(bytea, integer) is
  'SECURITY-RELEVANT (WP-ADM-05 follow-up). Claims the next account e-mail request this web request tagged (it needs the request''s secret), under a two-minute lease, and returns who gets it, in which organization, language and look, and the counts behind the caps. Any outcome but send has removed the request. app_server only.';

-- ---------------------------------------------------------------------------------------------------
-- Queue the delivery and remove the request, atomically
-- ---------------------------------------------------------------------------------------------------
-- Step one (account_mail_guard, internal): the claimed request, the template it may use and - for an
-- authenticator set-up - the hashes of its code and link; removes the request and says whom the e-mail goes to.
-- No row: the request is not the secret holder's, not claimed, gone, or its app is gone.
create or replace function private.account_mail_consume(
  p_secret bytea, p_request_id uuid, p_template text, p_code_hash bytea, p_remove_hash bytea)
returns table (tenant_id uuid, person_id uuid, email text, request_id uuid)
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  r private.account_mail_requests%rowtype;
  v_base text;
  v_expected text;
begin
  if p_secret is null or octet_length(p_secret) <> 32 or p_request_id is null then
    raise exception 'invalid inline e-mail' using errcode = 'invalid_parameter_value';
  end if;
  select * into r from private.account_mail_requests q
  where q.id = p_request_id and q.inline_claim_hash = pg_catalog.sha256(p_secret)
    and q.leased_until > now() and q.resolved_email is not null and q.resolved_tenant_id is not null
    -- the lease is THIS claim's: the worker leasing the request again (after the two minutes) bumps `attempts`
    and q.inline_claim_attempt = q.attempts
  for update;
  if not found then
    return;
  end if;
  v_base := private.account_mail_base_template(r.kind);
  -- The account e-mails that open an account are sent through the platform sender ONLY for an account of several
  -- organizations or a platform role: the platform variant is required there, and not used elsewhere.
  v_expected := case when r.kind = 'mfa_factor_added' and private.account_sender_is_platform(r.user_id)
                     then v_base || '_platform' else v_base end;
  if v_base is null or r.kind in ('password_reset', 'security_digest') or p_template is distinct from v_expected then
    raise exception 'this e-mail cannot be queued' using errcode = 'insufficient_privilege';
  end if;
  if r.kind = 'mfa_factor_added' then
    if not private.mfa_setup_issue(r.factor_id, r.user_id, p_code_hash, p_remove_hash) then
      delete from private.account_mail_requests q where q.id = r.id;
      return;
    end if;
  end if;
  delete from private.account_mail_requests q where q.id = r.id;
  return query select r.resolved_tenant_id, r.resolved_person_id, r.resolved_email, r.id;
end
$$;
comment on function private.account_mail_consume(bytea, uuid, text, bytea, bytea) is
  'SECURITY-RELEVANT (WP-ADM-05 follow-up). Step one of queueing a claimed account e-mail: checks the secret, the kind''s own template (the platform-only variant for an account of several organizations or a platform role), stores the set-up code and link hashes, removes the request and says whom it goes to. Internal: inline_mail_guard only.';

-- Step two (inline_mail_guard, the web app): the delivery, in the same call.
create or replace function private.inline_account_mail_queue(
  p_secret bytea, p_request_id uuid, p_template text, p_version integer, p_locale text, p_subject text,
  p_html text, p_text text, p_code_hash bytea, p_remove_hash bytea)
returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  t record;
  v_id uuid;
begin
  if session_user <> 'app_server' then
    raise exception 'reserved to the web app' using errcode = 'insufficient_privilege';
  end if;
  if p_secret is null or octet_length(p_secret) <> 32 or p_request_id is null or p_subject is null
     or p_html is null or p_text is null or p_locale not in ('ar', 'en') then
    raise exception 'invalid inline e-mail' using errcode = 'invalid_parameter_value';
  end if;
  select * into t from private.account_mail_consume(p_secret, p_request_id, p_template, p_code_hash, p_remove_hash);
  if not found then
    return null;
  end if;
  insert into platform.message_deliveries
    (tenant_id, template, template_version, locale, recipient_person_id, destination, destination_masked, subject,
     html_body, text_body, source_key, inline_claim_hash)
  values (t.tenant_id, p_template, p_version, p_locale, t.person_id, t.email,
          case when position('@' in t.email) > 1 then left(t.email, 1) || '***' || substr(t.email, position('@' in t.email))
               else '***' end,
          p_subject, p_html, p_text, 'account:' || t.request_id::text, pg_catalog.sha256(p_secret))
  on conflict (tenant_id, source_key) where source_key is not null do nothing
  returning id into v_id;
  return v_id;
end
$$;
comment on function private.inline_account_mail_queue(bytea, uuid, text, integer, text, text, text, text, bytea, bytea) is
  'SECURITY-RELEVANT (WP-ADM-05 follow-up). Queues the e-mail of a claimed account e-mail request for an immediate send and removes the request, in one step; the address, organization and person are the ones the claim resolved, the template the kind''s own. For an authenticator set-up it also stores the hashes of the code and link. app_server only.';

-- A claimed request the web app will not send (over a cap, content refused): removed, as the worker does.
create or replace function private.inline_account_mail_done(p_secret bytea, p_request_id uuid)
returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_done integer;
begin
  if session_user <> 'app_server' then
    raise exception 'reserved to the web app' using errcode = 'insufficient_privilege';
  end if;
  if p_secret is null or octet_length(p_secret) <> 32 or p_request_id is null then
    return false;
  end if;
  delete from private.account_mail_requests q
  where q.id = p_request_id and q.inline_claim_hash = pg_catalog.sha256(p_secret)
    and (q.inline_claim_attempt is null or q.inline_claim_attempt = q.attempts);
  get diagnostics v_done = row_count;
  return v_done = 1;
end
$$;
comment on function private.inline_account_mail_done(bytea, uuid) is
  'SECURITY-RELEVANT (WP-ADM-05 follow-up). Removes an account e-mail request the web app claimed and decided not to send. app_server only.';

-- ---------------------------------------------------------------------------------------------------
-- Password reset through the Send Email hook (type recovery)
-- ---------------------------------------------------------------------------------------------------
-- The facts for the reset e-mail of the account Auth is e-mailing: the address Auth stores, the organization
-- whose look and language the e-mail uses, whether the platform sender must carry it, whether the account has an
-- authenticator app (the page then asks for a code). No row: no account, a banned one, no usable membership.
create or replace function private.inline_recovery_facts(p_user_id uuid)
returns table (email text, tenant_id uuid, person_id uuid, locale text, platform_sender boolean, has_app boolean,
               organization_ar text, organization_en text, action_color text, link_color text, logo_asset_id uuid)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if session_user <> 'app_server' then
    raise exception 'reserved to the web app' using errcode = 'insufficient_privilege';
  end if;
  return query
    select a.email, a.tenant_id, a.person_id, a.locale, a.platform_sender, private.user_has_totp_app(p_user_id),
           t.name_ar, t.name_en, r.action_color, r.link_color, r.logo_asset_id
    from private.auth_mail_account(p_user_id) a
    join platform.tenants t on t.id = a.tenant_id
    left join lateral (select x.action_color, x.link_color, x.logo_asset_id
                       from private.auth_mail_route(a.tenant_id) x) r on true;
end
$$;
comment on function private.inline_recovery_facts(uuid) is
  'SECURITY-RELEVANT (WP-ADM-05 follow-up). The Send Email hook, type recovery: address, organization, person, language, sender rule, authenticator app and look of the account Auth is e-mailing. No sender settings. app_server only (the route verifies Auth''s signature first).';

-- Step one (account_mail_guard, internal): may this reset e-mail go to this address now? The account's own
-- address, the reset's own template (the platform-only variant where the sender rule requires it), at most five
-- reset e-mails an hour per person (on top of the route's limiter). No row: no usable account or over the cap.
create or replace function private.recovery_target(p_user_id uuid, p_to text, p_template text)
returns table (tenant_id uuid, person_id uuid, email text)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  a record;
  v_expected text;
begin
  select * into a from private.auth_mail_account(p_user_id);
  if not found then
    return;
  end if;
  v_expected := case when a.platform_sender then 'platform.password_reset_platform' else 'platform.password_reset' end;
  if lower(a.email) <> lower(btrim(p_to)) or p_template is distinct from v_expected then
    raise exception 'this e-mail cannot be queued' using errcode = 'insufficient_privilege';
  end if;
  if (select count(*) from platform.message_deliveries d
      where d.tenant_id = a.tenant_id and d.recipient_person_id = a.person_id
        and d.template in ('platform.password_reset', 'platform.password_reset_platform')
        and d.created_at > now() - interval '1 hour') >= 5 then
    return;
  end if;
  return query select a.tenant_id, a.person_id, lower(a.email)::text;
end
$$;
comment on function private.recovery_target(uuid, text, text) is
  'SECURITY-RELEVANT (WP-ADM-05 follow-up). Step one of queueing a reset e-mail from the Send Email hook: the account''s own address and the reset''s own template (platform-only variant where required), at most five an hour per person. Internal: inline_mail_guard only.';

-- Step two (inline_mail_guard, the web app): the delivery. Null: over the cap, no usable account, or the same
-- webhook queued already.
create or replace function private.inline_recovery_queue(
  p_user_id uuid, p_template text, p_version integer, p_locale text, p_to text, p_subject text, p_html text,
  p_text text, p_source_key text, p_claim_hash bytea)
returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  t record;
  v_id uuid;
begin
  if session_user <> 'app_server' then
    raise exception 'reserved to the web app' using errcode = 'insufficient_privilege';
  end if;
  if p_claim_hash is null or octet_length(p_claim_hash) <> 32 or p_to is null or p_subject is null
     or p_html is null or p_text is null or p_locale not in ('ar', 'en')
     or p_source_key is null or p_source_key !~ '^recovery:[a-f0-9]{16,64}$' then
    raise exception 'invalid inline e-mail' using errcode = 'invalid_parameter_value';
  end if;
  select * into t from private.recovery_target(p_user_id, p_to, p_template);
  if not found then
    return null;
  end if;
  insert into platform.message_deliveries
    (tenant_id, template, template_version, locale, recipient_person_id, destination, destination_masked, subject,
     html_body, text_body, source_key, inline_claim_hash)
  values (t.tenant_id, p_template, p_version, p_locale, t.person_id, t.email,
          case when position('@' in t.email) > 1 then left(t.email, 1) || '***' || substr(t.email, position('@' in t.email))
               else '***' end,
          p_subject, p_html, p_text, p_source_key, p_claim_hash)
  on conflict (tenant_id, source_key) where source_key is not null do nothing
  returning id into v_id;
  return v_id;
end
$$;
comment on function private.inline_recovery_queue(uuid, text, integer, text, text, text, text, text, text, bytea) is
  'SECURITY-RELEVANT (WP-ADM-05 follow-up). The Send Email hook, type recovery: queues the reset e-mail for an immediate send to the account''s own address (platform-only variant where the sender rule requires it), at most five an hour per person. app_server only (the route verifies Auth''s signature first).';

-- The "password changed" notice after a reset (no session) needs OUR reset e-mail to the account within 65
-- minutes and its link used. The reset e-mail of an account of several organizations or a platform role goes
-- out as the platform-only variant (20261026100200): that template counts too (it did not, so such an account
-- never got the notice).
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
                    where m.user_id = p_user_id
                      and d.template in ('platform.password_reset', 'platform.password_reset_platform')
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
  'SECURITY-RELEVANT (FR-IAM-13/16, T-M2-17). Queues the "password changed" notice of an account (the signed-in user''s own, or after a reset of ours - the platform-only reset e-mail counts too). app_server only.';

-- ---------------------------------------------------------------------------------------------------
-- Ownership hand-over and grants
-- ---------------------------------------------------------------------------------------------------
grant create on schema private to account_mail_guard, tenant_guard, inline_mail_guard;
alter function private.mfa_setup_peek(uuid, uuid) owner to tenant_guard;
alter function private.mfa_setup_issue(uuid, uuid, bytea, bytea) owner to tenant_guard;
alter function private.user_has_totp_app(uuid) owner to tenant_guard;
alter function private.account_mail_base_template(text) owner to account_mail_guard;
alter function private.account_mail_claim_core(bytea) owner to account_mail_guard;
alter function private.inline_account_mail_tag(bytea) owner to account_mail_guard;
alter function private.inline_account_mail_claim(bytea, integer) owner to account_mail_guard;
alter function private.account_mail_consume(bytea, uuid, text, bytea, bytea) owner to account_mail_guard;
alter function private.recovery_target(uuid, text, text) owner to account_mail_guard;
alter function private.inline_account_mail_queue(bytea, uuid, text, integer, text, text, text, text, bytea, bytea) owner to inline_mail_guard;
alter function private.inline_account_mail_done(bytea, uuid) owner to account_mail_guard;
alter function private.inline_recovery_facts(uuid) owner to account_mail_guard;
alter function private.inline_recovery_queue(uuid, text, integer, text, text, text, text, text, text, bytea) owner to inline_mail_guard;
revoke create on schema private from account_mail_guard, tenant_guard, inline_mail_guard;

revoke all on function private.mfa_setup_peek(uuid, uuid) from public;
revoke all on function private.mfa_setup_issue(uuid, uuid, bytea, bytea) from public;
revoke all on function private.user_has_totp_app(uuid) from public;
revoke all on function private.account_mail_base_template(text) from public;
revoke all on function private.account_mail_claim_core(bytea) from public;
revoke all on function private.account_mail_consume(bytea, uuid, text, bytea, bytea) from public;
revoke all on function private.recovery_target(uuid, text, text) from public;
revoke all on function private.inline_account_mail_tag(bytea) from public;
revoke all on function private.inline_account_mail_claim(bytea, integer) from public;
revoke all on function private.inline_account_mail_queue(bytea, uuid, text, integer, text, text, text, text, bytea, bytea) from public;
revoke all on function private.inline_account_mail_done(bytea, uuid) from public;
revoke all on function private.inline_recovery_facts(uuid) from public;
revoke all on function private.inline_recovery_queue(uuid, text, integer, text, text, text, text, text, text, bytea) from public;

-- Internal helpers: the guard that uses them, nobody else.
grant execute on function private.mfa_setup_peek(uuid, uuid) to account_mail_guard;
grant execute on function private.mfa_setup_issue(uuid, uuid, bytea, bytea) to account_mail_guard;
grant execute on function private.user_has_totp_app(uuid) to account_mail_guard;
grant execute on function private.account_mail_consume(bytea, uuid, text, bytea, bytea) to inline_mail_guard;
grant execute on function private.recovery_target(uuid, text, text) to inline_mail_guard;
-- The web app's functions run inside `set local role authenticated` transactions; each checks the LOGIN role.
grant execute on function private.inline_account_mail_tag(bytea) to authenticated;
grant execute on function private.inline_account_mail_claim(bytea, integer) to authenticated;
grant execute on function private.inline_account_mail_queue(bytea, uuid, text, integer, text, text, text, text, bytea, bytea) to authenticated;
grant execute on function private.inline_account_mail_done(bytea, uuid) to authenticated;
grant execute on function private.inline_recovery_facts(uuid) to authenticated;
grant execute on function private.inline_recovery_queue(uuid, text, integer, text, text, text, text, text, text, bytea) to authenticated;
-- The worker's rescue (a direct statement under `authenticated`) reads the codes of messages that wait for a sender
-- from the one function that names them, instead of repeating the list.
grant execute on function private.email_waiting_codes() to authenticated;
