-- Rollback of 20261020090400_platform__add_role_scope_units.sql.
-- Acceptance goes back to the version of 20261018100000 (no unit); the unit columns, their rules and the
-- delete guard go away (department-limited roles then grant nothing scoped until the earlier application,
-- which reads the scope `departments` as the departments the member heads, runs again).
grant invitation_guard to current_user;

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

drop trigger departments_until_role_scopes_moved on platform.departments;
drop function private.check_department_role_scopes();
drop trigger invitations_scope_unit on platform.invitations;
drop trigger role_assignments_scope_unit on platform.role_assignments;
drop function private.check_role_scope_unit();
drop index platform.invitations_tenant_scope_unit_idx;
alter table platform.invitations drop constraint invitations_scope_unit_fkey, drop column scope_unit_id;
drop index platform.role_assignments_tenant_scope_unit_idx;
alter table platform.role_assignments drop constraint role_assignments_scope_unit_fkey, drop column scope_unit_id;
