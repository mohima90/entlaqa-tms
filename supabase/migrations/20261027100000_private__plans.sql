-- Plans, limits and the organization's status (WP-ADM-06; FR-ADM-13, FR-SUB-01, FR-ADM-17; business flow
-- docs/business-flows/EP-PLAN-plan-limits-feature-switches.md, agreed by the PO 24 Oct 2026). Class: G
-- (private.plans) + T (platform.tenants columns) + P. PII: none.
--
-- What it does:
--   * The Platform Super Admin CREATES plans (no fixed plans): a name, a description, two limits (people,
--     storage in GB; empty = no limit) and the product features the plan includes (a fixed list below).
--   * Each organization is on at most one plan (none = everything, no limits: the organizations that exist
--     today), with its status (trial, active, suspended, cancelled), a trial end date and limits special to
--     it that win over the plan's (BR-PLAN-5).
--   * A feature the plan does not include is not available: its permissions are taken out of everyone's
--     permissions (private.member_permissions), so menus, pages and the database guards refuse it alike;
--     the features without a permission of their own (bulk import, own branding, own e-mail provider) are
--     refused where they are written and ignored where they are used. Nothing is deleted (BR-PLAN-3).
--   * Going over a limit is refused at the moment of the action (JL001 people, JL002 storage); what already
--     exists above a lowered limit is kept (BR-PLAN-6).
--   * A trial whose end date has passed becomes suspended (worker platform task, private.expire_trials).
--   * The Organization Admin SEES the plan, the status and the limits with their usage (read-only, PO 24 Oct
--     2026: no feature switches).
--
-- Security shape: everything runs in functions owned by plan_guard (a role of its own: NOLOGIN, NOINHERIT,
-- no BYPASSRLS; explicit column grants and policies below). The console functions require a signed-in
-- Super Admin (private.platform_admin_caller); the Organization Admin's view requires platform.tenant.manage
-- in the caller's organization; the trial expiry requires the worker's system claims. The limit and feature
-- checks are triggers, so every writer (web app, worker, guard functions) meets them.
--
-- Error codes: JP001 invalid input (message = the field), JP006 plan name taken, JP007 the plan was changed
-- by someone else (version), JL001 people limit reached, JL002 storage limit reached, JL003 the feature is
-- not in the organization's plan.
-- Expand-first: new role, table, nullable columns and functions; member_permissions keeps its signature.

-- ---------------------------------------------------------------------------------------------------
-- Role plan_guard (attribute policy as in 20260930120000)
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'plan_guard') then
    create role plan_guard nologin noinherit nobypassrls;
  end if;
end
$$;

do $$
declare
  r record;
begin
  select rolname, rolcanlogin, rolinherit, rolsuper, rolbypassrls, rolreplication, rolcreatedb, rolcreaterole
    into r from pg_roles where rolname = 'plan_guard';
  if r.rolsuper or r.rolbypassrls or r.rolreplication then
    raise exception 'role plan_guard must be NOSUPERUSER NOBYPASSRLS NOREPLICATION; fix it as a superuser first';
  end if;
  if r.rolinherit or r.rolcreatedb or r.rolcreaterole or r.rolcanlogin then
    alter role plan_guard nologin noinherit nocreatedb nocreaterole;
  end if;
  if exists (select 1 from pg_auth_members m join pg_roles g on g.oid = m.roleid join pg_roles u on u.oid = m.member
             where g.rolname = 'plan_guard' and (m.inherit_option or m.set_option)
               and not u.rolsuper and u.rolname <> current_user) then
    raise exception 'role plan_guard must have no members besides the migration role';
  end if;
end
$$;

grant plan_guard to current_user;
grant usage on schema platform, private to plan_guard;

