-- Platform Super Admin console (FR-ADM-17; BRD §4.2: Platform Super Admin «مشرف المنصة» = ENTLAQA staff,
-- not a tenant role; PO decisions 16 Oct 2026, Kawadir ATS's /organizations screens). A Super Admin signs in
-- on the normal sign-in page (an Auth account with no organization), lists the organizations, creates one
-- together with its Organization Admin's PENDING invitation and copies that invitation's code / link
-- (no e-mail needed), and issues a new code while it is pending. Super Admins are granted by user UID
-- through a GitHub workflow (scripts/platform-admin.sh) — never from the product. Class: P (platform).
-- Design record: docs/adr/0013-platform-super-admin.md; runbook docs/engineering/platform-console.md.
--
--   private.platform_admins     the Super Admins (Auth user ids). NOT a tenant table (schema private, like
--                               private.revoked_sessions): RLS forced, reachable by platform_admin_guard only.
--   private.platform_invitations
--                               the invitations a Super Admin created (one per new organization's first
--                               Organization Admin). Such an invitation stays valid while its issuer is still
--                               a Super Admin and it gives the Organization Admin role alone: the inviter
--                               rule of tenant invitations (an ACTIVE Organization Admin of the organization,
--                               review M1) cannot apply — the organization has no member yet.
--   private.platform_audit_events
--                               append-only audit of platform actions (no tenant): grants, organizations
--                               created, codes issued or read. Ids only; never a code or an e-mail.
--   platform_admin_guard        NOLOGIN owner of the functions below. No BYPASSRLS: it reaches exactly what
--                               they need through explicit grants and policies `to platform_admin_guard`
--                               (pattern of tenant_guard / invitation_guard, migrations 20260930120100 and
--                               20261009090000).
--   private.is_platform_admin() / platform_list_tenants() / platform_create_tenant(…) /
--   platform_admin_invitation_code(tenant) / platform_reissue_admin_code(tenant)
--                               SECURITY DEFINER; app_server with verified USER claims of a valid session
--                               (private.user_session_is_valid) whose user is a Super Admin — no tenant claim
--                               needed. Everyone else: false / 42501.
--   private.grant_platform_admin(uid) / revoke_platform_admin(uid)
--                               SECURITY DEFINER; EXECUTE for the migration role only (the workflow).
--   private.invitation_issuer_may_grant(…)
--                               the inviter rule used by a link's state and by acceptance: a Super Admin's
--                               invitation (above) or, as before, private.invitation_inviter_may_grant.
--   private.write_invitation_code(id)
--                               the code-issuing step of private.issue_invitation_code, shared with the
--                               console (same behaviour: a new code replaces the old one, retried on the
--                               improbable collision; the lifecycle trigger counts it and gives 7 days).
--
-- Creating an organization does exactly what scripts/sql/provision-tenant.sql does for the organization
-- (an ACTIVE tenant; its default settings and security policy come from the tenant triggers) and, instead
-- of a membership for an existing account, creates the Organization Admin's person record and a pending
-- invitation (primary role tenant_admin, nothing else) with its first code. The invitee joins through the
-- existing sign-up page and hook (private.before_user_created_hook → invitation_allows_signup, for that
-- e-mail only) and acceptance (private.accept_invitation_as_caller). MFA for Super Admins (FR-ADM-17) is
-- NOT enforced (PO, 15 Oct 2026: no extra authenticator layers for now) — open question in the ADR.

-- ---------------------------------------------------------------------------------------------------
-- Role platform_admin_guard (attribute policy as in 20260930120000)
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'platform_admin_guard') then
    create role platform_admin_guard nologin noinherit nobypassrls;
  end if;
end
$$;

do $$
declare
  r record;
begin
  select rolname, rolcanlogin, rolinherit, rolsuper, rolbypassrls, rolreplication, rolcreatedb, rolcreaterole
    into r from pg_roles where rolname = 'platform_admin_guard';
  if r.rolsuper or r.rolbypassrls or r.rolreplication then
    raise exception 'role platform_admin_guard must be NOSUPERUSER NOBYPASSRLS NOREPLICATION; fix it as a superuser first';
  end if;
  if r.rolinherit or r.rolcreatedb or r.rolcreaterole or r.rolcanlogin then
    alter role platform_admin_guard nologin noinherit nocreatedb nocreaterole;
  end if;
  if exists (select 1 from pg_auth_members m join pg_roles g on g.oid = m.roleid join pg_roles u on u.oid = m.member
             where g.rolname = 'platform_admin_guard' and (m.inherit_option or m.set_option)
               and not u.rolsuper and u.rolname <> current_user) then
    raise exception 'role platform_admin_guard must have no members besides the migration role';
  end if;
end
$$;

-- The migration role hands function ownership to the guards.
grant platform_admin_guard to current_user;
grant invitation_guard to current_user;
grant usage on schema platform, private to platform_admin_guard;

-- ---------------------------------------------------------------------------------------------------
-- Tables (schema private: not tenant data)
-- ---------------------------------------------------------------------------------------------------
create table private.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  granted_at timestamptz not null default now(),
  -- Who granted it: 'workflow' (the Platform admin workflow) or another operator label — never a person's
  -- name or e-mail.
  granted_by text not null check (granted_by ~ '^[a-z][a-z0-9_.-]{0,62}$')
);
comment on table private.platform_admins is
  'SECURITY-RELEVANT (FR-ADM-17). Platform Super Admins (ENTLAQA staff, BRD §4.2): Auth user ids. Granted by the Platform admin workflow only; platform_admin_guard only.';

alter table private.platform_admins enable row level security;
alter table private.platform_admins force row level security;
create policy platform_admins_guard on private.platform_admins for all to platform_admin_guard
  using (true) with check (true);
revoke all on private.platform_admins from public;
grant select, insert, delete on private.platform_admins to platform_admin_guard;

