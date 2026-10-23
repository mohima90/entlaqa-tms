-- Remembered browsers (WP-ADM-05, FR-IAM-12; business flow EP-AUTH-signin-extras BR-AUTH-f/g, PO 23 Oct 2026 #4).
-- ADR 0002 §6 pattern. Class: T. PII: a short browser label such as "Chrome on Windows" (never the raw user
-- agent, never an address); the token itself is stored only as its SHA-256.
--
-- A person ticks «Remember this browser» on the e-mailed-code screen; for the days their organization chose
-- (platform.security_policies.remembered_browser_days, 20261026100000: Off / 1 / 7 / 14 / 30) that browser
-- signs in with «Email me a code» WITHOUT a code. The browser holds a random 256-bit token in an HttpOnly,
-- Secure, SameSite cookie; the database keeps one row per (organization, person, token hash).
--
--   platform.remembered_browsers  (tenant_id, user_id, person_id, token_hash, label, created_at, last_used_at,
--                           expires_at). RLS: the restrictive tenant_isolation policy; a member reads and
--                           deletes (= forgets) their OWN rows only, never the hash (column grant); nobody
--                           inserts or updates directly. The two guards write: account_mail_guard (the
--                           remember and use functions) and tenant_guard (forgetting for a member).
--   private.remembered_browser_ok(user, hash)   may this browser skip the code for this account NOW? It must be
--                           remembered in EVERY organization where the person is an active member (strictest
--                           organization wins, BR-AUTH-h), each time within its own date AND within creation +
--                           the organization's CURRENT days (shortening or switching off applies at once).
--   private.remember_browser(hash, label)       app_server with the signed-in user's claims (an organization
--                           is not yet selected): remembers the browser in every organization of the account -
--                           none when any of them has the setting Off (strictest wins). At most 10 per person
--                           and organization (the oldest go). Audited in each organization
--                           (`platform.auth.browser_remembered`, no browser data).
--   private.forget_member_remembered_browsers(person)   app_server, an Organization Admin / user manager
--                           (the permission of «End sessions»): forgets that member's remembered browsers.
--   trigger on platform.tenant_memberships      a member who is no longer active loses their remembered
--                           browsers of that organization (BR-AUTH-g: deactivation).
--   private.auth_password_marker   view of auth.users (id, a SHA-256 marker of the stored password hash - never the
--                           hash): a remembered browser is valid only while the marker is the one it was
--                           remembered under, so a password CHANGE or RESET forgets every remembered browser of
--                           the account at once (BR-AUTH-g) without any hook in the application.
-- Expand-first: new objects only.

create table platform.remembered_browsers (
  tenant_id uuid not null references platform.tenants (id),
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  person_id uuid not null,
  -- SHA-256 of the cookie's 256-bit random token (the application hashes; the token never reaches the database).
  token_hash bytea not null,
  -- The account's password marker when the browser was remembered (private.auth_password_marker).
  password_marker text not null,
  label text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz not null,
  primary key (tenant_id, id),
  constraint remembered_browsers_token_uq unique (tenant_id, user_id, token_hash),
  constraint remembered_browsers_person_fkey foreign key (tenant_id, person_id)
    references platform.persons (tenant_id, id),
  constraint remembered_browsers_token_hash_check check (octet_length(token_hash) = 32),
  constraint remembered_browsers_password_marker_check check (password_marker ~ '^[0-9a-f]{64}$'),
  constraint remembered_browsers_label_check check (label is null or (char_length(label) between 1 and 80 and label ~ '^[\x20-\x7E]+$')),
  constraint remembered_browsers_expires_check check (expires_at > created_at and expires_at <= created_at + interval '31 days')
);
comment on table platform.remembered_browsers is
  'SECURITY-RELEVANT (WP-ADM-05). Browsers a person chose to remember (skip the e-mailed sign-in code); SHA-256 of the cookie token, per organization and person. Owner: platform. Class: T.';
comment on column platform.remembered_browsers.label is 'pii:indirect - browser and system name only';

create index remembered_browsers_user_idx on platform.remembered_browsers (user_id, token_hash);
create index remembered_browsers_person_idx on platform.remembered_browsers (tenant_id, person_id, created_at desc);

alter table platform.remembered_browsers enable row level security;
alter table platform.remembered_browsers force row level security;

create policy tenant_isolation on platform.remembered_browsers
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
create policy remembered_browsers_read on platform.remembered_browsers for select to authenticated
  using (user_id = (select private.request_user_id()));
create policy remembered_browsers_forget on platform.remembered_browsers for delete to authenticated
  using (user_id = (select private.request_user_id()));
create policy remembered_browsers_account_mail_guard on platform.remembered_browsers for all to account_mail_guard
  using (true) with check (true);
create policy remembered_browsers_tenant_guard on platform.remembered_browsers for all to tenant_guard
  using (true) with check (true);

