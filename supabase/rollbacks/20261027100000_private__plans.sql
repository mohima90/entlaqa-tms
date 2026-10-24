-- Rollback of 20261027100000_private__plans.sql: no plans, no limits, every feature for every organization
-- again. The functions changed here go back to their definitions of 20261019090100 (member_permissions),
-- 20261022100100 (email_route) and 20261026100200 (auth_mail_route). The cluster-wide role plan_guard is kept
-- (other databases may use it); its privileges here are removed.
drop trigger if exists tenant_email_settings_plan_feature on private.tenant_email_settings;
drop trigger if exists tenant_branding_plan_feature on platform.tenant_branding;
drop trigger if exists user_imports_plan_feature on platform.user_imports;
drop trigger if exists files_storage_limit on platform.files;
drop trigger if exists tenant_memberships_people_limit on platform.tenant_memberships;
drop trigger if exists invitations_people_limit on platform.invitations;

-- The definitions before the plans.
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
  ) x;
$$;

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
comment on function private.member_permissions(uuid, uuid) is
  'SECURITY-RELEVANT (EP-ROLES, ADR 0003 §5). Permissions the user holds organization-wide now in the organization (standard and custom roles).';

drop function if exists private.expire_trials();
drop function if exists private.platform_set_tenant_plan(uuid, uuid, text, timestamptz, integer, integer);
drop function if exists private.platform_tenant_plans();
drop function if exists private.platform_save_plan(uuid, text, text, integer, integer, text[], integer);
drop function if exists private.platform_list_plans();
drop function if exists private.organization_plan();
drop function if exists private.current_tenant_features();
drop function if exists private.enforce_plan_feature();
drop function if exists private.enforce_storage_limit();
drop function if exists private.enforce_people_limit();
drop function if exists private.tenant_storage_used(uuid);
drop function if exists private.tenant_people_used(uuid);
drop function if exists private.tenant_limits(uuid);
drop function if exists private.tenant_has_feature(uuid, text);
drop function if exists private.tenant_plan_features(uuid);

revoke execute on function private.member_permissions(uuid, uuid) from plan_guard;
revoke execute on function private.member_has_permission(uuid, uuid, text) from plan_guard;
revoke execute on function private.platform_admin_caller() from plan_guard;
revoke execute on function private.platform_admin_is_active(uuid) from plan_guard;
revoke execute on function private.user_session_is_valid(uuid, uuid) from plan_guard;
revoke execute on function private.has_visible_text(text) from plan_guard;
revoke execute on function private.current_tenant_id() from plan_guard;
revoke execute on function private.request_user_id() from plan_guard;
revoke execute on function private.request_claims() from plan_guard;
revoke execute on function private.try_uuid(text) from plan_guard;

drop policy audit_events_plan_guard_insert on platform.audit_events;
revoke insert (tenant_id, actor_user_id, action, entity_type, entity_id, data) on platform.audit_events from plan_guard;
drop policy platform_audit_events_plan_guard_insert on private.platform_audit_events;
revoke insert (actor_user_id, action, tenant_id, entity_type, entity_id, data) on private.platform_audit_events
  from plan_guard;
drop policy ref_role_permissions_plan_guard_read on platform.ref_role_permissions;
revoke select (role_code, permission_code, scope) on platform.ref_role_permissions from plan_guard;
drop policy ref_permissions_plan_guard_read on platform.ref_permissions;
revoke select (code, custom_role_use) on platform.ref_permissions from plan_guard;
drop policy custom_role_permissions_plan_guard_read on platform.custom_role_permissions;
revoke select (tenant_id, custom_role_id, permission_code) on platform.custom_role_permissions from plan_guard;
drop policy custom_roles_plan_guard_read on platform.custom_roles;
revoke select (tenant_id, id, code, data_scope) on platform.custom_roles from plan_guard;
drop policy role_assignments_plan_guard_read on platform.role_assignments;
revoke select (tenant_id, membership_id, role_code, valid_from, valid_until) on platform.role_assignments from plan_guard;
drop policy files_plan_guard_read on platform.files;
revoke select (tenant_id, id, status, declared_size, size_bytes, upload_expires_at) on platform.files from plan_guard;
drop policy invitations_plan_guard_read on platform.invitations;
revoke select (tenant_id, id, person_id, status, expires_at) on platform.invitations from plan_guard;
drop policy tenant_memberships_plan_guard_read on platform.tenant_memberships;
revoke select (id, tenant_id, user_id, person_id, status) on platform.tenant_memberships from plan_guard;
drop policy tenants_plan_guard_update on platform.tenants;
drop policy tenants_plan_guard_read on platform.tenants;

alter table platform.tenants
  drop column max_storage_gb_override,
  drop column max_people_override,
  drop column trial_ends_at,
  drop column plan_id;
revoke all on platform.tenants from plan_guard;

drop table private.plans;
drop function if exists private.permission_feature(text);
drop function if exists private.plan_feature_codes();

revoke usage on schema platform, private from plan_guard;
revoke plan_guard from current_user;