-- ---------------------------------------------------------------------------------------------------
-- The features a plan can include (the product's parts that exist today; later parts join the list)
-- ---------------------------------------------------------------------------------------------------
create or replace function private.plan_feature_codes()
returns text[]
language sql immutable parallel safe
set search_path = ''
as $$
  select array['planning', 'needs_forms', 'courses', 'bulk_import', 'branding', 'email_integration']::text[];
$$;
comment on function private.plan_feature_codes() is
  'The product features a plan can include (WP-ADM-06). Team members, structure, roles, settings and My profile are always included.';

-- The feature a permission belongs to (null: always included).
create or replace function private.permission_feature(p_permission text)
returns text
language sql immutable parallel safe
set search_path = ''
as $$
  select case
    when p_permission like 'tms.plan\_cycle.%' then 'planning'
    when p_permission like 'tms.needs\_form.%' then 'needs_forms'
    when p_permission like 'tms.course.%' or p_permission like 'tms.course\_cost.%' then 'courses'
  end;
$$;
comment on function private.permission_feature(text) is
  'SECURITY-RELEVANT (WP-ADM-06). The plan feature a permission belongs to (null: always included): a permission of a feature the organization''s plan does not include is held by nobody.';

-- ---------------------------------------------------------------------------------------------------
-- Plans
-- ---------------------------------------------------------------------------------------------------
create table private.plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  max_people integer,
  max_storage_gb integer,
  features text[] not null default '{}',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plans_name_check check (char_length(name) between 1 and 80 and name = btrim(name) and name !~ '[[:cntrl:]]'),
  constraint plans_description_check
    check (description is null or (char_length(description) between 1 and 200 and description !~ '[[:cntrl:]]')),
  constraint plans_max_people_check check (max_people is null or max_people between 1 and 1000000),
  constraint plans_max_storage_check check (max_storage_gb is null or max_storage_gb between 1 and 100000),
  constraint plans_features_check
    check ((cardinality(features) = 0 or array_ndims(features) = 1) and array_position(features, null) is null
           and features <@ private.plan_feature_codes()),
  constraint plans_version_check check (version >= 1)
);
create unique index plans_name_uq on private.plans (lower(name));
comment on table private.plans is
  'Plans the Platform Super Admin creates (WP-ADM-06): limits (people, storage in GB; null = no limit) and the features included. Reached only through plan_guard''s functions.';

alter table private.plans enable row level security;
alter table private.plans force row level security;
revoke all on private.plans from public;
create policy plans_plan_guard on private.plans for all to plan_guard using (true) with check (true);
grant select, insert (name, description, max_people, max_storage_gb, features),
      update (name, description, max_people, max_storage_gb, features, version, updated_at)
  on private.plans to plan_guard;

-- ---------------------------------------------------------------------------------------------------
-- The organization's plan, trial and special limits
-- ---------------------------------------------------------------------------------------------------
alter table platform.tenants
  add column plan_id uuid references private.plans (id) on delete restrict,
  add column trial_ends_at timestamptz,
  add column max_people_override integer,
  add column max_storage_gb_override integer,
  add constraint tenants_trial_ends_check check (trial_ends_at is null or status = 'trial'),
  add constraint tenants_max_people_override_check
    check (max_people_override is null or max_people_override between 1 and 1000000),
  add constraint tenants_max_storage_override_check
    check (max_storage_gb_override is null or max_storage_gb_override between 1 and 100000);
create index tenants_plan_idx on platform.tenants (plan_id) where plan_id is not null;
create index tenants_trial_ends_idx on platform.tenants (trial_ends_at) where status = 'trial' and trial_ends_at is not null;
comment on column platform.tenants.plan_id is
  'The organization''s plan (WP-ADM-06; null: every feature, no limits). Set by the Platform Super Admin only.';
comment on column platform.tenants.trial_ends_at is
  'During a trial: when it ends (the worker suspends the organization then). Null outside a trial.';
comment on column platform.tenants.max_people_override is
  'A people limit special to this organization: wins over the plan''s (BR-PLAN-5).';
comment on column platform.tenants.max_storage_gb_override is
  'A storage limit (GB) special to this organization: wins over the plan''s (BR-PLAN-5).';

-- ---------------------------------------------------------------------------------------------------
-- What plan_guard reaches (columns and policies, nothing else)
-- ---------------------------------------------------------------------------------------------------
create policy tenants_plan_guard_read on platform.tenants for select to plan_guard using (true);
create policy tenants_plan_guard_update on platform.tenants for update to plan_guard using (true) with check (true);
grant select (id, slug, name_ar, name_en, status, created_at, plan_id, trial_ends_at, max_people_override,
              max_storage_gb_override)
  on platform.tenants to plan_guard;
grant update (status, plan_id, trial_ends_at, max_people_override, max_storage_gb_override)
  on platform.tenants to plan_guard;

-- Usage: people (memberships and pending invitations) and stored files, counted per organization.
create policy tenant_memberships_plan_guard_read on platform.tenant_memberships for select to plan_guard using (true);
grant select (id, tenant_id, user_id, person_id, status) on platform.tenant_memberships to plan_guard;
create policy invitations_plan_guard_read on platform.invitations for select to plan_guard using (true);
grant select (tenant_id, id, person_id, status, expires_at) on platform.invitations to plan_guard;
create policy files_plan_guard_read on platform.files for select to plan_guard using (true);
grant select (tenant_id, id, status, declared_size, size_bytes, upload_expires_at) on platform.files to plan_guard;

-- The Organization Admin's view checks platform.tenant.manage in the caller's organization: the permission
-- helpers read the caller's roles there only (pattern of email_guard, 20261022100100).
create policy role_assignments_plan_guard_read on platform.role_assignments for select to plan_guard
  using (tenant_id = (select private.current_tenant_id()));
grant select (tenant_id, membership_id, role_code, valid_from, valid_until) on platform.role_assignments to plan_guard;
create policy custom_roles_plan_guard_read on platform.custom_roles for select to plan_guard
  using (tenant_id = (select private.current_tenant_id()));