create table private.platform_invitations (
  invitation_id uuid primary key,
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, invitation_id) references platform.invitations (tenant_id, id)
);
comment on table private.platform_invitations is
  'SECURITY-RELEVANT (FR-ADM-17). Invitations created by a Super Admin (a new organization''s first Organization Admin): valid while the issuer is a Super Admin. platform_admin_guard writes; invitation_guard asks private.is_platform_invitation.';
create index platform_invitations_tenant_id_idx on private.platform_invitations (tenant_id);

alter table private.platform_invitations enable row level security;
alter table private.platform_invitations force row level security;
create policy platform_invitations_guard on private.platform_invitations for all to platform_admin_guard
  using (true) with check (true);
revoke all on private.platform_invitations from public;
grant select, insert on private.platform_invitations to platform_admin_guard;

create table private.platform_audit_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  -- The Super Admin who acted; NULL for the workflow (grants).
  actor_user_id uuid,
  action text not null check (action ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2,}$'),
  tenant_id uuid references platform.tenants (id),
  entity_type text,
  entity_id text,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object')
);
comment on table private.platform_audit_events is
  'Append-only audit of platform actions (FR-ADM-17, FR-AUD-01): Super Admin grants, organizations created, invitation codes issued or read. Ids only; never codes or e-mails.';
create index platform_audit_events_occurred_idx on private.platform_audit_events (occurred_at desc);

create trigger platform_audit_events_append_only before update or delete on private.platform_audit_events
  for each row execute function private.prevent_update_delete();

alter table private.platform_audit_events enable row level security;
alter table private.platform_audit_events force row level security;
create policy platform_audit_events_guard_insert on private.platform_audit_events for insert to platform_admin_guard
  with check (action in ('platform.admin.granted', 'platform.admin.revoked', 'platform.tenant.created',
                         'platform.tenant.admin_code_issued', 'platform.tenant.admin_code_viewed'));
revoke all on private.platform_audit_events from public;
grant insert (actor_user_id, action, tenant_id, entity_type, entity_id, data) on private.platform_audit_events
  to platform_admin_guard;

-- ---------------------------------------------------------------------------------------------------
-- What platform_admin_guard reaches in the platform tables (columns and policies, nothing else)
-- ---------------------------------------------------------------------------------------------------
-- Organizations: list them, create one (the triggers add its settings and security policy).
create policy tenants_platform_admin_guard_read on platform.tenants for select to platform_admin_guard using (true);
create policy tenants_platform_admin_guard_insert on platform.tenants for insert to platform_admin_guard
  with check (status = 'active');
grant select (id, slug, name_ar, name_en, status, created_at) on platform.tenants to platform_admin_guard;
grant insert (slug, name_ar, name_en, status) on platform.tenants to platform_admin_guard;

create policy tenant_settings_platform_admin_guard_insert on platform.tenant_settings for insert
  to platform_admin_guard with check (true);
grant insert (tenant_id) on platform.tenant_settings to platform_admin_guard;
create policy security_policies_platform_admin_guard_insert on platform.security_policies for insert
  to platform_admin_guard with check (true);
grant insert (tenant_id) on platform.security_policies to platform_admin_guard;

-- The Organization Admin's person record (as an invitation creates it).
create policy persons_platform_admin_guard_read on platform.persons for select to platform_admin_guard using (true);
create policy persons_platform_admin_guard_insert on platform.persons for insert to platform_admin_guard
  with check (true);
grant select (id, tenant_id, email, status) on platform.persons to platform_admin_guard;
grant insert (tenant_id, display_name_ar, display_name_en, first_name_ar, family_name_ar, first_name_en,
              family_name_en, email, preferred_locale)
  on platform.persons to platform_admin_guard;

-- Its invitation: the Organization Admin role alone; a code; revoked and replaced when all 4 codes were used.
create policy invitations_platform_admin_guard_read on platform.invitations for select to platform_admin_guard
  using (true);
create policy invitations_platform_admin_guard_insert on platform.invitations for insert to platform_admin_guard
  with check (status = 'pending' and primary_role = 'tenant_admin' and additional_roles = '{}'::text[]
              and not mail_held and import_id is null);
create policy invitations_platform_admin_guard_update on platform.invitations for update to platform_admin_guard
  using (status = 'pending' and primary_role = 'tenant_admin' and not mail_held)
  with check (primary_role = 'tenant_admin' and not mail_held);
grant select (id, tenant_id, person_id, email, locale, primary_role, additional_roles, status, mail_held,
              invite_code, send_count, expires_at, invited_by, created_at)
  on platform.invitations to platform_admin_guard;
grant insert (tenant_id, person_id, email, locale, primary_role, additional_roles, invited_by)
  on platform.invitations to platform_admin_guard;
grant update (invite_code, status) on platform.invitations to platform_admin_guard;

-- Members and their roles: counts and "has an Organization Admin" on the list; the invitation trigger reads
-- whether the person has a membership.
create policy tenant_memberships_platform_admin_guard_read on platform.tenant_memberships for select
  to platform_admin_guard using (true);
grant select (id, tenant_id, user_id, person_id, status) on platform.tenant_memberships to platform_admin_guard;
create policy role_assignments_platform_admin_guard_read on platform.role_assignments for select
  to platform_admin_guard using (true);
grant select (tenant_id, membership_id, role_code, valid_from, valid_until) on platform.role_assignments
  to platform_admin_guard;
create policy ref_roles_platform_admin_guard_read on platform.ref_roles for select to platform_admin_guard
  using (true);
grant select (code, is_privileged) on platform.ref_roles to platform_admin_guard;

-- The organization's own audit trail records what the platform did there (actor: the Super Admin).
create policy audit_events_platform_admin_guard_insert on platform.audit_events for insert to platform_admin_guard
  with check (action in ('platform.tenant.created', 'platform.invitation.created',
                         'platform.invitation.resend_requested')
              and actor_user_id is not null and actor_person_id is null and impersonator_user_id is null);
