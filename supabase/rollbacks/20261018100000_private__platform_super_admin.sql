-- Rollback of 20261018100000_private__platform_super_admin.sql: no platform console. The invitation link,
-- acceptance and code issuing go back to 20261009090000 / 20261018090000 (console invitations then read as
-- invalid: their inviter is no member of the organization). Organizations created from the console stay
-- (they are ordinary organizations; an Organization Admin who joined keeps the role). The cluster-wide role
-- platform_admin_guard is kept (other databases may use it); its privileges here are removed.
grant invitation_guard to current_user;
grant platform_admin_guard to current_user;

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
  select i.status, i.expires_at, i.email, i.locale, i.tenant_id, i.person_id, i.invited_by, i.primary_role,
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
        or not private.invitation_inviter_may_grant(v.tenant_id, v.invited_by,
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
  if not private.invitation_inviter_may_grant(v_inv.tenant_id, v_inv.invited_by,
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

create or replace function private.issue_invitation_code(p_invitation_id uuid)
returns text
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_tenant uuid;
  v_inv record;
  v_code text;
  v_constraint text;
  v_try integer := 0;
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
  loop
    v_try := v_try + 1;
    v_code := private.unused_invitation_code();
    begin
      update platform.invitations i set invite_code = v_code where i.id = v_inv.id;
      return v_code;
    exception when unique_violation then
      -- Another invitation took this code meanwhile (improbable: 32^12 codes): draw again, a few times.
      -- Never re-raised as is: the error must not carry a code (security review L9).
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint not in ('invitations_invite_code_uq', 'invitations_token_hash_uq') then
        raise exception 'the invitation code could not be stored' using errcode = 'unique_violation';
      end if;
      if v_try >= 5 then
        raise exception 'no unused invitation code could be drawn' using errcode = 'JI006';
      end if;
    end;
  end loop;
end
$$;

drop function private.invitation_issuer_may_grant(uuid, uuid, uuid, text[]);
drop function private.write_invitation_code(uuid);
drop function private.grant_platform_admin(uuid);
drop function private.revoke_platform_admin(uuid);
drop function private.platform_reissue_admin_code(uuid);
drop function private.platform_admin_invitation_code(uuid);
drop function private.platform_create_tenant(text, text, text, text, text, text, text, text, text);
drop function private.platform_reserved_slug(text);
drop function private.platform_list_tenants();
drop function private.platform_pending_admin_invitation(uuid);
drop function private.is_platform_admin();
drop function private.platform_admin_caller();
drop function private.is_platform_invitation(uuid);
drop function private.platform_admin_is_active(uuid);

drop table private.platform_audit_events;
drop table private.platform_invitations;
drop table private.platform_admins;

drop policy tenants_platform_admin_guard_read on platform.tenants;
drop policy tenants_platform_admin_guard_insert on platform.tenants;
drop policy tenant_settings_platform_admin_guard_insert on platform.tenant_settings;
drop policy security_policies_platform_admin_guard_insert on platform.security_policies;
drop policy persons_platform_admin_guard_read on platform.persons;
drop policy persons_platform_admin_guard_insert on platform.persons;
drop policy invitations_platform_admin_guard_read on platform.invitations;
drop policy invitations_platform_admin_guard_insert on platform.invitations;
drop policy invitations_platform_admin_guard_update on platform.invitations;
drop policy tenant_memberships_platform_admin_guard_read on platform.tenant_memberships;
drop policy role_assignments_platform_admin_guard_read on platform.role_assignments;
drop policy ref_roles_platform_admin_guard_read on platform.ref_roles;
drop policy audit_events_platform_admin_guard_insert on platform.audit_events;

revoke all on platform.tenants, platform.tenant_settings, platform.security_policies, platform.persons,
  platform.invitations, platform.tenant_memberships, platform.role_assignments, platform.ref_roles,
  platform.audit_events from platform_admin_guard;
revoke execute on function private.try_uuid(text), private.request_claims(), private.request_user_id(),
  private.request_person_id(), private.current_tenant_id(), private.user_session_is_valid(uuid, uuid),
  private.lock_tenant_roles(uuid), private.has_visible_text(text), private.new_invitation_code(),
  private.unused_invitation_code(),
  private.roles_conflict(text, text), private.roles_include_conflict(text[]) from platform_admin_guard;

revoke usage on schema platform, private from platform_admin_guard;
revoke platform_admin_guard from current_user;