grant select (tenant_id, id, code, data_scope) on platform.custom_roles to plan_guard;
create policy custom_role_permissions_plan_guard_read on platform.custom_role_permissions for select to plan_guard
  using (tenant_id = (select private.current_tenant_id()));
grant select (tenant_id, custom_role_id, permission_code) on platform.custom_role_permissions to plan_guard;
create policy ref_permissions_plan_guard_read on platform.ref_permissions for select to plan_guard using (true);
grant select (code, custom_role_use) on platform.ref_permissions to plan_guard;
create policy ref_role_permissions_plan_guard_read on platform.ref_role_permissions for select to plan_guard
  using (true);
grant select (role_code, permission_code, scope) on platform.ref_role_permissions to plan_guard;

-- The platform's audit trail (plans, an organization's plan and status) and the organization's own (its plan
-- or status changed by ENTLAQA; its trial ended).
create policy platform_audit_events_plan_guard_insert on private.platform_audit_events for insert to plan_guard
  with check (action in ('platform.plan.created', 'platform.plan.updated', 'platform.tenant.plan_changed',
                         'platform.tenant.trial_ended'));
grant insert (actor_user_id, action, tenant_id, entity_type, entity_id, data) on private.platform_audit_events
  to plan_guard;
create policy audit_events_plan_guard_insert on platform.audit_events for insert to plan_guard
  with check (action in ('platform.tenant.plan_changed', 'platform.tenant.trial_ended')
              and actor_person_id is null and impersonator_user_id is null);
grant insert (tenant_id, actor_user_id, action, entity_type, entity_id, data) on platform.audit_events to plan_guard;

-- Helpers the functions below call.
grant execute on function private.try_uuid(text) to plan_guard;
grant execute on function private.request_claims() to plan_guard;
grant execute on function private.request_user_id() to plan_guard;
grant execute on function private.current_tenant_id() to plan_guard;
grant execute on function private.has_visible_text(text) to plan_guard;
grant execute on function private.user_session_is_valid(uuid, uuid) to plan_guard;
grant execute on function private.platform_admin_is_active(uuid) to plan_guard;
grant execute on function private.platform_admin_caller() to plan_guard;
grant execute on function private.member_has_permission(uuid, uuid, text) to plan_guard;
grant execute on function private.member_permissions(uuid, uuid) to plan_guard;

-- ---------------------------------------------------------------------------------------------------
-- Features and limits of an organization
-- ---------------------------------------------------------------------------------------------------
-- The features an organization's plan includes; null when it is on no plan (everything). Only the list of
-- features is returned (the organization list itself is readable to members already).
create or replace function private.tenant_plan_features(p_tenant_id uuid)
returns text[]
language sql stable security definer
set search_path = ''
as $$
  select p.features
  from platform.tenants t
  join private.plans p on p.id = t.plan_id
  where t.id = p_tenant_id;
$$;
comment on function private.tenant_plan_features(uuid) is
  'SECURITY-RELEVANT (WP-ADM-06). The features the organization''s plan includes, or null when it is on no plan (every feature).';