grant insert (tenant_id, actor_user_id, action, entity_type, entity_id, data) on platform.audit_events
  to platform_admin_guard;

-- Helpers the functions below, and the touched tables' triggers and checks, call.
grant execute on function private.try_uuid(text) to platform_admin_guard;
grant execute on function private.request_claims() to platform_admin_guard;
grant execute on function private.request_user_id() to platform_admin_guard;
grant execute on function private.request_person_id() to platform_admin_guard;
grant execute on function private.current_tenant_id() to platform_admin_guard;
grant execute on function private.user_session_is_valid(uuid, uuid) to platform_admin_guard;
grant execute on function private.lock_tenant_roles(uuid) to platform_admin_guard;
grant execute on function private.has_visible_text(text) to platform_admin_guard;
grant execute on function private.new_invitation_code() to platform_admin_guard;
grant execute on function private.roles_conflict(text, text) to platform_admin_guard;
grant execute on function private.roles_include_conflict(text[]) to platform_admin_guard;

-- ---------------------------------------------------------------------------------------------------
-- Errors (SQLSTATE → @jadarat/platform-db DomainError)
--   42501 not app_server, no valid user session, or not a Super Admin                → NOT_FOUND (404)
--   JP001 invalid input; the message is the field: slug, name_ar, name_en, admin_email, admin_name, locale
--   JP002 the short name (slug) is taken or reserved                                → SLUG_TAKEN
--   JP003 the organization has no pending Organization Admin invitation from the console
--                                                                                   → NO_PENDING_ADMIN
-- ---------------------------------------------------------------------------------------------------

