-- E-mail sending set up inside the product (WP-ADM-01; FR-NTF-11, FR-NTF-02 sending, FR-ADM-17 platform e-mail
-- settings; T-M2-47, T-M2-48, T-M2-20; business flow docs/business-flows/EP-EMAIL-email-sending.md, agreed by
-- the PO on 17 Oct 2026; Kawadir ATS's platform_email_settings and sender rule). Class: P (platform) and T.
--
--   The sender rule (Kawadir): an organization's own provider when it is configured AND enabled, else the
--   platform sender — only once the Super Admin's test e-mail went out (verified). No automatic switch to
--   another sender when the organization's own provider fails: its errors are shown to the Organization Admin.
--   While no sender is verified, e-mails WAIT in the queue (nothing is lost; the Super Admin sees a warning).
--
--   private.email_credentials_key   the worker's PUBLIC key (X25519, base64url) and its id, published by the
--                                   worker, which derives the key pair from its secret EMAIL_CREDENTIALS_KEY.
--                                   The web app seals provider secrets with it (sealed box: an ephemeral
--                                   X25519 key, HKDF-SHA256, AES-256-GCM bound to the organization and the
--                                   provider); only the worker can open them. No row: e-mail sending is not set
--                                   up yet (the pages say so) — nothing else stops working.
--   private.platform_email_settings the platform sender (one row): provider, its non-secret options, the
--                                   sealed secrets (write-only), sender name and address, verified or not, and
--                                   the latest test e-mail. Super Admins only (private.platform_admin_caller()).
--   private.tenant_email_settings   an organization's own provider (one row per organization, optional): the
--                                   same plus reply-to and enabled. Organization Admins (platform.tenant.manage)
--                                   change it; members with platform.tenant.read see it (never the secrets).
--   private.invitation_mail_skips   the invitation e-mails the mailer did NOT queue (the member it was sent
--                                   for may no longer invite, T-M2-20): the users list says «لم تُرسل الدعوة»
--                                   instead of "sent" until a new code is sent.
--   email_guard                     NOLOGIN owner of the functions below. No BYPASSRLS: explicit grants and
--                                   policies `to email_guard`, nothing else (pattern of platform_admin_guard).
--
-- Secrets are never readable by an application role: no table here is granted to authenticated; the sealed
-- secrets leave the database only to the worker's job transactions (private.email_route, private.claim_email_tests),
-- and the web app cannot open them (it never holds the private key). Audit records name what changed, never a
-- secret and never an address. Errors (SQLSTATE → @jadarat/platform-db):
--   42501 wrong login role, no valid session / job, or not allowed          → NOT_FOUND / FORBIDDEN
--   JE001 invalid input; the message is the field (provider, options, credentials, from_name, from_address,
--         reply_to, test_to, enabled)
--   JE002 the settings changed meanwhile (version)                            → CONFLICT_VERSION
--   JE003 the secrets were sealed with another key than the worker's current one (or none is published)
--   JE004 enabling an organization's provider that has not been verified by a test e-mail
--   JE005 a test of an organization's provider that is not configured

-- ---------------------------------------------------------------------------------------------------
-- Role email_guard (attribute policy as in 20260930120000)
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'email_guard') then
    create role email_guard nologin noinherit nobypassrls;
  end if;
end
$$;

do $$
declare
  r record;
begin
  select rolname, rolcanlogin, rolinherit, rolsuper, rolbypassrls, rolreplication, rolcreatedb, rolcreaterole
    into r from pg_roles where rolname = 'email_guard';
  if r.rolsuper or r.rolbypassrls or r.rolreplication then
    raise exception 'role email_guard must be NOSUPERUSER NOBYPASSRLS NOREPLICATION; fix it as a superuser first';
  end if;
  if r.rolinherit or r.rolcreatedb or r.rolcreaterole or r.rolcanlogin then
    alter role email_guard nologin noinherit nocreatedb nocreaterole;
  end if;
  if exists (select 1 from pg_auth_members m join pg_roles g on g.oid = m.roleid join pg_roles u on u.oid = m.member
             where g.rolname = 'email_guard' and (m.inherit_option or m.set_option)
               and not u.rolsuper and u.rolname <> current_user) then
    raise exception 'role email_guard must have no members besides the migration role';
  end if;
end
$$;

-- The migration role hands function ownership to the guard.
grant email_guard to current_user;
grant usage on schema platform, private to email_guard;