create or replace function private.tenant_has_feature(p_tenant_id uuid, p_feature text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(p.features @> array[p_feature], true)
  from platform.tenants t
  left join private.plans p on p.id = t.plan_id
  where t.id = p_tenant_id;
$$;
comment on function private.tenant_has_feature(uuid, text) is
  'SECURITY-RELEVANT (WP-ADM-06). Whether the organization''s plan includes the feature (true when it is on no plan; null for an unknown organization).';

-- The limits in force (the organization's own, else the plan's; null = no limit).
create or replace function private.tenant_limits(p_tenant_id uuid, out max_people integer, out max_storage_gb integer)
language sql stable
set search_path = ''
as $$
  select coalesce(t.max_people_override, p.max_people), coalesce(t.max_storage_gb_override, p.max_storage_gb)
  from platform.tenants t
  left join private.plans p on p.id = t.plan_id
  where t.id = p_tenant_id;
$$;

-- People: everyone with an account (active or invited membership) and everyone with a pending, unexpired
-- invitation, each person once.
create or replace function private.tenant_people_used(p_tenant_id uuid)
returns integer
language sql stable
set search_path = ''
as $$
  select count(*)::integer from (
    select m.person_id from platform.tenant_memberships m
    where m.tenant_id = p_tenant_id and m.status in ('active', 'invited')
    union
    select i.person_id from platform.invitations i
    where i.tenant_id = p_tenant_id and i.status = 'pending' and i.expires_at > now()
  ) x;
$$;

-- Storage: every file that is or may become stored (not deleted, rejected or infected; an abandoned upload
-- no longer counts), by its real size once known.
create or replace function private.tenant_storage_used(p_tenant_id uuid)
returns bigint
language sql stable
set search_path = ''
as $$
  select coalesce(sum(coalesce(f.size_bytes, f.declared_size)), 0)::bigint
  from platform.files f
  where f.tenant_id = p_tenant_id and f.status not in ('deleted', 'rejected', 'infected')
    and not (f.status = 'pending_upload' and f.upload_expires_at <= now());
$$;

-- ---------------------------------------------------------------------------------------------------
-- Permissions: a feature the plan does not include is held by nobody
-- ---------------------------------------------------------------------------------------------------
create or replace function private.member_permissions(p_tenant_id uuid, p_user_id uuid)
returns text[]
language sql stable
set search_path = ''
as $$
  select coalesce(array_agg(distinct x.code order by x.code), '{}')
  from (
    select rp.permission_code as code
    from platform.role_assignments ra
    join platform.tenant_memberships m on m.tenant_id = ra.tenant_id and m.id = ra.membership_id
    join platform.ref_role_permissions rp on rp.role_code = ra.role_code and rp.scope = 'tenant'
    where ra.tenant_id = p_tenant_id and m.user_id = p_user_id and m.status = 'active'
      and (ra.valid_from is null or ra.valid_from <= now())
      and (ra.valid_until is null or ra.valid_until > now())
    union all
    select crp.permission_code
    from platform.role_assignments ra
    join platform.tenant_memberships m on m.tenant_id = ra.tenant_id and m.id = ra.membership_id
    join platform.custom_roles cr on cr.tenant_id = ra.tenant_id and cr.code = ra.role_code
    join platform.custom_role_permissions crp on crp.tenant_id = cr.tenant_id and crp.custom_role_id = cr.id
    join platform.ref_permissions p on p.code = crp.permission_code
    where ra.tenant_id = p_tenant_id and m.user_id = p_user_id and m.status = 'active'
      and (ra.valid_from is null or ra.valid_from <= now())
      and (ra.valid_until is null or ra.valid_until > now())
      and (p.custom_role_use = 'organization'
           or (cr.data_scope = 'organization' and p.custom_role_use in ('scoped', 'organization_only')))
  ) x
  cross join (select private.tenant_plan_features(p_tenant_id) as features) f
  where f.features is null or private.permission_feature(x.code) is null
     or private.permission_feature(x.code) = any (f.features);
$$;

comment on function private.member_permissions(uuid, uuid) is
  'SECURITY-RELEVANT (EP-ROLES, ADR 0003 §5; WP-ADM-06). Permissions the user holds organization-wide now in the organization (standard and custom roles), without those of features the organization''s plan does not include.';

-- ---------------------------------------------------------------------------------------------------
-- Limits and features at the moment of the action (triggers: every writer meets them)
-- ---------------------------------------------------------------------------------------------------
create or replace function private.enforce_people_limit()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_max integer;
begin
  -- Only an action that ADDS a person to the count is checked.
  if tg_table_name = 'invitations' then
    if new.status <> 'pending' or new.expires_at <= now()
       or (tg_op = 'UPDATE' and old.status = 'pending' and old.expires_at > now()) then
      return new;
    end if;
  else
    if new.status not in ('active', 'invited') or (tg_op = 'UPDATE' and old.status in ('active', 'invited')) then
      return new;
    end if;
  end if;
  select l.max_people into v_max from private.tenant_limits(new.tenant_id) l;
  if v_max is null then
    return new;
  end if;
  -- One check at a time per organization: two invitations at once cannot both take the last place.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('platform.people_limit:' || new.tenant_id::text, 0));
  if exists (select 1 from platform.tenant_memberships m
             where m.tenant_id = new.tenant_id and m.person_id = new.person_id and m.status in ('active', 'invited')
               and (tg_table_name = 'invitations' or m.id <> new.id))
     or exists (select 1 from platform.invitations i
                where i.tenant_id = new.tenant_id and i.person_id = new.person_id and i.status = 'pending'
                  and i.expires_at > now() and (tg_table_name <> 'invitations' or i.id <> new.id)) then
    return new;  -- this person is counted already
  end if;
  if private.tenant_people_used(new.tenant_id) >= v_max then
    raise exception 'the organization''s people limit is reached' using errcode = 'JL001', detail = v_max::text;
  end if;
  return new;
end
$$;
comment on function private.enforce_people_limit() is
  'SECURITY-RELEVANT (WP-ADM-06, BR-PLAN-6). Refuses an invitation, a new account or a reactivation that would take the organization over its people limit (JL001); people already above a lowered limit are kept.';

create trigger invitations_people_limit
  before insert or update of status, expires_at on platform.invitations
  for each row execute function private.enforce_people_limit();
create trigger tenant_memberships_people_limit
  before insert or update of status on platform.tenant_memberships
  for each row execute function private.enforce_people_limit();