-- Is this user a Super Admin now? Runs as platform_admin_guard (definer): invitation_guard asks it for a
-- console invitation's issuer, the functions below for the caller.
create or replace function private.platform_admin_is_active(p_user_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_user_id is not null
         and exists (select 1 from private.platform_admins a where a.user_id = p_user_id);
$$;

comment on function private.platform_admin_is_active(uuid) is
  'SECURITY-RELEVANT (FR-ADM-17). Is the user a Platform Super Admin? platform_admin_guard and invitation_guard only.';

-- Was the invitation created by a Super Admin (the console)?
create or replace function private.is_platform_invitation(p_invitation_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_invitation_id is not null
         and exists (select 1 from private.platform_invitations i where i.invitation_id = p_invitation_id);
$$;

comment on function private.is_platform_invitation(uuid) is
  'SECURITY-RELEVANT (FR-ADM-17). Was the invitation created from the platform console? platform_admin_guard and invitation_guard only.';

-- The verified Super Admin making this app_server request (valid user session, no tenant claim needed),
-- or 42501. SECURITY INVOKER: called by the definer functions below only.
create or replace function private.platform_admin_caller()
returns uuid
language plpgsql stable
set search_path = ''
as $$
declare
  v_claims jsonb := private.request_claims();
  v_user uuid;
begin
  if session_user <> 'app_server' or v_claims is null or coalesce(v_claims ->> 'role', '') <> 'authenticated' then
    raise exception 'the platform console needs a signed-in Super Admin' using errcode = 'insufficient_privilege';
  end if;
  v_user := private.try_uuid(v_claims ->> 'sub');
  if not private.user_session_is_valid(v_user, private.try_uuid(v_claims ->> 'session_id'))
     or not private.platform_admin_is_active(v_user) then
    raise exception 'the platform console needs a signed-in Super Admin' using errcode = 'insufficient_privilege';
  end if;
  return v_user;
end
$$;

comment on function private.platform_admin_caller() is
  'SECURITY-RELEVANT (FR-ADM-17). The verified Super Admin of an app_server request (valid session), or 42501. platform_admin_guard only.';

-- For the web app (sign-in routing, the console's pages): yes only for a Super Admin's valid session on an
-- app_server connection; never raises.
create or replace function private.is_platform_admin()
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_claims jsonb := private.request_claims();
  v_user uuid;
begin
  if session_user <> 'app_server' or v_claims is null or coalesce(v_claims ->> 'role', '') <> 'authenticated' then
    return false;
  end if;
  v_user := private.try_uuid(v_claims ->> 'sub');
  return coalesce(private.user_session_is_valid(v_user, private.try_uuid(v_claims ->> 'session_id'))
                  and private.platform_admin_is_active(v_user), false);
end
$$;

comment on function private.is_platform_admin() is
  'SECURITY-RELEVANT (FR-ADM-17). Is the signed-in caller (app_server, valid session) a Platform Super Admin? Never raises.';

-- The pending Organization Admin invitation the console created for an organization (latest), if any.
-- SECURITY INVOKER (platform_admin_guard).
create or replace function private.platform_pending_admin_invitation(p_tenant_id uuid)
returns uuid
language sql stable
set search_path = ''
as $$
  select i.id
  from private.platform_invitations pi
  join platform.invitations i on i.tenant_id = pi.tenant_id and i.id = pi.invitation_id
  where pi.tenant_id = p_tenant_id and i.status = 'pending'
  order by i.created_at desc, i.id
  limit 1;
$$;

comment on function private.platform_pending_admin_invitation(uuid) is
  'The pending console invitation of an organization (FR-ADM-17). platform_admin_guard only.';

-- The organizations, newest first, with what the console's table shows: no personal data (no names or
-- e-mails of people), counts and the Organization Admin's state:
--   active   an ACTIVE member holds the Organization Admin role now
--   pending  else, the console's invitation is pending and not expired
--   expired  else, it is pending and expired (a new code gives it 7 more days)
--   none     else (e.g. organizations provisioned by the workflow before, without an admin)
create or replace function private.platform_list_tenants()
returns table (tenant_id uuid, slug text, name_ar text, name_en text, status text, created_at timestamptz,
               member_count integer, admin_state text, admin_invitation_locale text,
               admin_invitation_expires_at timestamptz)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform private.platform_admin_caller();
  return query
    with members as (
      select m.tenant_id, count(*)::integer as n
      from platform.tenant_memberships m where m.status = 'active' group by m.tenant_id),
    admins as (
      select distinct m.tenant_id
      from platform.tenant_memberships m
      join platform.role_assignments ra on ra.tenant_id = m.tenant_id and ra.membership_id = m.id
      where m.status = 'active' and ra.role_code = 'tenant_admin'
        and (ra.valid_from is null or ra.valid_from <= now())
        and (ra.valid_until is null or ra.valid_until > now())),
    pending as (
      select distinct on (i.tenant_id) i.tenant_id, i.locale, i.expires_at
      from private.platform_invitations pi
      join platform.invitations i on i.tenant_id = pi.tenant_id and i.id = pi.invitation_id
      where i.status = 'pending'
      order by i.tenant_id, i.created_at desc, i.id)
    select t.id, t.slug, t.name_ar, t.name_en, t.status, t.created_at, coalesce(mb.n, 0),
           case when a.tenant_id is not null then 'active'
                when p.tenant_id is not null and p.expires_at > now() then 'pending'
                when p.tenant_id is not null then 'expired'
                else 'none' end,
           case when a.tenant_id is null then p.locale end,
           case when a.tenant_id is null then p.expires_at end
    from platform.tenants t
    left join members mb on mb.tenant_id = t.id
    left join admins a on a.tenant_id = t.id
    left join pending p on p.tenant_id = t.id
    order by t.created_at desc, t.id;
end
$$;

comment on function private.platform_list_tenants() is
  'SECURITY-RELEVANT (FR-ADM-17). The organizations for the platform console (counts and Organization Admin state, no personal data). Super Admins only (app_server, valid session).';

-- Short names that are never an organization's (future subdomains of the platform itself).
create or replace function private.platform_reserved_slug(p_slug text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select p_slug = any (array['admin', 'api', 'app', 'assets', 'auth', 'help', 'login', 'mail', 'platform',
                             'static', 'status', 'suite', 'support', 'www']);
$$;

comment on function private.platform_reserved_slug(text) is
  'Short names reserved for the platform (FR-ADM-17). platform_admin_guard only.';

-- Writes a new code to a pending, sent invitation (the step private.issue_invitation_code always did):
-- the lifecycle trigger derives the token hash, counts it, stamps it and gives 7 days. Retries the
-- improbable collision with another invitation's code. SECURITY INVOKER: runs as its caller
-- (invitation_guard for issue_invitation_code, platform_admin_guard for the console).
create or replace function private.write_invitation_code(p_invitation_id uuid)
returns text
language plpgsql volatile
set search_path = ''
as $$
declare
  v_code text;
  v_constraint text;
  v_try integer := 0;
begin
  if current_user not in ('invitation_guard', 'platform_admin_guard') then
    raise exception 'invitation codes are written by the invitation functions only' using errcode = 'insufficient_privilege';
  end if;
  loop
    v_try := v_try + 1;
    v_code := private.new_invitation_code();
    begin
      update platform.invitations i set invite_code = v_code where i.id = p_invitation_id;
      if not found then
        raise exception 'the invitation is not pending' using errcode = 'JI005';
      end if;
      return v_code;
    exception when unique_violation then
      -- Another invitation holds this code (improbable: 32^8 codes): draw again, a few times.
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint not in ('invitations_invite_code_uq', 'invitations_token_hash_uq') or v_try >= 5 then
        raise;
      end if;
    end;
  end loop;
end
$$;

comment on function private.write_invitation_code(uuid) is
  'SECURITY-RELEVANT (FR-IAM-03, FR-ADM-17). Internal: stores a fresh code on an invitation (callers check the actor and the state first). invitation_guard and platform_admin_guard only.';

-- Creates an organization with its first Organization Admin's pending invitation; returns the invitation's
-- first code (for the Super Admin to copy, never logged or audited).
create or replace function private.platform_create_tenant(
  p_slug text, p_name_ar text, p_name_en text, p_admin_email text,
  p_admin_first_name_ar text default null, p_admin_family_name_ar text default null,
  p_admin_first_name_en text default null, p_admin_family_name_en text default null,
  p_locale text default 'en')
returns table (tenant_id uuid, invitation_id uuid, invite_code text)
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.platform_admin_caller();
  v_slug text := coalesce(p_slug, '');
  v_name_ar text := btrim(coalesce(p_name_ar, ''));
  v_name_en text := nullif(btrim(coalesce(p_name_en, '')), '');
  v_email text := lower(btrim(coalesce(p_admin_email, '')));
  v_first_ar text := nullif(btrim(coalesce(p_admin_first_name_ar, '')), '');
  v_family_ar text := nullif(btrim(coalesce(p_admin_family_name_ar, '')), '');
  v_first_en text := nullif(btrim(coalesce(p_admin_first_name_en, '')), '');
  v_family_en text := nullif(btrim(coalesce(p_admin_family_name_en, '')), '');
  v_display_ar text;
  v_display_en text;
  v_tenant uuid;
  v_person uuid;
  v_invitation uuid;
  v_code text;
  v_saved_claims text := pg_catalog.current_setting('request.jwt.claims', true);
begin
  -- Input (validated again here: the database never trusts the web app). Messages name the field only.
  if v_slug !~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$' then
    raise exception 'slug' using errcode = 'JP001';
  end if;
  if v_name_ar = '' or char_length(v_name_ar) > 200 or v_name_ar ~ '[[:cntrl:]]'
     or not private.has_visible_text(v_name_ar) then
    raise exception 'name_ar' using errcode = 'JP001';
  end if;
  if v_name_en is not null and (char_length(v_name_en) > 200 or v_name_en ~ '[[:cntrl:]]'
                                or not private.has_visible_text(v_name_en)) then
    raise exception 'name_en' using errcode = 'JP001';
  end if;
  if char_length(v_email) not between 3 and 254 or v_email !~ '^[^@\s[:cntrl:]]+@[^@\s[:cntrl:]]+\.[^@\s[:cntrl:]]+$' then
    raise exception 'admin_email' using errcode = 'JP001';
  end if;
  if exists (select 1 from unnest(array[v_first_ar, v_family_ar, v_first_en, v_family_en]) n
             where n is not null and (char_length(n) > 100 or n ~ '[[:cntrl:]]' or not private.has_visible_text(n))) then
    raise exception 'admin_name' using errcode = 'JP001';
  end if;
  if p_locale is null or p_locale not in ('ar', 'en') then
    raise exception 'locale' using errcode = 'JP001';
  end if;
  if private.platform_reserved_slug(v_slug) then
    raise exception 'the short name is reserved' using errcode = 'JP002';
  end if;

  -- Without the caller's claims: the [std] stamps record a platform operation (as provisioning does), and
  -- the tenant-scoped triggers see no user of another organization. Put back before returning; any error
  -- aborts the (sub)transaction, which reverts the setting too.
  perform pg_catalog.set_config('request.jwt.claims', '', true);

  begin
    insert into platform.tenants (slug, name_ar, name_en, status)
    values (v_slug, v_name_ar, v_name_en, 'active')
    returning id into v_tenant;
  exception when unique_violation then
    raise exception 'the short name is taken' using errcode = 'JP002';
  end;

  -- The person record: the names given, else the neutral name provisioning uses until the invitee sets
  -- their own on the sign-up page.
  v_display_ar := nullif(concat_ws(' ', v_first_ar, v_family_ar), '');
  v_display_en := nullif(concat_ws(' ', v_first_en, v_family_en), '');
  if v_display_ar is null and v_display_en is null then
    v_display_ar := 'مدير المنشأة';
    v_display_en := 'Organization Admin';
  end if;
  insert into platform.persons (tenant_id, display_name_ar, display_name_en, first_name_ar, family_name_ar,
                                first_name_en, family_name_en, email, preferred_locale)
  values (v_tenant, coalesce(v_display_ar, v_display_en), v_display_en, v_first_ar, v_family_ar,
          v_first_en, v_family_en, v_email, p_locale)
  returning id into v_person;

  insert into platform.invitations (tenant_id, person_id, email, locale, primary_role, additional_roles, invited_by)
  values (v_tenant, v_person, v_email, p_locale, 'tenant_admin', '{}'::text[], v_actor)
  returning id into v_invitation;
  insert into private.platform_invitations (invitation_id, tenant_id) values (v_invitation, v_tenant);

  perform private.lock_tenant_roles(v_tenant);
  v_code := private.write_invitation_code(v_invitation);

  -- Audit: the platform's trail and the organization's own (ids only; never the code or the e-mail).
  insert into private.platform_audit_events (actor_user_id, action, tenant_id, entity_type, entity_id, data)
  values (v_actor, 'platform.tenant.created', v_tenant, 'tenant', v_tenant::text,
          jsonb_build_object('invitationId', v_invitation, 'locale', p_locale));
  insert into platform.audit_events (tenant_id, actor_user_id, action, entity_type, entity_id, data)
  values (v_tenant, v_actor, 'platform.tenant.created', 'tenant', v_tenant::text,
          jsonb_build_object('source', 'platform_console')),
         (v_tenant, v_actor, 'platform.invitation.created', 'invitation', v_invitation::text,
          jsonb_build_object('source', 'platform_console', 'personId', v_person, 'primaryRole', 'tenant_admin',
                             'additionalRoles', '[]'::jsonb));

  perform pg_catalog.set_config('request.jwt.claims', coalesce(v_saved_claims, ''), true);
  return query select v_tenant, v_invitation, v_code;
end
$$;

comment on function private.platform_create_tenant(text, text, text, text, text, text, text, text, text) is
  'SECURITY-RELEVANT (FR-ADM-17). Creates an organization (as provisioning) and its Organization Admin''s pending invitation with its first code. Super Admins only (app_server, valid session).';

-- The pending console invitation's current code (Copy code / Copy invite link), without changing it.
create or replace function private.platform_admin_invitation_code(p_tenant_id uuid)
returns table (invite_code text, locale text, expires_at timestamptz)
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.platform_admin_caller();
  v_invitation uuid := private.platform_pending_admin_invitation(p_tenant_id);
  v_inv record;
begin
  select i.invite_code, i.locale, i.expires_at into v_inv
  from platform.invitations i where i.tenant_id = p_tenant_id and i.id = v_invitation;
  if v_invitation is null or v_inv.invite_code is null then
    raise exception 'no pending Organization Admin invitation' using errcode = 'JP003';
  end if;
  insert into private.platform_audit_events (actor_user_id, action, tenant_id, entity_type, entity_id)
  values (v_actor, 'platform.tenant.admin_code_viewed', p_tenant_id, 'invitation', v_invitation::text);
  return query select v_inv.invite_code, v_inv.locale, v_inv.expires_at;
end
$$;

comment on function private.platform_admin_invitation_code(uuid) is
  'SECURITY-RELEVANT (FR-ADM-17). The current code of an organization''s pending console invitation (audited read). Super Admins only.';

-- A new code for the pending console invitation (the old one stops working; 7 more days). After its 4
-- codes the invitation is revoked and a new one for the same person takes its place.
create or replace function private.platform_reissue_admin_code(p_tenant_id uuid)
returns table (invite_code text, locale text, expires_at timestamptz)
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.platform_admin_caller();
  v_invitation uuid;
  v_inv record;
  v_code text;
  v_replaced boolean := false;
  v_saved_claims text := pg_catalog.current_setting('request.jwt.claims', true);
begin
  perform pg_catalog.set_config('request.jwt.claims', '', true);
  -- Serialised with the organization's role changes and acceptance (same lock).
  perform private.lock_tenant_roles(p_tenant_id);
  v_invitation := private.platform_pending_admin_invitation(p_tenant_id);
  select i.id, i.person_id, i.email, i.locale, i.send_count, i.invited_by into v_inv
  from platform.invitations i
  where i.tenant_id = p_tenant_id and i.id = v_invitation and i.status = 'pending'
  for update;
  if not found then
    raise exception 'no pending Organization Admin invitation' using errcode = 'JP003';
  end if;
  if v_inv.send_count >= 4 then
    update platform.invitations i set status = 'revoked' where i.id = v_inv.id;
    insert into platform.invitations (tenant_id, person_id, email, locale, primary_role, additional_roles, invited_by)
    values (p_tenant_id, v_inv.person_id, v_inv.email, v_inv.locale, 'tenant_admin', '{}'::text[], v_actor)
    returning id into v_invitation;
    insert into private.platform_invitations (invitation_id, tenant_id) values (v_invitation, p_tenant_id);
    v_replaced := true;
  end if;
  v_code := private.write_invitation_code(v_invitation);

  insert into private.platform_audit_events (actor_user_id, action, tenant_id, entity_type, entity_id, data)
  values (v_actor, 'platform.tenant.admin_code_issued', p_tenant_id, 'invitation', v_invitation::text,
          jsonb_build_object('replacedInvitation', case when v_replaced then v_inv.id end));
  insert into platform.audit_events (tenant_id, actor_user_id, action, entity_type, entity_id, data)
  values (p_tenant_id, v_actor, 'platform.invitation.resend_requested', 'invitation', v_invitation::text,
          jsonb_build_object('source', 'platform_console'));

  perform pg_catalog.set_config('request.jwt.claims', coalesce(v_saved_claims, ''), true);
  return query select i.invite_code, i.locale, i.expires_at from platform.invitations i
               where i.tenant_id = p_tenant_id and i.id = v_invitation;
end
$$;

comment on function private.platform_reissue_admin_code(uuid) is
  'SECURITY-RELEVANT (FR-ADM-17). A new code for an organization''s pending console invitation (after 4 codes: a new invitation). Super Admins only.';

-- Granting and revoking Super Admins: the Platform admin workflow (scripts/platform-admin.sh), as the
-- migration role. EXECUTE for the migration role only; never the request path.
create or replace function private.grant_platform_admin(p_user_id uuid)
returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  if session_user in ('app_server', 'app_worker', 'app_queue') or p_user_id is null then
    raise exception 'Super Admins are granted by the platform admin workflow only' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from private.platform_admins a where a.user_id = p_user_id) then
    return false;
  end if;
  begin
    insert into private.platform_admins (user_id, granted_by) values (p_user_id, 'workflow');
  exception when foreign_key_violation then
    raise exception 'no Auth user with this UID (create the user in Authentication → Users first)'
      using errcode = 'JP004';
  end;
  insert into private.platform_audit_events (action, entity_type, entity_id, data)
  values ('platform.admin.granted', 'user', p_user_id::text, jsonb_build_object('source', 'workflow'));
  return true;
end
$$;

comment on function private.grant_platform_admin(uuid) is
  'SECURITY-RELEVANT (FR-ADM-17). Makes an Auth user a Platform Super Admin (audited). The migration role only (Platform admin workflow).';

create or replace function private.revoke_platform_admin(p_user_id uuid)
returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  if session_user in ('app_server', 'app_worker', 'app_queue') or p_user_id is null then
    raise exception 'Super Admins are revoked by the platform admin workflow only' using errcode = 'insufficient_privilege';
  end if;
  delete from private.platform_admins a where a.user_id = p_user_id;
  if not found then
    return false;
  end if;
  insert into private.platform_audit_events (action, entity_type, entity_id, data)
  values ('platform.admin.revoked', 'user', p_user_id::text, jsonb_build_object('source', 'workflow'));
  return true;
end
$$;

comment on function private.revoke_platform_admin(uuid) is
  'SECURITY-RELEVANT (FR-ADM-17). Ends an account''s Platform Super Admin role (audited); its pending console invitations stop working. The migration role only.';

-- ---------------------------------------------------------------------------------------------------
-- Invitation links and acceptance: a console invitation's inviter rule (as in 20261009090000 otherwise)
-- ---------------------------------------------------------------------------------------------------
-- May the invitation still give its roles? A console invitation: while its issuer is a Super Admin and it
-- gives the Organization Admin role alone. Any other: the inviter's current authority in the organization
-- (private.invitation_inviter_may_grant, review M1). Runs as invitation_guard.
create or replace function private.invitation_issuer_may_grant(
  p_invitation_id uuid, p_tenant_id uuid, p_invited_by uuid, p_roles text[])
returns boolean
language plpgsql stable
set search_path = ''
as $$
begin
  if private.is_platform_invitation(p_invitation_id) then
    return p_roles = array['tenant_admin']::text[] and private.platform_admin_is_active(p_invited_by);
  end if;
  return private.invitation_inviter_may_grant(p_tenant_id, p_invited_by, p_roles);
end
$$;

comment on function private.invitation_issuer_may_grant(uuid, uuid, uuid, text[]) is
  'SECURITY-RELEVANT (FR-IAM-03, FR-ADM-17). Does the invitation''s issuer still hold the authority to give its roles (console invitations: a Super Admin, Organization Admin role alone)? invitation_guard only.';

create or replace function private.invitation_link(p_token_hash bytea)
returns table (state text, tenant_name_ar text, tenant_name_en text, email text, display_name_ar text,
               display_name_en text, locale text)
language plpgsql stable
set search_path = ''
as $$
declare
  v record;
begin
  if p_token_hash is null or octet_length(p_token_hash) <> 32 then
    return query select 'invalid'::text, null::text, null::text, null::text, null::text, null::text, null::text;
    return;
  end if;
  select i.id, i.status, i.expires_at, i.email, i.locale, i.tenant_id, i.person_id, i.invited_by, i.primary_role,
         i.additional_roles, t.status as tenant_status, t.name_ar, t.name_en,
         p.email as person_email, p.status as person_status, p.display_name_ar, p.display_name_en
    into v
  from platform.invitations i
  join platform.tenants t on t.id = i.tenant_id
  join platform.persons p on p.tenant_id = i.tenant_id and p.id = i.person_id
  where i.token_hash = p_token_hash;

  if not found then
    state := 'invalid';
  elsif v.status = 'accepted' then
    state := 'used';
  elsif v.status = 'revoked' then
    state := 'revoked';
  elsif v.tenant_status not in ('active', 'trial') then
    state := 'invalid';
  elsif v.expires_at <= now() then
    state := 'expired';
  elsif v.person_status <> 'active' or v.person_email is distinct from v.email
        or exists (select 1 from platform.tenant_memberships m
                   where m.tenant_id = v.tenant_id and m.person_id = v.person_id)
        or not private.invitation_issuer_may_grant(v.id, v.tenant_id, v.invited_by,
                                                   array[v.primary_role] || v.additional_roles) then
    state := 'invalid';
  else
    return query select 'valid'::text, v.name_ar, v.name_en, v.email, v.display_name_ar, v.display_name_en, v.locale;
    return;
  end if;
  return query select state, null::text, null::text, null::text, null::text, null::text, null::text;
end
$$;

create or replace function private.apply_invitation_acceptance(
  p_token_hash bytea, p_user_id uuid, p_display_name_ar text, p_display_name_en text)
returns uuid
language plpgsql volatile
set search_path = ''
as $$
declare
  v_inv record;
  v_user_email text;
  v_membership uuid;
  v_role text;
  v_name_ar text := nullif(btrim(p_display_name_ar), '');
  v_name_en text := nullif(btrim(p_display_name_en), '');
  v_saved_claims text := pg_catalog.current_setting('request.jwt.claims', true);
begin
  if current_user <> 'invitation_guard' or p_token_hash is null or p_user_id is null then
    raise exception 'invitation acceptance is reserved to the acceptance function' using errcode = 'insufficient_privilege';
  end if;
  perform pg_catalog.set_config('request.jwt.claims', '', true);

  update platform.invitations i
  set status = 'accepted', accepted_user_id = p_user_id
  where i.token_hash = p_token_hash and i.status = 'pending' and i.expires_at > now()
  returning i.id, i.tenant_id, i.person_id, i.email, i.primary_role, i.additional_roles, i.invited_by
    into v_inv;
  if not found then
    raise exception 'the invitation is not valid' using errcode = 'JI001';
  end if;

  -- Serialised with the tenant's role and membership changes (their guards take the same lock), so the
  -- inviter's authority read here holds until this transaction commits.
  perform private.lock_tenant_roles(v_inv.tenant_id);
  if not private.invitation_issuer_may_grant(v_inv.id, v_inv.tenant_id, v_inv.invited_by,
                                             array[v_inv.primary_role] || v_inv.additional_roles)
     or not exists (select 1 from platform.tenants t where t.id = v_inv.tenant_id and t.status in ('active', 'trial'))
     or not exists (select 1 from platform.persons p
                    where p.tenant_id = v_inv.tenant_id and p.id = v_inv.person_id
                      and p.status = 'active' and p.email = v_inv.email)
     or exists (select 1 from platform.tenant_memberships m
                where m.tenant_id = v_inv.tenant_id and m.person_id = v_inv.person_id) then
    raise exception 'the invitation is not valid' using errcode = 'JI001';
  end if;

  select lower(u.email) into v_user_email from private.auth_user_email u where u.id = p_user_id;
  if v_user_email is distinct from v_inv.email then
    raise exception 'the account does not match the invitation' using errcode = 'JI003';
  end if;
  if exists (select 1 from platform.tenant_memberships m where m.tenant_id = v_inv.tenant_id and m.user_id = p_user_id) then
    raise exception 'the account is already a member of the organization' using errcode = 'JI002';
  end if;

  insert into platform.tenant_memberships (tenant_id, user_id, person_id, status)
  values (v_inv.tenant_id, p_user_id, v_inv.person_id, 'active')
  returning id into v_membership;

  insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary)
  values (v_inv.tenant_id, v_membership, v_inv.primary_role, true);
  foreach v_role in array v_inv.additional_roles loop
    insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary)
    values (v_inv.tenant_id, v_membership, v_role, false);
  end loop;

  if v_name_ar is not null or v_name_en is not null then
    update platform.persons p
    set display_name_ar = coalesce(v_name_ar, p.display_name_ar),
        display_name_en = coalesce(v_name_en, p.display_name_en)
    where p.tenant_id = v_inv.tenant_id and p.id = v_inv.person_id
      and (coalesce(v_name_ar, p.display_name_ar), coalesce(v_name_en, p.display_name_en))
          is distinct from (p.display_name_ar, p.display_name_en);
  end if;

  insert into platform.audit_events (tenant_id, actor_user_id, actor_person_id, action, entity_type, entity_id)
  values (v_inv.tenant_id, p_user_id, v_inv.person_id, 'platform.invitation.accepted', 'invitation', v_inv.id::text);

  insert into platform.event_outbox (id, tenant_id, type, subject, actor_id)
  values (gen_random_uuid(), v_inv.tenant_id, 'com.entlaqa.platform.invitation.accepted', v_inv.id, p_user_id);

  perform pg_catalog.set_config('request.jwt.claims', coalesce(v_saved_claims, ''), true);
  return v_inv.tenant_id;