-- ---------------------------------------------------------------------------------------------------
-- Helpers (immutable, no data)
-- ---------------------------------------------------------------------------------------------------
-- The e-mail address syntax of @jadarat/platform-notifications isEmailAddress (one @, no spaces, brackets or
-- control characters, a dotted domain of letters, digits and hyphens).
create or replace function private.email_address_is_valid(p_value text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select p_value is not null and char_length(p_value) <= 254
         and p_value ~ '^[^][[:space:]@<>()",;:\\]{1,64}@[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$'
         and p_value !~ '[[:cntrl:]]';
$$;

comment on function private.email_address_is_valid(text) is
  'E-mail address syntax (as @jadarat/platform-notifications isEmailAddress; WP-ADM-01).';

-- `n.aldossari@alraya.example` → `n***@alraya.example` (as maskEmailAddress).
create or replace function private.email_address_masked(p_value text)
returns text
language sql immutable
set search_path = ''
as $$
  select case when p_value is null or strpos(p_value, '@') < 2 then '***'
              else left(p_value, 1) || '***' || substring(p_value from '@[^@]*$') end;
$$;

comment on function private.email_address_masked(text) is 'Masked e-mail address for display and logs (WP-ADM-01).';

-- A sender display name: one line, 1–100 characters, no control characters.
create or replace function private.email_sender_name_is_valid(p_value text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select p_value is not null and char_length(btrim(p_value)) between 1 and 100 and p_value !~ '[[:cntrl:]]'
         and p_value !~ '[‪-‮⁦-⁩]';
$$;

comment on function private.email_sender_name_is_valid(text) is 'Sender display name: one line of 1–100 characters (WP-ADM-01).';

revoke all on function private.email_address_is_valid(text) from public;
revoke all on function private.email_address_masked(text) from public;
revoke all on function private.email_sender_name_is_valid(text) from public;
grant execute on function private.email_address_is_valid(text), private.email_address_masked(text),
                          private.email_sender_name_is_valid(text) to email_guard;

-- ---------------------------------------------------------------------------------------------------
-- Tables (schema private: reached through the functions below only)
-- ---------------------------------------------------------------------------------------------------
create table private.email_credentials_key (
  id smallint primary key default 1 check (id = 1),
  -- base64url of the first 9 bytes of SHA-256 over the public key: names the key a secret was sealed with.
  key_id text not null check (key_id ~ '^[A-Za-z0-9_-]{12}$'),
  -- The raw 32-byte X25519 public key, base64url without padding.
  public_key text not null check (public_key ~ '^[A-Za-z0-9_-]{43}$'),
  published_at timestamptz not null default now()
);
comment on table private.email_credentials_key is
  'SECURITY-RELEVANT (WP-ADM-01, FR-NTF-11). The worker''s public key for sealing e-mail provider secrets (published by the worker; the private key exists in the worker only). email_guard only.';

create table private.platform_email_settings (
  id smallint primary key default 1 check (id = 1),
  provider text not null
    check (provider in ('resend', 'smtp', 'sendgrid', 'mailgun', 'microsoft_graph')),
  -- Non-secret provider options (SMTP host/port/security/user, Mailgun domain/region, Microsoft 365 tenant
  -- and client ids), validated by the application (zod) and again by the worker.
  options jsonb not null default '{}'::jsonb
    check (jsonb_typeof(options) = 'object' and octet_length(options::text) <= 2000),
  -- The provider's secrets, sealed for the worker: v1.<key id>.<payload>. Write-only.
  credentials_sealed text not null
    check (char_length(credentials_sealed) <= 12000
           and credentials_sealed ~ '^v1\.[A-Za-z0-9_-]{12}\.[A-Za-z0-9_-]{60,}$'),
  from_name text not null check (private.email_sender_name_is_valid(from_name)),
  from_address text not null check (private.email_address_is_valid(from_address)),
  -- verified: a test e-mail went out with exactly this version of the settings.
  status text not null default 'unverified' check (status in ('unverified', 'verified')),
  verified_at timestamptz,
  version integer not null default 1 check (version >= 1),
  updated_at timestamptz not null default now(),
  -- The Super Admin (Auth user id) who saved it last.
  updated_by uuid not null,
  -- The latest test e-mail: the plain recipient only while it waits; its masked form afterwards.
  test_status text check (test_status in ('queued', 'sending', 'sent', 'failed')),
  test_recipient text check (test_recipient is null or private.email_address_is_valid(test_recipient)),
  test_recipient_masked text check (test_recipient_masked is null or char_length(test_recipient_masked) <= 260),
  test_error_code text check (test_error_code is null or test_error_code ~ '^[A-Z0-9_]{2,64}$'),
  test_requested_at timestamptz,
  test_claimed_at timestamptz,
  test_finished_at timestamptz,
  test_attempts smallint not null default 0 check (test_attempts between 0 and 100),
  constraint platform_email_settings_verified_check check ((status = 'verified') = (verified_at is not null)),
  constraint platform_email_settings_test_check check (
    (test_status is null and test_recipient is null and test_requested_at is null)
    or (test_status in ('queued', 'sending') and test_recipient is not null and test_finished_at is null)
    or (test_status in ('sent', 'failed') and test_recipient is null and test_finished_at is not null))
);
comment on table private.platform_email_settings is
  'SECURITY-RELEVANT (FR-ADM-17, FR-NTF-11; WP-ADM-01). The platform sender set by the Super Admin (Kawadir platform_email_settings): verified only after a test e-mail went out. Secrets sealed for the worker. email_guard only.';

create table private.tenant_email_settings (
  tenant_id uuid primary key references platform.tenants (id),
  provider text not null
    check (provider in ('resend', 'smtp', 'sendgrid', 'mailgun', 'microsoft_graph')),
  options jsonb not null default '{}'::jsonb
    check (jsonb_typeof(options) = 'object' and octet_length(options::text) <= 2000),
  credentials_sealed text not null
    check (char_length(credentials_sealed) <= 12000
           and credentials_sealed ~ '^v1\.[A-Za-z0-9_-]{12}\.[A-Za-z0-9_-]{60,}$'),
  from_name text not null check (private.email_sender_name_is_valid(from_name)),
  from_address text not null check (private.email_address_is_valid(from_address)),
  reply_to text check (reply_to is null or private.email_address_is_valid(reply_to)),
  -- On: every e-mail of the organization goes out through this provider (the sender rule). Only once verified.
  enabled boolean not null default false,
  status text not null default 'unverified' check (status in ('unverified', 'verified')),
  verified_at timestamptz,
  version integer not null default 1 check (version >= 1),
  updated_at timestamptz not null default now(),
  -- The Organization Admin (person) who changed it last.
  updated_by uuid,
  test_status text check (test_status in ('queued', 'sending', 'sent', 'failed')),
  test_recipient text check (test_recipient is null or private.email_address_is_valid(test_recipient)),
  test_recipient_masked text check (test_recipient_masked is null or char_length(test_recipient_masked) <= 260),
  test_error_code text check (test_error_code is null or test_error_code ~ '^[A-Z0-9_]{2,64}$'),
  test_requested_at timestamptz,
  test_claimed_at timestamptz,
  test_finished_at timestamptz,
  test_attempts smallint not null default 0 check (test_attempts between 0 and 100),
  -- Test e-mails requested in the current 24-hour window (at most 20 a day, one a minute; security review).
  test_window_started_at timestamptz,
  test_window_count smallint not null default 0 check (test_window_count between 0 and 1000),
  constraint tenant_email_settings_verified_check check ((status = 'verified') = (verified_at is not null)),
  constraint tenant_email_settings_enabled_check check (not enabled or status = 'verified'),
  constraint tenant_email_settings_test_check check (
    (test_status is null and test_recipient is null and test_requested_at is null)
    or (test_status in ('queued', 'sending') and test_recipient is not null and test_finished_at is null)
    or (test_status in ('sent', 'failed') and test_recipient is null and test_finished_at is not null)),
  constraint tenant_email_settings_updated_by_fkey
    foreign key (tenant_id, updated_by) references platform.persons (tenant_id, id)
);
comment on table private.tenant_email_settings is
  'SECURITY-RELEVANT (FR-NTF-11; WP-ADM-01). An organization''s own e-mail provider (Email integration): used for all its e-mails while enabled (only once verified). Secrets sealed for the worker. email_guard only.';

create index tenant_email_settings_test_idx on private.tenant_email_settings (test_requested_at)
  where test_status in ('queued', 'sending');

create table private.invitation_mail_skips (
  tenant_id uuid not null,
  invitation_id uuid not null,
  -- The code (token) the skipped e-mail would have carried: a new code (resend) is "sent" again.
  token_issued_at timestamptz not null,
  skipped_at timestamptz not null default now(),
  primary key (tenant_id, invitation_id),
  foreign key (tenant_id, invitation_id) references platform.invitations (tenant_id, id) on delete cascade
);
comment on table private.invitation_mail_skips is
  'Invitation e-mails the mailer did not queue (the member it was sent for may no longer invite; T-M2-20). email_guard only.';

alter table private.email_credentials_key enable row level security;
alter table private.email_credentials_key force row level security;
alter table private.platform_email_settings enable row level security;
alter table private.platform_email_settings force row level security;
alter table private.tenant_email_settings enable row level security;
alter table private.tenant_email_settings force row level security;
alter table private.invitation_mail_skips enable row level security;
alter table private.invitation_mail_skips force row level security;

create policy email_credentials_key_guard on private.email_credentials_key for all to email_guard
  using (true) with check (true);
create policy platform_email_settings_guard on private.platform_email_settings for all to email_guard
  using (true) with check (true);
create policy tenant_email_settings_guard on private.tenant_email_settings for all to email_guard
  using (true) with check (true);
create policy invitation_mail_skips_guard on private.invitation_mail_skips for all to email_guard
  using (true) with check (true);

revoke all on private.email_credentials_key, private.platform_email_settings, private.tenant_email_settings,
              private.invitation_mail_skips from public;
grant select, insert, update on private.email_credentials_key to email_guard;
grant select, insert, update on private.platform_email_settings to email_guard;
grant select, insert, update on private.tenant_email_settings to email_guard;
grant select, insert, update on private.invitation_mail_skips to email_guard;

-- ---------------------------------------------------------------------------------------------------
-- What email_guard reaches outside its tables (columns and policies, nothing else)
-- ---------------------------------------------------------------------------------------------------
-- Organizations: the brand name (the platform sender's display name) and whether they are served.
create policy tenants_email_guard_read on platform.tenants for select to email_guard using (true);
grant select (id, name_ar, name_en, status) on platform.tenants to email_guard;
create policy tenant_settings_email_guard_read on platform.tenant_settings for select to email_guard using (true);
grant select (tenant_id, default_locale) on platform.tenant_settings to email_guard;

-- The delivery log: counts of waiting messages (Super Admin warning, Organization Admin page), the latest
-- failures of an organization (no address beyond its domain, no content), and the sweeper (T-M2-48): a
-- message waiting for more than a day becomes failed (STALE) with its content removed; one waiting for a
-- sender for more than 7 days likewise (SENDER_WAIT_EXPIRED: an invitation's code has expired by then);
-- final rows older than 12 months are removed (BR-NTF-2 retention).
create policy message_deliveries_email_guard_read on platform.message_deliveries for select to email_guard
  using (true);
create policy message_deliveries_email_guard_sweep on platform.message_deliveries for update to email_guard
  using (status in ('queued', 'sending'))
  with check (status = 'failed' and error_code in ('STALE', 'SENDER_WAIT_EXPIRED'));
create policy message_deliveries_email_guard_purge on platform.message_deliveries for delete to email_guard
  using (status in ('sent', 'failed', 'suppressed') and created_at < now() - interval '12 months');
grant select (id, tenant_id, template, status, error_code, sender, destination_masked, created_at, updated_at)
  on platform.message_deliveries to email_guard;
grant update (status, error_code, destination, subject, html_body, text_body) on platform.message_deliveries
  to email_guard;
grant delete on platform.message_deliveries to email_guard;

-- Invitations (T-M2-20): which code a skipped e-mail would have carried, in the caller's organization.
create policy invitations_email_guard_read on platform.invitations for select to email_guard
  using (tenant_id = (select private.current_tenant_id()));
grant select (tenant_id, id, status, mail_held, token_issued_at) on platform.invitations to email_guard;

-- Who may see or change an organization's settings: the permission helpers read the caller's roles in the
-- caller's organization only (pattern of rate_limit_guard, 20261013090000 / 20261019090100).
create policy tenant_memberships_email_guard_read on platform.tenant_memberships for select to email_guard
  using (tenant_id = (select private.current_tenant_id()));
grant select (id, tenant_id, user_id, status) on platform.tenant_memberships to email_guard;
create policy role_assignments_email_guard_read on platform.role_assignments for select to email_guard
  using (tenant_id = (select private.current_tenant_id()));
grant select (tenant_id, membership_id, role_code, valid_from, valid_until) on platform.role_assignments
  to email_guard;
create policy custom_roles_email_guard_read on platform.custom_roles for select to email_guard
  using (tenant_id = (select private.current_tenant_id()));
grant select (tenant_id, id, code, data_scope) on platform.custom_roles to email_guard;
create policy custom_role_permissions_email_guard_read on platform.custom_role_permissions for select
  to email_guard using (tenant_id = (select private.current_tenant_id()));
grant select (tenant_id, custom_role_id, permission_code) on platform.custom_role_permissions to email_guard;
create policy ref_permissions_email_guard_read on platform.ref_permissions for select to email_guard using (true);
grant select (code, custom_role_use) on platform.ref_permissions to email_guard;
create policy ref_role_permissions_email_guard_read on platform.ref_role_permissions for select to email_guard
  using (true);
grant select (role_code, permission_code, scope) on platform.ref_role_permissions to email_guard;

-- The platform's audit trail (Super Admin changes, the platform sender verified) and the organization's
-- own (its provider verified by the worker; changes by members are audited by the application as the member).
create policy platform_audit_events_email_guard_insert on private.platform_audit_events for insert to email_guard
  with check (action in ('platform.email.sender_changed', 'platform.email.sender_verified'));
grant insert (actor_user_id, action, tenant_id, entity_type, entity_id, data) on private.platform_audit_events
  to email_guard;
create policy audit_events_email_guard_insert on platform.audit_events for insert to email_guard
  with check (action = 'platform.email.integration_verified'
              and actor_user_id is null and actor_person_id is null and impersonator_user_id is null);
grant insert (tenant_id, action, entity_type, entity_id, data) on platform.audit_events to email_guard;

-- Helpers the functions below call.
grant execute on function private.try_uuid(text) to email_guard;
grant execute on function private.request_claims() to email_guard;
grant execute on function private.request_user_id() to email_guard;
grant execute on function private.request_person_id() to email_guard;
grant execute on function private.current_tenant_id() to email_guard;
grant execute on function private.user_session_is_valid(uuid, uuid) to email_guard;
grant execute on function private.platform_admin_is_active(uuid) to email_guard;
grant execute on function private.member_permissions(uuid, uuid) to email_guard;
grant execute on function private.member_has_permission(uuid, uuid, text) to email_guard;

-- ---------------------------------------------------------------------------------------------------
-- Callers (SECURITY INVOKER: run as email_guard inside the functions below)
-- ---------------------------------------------------------------------------------------------------
-- A signed-in member's organization when the member may see (p_manage false: platform.tenant.read or
-- .manage) or change (p_manage true: platform.tenant.manage) its e-mail settings — app_server, a valid
-- session in a served organization (private.current_tenant_id()) — else 42501.
create or replace function private.email_member_tenant(p_manage boolean)
returns uuid
language plpgsql stable
set search_path = ''
as $$
declare
  v_claims jsonb := private.request_claims();
  v_tenant uuid;
  v_user uuid;
begin
  if session_user <> 'app_server' or v_claims is null or coalesce(v_claims ->> 'role', '') <> 'authenticated' then
    raise exception 'e-mail settings need a signed-in member' using errcode = 'insufficient_privilege';
  end if;
  v_tenant := private.current_tenant_id();
  v_user := private.request_user_id();
  if v_tenant is null or v_user is null
     or not (private.member_has_permission(v_tenant, v_user, 'platform.tenant.manage')
             or (not p_manage and private.member_has_permission(v_tenant, v_user, 'platform.tenant.read'))) then
    raise exception 'not allowed to % the organization''s e-mail settings',
      case when p_manage then 'change' else 'see' end using errcode = 'insufficient_privilege';
  end if;
  return v_tenant;
end
$$;

comment on function private.email_member_tenant(boolean) is
  'SECURITY-RELEVANT (WP-ADM-01). The caller''s organization when the member may see (tenant.read/manage) or change (tenant.manage) its e-mail settings, else 42501. email_guard only.';

-- A worker job (app_worker, system claims with a job id): its organization (p_tenant true: served, from the
-- claims) or none (p_tenant false: a platform task — claims without an organization). Else 42501.
create or replace function private.email_job_tenant(p_tenant boolean)
returns uuid
language plpgsql stable
set search_path = ''
as $$
declare
  v_claims jsonb := private.request_claims();
  v_tenant uuid;
begin
  if session_user <> 'app_worker' or v_claims is null or coalesce(v_claims ->> 'role', '') <> 'system'
     or coalesce(btrim(v_claims ->> 'job_id'), '') = '' then
    raise exception 'for the e-mail jobs only' using errcode = 'insufficient_privilege';
  end if;
  if not p_tenant then
    if v_claims ? 'tenant_id' then
      raise exception 'a platform e-mail task acts for no organization' using errcode = 'insufficient_privilege';
    end if;
    return null;
  end if;
  v_tenant := private.current_tenant_id();
  if v_tenant is null then
    raise exception 'the job''s organization is not served' using errcode = 'insufficient_privilege';
  end if;
  return v_tenant;
end
$$;

comment on function private.email_job_tenant(boolean) is
  'SECURITY-RELEVANT (WP-ADM-01). The worker job''s served organization (or none for a platform task), else 42501. email_guard only.';

-- Grants of the callers come with their owner hand-over below.

-- ---------------------------------------------------------------------------------------------------
-- The worker's public key
-- ---------------------------------------------------------------------------------------------------
-- Published by the worker (a platform task) at every pass; true when it changed (a new secret: settings
-- sealed with the old key must be entered again — the pages say so).
create or replace function private.publish_email_credentials_key(p_key_id text, p_public_key text)
returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_old text;
begin
  perform private.email_job_tenant(false);
  if p_key_id is null or p_key_id !~ '^[A-Za-z0-9_-]{12}$' or p_public_key is null
     or p_public_key !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'public_key' using errcode = 'JE001';
  end if;
  select k.key_id into v_old from private.email_credentials_key k where k.id = 1 for update;
  if v_old is not distinct from p_key_id then
    return false;
  end if;
  insert into private.email_credentials_key (id, key_id, public_key, published_at)
  values (1, p_key_id, p_public_key, now())
  on conflict (id) do update set key_id = excluded.key_id, public_key = excluded.public_key, published_at = now();
  return true;
end
$$;

comment on function private.publish_email_credentials_key(text, text) is
  'SECURITY-RELEVANT (WP-ADM-01). The worker publishes its public key for sealing provider secrets. Worker platform tasks only.';

-- The key the web app seals with: for any signed-in caller with a valid session (app_server); none while the
-- worker has not published one (e-mail sending not set up).
create or replace function private.email_credentials_public_key()
returns table (key_id text, public_key text)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_claims jsonb := private.request_claims();
begin
  if session_user <> 'app_server' or v_claims is null or coalesce(v_claims ->> 'role', '') <> 'authenticated'
     or not coalesce(private.user_session_is_valid(private.try_uuid(v_claims ->> 'sub'),
                                                   private.try_uuid(v_claims ->> 'session_id')), false) then
    raise exception 'the sealing key is for signed-in users' using errcode = 'insufficient_privilege';
  end if;
  return query select k.key_id, k.public_key from private.email_credentials_key k where k.id = 1;
end
$$;

comment on function private.email_credentials_public_key() is
  'The worker''s public key for sealing e-mail provider secrets (WP-ADM-01). Signed-in callers (app_server, valid session).';

-- ---------------------------------------------------------------------------------------------------
-- Platform sender (Super Admin)
-- ---------------------------------------------------------------------------------------------------
-- Messages waiting for a sender (the e-mail sender leaves them queued with one of these codes).
create or replace function private.email_waiting_codes()
returns text[]
language sql immutable
set search_path = ''
as $$
  select array['NO_SENDER', 'CREDENTIALS_UNAVAILABLE']::text[];
$$;

comment on function private.email_waiting_codes() is
  'Error codes of deliveries that wait for a sender (WP-ADM-01): kept queued, resumed once a sender is ready.';

create or replace function private.platform_email_settings_view()
returns table (configured boolean, provider text, options jsonb, credentials_key_id text, current_key_id text,
               from_name text, from_address text, status text, verified_at timestamptz, version integer,
               updated_at timestamptz, test_status text, test_recipient_masked text, test_error_code text,
               test_requested_at timestamptz, test_finished_at timestamptz, waiting_count bigint,
               oldest_waiting_at timestamptz, platform_failed_24h bigint)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform private.platform_admin_caller();
  return query
    with waiting as (
      select count(*) as n, min(d.created_at) as oldest
      from platform.message_deliveries d
      where d.status = 'queued' and d.error_code = any (private.email_waiting_codes())),
    failed as (
      select count(*) as n from platform.message_deliveries d
      where d.status = 'failed' and d.sender = 'platform' and d.updated_at > now() - interval '24 hours')
    select s.id is not null, s.provider, s.options, split_part(s.credentials_sealed, '.', 2), k.key_id,
           s.from_name, s.from_address, coalesce(s.status, 'unverified'), s.verified_at, s.version, s.updated_at,
           s.test_status, s.test_recipient_masked, s.test_error_code, s.test_requested_at, s.test_finished_at,
           w.n, w.oldest, f.n
    from waiting w
    cross join failed f
    left join private.platform_email_settings s on s.id = 1
    left join private.email_credentials_key k on k.id = 1;
end
$$;

comment on function private.platform_email_settings_view() is
  'SECURITY-RELEVANT (FR-ADM-17, WP-ADM-01). The platform sender for the Super Admin''s page (never the secrets), the messages waiting for a sender and the platform sender''s failed deliveries of the last 24 hours. Super Admins only.';

-- True when the SMTP server of saved options differs from the new ones (host — case-insensitive —, port or
-- encryption): the saved password must not be kept then (WP-ADM-01 security review). False for other providers.
create or replace function private.email_smtp_server_changed(p_provider text, p_old jsonb, p_new jsonb)
returns boolean
language sql immutable
set search_path = ''
as $$
  select p_provider = 'smtp'
     and (lower(btrim(p_old ->> 'host')) is distinct from lower(btrim(p_new ->> 'host'))
          or (p_old ->> 'port') is distinct from (p_new ->> 'port')
          or coalesce(p_old ->> 'security', 'starttls') is distinct from coalesce(p_new ->> 'security', 'starttls'));
$$;

comment on function private.email_smtp_server_changed(text, jsonb, jsonb) is
  'WP-ADM-01. Whether an SMTP sender''s server (host, port, encryption) changed: its saved password is then not kept.';
revoke all on function private.email_smtp_server_changed(text, jsonb, jsonb) from public;
grant execute on function private.email_smtp_server_changed(text, jsonb, jsonb) to email_guard;

-- «حفظ وإرسال رسالة تجريبية» / Save and send test (Kawadir): saves the platform sender (secrets kept when
-- p_credentials_sealed is null and the provider is unchanged), marks it unverified until the worker has sent
-- the test e-mail to p_test_to, audits what changed (never the secrets or an address). p_version: the version
-- the page showed (null when none). Returns the new version.
create or replace function private.platform_save_email_settings(
  p_provider text, p_options jsonb, p_credentials_sealed text, p_from_name text, p_from_address text,
  p_test_to text, p_version integer)
returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_user uuid := private.platform_admin_caller();
  v_old private.platform_email_settings%rowtype;
  v_key text;
  v_sealed text;
  v_changed text[] := '{}';
  v_version integer;
begin
  if p_provider is null or p_provider not in ('resend', 'smtp', 'sendgrid', 'mailgun', 'microsoft_graph') then
    raise exception 'provider' using errcode = 'JE001';
  end if;
  if p_options is null or jsonb_typeof(p_options) <> 'object' or octet_length(p_options::text) > 2000 then
    raise exception 'options' using errcode = 'JE001';
  end if;
  if not private.email_sender_name_is_valid(p_from_name) then
    raise exception 'from_name' using errcode = 'JE001';
  end if;
  if not private.email_address_is_valid(p_from_address) then
    raise exception 'from_address' using errcode = 'JE001';
  end if;
  if not private.email_address_is_valid(p_test_to) then
    raise exception 'test_to' using errcode = 'JE001';
  end if;
  select * into v_old from private.platform_email_settings s where s.id = 1 for update;
  if (case when found then v_old.version end) is distinct from p_version then
    raise exception 'the platform sender changed meanwhile' using errcode = 'JE002';
  end if;
  select k.key_id into v_key from private.email_credentials_key k where k.id = 1;
  if p_credentials_sealed is not null then
    if char_length(p_credentials_sealed) > 12000
       or p_credentials_sealed !~ '^v1\.[A-Za-z0-9_-]{12}\.[A-Za-z0-9_-]{60,}$' then
      raise exception 'credentials' using errcode = 'JE001';
    end if;
    if v_key is null or split_part(p_credentials_sealed, '.', 2) <> v_key then
      raise exception 'the secrets were sealed with another key' using errcode = 'JE003';
    end if;
    v_sealed := p_credentials_sealed;
  elsif v_old.id is not null and v_old.provider = p_provider
        and not private.email_smtp_server_changed(p_provider, v_old.options, p_options) then
    v_sealed := v_old.credentials_sealed;
  else
    -- A new provider brings its own secrets; so does another SMTP server (its password is never reused for
    -- another host, port or encryption — the sealed value is bound to host:port as well).
    raise exception 'credentials' using errcode = 'JE001';
  end if;
  -- One test e-mail a minute (every save sends one).
  if v_old.test_requested_at > now() - interval '1 minute' then
    raise exception 'test_too_soon' using errcode = 'JE006';
  end if;

  if v_old.id is null then
    v_changed := array['provider', 'options', 'credentials', 'from_name', 'from_address'];
  else
    if v_old.provider <> p_provider then v_changed := v_changed || 'provider'::text; end if;
    if v_old.options <> p_options then v_changed := v_changed || 'options'::text; end if;
    if p_credentials_sealed is not null then v_changed := v_changed || 'credentials'::text; end if;
    if v_old.from_name <> btrim(p_from_name) then v_changed := v_changed || 'from_name'::text; end if;
    if v_old.from_address <> p_from_address then v_changed := v_changed || 'from_address'::text; end if;
  end if;

  insert into private.platform_email_settings as s
    (id, provider, options, credentials_sealed, from_name, from_address, status, verified_at, version, updated_at,
     updated_by, test_status, test_recipient, test_recipient_masked, test_error_code, test_requested_at,
     test_claimed_at, test_finished_at, test_attempts)
  values (1, p_provider, p_options, v_sealed, btrim(p_from_name), p_from_address, 'unverified', null, 1, now(),
          v_user, 'queued', p_test_to, private.email_address_masked(p_test_to), null, now(), null, null, 0)
  on conflict (id) do update
    set provider = excluded.provider, options = excluded.options, credentials_sealed = excluded.credentials_sealed,
        from_name = excluded.from_name, from_address = excluded.from_address, status = 'unverified',
        verified_at = null, version = s.version + 1, updated_at = now(), updated_by = excluded.updated_by,
        test_status = 'queued', test_recipient = excluded.test_recipient,
        test_recipient_masked = excluded.test_recipient_masked, test_error_code = null,
        test_requested_at = now(), test_claimed_at = null, test_finished_at = null, test_attempts = 0
  returning s.version into v_version;

  insert into private.platform_audit_events (actor_user_id, action, entity_type, entity_id, data)
  values (v_user, 'platform.email.sender_changed', 'platform_email_settings', '1',
          jsonb_build_object('provider', p_provider, 'changed', to_jsonb(v_changed), 'version', v_version,
                             'testRequested', true));
  return v_version;
end
$$;

comment on function private.platform_save_email_settings(text, jsonb, text, text, text, text, integer) is
  'SECURITY-RELEVANT (FR-ADM-17, WP-ADM-01). Saves the platform sender (unverified) and queues its test e-mail; audited without secrets or addresses. Super Admins only.';

-- ---------------------------------------------------------------------------------------------------
-- Organization's own provider (Organization Admin) — Email integration
-- ---------------------------------------------------------------------------------------------------
create or replace function private.tenant_email_settings_view()
returns table (configured boolean, provider text, options jsonb, credentials_key_id text, current_key_id text,
               from_name text, from_address text, reply_to text, enabled boolean, status text,
               verified_at timestamptz, version integer, updated_at timestamptz, test_status text,
               test_recipient_masked text, test_error_code text, test_requested_at timestamptz,
               test_finished_at timestamptz, platform_sender_verified boolean, waiting_count bigint)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_tenant uuid := private.email_member_tenant(false);
begin
  return query
    with waiting as (
      select count(*) as n from platform.message_deliveries d
      where d.tenant_id = v_tenant and d.status = 'queued' and d.error_code = any (private.email_waiting_codes()))
    select s.tenant_id is not null, s.provider, s.options, split_part(s.credentials_sealed, '.', 2), k.key_id,
           s.from_name, s.from_address, s.reply_to, coalesce(s.enabled, false), coalesce(s.status, 'unverified'),
           s.verified_at, s.version, s.updated_at, s.test_status, s.test_recipient_masked, s.test_error_code,
           s.test_requested_at, s.test_finished_at,
           coalesce((select p.status = 'verified' from private.platform_email_settings p where p.id = 1), false),
           w.n
    from waiting w
    left join private.tenant_email_settings s on s.tenant_id = v_tenant
    left join private.email_credentials_key k on k.id = 1;
end
$$;

comment on function private.tenant_email_settings_view() is
  'SECURITY-RELEVANT (FR-NTF-11, WP-ADM-01). The caller''s organization''s Email integration (never the secrets) and its waiting messages. Members with platform.tenant.read or .manage.';

-- The organization's latest delivery errors (newest first, at most p_limit, 1–50): the e-mail's kind, our
-- error code, the sender it went out with and the recipient's domain only.
create or replace function private.tenant_email_failures(p_limit integer)
returns table (template text, error_code text, sender text, recipient_domain text, failed_at timestamptz)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_tenant uuid := private.email_member_tenant(false);
begin
  return query
    select d.template, d.error_code, d.sender, substring(d.destination_masked from '@([^@]*)$'), d.updated_at
    from platform.message_deliveries d
    where d.tenant_id = v_tenant and d.status = 'failed'
    order by d.updated_at desc, d.id
    limit greatest(1, least(coalesce(p_limit, 20), 50));
end
$$;

comment on function private.tenant_email_failures(integer) is
  'SECURITY-RELEVANT (FR-NTF-11, WP-ADM-01). The caller''s organization''s latest failed deliveries (no address beyond the domain, no content). Members with platform.tenant.read or .manage.';

-- Saves the organization's provider (secrets kept when p_credentials_sealed is null and the provider is
-- unchanged). A new provider, options, secrets or sender address make it unverified and switch it off (the
-- platform sender takes over until a test went out and it is enabled again); the sender name and reply-to
-- keep the verification. p_version: the version the page showed (null when none). Returns the new version
-- and the changed fields (for the application's audit record).
create or replace function private.save_tenant_email_settings(
  p_provider text, p_options jsonb, p_credentials_sealed text, p_from_name text, p_from_address text,
  p_reply_to text, p_version integer)
returns table (version integer, changed text[], reverify boolean)
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_tenant uuid := private.email_member_tenant(true);
  v_old private.tenant_email_settings%rowtype;
  v_key text;
  v_sealed text;
  v_changed text[] := '{}';
  v_reverify boolean;
  v_version integer;
begin
  if p_provider is null or p_provider not in ('resend', 'smtp', 'sendgrid', 'mailgun', 'microsoft_graph') then
    raise exception 'provider' using errcode = 'JE001';
  end if;
  if p_options is null or jsonb_typeof(p_options) <> 'object' or octet_length(p_options::text) > 2000 then
    raise exception 'options' using errcode = 'JE001';
  end if;
  if not private.email_sender_name_is_valid(p_from_name) then
    raise exception 'from_name' using errcode = 'JE001';
  end if;
  if not private.email_address_is_valid(p_from_address) then
    raise exception 'from_address' using errcode = 'JE001';
  end if;
  if p_reply_to is not null and not private.email_address_is_valid(p_reply_to) then
    raise exception 'reply_to' using errcode = 'JE001';
  end if;
  select * into v_old from private.tenant_email_settings s where s.tenant_id = v_tenant for update;
  if (case when found then v_old.version end) is distinct from p_version then
    raise exception 'the e-mail settings changed meanwhile' using errcode = 'JE002';
  end if;
  select k.key_id into v_key from private.email_credentials_key k where k.id = 1;
  if p_credentials_sealed is not null then
    if char_length(p_credentials_sealed) > 12000
       or p_credentials_sealed !~ '^v1\.[A-Za-z0-9_-]{12}\.[A-Za-z0-9_-]{60,}$' then
      raise exception 'credentials' using errcode = 'JE001';
    end if;
    if v_key is null or split_part(p_credentials_sealed, '.', 2) <> v_key then
      raise exception 'the secrets were sealed with another key' using errcode = 'JE003';
    end if;
    v_sealed := p_credentials_sealed;
  elsif v_old.tenant_id is not null and v_old.provider = p_provider
        and not private.email_smtp_server_changed(p_provider, v_old.options, p_options) then
    v_sealed := v_old.credentials_sealed;
  else
    raise exception 'credentials' using errcode = 'JE001';
  end if;

  if v_old.tenant_id is null then
    v_changed := array['provider', 'options', 'credentials', 'from_name', 'from_address']
                 || case when p_reply_to is null then '{}'::text[] else array['reply_to'] end;
  else
    if v_old.provider <> p_provider then v_changed := v_changed || 'provider'::text; end if;
    if v_old.options <> p_options then v_changed := v_changed || 'options'::text; end if;
    if p_credentials_sealed is not null then v_changed := v_changed || 'credentials'::text; end if;
    if v_old.from_name <> btrim(p_from_name) then v_changed := v_changed || 'from_name'::text; end if;
    if v_old.from_address <> p_from_address then v_changed := v_changed || 'from_address'::text; end if;
    if v_old.reply_to is distinct from p_reply_to then v_changed := v_changed || 'reply_to'::text; end if;
  end if;
  if cardinality(v_changed) = 0 then
    return query select v_old.version, v_changed, false;
    return;
  end if;
  v_reverify := v_old.tenant_id is null
                or v_changed && array['provider', 'options', 'credentials', 'from_address'];

  insert into private.tenant_email_settings as s
    (tenant_id, provider, options, credentials_sealed, from_name, from_address, reply_to, enabled, status,
     verified_at, version, updated_at, updated_by)
  values (v_tenant, p_provider, p_options, v_sealed, btrim(p_from_name), p_from_address, p_reply_to, false,
          'unverified', null, 1, now(), private.request_person_id())
  on conflict (tenant_id) do update
    set provider = excluded.provider, options = excluded.options, credentials_sealed = excluded.credentials_sealed,
        from_name = excluded.from_name, from_address = excluded.from_address, reply_to = excluded.reply_to,
        enabled = case when v_reverify then false else s.enabled end,
        status = case when v_reverify then 'unverified' else s.status end,
        verified_at = case when v_reverify then null else s.verified_at end,
        version = s.version + 1, updated_at = now(), updated_by = excluded.updated_by
  returning s.version into v_version;
  return query select v_version, v_changed, v_reverify;
end
$$;

comment on function private.save_tenant_email_settings(text, jsonb, text, text, text, text, integer) is
  'SECURITY-RELEVANT (FR-NTF-11, WP-ADM-01). Saves the caller''s organization''s own provider; a changed provider/secret/address needs a new test and switches it off. Members with platform.tenant.manage.';

-- «إرسال رسالة تجريبية» / Send test e-mail: queues a test e-mail through the organization's provider (the
-- worker sends it; success verifies these settings). Returns the provider.
create or replace function private.request_tenant_email_test(p_recipient text)
returns text
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_tenant uuid := private.email_member_tenant(true);
  v_old private.tenant_email_settings%rowtype;
  v_new_window boolean;
begin
  if not private.email_address_is_valid(p_recipient) then
    raise exception 'test_to' using errcode = 'JE001';
  end if;
  select * into v_old from private.tenant_email_settings s where s.tenant_id = v_tenant for update;
  if not found then
    raise exception 'the organization has no e-mail provider to test' using errcode = 'JE005';
  end if;
  -- At most one test e-mail a minute and 20 a day per organization (security review: no mail cannon).
  if v_old.test_requested_at > now() - interval '1 minute' then
    raise exception 'test_too_soon' using errcode = 'JE006';
  end if;
  v_new_window := v_old.test_window_started_at is null or v_old.test_window_started_at <= now() - interval '1 day';
  if not v_new_window and v_old.test_window_count >= 20 then
    raise exception 'test_daily_limit' using errcode = 'JE006';
  end if;
  update private.tenant_email_settings s
  set test_status = 'queued', test_recipient = p_recipient,
      test_recipient_masked = private.email_address_masked(p_recipient), test_error_code = null,
      test_requested_at = now(), test_claimed_at = null, test_finished_at = null, test_attempts = 0,
      test_window_started_at = case when v_new_window then now() else s.test_window_started_at end,
      test_window_count = case when v_new_window then 1 else s.test_window_count + 1 end
  where s.tenant_id = v_tenant;
  return v_old.provider;
end
$$;

comment on function private.request_tenant_email_test(text) is
  'SECURITY-RELEVANT (FR-NTF-11, WP-ADM-01). Queues a test e-mail through the caller''s organization''s provider (one a minute, 20 a day). Members with platform.tenant.manage.';

-- Switches the organization's provider on (only once verified) or off (back to the platform sender, any
-- time). Returns the new version (unchanged when nothing changed).
create or replace function private.set_tenant_email_enabled(p_enabled boolean, p_version integer)
returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_tenant uuid := private.email_member_tenant(true);
  v_old private.tenant_email_settings%rowtype;
  v_version integer;
begin
  if p_enabled is null then
    raise exception 'enabled' using errcode = 'JE001';
  end if;
  select * into v_old from private.tenant_email_settings s where s.tenant_id = v_tenant for update;
  if not found then
    raise exception 'the organization has no e-mail provider' using errcode = 'JE005';
  end if;
  if v_old.version is distinct from p_version then
    raise exception 'the e-mail settings changed meanwhile' using errcode = 'JE002';
  end if;
  if v_old.enabled = p_enabled then
    return v_old.version;
  end if;
  if p_enabled and v_old.status <> 'verified' then
    raise exception 'send a test e-mail first' using errcode = 'JE004';
  end if;
  update private.tenant_email_settings s
  set enabled = p_enabled, version = s.version + 1, updated_at = now(), updated_by = private.request_person_id()
  where s.tenant_id = v_tenant
  returning s.version into v_version;
  return v_version;
end
$$;

comment on function private.set_tenant_email_enabled(boolean, integer) is
  'SECURITY-RELEVANT (FR-NTF-11, WP-ADM-01). Switches the caller''s organization''s own provider on (verified only) or off. Members with platform.tenant.manage.';

-- ---------------------------------------------------------------------------------------------------
-- Worker
-- ---------------------------------------------------------------------------------------------------
-- The sender rule's inputs for the job's organization: its own provider, the platform sender (sealed secrets
-- included — opened by the worker only) and its brand name and default language (the platform sender's
-- display name). One row.
create or replace function private.email_route()
returns table (tenant_provider text, tenant_options jsonb, tenant_credentials_sealed text, tenant_from_name text,
               tenant_from_address text, tenant_reply_to text, tenant_enabled boolean, tenant_version integer,
               platform_configured boolean, platform_provider text, platform_options jsonb,
               platform_credentials_sealed text, platform_from_address text, platform_verified boolean,
               platform_version integer, brand_name_ar text, brand_name_en text, default_locale text)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_tenant uuid := private.email_job_tenant(true);
begin
  return query
    select s.provider, s.options, s.credentials_sealed, s.from_name, s.from_address, s.reply_to,
           coalesce(s.enabled and s.status = 'verified', false), s.version,
           p.id is not null, p.provider, p.options, p.credentials_sealed, p.from_address,
           coalesce(p.status = 'verified', false), p.version,
           t.name_ar, t.name_en, coalesce(ts.default_locale, 'en')
    from platform.tenants t
    left join platform.tenant_settings ts on ts.tenant_id = t.id
    left join private.tenant_email_settings s on s.tenant_id = t.id
    left join private.platform_email_settings p on p.id = 1
    where t.id = v_tenant;
end
$$;

comment on function private.email_route() is
  'SECURITY-RELEVANT (FR-NTF-11, WP-ADM-01). The sender rule''s inputs (sealed secrets included) for the e-mail sender of the job''s organization. Worker jobs only.';

-- Claims up to p_limit (1–20) waiting test e-mails in all, platform and organizations together (a claim older
-- than 5 minutes is taken again: its worker died). A test claimed 3 times without an outcome is recorded as
-- failed (TIMEOUT) instead of being claimed again — a server that never answers cannot block the others.
-- Returns what each test is sent with and the settings' version it proves.
create or replace function private.claim_email_tests(p_limit integer)
returns table (tenant_id uuid, recipient text, version integer, provider text, options jsonb,
               credentials_sealed text, from_name text, from_address text, reply_to text)
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 5), 20));
  v_platform integer;
