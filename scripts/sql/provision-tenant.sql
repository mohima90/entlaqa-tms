-- Provisions an organization (tenant) and its first administrator's ACTIVE membership (T-M1-D03).
-- Run by scripts/provision-tenant.sh only, as the migration role (owner of the platform tables, BYPASSRLS
-- on hosted Supabase). Values arrive as psql variables (quoted by psql with :'name', never spliced into
-- SQL text) and are re-validated here. The caller wraps this file in one transaction and decides between
-- COMMIT (apply) and ROLLBACK (plan).
--
--   :'tenant_slug'     e.g. entlaqa-demo (also the future subdomain)
--   :'tenant_name_ar'  Arabic organization name (required)
--   :'tenant_name_en'  English organization name ('' = none)
--   :'admin_user_id'   the Auth user's UID (Supabase: Authentication → Users → Copy UID); no e-mail, so no
--                      personal data in workflow inputs or logs
--   :'add_to_existing' 'true' | 'false'
--
-- An existing slug is REFUSED unless add_to_existing is 'true' AND both names equal the stored ones, so
-- a typo or a slug collision can never make someone a member of another customer's organization.
-- An existing ACTIVE membership of the user is a no-op; any other existing membership status is refused
-- (change it in the application, where the status transitions are enforced and audited).
-- The person record gets the neutral name 'مدير المنشأة' (Tenant Admin) until the user edits the profile.

select set_config('provision.tenant_slug', :'tenant_slug', true),
       set_config('provision.tenant_name_ar', :'tenant_name_ar', true),
       set_config('provision.tenant_name_en', :'tenant_name_en', true),
       set_config('provision.admin_user_id', :'admin_user_id', true),
       set_config('provision.add_to_existing', :'add_to_existing', true);

do $$
declare
  v_slug text := current_setting('provision.tenant_slug');
  v_name_ar text := btrim(current_setting('provision.tenant_name_ar'));
  v_name_en text := nullif(btrim(current_setting('provision.tenant_name_en')), '');
  v_user_text text := lower(current_setting('provision.admin_user_id'));
  v_add_to_existing text := current_setting('provision.add_to_existing');
  v_stored_ar text;
  v_stored_en text;
  v_user uuid;
  v_tenant uuid;
  v_person uuid;
  v_membership uuid;
  v_status text;
  v_tenant_created boolean := false;
begin
  if v_slug !~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$' then
    raise exception 'provision: tenant_slug must be 1-63 lowercase letters, digits or hyphens (no hyphen at either end)';
  end if;
  if v_name_ar = '' or length(v_name_ar) > 200 or v_name_ar ~ '[[:cntrl:]]' then
    raise exception 'provision: tenant_name_ar must be 1-200 characters without control characters';
  end if;
  if v_name_en is not null and (length(v_name_en) > 200 or v_name_en ~ '[[:cntrl:]]') then
    raise exception 'provision: tenant_name_en must be at most 200 characters without control characters';
  end if;
  if v_user_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'provision: admin_user_id must be a UUID (the user''s UID in Supabase Auth)';
  end if;
  if v_add_to_existing not in ('true', 'false') then
    raise exception 'provision: add_to_existing must be true or false';
  end if;
  v_user := v_user_text::uuid;

  select id, name_ar, name_en into v_tenant, v_stored_ar, v_stored_en
  from platform.tenants where slug = v_slug for update;
  if v_tenant is null then
    insert into platform.tenants (slug, name_ar, name_en, status)
    values (v_slug, v_name_ar, v_name_en, 'active')
    returning id into v_tenant;
    v_tenant_created := true;
    raise notice 'provision: created organization % (%)', v_slug, v_tenant;
  elsif v_add_to_existing <> 'true' then
    raise exception 'provision: organization % already exists; to add a member to it, set add_to_existing and give its exact names', v_slug;
  elsif v_stored_ar is distinct from v_name_ar or v_stored_en is distinct from v_name_en then
    raise exception 'provision: organization % exists with different names; check the short name', v_slug;
  else
    raise notice 'provision: adding to the existing organization % (%)', v_slug, v_tenant;
  end if;

  select status into v_status from platform.tenant_memberships
  where tenant_id = v_tenant and user_id = v_user;
  if v_status = 'active' then
    -- Recovery path: an organization left without an Organization Admin gets one back (idempotent).
    -- Refused (SQLSTATE JR001, BR-IAM-4) when the user is the organization's HR Manager: choose another
    -- person, or have that role removed in the application first.
    insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary)
    select m.tenant_id, m.id, 'tenant_admin',
           not exists (select 1 from platform.role_assignments p
                       where p.tenant_id = m.tenant_id and p.membership_id = m.id and p.is_primary)
    from platform.tenant_memberships m
    where m.tenant_id = v_tenant and m.user_id = v_user
    -- An existing admin row with an end or start date does not count (private.tenant_has_admin):
    -- make it open-ended.
    on conflict (tenant_id, membership_id, role_code) do update
      set valid_from = null, valid_until = null
      where platform.role_assignments.valid_from is not null or platform.role_assignments.valid_until is not null;
    if found then
      insert into platform.audit_events (tenant_id, action, entity_type, entity_id, data)
      values (v_tenant, 'platform.tenant.admin_role_restored', 'tenant_membership', v_user::text,
              jsonb_build_object('source', 'ops.provision_tenant'));
      raise notice 'provision: the user is an active member; the Organization Admin role was given back';
    else
      raise notice 'provision: the user is already an active Organization Admin; nothing to do';
    end if;
    return;
  elsif v_status is not null then
    raise exception 'provision: the user already has a % membership in this organization; change it in the application', v_status;
  end if;

  insert into platform.persons (tenant_id, display_name_ar, display_name_en)
  values (v_tenant, 'مدير المنشأة', 'Tenant Admin')
  returning id into v_person;

  begin
    insert into platform.tenant_memberships (tenant_id, user_id, person_id, status)
    values (v_tenant, v_user, v_person, 'active')
    returning id into v_membership;
  exception when foreign_key_violation then
    raise exception 'provision: no Auth user with this UID (create the user in Authentication → Users first)';
  end;

  -- The provisioned member is an Organization Admin (primary role, T-M2-03).
  insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary)
  values (v_tenant, v_membership, 'tenant_admin', true);

  -- System action: no actor user (ids only, no personal data).
  insert into platform.audit_events (tenant_id, action, entity_type, entity_id, data)
  values (v_tenant, 'platform.tenant.admin_provisioned', 'tenant_membership', v_user::text,
          jsonb_build_object('source', 'ops.provision_tenant', 'tenant_created', v_tenant_created));
  raise notice 'provision: the user is now an active member of %', v_slug;
end
$$;