end
$$;

-- issue_invitation_code (20261018090000): the same checks, the code written by the shared step.
create or replace function private.issue_invitation_code(p_invitation_id uuid)
returns text
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_tenant uuid;
  v_inv record;
begin
  select c.o_user, c.o_tenant into v_user, v_tenant from private.invitation_code_caller() c;
  -- Serialised with the organization's role changes: the actor's authority read below holds until commit.
  perform private.lock_tenant_roles(v_tenant);
  select i.id, i.status, i.mail_held, i.send_count, i.invited_by, i.primary_role, i.additional_roles
    into v_inv
  from platform.invitations i
  where i.id = p_invitation_id and i.tenant_id = v_tenant
  for update;
  if not found or v_inv.status <> 'pending' or v_inv.mail_held then
    raise exception 'the invitation is not pending' using errcode = 'JI005';
  end if;
  if not private.invitation_inviter_may_grant(v_tenant, v_user, array[v_inv.primary_role] || v_inv.additional_roles) then
    raise exception 'only an Organization Admin or an HR Manager (ordinary roles) issues invitation codes'
      using errcode = 'insufficient_privilege';
  end if;
  if v_inv.send_count >= 4 then
    raise exception 'the invitation has had all its codes' using errcode = 'JI004';
  end if;
  return private.write_invitation_code(v_inv.id);