begin
  perform private.email_job_tenant(false);
  update private.platform_email_settings s
  set test_status = 'failed', test_error_code = 'TIMEOUT', test_recipient = null, test_finished_at = now()
  where s.id = 1 and s.test_attempts >= 3
    and (s.test_status = 'queued'
         or (s.test_status = 'sending' and s.test_claimed_at < now() - interval '5 minutes'));
  update private.tenant_email_settings s
  set test_status = 'failed', test_error_code = 'TIMEOUT', test_recipient = null, test_finished_at = now()
  where s.test_attempts >= 3
    and (s.test_status = 'queued'
         or (s.test_status = 'sending' and s.test_claimed_at < now() - interval '5 minutes'));

  return query
    with claimed as (
      update private.platform_email_settings s
      set test_status = 'sending', test_claimed_at = now(), test_attempts = least(s.test_attempts + 1, 100)
      where s.id = 1 and s.test_attempts < 3
        and (s.test_status = 'queued'
             or (s.test_status = 'sending' and s.test_claimed_at < now() - interval '5 minutes'))
      returning null::uuid, s.test_recipient, s.version, s.provider, s.options, s.credentials_sealed,
                s.from_name, s.from_address, null::text)
    select * from claimed;
  get diagnostics v_platform = row_count;
  if v_limit - v_platform < 1 then
    return;
  end if;

  return query
    with claimed as (
      update private.tenant_email_settings s
      set test_status = 'sending', test_claimed_at = now(), test_attempts = least(s.test_attempts + 1, 100)
      where s.tenant_id in (
          select x.tenant_id from private.tenant_email_settings x
          join platform.tenants t on t.id = x.tenant_id and t.status in ('active', 'trial')
          where x.test_attempts < 3
            and (x.test_status = 'queued'
                 or (x.test_status = 'sending' and x.test_claimed_at < now() - interval '5 minutes'))
          order by x.test_requested_at
          limit v_limit - v_platform
          for update of x skip locked)
      returning s.tenant_id, s.test_recipient, s.version, s.provider, s.options, s.credentials_sealed,
                s.from_name, s.from_address, s.reply_to)
    select * from claimed;