revoke all on platform.remembered_browsers from public, anon;
-- The hash is not readable by members; they list and forget their browsers.
grant select (tenant_id, id, user_id, person_id, label, created_at, last_used_at, expires_at)
  on platform.remembered_browsers to authenticated;
grant delete on platform.remembered_browsers to authenticated;
grant select, insert, update, delete on platform.remembered_browsers to account_mail_guard, tenant_guard;

-- Account-level audit rows written by the remember function (an allow-list of actions, no personal data).
create policy audit_events_account_mail_guard_insert on platform.audit_events for insert to account_mail_guard
  with check (action in ('platform.auth.browser_remembered', 'platform.auth.sign_in_code_sent')
              and impersonator_user_id is null);
grant insert (tenant_id, actor_user_id, actor_person_id, action, entity_type, entity_id, data)
  on platform.audit_events to account_mail_guard;

-- ---------------------------------------------------------------------------------------------------
-- The password marker: a hash of the stored password hash (view of auth.users, owned by the migration role, as
-- private.auth_account)
-- ---------------------------------------------------------------------------------------------------
create or replace view private.auth_password_marker
with (security_barrier = true)  -- defensive only: the view has no WHERE clause
as select u.id, pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(coalesce(u.encrypted_password, ''), 'UTF8')), 'hex') as marker
   from auth.users u;
comment on view private.auth_password_marker is
  'SECURITY-RELEVANT (WP-ADM-05): auth.users (id, SHA-256 of the stored password hash) for account_mail_guard only - changes with every password change or reset; never the hash.';
revoke all on private.auth_password_marker from public;
grant select on private.auth_password_marker to account_mail_guard;

-- ---------------------------------------------------------------------------------------------------
-- May this browser skip the code for this account now?
-- ---------------------------------------------------------------------------------------------------
create or replace function private.remembered_browser_ok(p_user_id uuid, p_hash bytea)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_user_id is not null and p_hash is not null and octet_length(p_hash) = 32
         and exists (select 1 from platform.tenant_memberships m
                     join platform.tenants t on t.id = m.tenant_id
                     where m.user_id = p_user_id and m.status = 'active' and t.status in ('active', 'trial'))
         and not exists (
           select 1
           from platform.tenant_memberships m
           join platform.tenants t on t.id = m.tenant_id
           where m.user_id = p_user_id and m.status = 'active' and t.status in ('active', 'trial')
             and not exists (
               select 1
               from platform.remembered_browsers r
               join platform.security_policies p on p.tenant_id = r.tenant_id
               join private.auth_password_marker pm on pm.id = r.user_id and pm.marker = r.password_marker
               where r.tenant_id = m.tenant_id and r.user_id = p_user_id and r.token_hash = p_hash
                 and p.remembered_browser_days > 0
                 and least(r.expires_at, r.created_at + make_interval(days => p.remembered_browser_days)) > now()))
$$;
comment on function private.remembered_browser_ok(uuid, bytea) is
  'SECURITY-RELEVANT (WP-ADM-05, BR-AUTH-f/h). True when the browser (token hash) is remembered and still valid in EVERY organization where the account is an active member, within each organization''s CURRENT days. account_mail_guard''s functions only.';

-- ---------------------------------------------------------------------------------------------------
-- Remembering (the signed-in user, right after a code sign-in; no organization selected yet)
-- ---------------------------------------------------------------------------------------------------
create or replace function private.remember_browser(p_token_hash bytea, p_label text)
returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_claims jsonb := private.request_claims();
  v_user uuid := private.request_user_id();
  v_label text := nullif(btrim(p_label), '');
  v_marker text;
  v_count integer;