end
$$;

-- ---------------------------------------------------------------------------------------------------
-- Ownership and grants (hand-over as in 20260930120100)
-- ---------------------------------------------------------------------------------------------------
grant create on schema private to platform_admin_guard;
alter function private.platform_admin_is_active(uuid) owner to platform_admin_guard;
alter function private.is_platform_invitation(uuid) owner to platform_admin_guard;
alter function private.platform_admin_caller() owner to platform_admin_guard;
alter function private.is_platform_admin() owner to platform_admin_guard;
alter function private.platform_pending_admin_invitation(uuid) owner to platform_admin_guard;
alter function private.platform_list_tenants() owner to platform_admin_guard;
alter function private.platform_reserved_slug(text) owner to platform_admin_guard;
alter function private.platform_create_tenant(text, text, text, text, text, text, text, text, text) owner to platform_admin_guard;
alter function private.platform_admin_invitation_code(uuid) owner to platform_admin_guard;
alter function private.platform_reissue_admin_code(uuid) owner to platform_admin_guard;
alter function private.grant_platform_admin(uuid) owner to platform_admin_guard;
alter function private.revoke_platform_admin(uuid) owner to platform_admin_guard;
revoke create on schema private from platform_admin_guard;

grant create on schema private to invitation_guard;
alter function private.write_invitation_code(uuid) owner to invitation_guard;
alter function private.invitation_issuer_may_grant(uuid, uuid, uuid, text[]) owner to invitation_guard;
revoke create on schema private from invitation_guard;