end
$$;

comment on function private.claim_email_tests(integer) is
  'SECURITY-RELEVANT (WP-ADM-01). Claims waiting test e-mails (platform and organizations) with the settings to send them with. Worker platform tasks only.';

-- Records a test e-mail's outcome (p_tenant null: the platform sender): the recipient goes, the error code
-- stays; a test that went out verifies the settings it was sent with (p_version still current) — audited.
-- Returns true when the settings became verified.
create or replace function private.finish_email_test(p_tenant uuid, p_version integer, p_sent boolean,
                                                     p_error_code text)
returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_verified boolean := false;
  v_found boolean;
begin
  perform private.email_job_tenant(false);
  if p_sent is null or (not p_sent and (p_error_code is null or p_error_code !~ '^[A-Z0-9_]{2,64}$')) then
    raise exception 'error_code' using errcode = 'JE001';
  end if;
  if p_tenant is null then
    update private.platform_email_settings s
    set test_status = case when p_sent then 'sent' else 'failed' end,
        test_error_code = case when p_sent then null else p_error_code end,
        test_recipient = null, test_finished_at = now(),
        status = case when p_sent and s.version = p_version then 'verified' else s.status end,
        verified_at = case when p_sent and s.version = p_version then now() else s.verified_at end
    where s.id = 1 and s.test_status = 'sending'
    returning p_sent and s.version = p_version into v_verified;
    v_found := found;
    if v_found and v_verified then
      insert into private.platform_audit_events (actor_user_id, action, entity_type, entity_id, data)
      values (null, 'platform.email.sender_verified', 'platform_email_settings', '1',
              jsonb_build_object('version', p_version, 'job', private.request_claims() ->> 'job_id'));
    end if;
  else
    update private.tenant_email_settings s
    set test_status = case when p_sent then 'sent' else 'failed' end,
        test_error_code = case when p_sent then null else p_error_code end,
        test_recipient = null, test_finished_at = now(),
        status = case when p_sent and s.version = p_version then 'verified' else s.status end,
        verified_at = case when p_sent and s.version = p_version then now() else s.verified_at end
    where s.tenant_id = p_tenant and s.test_status = 'sending'
    returning p_sent and s.version = p_version into v_verified;
    v_found := found;
    if v_found and v_verified then
      insert into platform.audit_events (tenant_id, action, entity_type, entity_id, data)
      values (p_tenant, 'platform.email.integration_verified', 'tenant_email_settings', p_tenant::text,
              jsonb_build_object('version', p_version, 'job', private.request_claims() ->> 'job_id'));
    end if;
  end if;
  return coalesce(v_found and v_verified, false);
