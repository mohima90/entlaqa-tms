-- Platform Super Admin console × names that follow the default language (guided-test feedback #2, PO 17 Oct
-- 2026): when the Super Admin gives the first Organization Admin's English first and family names only, the
-- person gets no Arabic display name (allowed since 20261021090000) instead of the English name repeated in
-- the Arabic slot — so their profile later shows the Arabic name as not given, not as English text in the
-- Arabic fields. Only that INSERT changes; everything else is as in 20261018100000. The function keeps its
-- owner (platform_admin_guard: CREATE OR REPLACE keeps it; the migration role is a member since
-- 20261018100000) and its grants.

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
  -- A Super Admin never invites their own account as an organization's admin (security review L7): it
  -- would give a platform account a tenant role through the console's own invitation.
  if exists (select 1 from private.auth_user_email u where u.id = v_actor and lower(u.email) = v_email) then
    raise exception 'admin_email' using errcode = 'JP005';
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
  -- A complete English name alone is a name (persons_name_present_check, 20261021090000): the Arabic
  -- display name stays empty then instead of repeating the English one (PO 17 Oct 2026). An incomplete
  -- English name alone still fills the Arabic slot, as before.
  insert into platform.persons (tenant_id, display_name_ar, display_name_en, first_name_ar, family_name_ar,
                                first_name_en, family_name_en, email, preferred_locale)
  values (v_tenant,
          case when v_display_ar is null and v_first_en is not null and v_family_en is not null then null
               else coalesce(v_display_ar, v_display_en) end,
          v_display_en, v_first_ar, v_family_ar, v_first_en, v_family_en, v_email, p_locale)
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