revoke all on function private.platform_admin_is_active(uuid) from public;
revoke all on function private.is_platform_invitation(uuid) from public;
revoke all on function private.platform_admin_caller() from public;
revoke all on function private.is_platform_admin() from public;
revoke all on function private.platform_pending_admin_invitation(uuid) from public;
revoke all on function private.platform_list_tenants() from public;
revoke all on function private.platform_reserved_slug(text) from public;
revoke all on function private.platform_create_tenant(text, text, text, text, text, text, text, text, text) from public;
revoke all on function private.platform_admin_invitation_code(uuid) from public;
revoke all on function private.platform_reissue_admin_code(uuid) from public;
revoke all on function private.grant_platform_admin(uuid) from public;
revoke all on function private.revoke_platform_admin(uuid) from public;
revoke all on function private.write_invitation_code(uuid) from public;
revoke all on function private.invitation_issuer_may_grant(uuid, uuid, uuid, text[]) from public;

-- The web app (app_server → authenticated); each function checks the login role, the session and the
-- Super Admin itself.
grant execute on function private.is_platform_admin() to authenticated;
grant execute on function private.platform_list_tenants() to authenticated;
grant execute on function private.platform_create_tenant(text, text, text, text, text, text, text, text, text) to authenticated;
grant execute on function private.platform_admin_invitation_code(uuid) to authenticated;
grant execute on function private.platform_reissue_admin_code(uuid) to authenticated;
-- The workflow (the migration role) only.
grant execute on function private.grant_platform_admin(uuid) to current_user;
grant execute on function private.revoke_platform_admin(uuid) to current_user;
-- Invitation links and acceptance (invitation_guard) ask about console invitations.
grant execute on function private.platform_admin_is_active(uuid) to invitation_guard;
grant execute on function private.is_platform_invitation(uuid) to invitation_guard;
-- The shared code-writing step: both guards.
grant execute on function private.write_invitation_code(uuid) to platform_admin_guard;