create or replace function private.enforce_storage_limit()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_max integer;
begin
  select l.max_storage_gb into v_max from private.tenant_limits(new.tenant_id) l;
  if v_max is null then
    return new;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('platform.storage_limit:' || new.tenant_id::text, 0));
  if private.tenant_storage_used(new.tenant_id) + coalesce(new.declared_size, 0) > v_max::bigint * 1073741824 then
    raise exception 'the organization''s storage limit is reached' using errcode = 'JL002', detail = v_max::text;
  end if;
  return new;
end
$$;
comment on function private.enforce_storage_limit() is
  'SECURITY-RELEVANT (WP-ADM-06, BR-PLAN-6). Refuses a new file that would take the organization over its storage limit (JL002).';

create trigger files_storage_limit
  before insert on platform.files
  for each row execute function private.enforce_storage_limit();

-- A feature without a permission of its own: refused where a member writes it (the worker's own updates,
-- without a user, are not refused).
create or replace function private.enforce_plan_feature()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if private.request_user_id() is not null and not coalesce(private.tenant_has_feature(new.tenant_id, tg_argv[0]), true) then
    raise exception 'this feature is not in the organization''s plan' using errcode = 'JL003', detail = tg_argv[0];
  end if;
  return new;
end
$$;
comment on function private.enforce_plan_feature() is
  'SECURITY-RELEVANT (WP-ADM-06). Refuses a member''s write to a feature the organization''s plan does not include (JL003; the feature is the trigger argument).';

create trigger user_imports_plan_feature
  before insert on platform.user_imports
  for each row execute function private.enforce_plan_feature('bulk_import');
create trigger tenant_branding_plan_feature
  before insert or update on platform.tenant_branding
  for each row execute function private.enforce_plan_feature('branding');
create trigger tenant_email_settings_plan_feature
  before insert or update on private.tenant_email_settings
  for each row execute function private.enforce_plan_feature('email_integration');

-- ---------------------------------------------------------------------------------------------------
-- What a member's organization has (any signed-in member: menus and pages)
-- ---------------------------------------------------------------------------------------------------
create or replace function private.current_tenant_features()
returns text[]
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_tenant uuid := private.current_tenant_id();
begin
  if session_user <> 'app_server' or v_tenant is null then
    raise exception 'needs a signed-in member of an organization' using errcode = 'insufficient_privilege';
  end if;
  return coalesce(private.tenant_plan_features(v_tenant), private.plan_feature_codes());
end
$$;
comment on function private.current_tenant_features() is
  'SECURITY-RELEVANT (WP-ADM-06). The features the caller''s organization has (every feature when it is on no plan). app_server, a signed-in member.';

-- ---------------------------------------------------------------------------------------------------
-- The Organization Admin's view: plan, status, limits and usage (read-only)
-- ---------------------------------------------------------------------------------------------------
create or replace function private.organization_plan()
returns table (has_plan boolean, plan_name text, plan_description text, status text, trial_ends_at timestamptz,
               max_people integer, people_used integer, max_storage_gb integer, storage_used_bytes bigint,
               features text[])
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_tenant uuid := private.current_tenant_id();
  v_user uuid := private.request_user_id();
begin
  if session_user <> 'app_server' or v_tenant is null or v_user is null
     or not private.member_has_permission(v_tenant, v_user, 'platform.tenant.manage') then
    raise exception 'the plan is shown to the Organization Admin' using errcode = 'insufficient_privilege';
  end if;
  return query
    select p.id is not null, p.name, p.description, t.status, t.trial_ends_at,
           l.max_people, private.tenant_people_used(t.id), l.max_storage_gb, private.tenant_storage_used(t.id),
           coalesce(p.features, private.plan_feature_codes())
    from platform.tenants t
    left join private.plans p on p.id = t.plan_id
    cross join lateral private.tenant_limits(t.id) l
    where t.id = v_tenant;
end
$$;
comment on function private.organization_plan() is
  'SECURITY-RELEVANT (WP-ADM-06, FR-ADM-13). The caller''s organization''s plan, status, limits and usage, for the Organization Admin (platform.tenant.manage). Read-only. app_server.';

-- ---------------------------------------------------------------------------------------------------
-- The console: plans
-- ---------------------------------------------------------------------------------------------------
create or replace function private.platform_list_plans()
returns table (plan_id uuid, name text, description text, max_people integer, max_storage_gb integer,
               features text[], version integer, tenant_count integer, created_at timestamptz,
               updated_at timestamptz)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform private.platform_admin_caller();
  return query
    select p.id, p.name, p.description, p.max_people, p.max_storage_gb, p.features, p.version,
           (select count(*)::integer from platform.tenants t where t.plan_id = p.id), p.created_at, p.updated_at
    from private.plans p
    order by lower(p.name), p.id;
end
$$;
comment on function private.platform_list_plans() is
  'SECURITY-RELEVANT (WP-ADM-06). The plans, with how many organizations are on each. Signed-in Super Admin only.';