begin
  if session_user <> 'app_server' or v_user is null or coalesce(v_claims ->> 'role', '') <> 'authenticated'
     or p_token_hash is null or octet_length(p_token_hash) <> 32 then
    raise exception 'reserved to a signed-in user' using errcode = 'insufficient_privilege';
  end if;
  if v_label is not null and (char_length(v_label) > 80 or v_label !~ '^[\x20-\x7E]+$') then
    v_label := null;
  end if;
  select pm.marker into v_marker from private.auth_password_marker pm where pm.id = v_user;
  if v_marker is null then
    return 0;
  end if;
  -- The strictest organization wins: nothing is remembered when any organization of the account has the
  -- setting Off (or has no policy row), or when the account is a member nowhere.
  if not exists (select 1 from platform.tenant_memberships m join platform.tenants t on t.id = m.tenant_id
                 where m.user_id = v_user and m.status = 'active' and t.status in ('active', 'trial'))
     or exists (select 1 from platform.tenant_memberships m join platform.tenants t on t.id = m.tenant_id
                left join platform.security_policies p on p.tenant_id = m.tenant_id
                where m.user_id = v_user and m.status = 'active' and t.status in ('active', 'trial')
                  and coalesce(p.remembered_browser_days, 0) = 0) then
    return 0;
  end if;
  insert into platform.remembered_browsers (tenant_id, user_id, person_id, token_hash, password_marker, label, created_at, expires_at)
  select m.tenant_id, v_user, m.person_id, p_token_hash, v_marker, v_label, now(),
         now() + make_interval(days => p.remembered_browser_days)
  from platform.tenant_memberships m
  join platform.tenants t on t.id = m.tenant_id
  join platform.security_policies p on p.tenant_id = m.tenant_id
  where m.user_id = v_user and m.status = 'active' and t.status in ('active', 'trial')
  on conflict (tenant_id, user_id, token_hash) do update
    set created_at = excluded.created_at, expires_at = excluded.expires_at, label = excluded.label,
        password_marker = excluded.password_marker;
  get diagnostics v_count = row_count;
  -- At most 10 remembered browsers per person and organization: the oldest go.
  delete from platform.remembered_browsers r
  using (select x.tenant_id, x.id,
                row_number() over (partition by x.tenant_id order by x.created_at desc, x.id) as n
         from platform.remembered_browsers x where x.user_id = v_user) old
  where r.tenant_id = old.tenant_id and r.id = old.id and old.n > 10;
  insert into platform.audit_events (tenant_id, actor_user_id, actor_person_id, action, entity_type, entity_id, data)
  select m.tenant_id, v_user, m.person_id, 'platform.auth.browser_remembered', 'user', v_user::text,
         jsonb_build_object('method', 'email_code')
  from platform.tenant_memberships m
  join platform.tenants t on t.id = m.tenant_id
  where m.user_id = v_user and m.status = 'active' and t.status in ('active', 'trial');
  return v_count;
end
$$;
comment on function private.remember_browser(bytea, text) is
  'SECURITY-RELEVANT (WP-ADM-05, BR-AUTH-f). Remembers a browser (SHA-256 of its cookie token) for the signed-in account in every organization, for each organization''s days; nothing when any has the setting Off. app_server, user claims.';

-- ---------------------------------------------------------------------------------------------------
-- Forgetting for a member (the Organization Admin's «End sessions») and on deactivation
-- ---------------------------------------------------------------------------------------------------
create or replace function private.forget_member_remembered_browsers(p_person_id uuid)
returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_tenant uuid := private.current_tenant_id();
  v_count integer;
begin
  if session_user <> 'app_server' or v_tenant is null or p_person_id is null
     or coalesce(private.request_claims() ->> 'role', '') <> 'authenticated' then
    raise exception 'reserved to a signed-in member' using errcode = 'insufficient_privilege';
  end if;
  -- The same rule as «End sessions» (private.end_member_sessions): user managers, privileged members only
  -- by the Organization Admin.
  if not private.actor_may_manage_person_with(v_tenant, p_person_id, array['platform.user.deactivate']) then
    raise exception 'only user managers may forget this member''s remembered browsers' using errcode = 'insufficient_privilege';
  end if;
  delete from platform.remembered_browsers r where r.tenant_id = v_tenant and r.person_id = p_person_id;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;
comment on function private.forget_member_remembered_browsers(uuid) is
  'SECURITY-RELEVANT (WP-ADM-05, BR-AUTH-g). Forgets a member''s remembered browsers in the caller''s organization; user managers only (the permission of ending sessions). app_server, user claims.';

create or replace function private.forget_remembered_browsers_of_inactive_member()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.status is distinct from 'active' then
    delete from platform.remembered_browsers r where r.tenant_id = new.tenant_id and r.person_id = new.person_id;
  end if;
  return null;
end
$$;
comment on function private.forget_remembered_browsers_of_inactive_member() is
  'SECURITY-RELEVANT (WP-ADM-05, BR-AUTH-g). A member who is no longer active loses their remembered browsers of that organization.';

create trigger tenant_memberships_forget_remembered after update of status on platform.tenant_memberships
  for each row execute function private.forget_remembered_browsers_of_inactive_member();

-- Ownership hand-over as in migration 20260930120100 (non-superuser migration role on hosted Supabase).
grant create on schema private to account_mail_guard, tenant_guard;
alter function private.remembered_browser_ok(uuid, bytea) owner to account_mail_guard;
alter function private.remember_browser(bytea, text) owner to account_mail_guard;
alter function private.forget_member_remembered_browsers(uuid) owner to tenant_guard;
alter function private.forget_remembered_browsers_of_inactive_member() owner to tenant_guard;
revoke create on schema private from account_mail_guard, tenant_guard;

revoke all on function private.remembered_browser_ok(uuid, bytea) from public;
revoke all on function private.remember_browser(bytea, text) from public;
revoke all on function private.forget_member_remembered_browsers(uuid) from public;
revoke all on function private.forget_remembered_browsers_of_inactive_member() from public;
grant execute on function private.remember_browser(bytea, text) to authenticated;
grant execute on function private.forget_member_remembered_browsers(uuid) to authenticated;
-- remember_browser reads memberships, tenants and policies as its owner.
grant execute on function private.request_claims() to account_mail_guard;
grant execute on function private.request_user_id() to account_mail_guard;