do $$
begin
  if exists (select 1 from pg_catalog.pg_proc p
             where p.oid in ('private.is_platform_admin()'::regprocedure, 'private.platform_list_tenants()'::regprocedure,
                             'private.platform_create_tenant(text, text, text, text, text, text, text, text, text)'::regprocedure,
                             'private.platform_admin_invitation_code(uuid)'::regprocedure,
                             'private.platform_reissue_admin_code(uuid)'::regprocedure,
                             'private.grant_platform_admin(uuid)'::regprocedure,
                             'private.revoke_platform_admin(uuid)'::regprocedure)
               and pg_catalog.pg_get_userbyid(p.proowner) <> 'platform_admin_guard') then
    raise exception 'the platform console functions must be owned by platform_admin_guard';
  end if;
  if pg_catalog.pg_get_userbyid((select p.proowner from pg_catalog.pg_proc p
       where p.oid = 'private.invitation_link(bytea)'::regprocedure)) <> 'invitation_guard'
     or pg_catalog.pg_get_userbyid((select p.proowner from pg_catalog.pg_proc p
       where p.oid = 'private.issue_invitation_code(uuid)'::regprocedure)) <> 'invitation_guard' then
    raise exception 'the invitation functions must stay owned by invitation_guard';
  end if;
  if has_function_privilege('authenticated', 'private.grant_platform_admin(uuid)', 'execute')
     or has_table_privilege('authenticated', 'private.platform_admins', 'select') then
    raise exception 'the request path must neither grant nor read Super Admins';
  end if;
end
$$;