-- Creates (p_plan_id null) or updates a plan; returns its id and new version. p_version: the version the
-- Super Admin edited (an update by someone else in between: JP007).
create or replace function private.platform_save_plan(p_plan_id uuid, p_name text, p_description text,
                                                      p_max_people integer, p_max_storage_gb integer,
                                                      p_features text[], p_version integer)
returns table (plan_id uuid, version integer)
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.platform_admin_caller();
  v_name text := btrim(coalesce(p_name, ''));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_features text[];
  v_old private.plans;
  v_id uuid;
  v_version integer;
begin
  if v_name = '' or char_length(v_name) > 80 or v_name ~ '[[:cntrl:]]' or not private.has_visible_text(v_name) then
    raise exception 'name' using errcode = 'JP001';
  end if;
  if v_description is not null and (char_length(v_description) > 200 or v_description ~ '[[:cntrl:]]') then
    raise exception 'description' using errcode = 'JP001';
  end if;
  if p_max_people is not null and p_max_people not between 1 and 1000000 then
    raise exception 'max_people' using errcode = 'JP001';
  end if;
  if p_max_storage_gb is not null and p_max_storage_gb not between 1 and 100000 then
    raise exception 'max_storage_gb' using errcode = 'JP001';
  end if;
  if p_features is not null and (array_position(p_features, null) is not null
                                 or not (p_features <@ private.plan_feature_codes())) then
    raise exception 'features' using errcode = 'JP001';
  end if;
  -- The product's order, each feature once.
  select coalesce(array_agg(c order by o), '{}') into v_features
  from unnest(private.plan_feature_codes()) with ordinality u(c, o)
  where c = any (coalesce(p_features, '{}'));

  if p_plan_id is null then
    begin
      insert into private.plans (name, description, max_people, max_storage_gb, features)
      values (v_name, v_description, p_max_people, p_max_storage_gb, v_features)
      returning id, plans.version into v_id, v_version;
    exception when unique_violation then
      raise exception 'the plan name is taken' using errcode = 'JP006';
    end;
    insert into private.platform_audit_events (actor_user_id, action, entity_type, entity_id, data)
    values (v_actor, 'platform.plan.created', 'plan', v_id::text,
            jsonb_build_object('name', v_name, 'maxPeople', p_max_people, 'maxStorageGb', p_max_storage_gb,
                               'features', to_jsonb(v_features)));
  else
    select * into v_old from private.plans p where p.id = p_plan_id for update;
    if not found then
      raise exception 'plan' using errcode = 'JP001';
    end if;
    if p_version is null or v_old.version <> p_version then
      raise exception 'the plan was changed by someone else' using errcode = 'JP007';
    end if;
    begin
      update private.plans p
      set name = v_name, description = v_description, max_people = p_max_people, max_storage_gb = p_max_storage_gb,
          features = v_features, version = p.version + 1, updated_at = now()
      where p.id = p_plan_id
      returning p.id, p.version into v_id, v_version;
    exception when unique_violation then
      raise exception 'the plan name is taken' using errcode = 'JP006';
    end;
    insert into private.platform_audit_events (actor_user_id, action, entity_type, entity_id, data)
    values (v_actor, 'platform.plan.updated', 'plan', v_id::text,
            jsonb_build_object(
              'before', jsonb_build_object('name', v_old.name, 'maxPeople', v_old.max_people,
                                           'maxStorageGb', v_old.max_storage_gb, 'features', to_jsonb(v_old.features)),
              'after', jsonb_build_object('name', v_name, 'maxPeople', p_max_people, 'maxStorageGb', p_max_storage_gb,
                                          'features', to_jsonb(v_features))));
  end if;
  return query select v_id, v_version;
end
$$;
comment on function private.platform_save_plan(uuid, text, text, integer, integer, text[], integer) is
  'SECURITY-RELEVANT (WP-ADM-06). Creates or updates a plan (validated; audited in the platform''s trail). Signed-in Super Admin only.';

-- ---------------------------------------------------------------------------------------------------
-- The console: an organization's plan, status, trial and special limits
-- ---------------------------------------------------------------------------------------------------
create or replace function private.platform_tenant_plans()
returns table (tenant_id uuid, plan_id uuid, plan_name text, status text, trial_ends_at timestamptz,
               max_people_override integer, max_storage_gb_override integer, max_people integer,
               max_storage_gb integer, people_used integer, storage_used_bytes bigint)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform private.platform_admin_caller();
  return query
    select t.id, t.plan_id, p.name, t.status, t.trial_ends_at, t.max_people_override, t.max_storage_gb_override,
           l.max_people, l.max_storage_gb, private.tenant_people_used(t.id), private.tenant_storage_used(t.id)
    from platform.tenants t
    left join private.plans p on p.id = t.plan_id
    cross join lateral private.tenant_limits(t.id) l
    order by t.created_at desc, t.id;