end
$$;

comment on function private.finish_email_test(uuid, integer, boolean, text) is
  'SECURITY-RELEVANT (WP-ADM-01). Records a test e-mail''s outcome; a sent test verifies the settings it proved (audited). Worker platform tasks only.';

-- Served organizations with messages waiting for a sender (the resume task asks each whether a sender is
-- ready now and queues their messages again).
create or replace function private.email_tenants_waiting()
returns table (tenant_id uuid, waiting bigint)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform private.email_job_tenant(false);
  return query
    select d.tenant_id, count(*)
    from platform.message_deliveries d
    join platform.tenants t on t.id = d.tenant_id and t.status in ('active', 'trial')
    where d.status = 'queued' and d.error_code = any (private.email_waiting_codes())
    group by d.tenant_id
    order by min(d.created_at);
end
$$;

comment on function private.email_tenants_waiting() is
  'Served organizations with deliveries waiting for a sender (WP-ADM-01). Worker platform tasks only.';

-- The delivery log's housekeeping (T-M2-18 of ADR 0008 §7, T-M2-48), at most p_batch rows of each kind:
--   stale     waiting (queued / sending) for more than a day without waiting for a sender → failed, STALE
--   expired   waiting for a sender for more than 7 days → failed, SENDER_WAIT_EXPIRED
--   purged    final rows older than 12 months → removed (BR-NTF-2)
--   tests_expired  test e-mails requested more than 7 days ago and still not sent (e.g. of a suspended
--             organization) → failed, TEST_EXPIRED, their plain recipient removed
-- The content and the plain address go with the final status (the table's own rule).
create or replace function private.sweep_email_deliveries(p_batch integer)
returns table (stale bigint, expired bigint, purged bigint, tests_expired bigint)
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_batch integer := greatest(1, least(coalesce(p_batch, 500), 5000));
  v_stale bigint;
  v_expired bigint;
  v_purged bigint;
  v_tests bigint;
  v_tenant_tests bigint;
begin
  perform private.email_job_tenant(false);
  with x as (
    select d.id from platform.message_deliveries d
    where d.status in ('queued', 'sending') and d.updated_at < now() - interval '1 day'
      and (d.error_code is null or not (d.error_code = any (private.email_waiting_codes())))
    order by d.updated_at limit v_batch for update skip locked)
  update platform.message_deliveries d
  set status = 'failed', error_code = 'STALE', destination = null, subject = null, html_body = null, text_body = null
  from x where d.id = x.id;
  get diagnostics v_stale = row_count;

  with x as (
    select d.id from platform.message_deliveries d
    where d.status = 'queued' and d.error_code = any (private.email_waiting_codes())
      and d.created_at < now() - interval '7 days'
    order by d.created_at limit v_batch for update skip locked)
  update platform.message_deliveries d
  set status = 'failed', error_code = 'SENDER_WAIT_EXPIRED', destination = null, subject = null, html_body = null,
      text_body = null
  from x where d.id = x.id;
  get diagnostics v_expired = row_count;

  -- (No row lock: final rows never change, and FOR UPDATE would apply the update policy, which is for
  -- waiting rows only.)
  with x as (
    select d.id from platform.message_deliveries d
    where d.status in ('sent', 'failed', 'suppressed') and d.created_at < now() - interval '12 months'
    order by d.created_at limit v_batch)
  delete from platform.message_deliveries d using x where d.id = x.id;
  get diagnostics v_purged = row_count;

  update private.platform_email_settings s
  set test_status = 'failed', test_error_code = 'TEST_EXPIRED', test_recipient = null, test_finished_at = now()
  where s.id = 1 and s.test_status in ('queued', 'sending') and s.test_requested_at < now() - interval '7 days';
  get diagnostics v_tests = row_count;
  update private.tenant_email_settings s
  set test_status = 'failed', test_error_code = 'TEST_EXPIRED', test_recipient = null, test_finished_at = now()
  where s.tenant_id in (
      select x.tenant_id from private.tenant_email_settings x
      where x.test_status in ('queued', 'sending') and x.test_requested_at < now() - interval '7 days'
      order by x.test_requested_at limit v_batch
      for update of x skip locked);
  get diagnostics v_tenant_tests = row_count;

  return query select v_stale, v_expired, v_purged, v_tests + v_tenant_tests;
end
$$;

comment on function private.sweep_email_deliveries(integer) is
  'SECURITY-RELEVANT (ADR 0008 §7, BR-NTF-2; T-M2-48). Stale and long-waiting deliveries become failed with their content removed; final rows older than 12 months are removed; test e-mails left unsent for 7 days fail. Worker platform tasks only.';

-- The invitation mailer did not queue the e-mail of an invitation (T-M2-20): remembered for its current code.
create or replace function private.note_invitation_mail_skipped(p_invitation_id uuid)
returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_tenant uuid := private.email_job_tenant(true);
  v_issued timestamptz;
begin
  select i.token_issued_at into v_issued
  from platform.invitations i
  where i.tenant_id = v_tenant and i.id = p_invitation_id and i.status = 'pending' and not i.mail_held;
  if v_issued is null then
    return false;
  end if;
  insert into private.invitation_mail_skips (tenant_id, invitation_id, token_issued_at, skipped_at)
  values (v_tenant, p_invitation_id, v_issued, now())
  on conflict (tenant_id, invitation_id) do update
    set token_issued_at = excluded.token_issued_at, skipped_at = excluded.skipped_at;
  return true;
end
$$;

comment on function private.note_invitation_mail_skipped(uuid) is
  'The invitation mailer skipped an invitation''s e-mail (T-M2-20): remembered for its current code. Worker jobs only.';

-- The caller's organization's pending invitations whose current code was never e-mailed (T-M2-20). Any
-- signed-in member of a served organization (ids only; the users list joins them to what it may show).
create or replace function private.invitation_mail_skipped_ids()
returns setof uuid
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_claims jsonb := private.request_claims();
  v_tenant uuid;
begin
  if session_user <> 'app_server' or v_claims is null or coalesce(v_claims ->> 'role', '') <> 'authenticated' then
    raise exception 'for signed-in members only' using errcode = 'insufficient_privilege';
  end if;
  v_tenant := private.current_tenant_id();
  if v_tenant is null then
    return;
  end if;
  return query
    select k.invitation_id
    from private.invitation_mail_skips k
    join platform.invitations i on i.tenant_id = k.tenant_id and i.id = k.invitation_id
    where k.tenant_id = v_tenant and i.status = 'pending' and i.token_issued_at = k.token_issued_at;
end
$$;

comment on function private.invitation_mail_skipped_ids() is
  'The caller''s organization''s pending invitations whose current code was not e-mailed (T-M2-20). Signed-in members.';

-- ---------------------------------------------------------------------------------------------------
-- Ownership hand-over (non-superuser migration role on hosted Supabase, as 20260930120100) and grants
-- ---------------------------------------------------------------------------------------------------
grant create on schema private to email_guard;
alter function private.publish_email_credentials_key(text, text) owner to email_guard;
alter function private.email_credentials_public_key() owner to email_guard;
alter function private.platform_email_settings_view() owner to email_guard;
alter function private.platform_save_email_settings(text, jsonb, text, text, text, text, integer) owner to email_guard;
alter function private.tenant_email_settings_view() owner to email_guard;
alter function private.tenant_email_failures(integer) owner to email_guard;
alter function private.save_tenant_email_settings(text, jsonb, text, text, text, text, integer) owner to email_guard;
alter function private.request_tenant_email_test(text) owner to email_guard;
alter function private.set_tenant_email_enabled(boolean, integer) owner to email_guard;
alter function private.email_route() owner to email_guard;
alter function private.claim_email_tests(integer) owner to email_guard;
alter function private.finish_email_test(uuid, integer, boolean, text) owner to email_guard;
alter function private.email_tenants_waiting() owner to email_guard;
alter function private.sweep_email_deliveries(integer) owner to email_guard;
alter function private.note_invitation_mail_skipped(uuid) owner to email_guard;
alter function private.invitation_mail_skipped_ids() owner to email_guard;
revoke create on schema private from email_guard;

revoke all on function private.email_member_tenant(boolean) from public;
revoke all on function private.email_job_tenant(boolean) from public;
revoke all on function private.email_waiting_codes() from public;
grant execute on function private.email_member_tenant(boolean), private.email_job_tenant(boolean),
                          private.email_waiting_codes() to email_guard;
-- The Super Admin caller (SECURITY INVOKER, private.platform_admin_caller) runs as email_guard here.
grant execute on function private.platform_admin_caller() to email_guard;

revoke all on function private.publish_email_credentials_key(text, text) from public;
revoke all on function private.email_credentials_public_key() from public;
revoke all on function private.platform_email_settings_view() from public;
revoke all on function private.platform_save_email_settings(text, jsonb, text, text, text, text, integer) from public;
revoke all on function private.tenant_email_settings_view() from public;
revoke all on function private.tenant_email_failures(integer) from public;
revoke all on function private.save_tenant_email_settings(text, jsonb, text, text, text, text, integer) from public;
revoke all on function private.request_tenant_email_test(text) from public;
revoke all on function private.set_tenant_email_enabled(boolean, integer) from public;
revoke all on function private.email_route() from public;
revoke all on function private.claim_email_tests(integer) from public;
revoke all on function private.finish_email_test(uuid, integer, boolean, text) from public;
revoke all on function private.email_tenants_waiting() from public;
revoke all on function private.sweep_email_deliveries(integer) from public;
revoke all on function private.note_invitation_mail_skipped(uuid) from public;
revoke all on function private.invitation_mail_skipped_ids() from public;
-- Both login roles reach the functions as `authenticated`; each function checks the LOGIN role
-- (session_user) and the claims itself: app_server for members and Super Admins, app_worker for jobs.
grant execute on function private.publish_email_credentials_key(text, text),
                          private.email_credentials_public_key(),
                          private.platform_email_settings_view(),
                          private.platform_save_email_settings(text, jsonb, text, text, text, text, integer),
                          private.tenant_email_settings_view(),
                          private.tenant_email_failures(integer),
                          private.save_tenant_email_settings(text, jsonb, text, text, text, text, integer),
                          private.request_tenant_email_test(text),
                          private.set_tenant_email_enabled(boolean, integer),
                          private.email_route(),
                          private.claim_email_tests(integer),
                          private.finish_email_test(uuid, integer, boolean, text),
                          private.email_tenants_waiting(),
                          private.sweep_email_deliveries(integer),
                          private.note_invitation_mail_skipped(uuid),
                          private.invitation_mail_skipped_ids()
  to authenticated;