end
$$;
comment on function private.platform_tenant_plans() is
  'SECURITY-RELEVANT (WP-ADM-06). Each organization''s plan, status, trial, limits and usage. Signed-in Super Admin only.';

create or replace function private.platform_set_tenant_plan(p_tenant_id uuid, p_plan_id uuid, p_status text,
                                                            p_trial_ends_at timestamptz,
                                                            p_max_people_override integer,
                                                            p_max_storage_gb_override integer)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.platform_admin_caller();
  v_old record;
  v_before jsonb;
  v_after jsonb;
begin
  select t.id, t.plan_id, t.status, t.trial_ends_at, t.max_people_override, t.max_storage_gb_override into v_old
  from platform.tenants t where t.id = p_tenant_id for update;
  if not found then
    raise exception 'tenant' using errcode = 'JP001';
  end if;
  if p_plan_id is not null and not exists (select 1 from private.plans p where p.id = p_plan_id) then
    raise exception 'plan' using errcode = 'JP001';
  end if;
  if p_status is null or p_status not in ('trial', 'active', 'suspended', 'cancelled') then
    raise exception 'status' using errcode = 'JP001';
  end if;
  -- A trial ends on a date; a date only during a trial (a past date: the trial is over, so not a trial).
  if (p_status = 'trial') <> (p_trial_ends_at is not null)
     or (p_trial_ends_at is not null and p_trial_ends_at <= now())
     or p_trial_ends_at > now() + interval '1 year' then
    raise exception 'trial_ends_at' using errcode = 'JP001';
  end if;
  if p_max_people_override is not null and p_max_people_override not between 1 and 1000000 then
    raise exception 'max_people_override' using errcode = 'JP001';
  end if;
  if p_max_storage_gb_override is not null and p_max_storage_gb_override not between 1 and 100000 then
    raise exception 'max_storage_gb_override' using errcode = 'JP001';
  end if;

  v_before := jsonb_build_object('planId', v_old.plan_id, 'status', v_old.status, 'trialEndsAt', v_old.trial_ends_at,
                                 'maxPeopleOverride', v_old.max_people_override,
                                 'maxStorageGbOverride', v_old.max_storage_gb_override);
  v_after := jsonb_build_object('planId', p_plan_id, 'status', p_status, 'trialEndsAt', p_trial_ends_at,
                                'maxPeopleOverride', p_max_people_override,
                                'maxStorageGbOverride', p_max_storage_gb_override);
  if v_before = v_after then
    return;
  end if;
  update platform.tenants t
  set plan_id = p_plan_id, status = p_status, trial_ends_at = p_trial_ends_at,
      max_people_override = p_max_people_override, max_storage_gb_override = p_max_storage_gb_override
  where t.id = p_tenant_id;
  insert into private.platform_audit_events (actor_user_id, action, tenant_id, entity_type, entity_id, data)
  values (v_actor, 'platform.tenant.plan_changed', p_tenant_id, 'tenant', p_tenant_id::text,
          jsonb_build_object('before', v_before, 'after', v_after));
  insert into platform.audit_events (tenant_id, actor_user_id, action, entity_type, entity_id, data)
  values (p_tenant_id, v_actor, 'platform.tenant.plan_changed', 'tenant', p_tenant_id::text,
          jsonb_build_object('before', v_before, 'after', v_after));
end
$$;
comment on function private.platform_set_tenant_plan(uuid, uuid, text, timestamptz, integer, integer) is
  'SECURITY-RELEVANT (WP-ADM-06, FR-ADM-17). Sets an organization''s plan, status, trial end date and special limits (validated; audited in the platform''s trail and the organization''s). Signed-in Super Admin only.';

-- ---------------------------------------------------------------------------------------------------
-- Trials that ended (worker platform task)
-- ---------------------------------------------------------------------------------------------------
create or replace function private.expire_trials()
returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_claims jsonb := private.request_claims();
  r record;
  v_count integer := 0;
begin
  if session_user <> 'app_worker' or coalesce(v_claims ->> 'role', '') <> 'system' then
    raise exception 'reserved to the worker' using errcode = 'insufficient_privilege';
  end if;
  for r in
    update platform.tenants t set status = 'suspended', trial_ends_at = null
    where t.status = 'trial' and t.trial_ends_at is not null and t.trial_ends_at <= now()
    returning t.id
  loop
    insert into private.platform_audit_events (action, tenant_id, entity_type, entity_id)
    values ('platform.tenant.trial_ended', r.id, 'tenant', r.id::text);
    insert into platform.audit_events (tenant_id, action, entity_type, entity_id)
    values (r.id, 'platform.tenant.trial_ended', 'tenant', r.id::text);
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$$;
comment on function private.expire_trials() is
  'SECURITY-RELEVANT (WP-ADM-06). Suspends the organizations whose trial has ended (audited). Worker platform task only.';

-- ---------------------------------------------------------------------------------------------------
-- Where the features without a permission of their own are USED: the organization's own e-mail provider
-- and its colours in e-mails count only while its plan includes them (definitions of 20261022100100 and
-- 20261026100200, plus the plan).
-- ---------------------------------------------------------------------------------------------------
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
           coalesce(s.enabled and s.status = 'verified' and private.tenant_has_feature(t.id, 'email_integration'), false),
           s.version,
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
           coalesce(s.enabled and s.status = 'verified' and private.tenant_has_feature(t.id, 'email_integration'), false),
           s.version,
           p.id is not null, p.provider, p.options, p.credentials_sealed, p.from_address,
           coalesce(p.status = 'verified', false), p.version,
           t.name_ar, t.name_en, coalesce(ts.default_locale, 'en'),
           b.email_action_color, b.email_link_color,
           (select a.id from platform.brand_assets a where a.tenant_id = b.tenant_id and a.file_id = b.logo_file_id)
    from platform.tenants t
    left join platform.tenant_settings ts on ts.tenant_id = t.id
    left join private.tenant_email_settings s on s.tenant_id = t.id
    left join private.platform_email_settings p on p.id = 1
    left join platform.tenant_branding b on b.tenant_id = t.id and private.tenant_has_feature(t.id, 'branding')
    where t.id = p_tenant_id and t.status in ('active', 'trial');
end
$$;

-- ---------------------------------------------------------------------------------------------------
-- Ownership hand-over and grants
-- ---------------------------------------------------------------------------------------------------
grant create on schema private to plan_guard;
alter function private.tenant_plan_features(uuid) owner to plan_guard;
alter function private.tenant_has_feature(uuid, text) owner to plan_guard;
alter function private.tenant_limits(uuid) owner to plan_guard;
alter function private.tenant_people_used(uuid) owner to plan_guard;
alter function private.tenant_storage_used(uuid) owner to plan_guard;
alter function private.enforce_people_limit() owner to plan_guard;
alter function private.enforce_storage_limit() owner to plan_guard;
alter function private.enforce_plan_feature() owner to plan_guard;
alter function private.current_tenant_features() owner to plan_guard;
alter function private.organization_plan() owner to plan_guard;
alter function private.platform_list_plans() owner to plan_guard;
alter function private.platform_save_plan(uuid, text, text, integer, integer, text[], integer) owner to plan_guard;
alter function private.platform_tenant_plans() owner to plan_guard;
alter function private.platform_set_tenant_plan(uuid, uuid, text, timestamptz, integer, integer) owner to plan_guard;
alter function private.expire_trials() owner to plan_guard;
revoke create on schema private from plan_guard;

revoke all on function private.plan_feature_codes() from public;
revoke all on function private.permission_feature(text) from public;
revoke all on function private.tenant_plan_features(uuid) from public;
revoke all on function private.tenant_has_feature(uuid, text) from public;
revoke all on function private.tenant_limits(uuid) from public;
revoke all on function private.tenant_people_used(uuid) from public;
revoke all on function private.tenant_storage_used(uuid) from public;
revoke all on function private.enforce_people_limit() from public;
revoke all on function private.enforce_storage_limit() from public;
revoke all on function private.enforce_plan_feature() from public;
revoke all on function private.current_tenant_features() from public;
revoke all on function private.organization_plan() from public;
revoke all on function private.platform_list_plans() from public;
revoke all on function private.platform_save_plan(uuid, text, text, integer, integer, text[], integer) from public;
revoke all on function private.platform_tenant_plans() from public;
revoke all on function private.platform_set_tenant_plan(uuid, uuid, text, timestamptz, integer, integer) from public;
revoke all on function private.expire_trials() from public;

-- The plan filter runs inside member_permissions (SECURITY INVOKER): every role that may call it may call
-- the filter too.
grant execute on function private.plan_feature_codes() to plan_guard;
grant execute on function private.permission_feature(text), private.tenant_plan_features(uuid)
  to authenticated, plan_guard, email_guard, file_guard, invitation_guard, membership_guard, rate_limit_guard,
     tenant_guard;
-- The e-mail routes (owned by email_guard) ask whether the plan includes the organization's provider and colours.
grant execute on function private.tenant_has_feature(uuid, text) to email_guard, plan_guard;
-- Called inside `set local role authenticated` transactions; each function checks the LOGIN role itself.
grant execute on function private.current_tenant_features() to authenticated;
grant execute on function private.organization_plan() to authenticated;
grant execute on function private.platform_list_plans() to authenticated;
grant execute on function private.platform_save_plan(uuid, text, text, integer, integer, text[], integer) to authenticated;
grant execute on function private.platform_tenant_plans() to authenticated;
grant execute on function private.platform_set_tenant_plan(uuid, uuid, text, timestamptz, integer, integer) to authenticated;
grant execute on function private.expire_trials() to authenticated;
