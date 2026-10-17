-- Department-limited custom roles (FR-IAM-08 R1 note, FR-IAM-07; BRD v3.2; T-M3-09; business flows
-- docs/business-flows/EP-ORG-organization-structure.md BR-ORG-c/d and EP-ROLES §4 step 4, PO 17 Oct 2026).
-- Class: T. PII: none (unit ids).
--
-- A custom role whose data scope is «A department» is given for ONE unit of the structure (any level), picked by
-- the giver (invite, Team members → Edit role); the holder sees that unit and every unit below it.
--
--   platform.role_assignments.scope_unit_id  the unit of a department-limited custom role (null otherwise)
--   platform.invitations.scope_unit_id       the unit the invitation gives with its role (carried to the
--                                            assignment on acceptance: private.apply_invitation_acceptance)
-- Both point at a unit of the SAME organization (composite foreign keys to platform.departments).
--
-- Expand-first (the application and the database deploy in parallel): the stored scope code of custom roles
-- stays `departments` (no data migration, the check constraint of platform.custom_roles is unchanged); only its
-- MEANING changes, in the application (packages/platform-rbac custom-roles.ts): from "the departments the member
-- heads" to "the unit picked when the role is given, with everything under it". The running application never
-- writes the new columns, so nothing breaks while it is older than this migration. A department-limited role
-- WITHOUT a unit (given before this change, or a role whose scope became «A department» later) grants nothing
-- scoped until a unit is picked (deny by default) — the new application always asks for one. The Department
-- Head standard role is unchanged (the units they head, with everything under them).
--
-- Rules (the application checks them first; repeated here for every writer):
--   * only a custom role whose data scope is `departments` takes a unit (check_violation otherwise);
--   * a signed-in member gives only a live, ACTIVE unit of the organization; the unit row is share-locked so a
--     concurrent delete waits and then sees the new holder (READ COMMITTED). Acceptance carries the
--     invitation's unit as it is (a unit deactivated meanwhile grants nothing until a new one is picked —
--     BR-ORG exception "the picked unit is deactivated");
--   * an invitation's unit never changes (like its role);
--   * a unit that is the scope of a role assignment (membership not revoked) or of a pending invitation cannot
--     be deleted (soft delete refused with both numbers; it can be deactivated). Pending invitations are counted
--     as far as the actor may read them (user managers: every one); one the actor cannot see keeps its unit,
--     which then grants nothing once deleted (fails closed).
-- Scoped permissions of a department-limited role are evaluated by the application (ADR 0003 §4: grants →
-- org_units scope with descendants → SQL filter). The database guards keep asking for ORGANIZATION-WIDE
-- permissions only (private.member_permissions): a department-limited role adds nothing there except the
-- permissions that are organization-wide by nature (custom_role_use = 'organization'), as before.
-- Audit: platform.user.roles_changed and platform.invitation.created carry the unit id (actions).

grant invitation_guard to current_user;

alter table platform.role_assignments add column scope_unit_id uuid;
alter table platform.role_assignments
  add constraint role_assignments_scope_unit_fkey
    foreign key (tenant_id, scope_unit_id) references platform.departments (tenant_id, id);
create index role_assignments_tenant_scope_unit_idx on platform.role_assignments (tenant_id, scope_unit_id)
  where scope_unit_id is not null;
comment on column platform.role_assignments.scope_unit_id is
  'The unit of a department-limited custom role (EP-ORG, FR-IAM-08): the holder sees it and every unit below it. Null for every other role.';

alter table platform.invitations add column scope_unit_id uuid;
alter table platform.invitations
  add constraint invitations_scope_unit_fkey
    foreign key (tenant_id, scope_unit_id) references platform.departments (tenant_id, id);
create index invitations_tenant_scope_unit_idx on platform.invitations (tenant_id, scope_unit_id)
  where scope_unit_id is not null and status = 'pending';
comment on column platform.invitations.scope_unit_id is
  'The unit given with a department-limited custom role (EP-ORG, FR-IAM-08); carried to the role assignment on acceptance.';
-- Invitations are granted column by column (never token_hash): the request path reads and sets the unit.
-- role_assignments are granted by table (select, insert, delete); the unit is never updated in place (a role
-- change replaces the row, packages/platform-db role-admin.ts).
grant select (scope_unit_id), insert (scope_unit_id) on platform.invitations to authenticated;

-- The unit of a role (assignment or invitation): a department-limited custom role only; a live, active unit
-- when a signed-in member gives it. SECURITY INVOKER (custom_roles: invitation_guard reads code + data_scope).
create or replace function private.check_role_scope_unit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_role text := case tg_table_name when 'invitations' then v_row ->> 'primary_role' else v_row ->> 'role_code' end;
  v_scope text;
  v_status text;
  v_deleted timestamptz;
begin
  if tg_table_name = 'invitations' and tg_op = 'UPDATE' then
    if new.scope_unit_id is distinct from old.scope_unit_id then
      raise exception 'what an invitation is for cannot change' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if new.scope_unit_id is null then
    return new;
  end if;
  if current_user = 'authenticated' and new.tenant_id is distinct from private.current_tenant_id() then
    return new;  -- another organization's row: the restrictive tenant_isolation policy rejects it
  end if;
  if v_role like 'custom\_%' then
    select cr.data_scope into v_scope from platform.custom_roles cr
    where cr.tenant_id = new.tenant_id and cr.code = v_role;
  end if;
  if v_scope is distinct from 'departments' then
    raise exception 'only a role limited to a department takes a unit' using errcode = 'check_violation';
  end if;
  if current_user = 'authenticated' then
    -- Share-locked: a concurrent soft delete of the unit waits for this transaction, then counts this holder.
    select d.status, d.deleted_at into v_status, v_deleted
    from platform.departments d
    where d.tenant_id = new.tenant_id and d.id = new.scope_unit_id
    for share;
    if not found or v_deleted is not null or v_status <> 'active' then
      raise exception 'the unit must be an active unit of the organization' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end
$$;

comment on function private.check_role_scope_unit() is
  'SECURITY-RELEVANT (FR-IAM-08, EP-ORG). The unit of a role: department-limited custom roles only; live and active when given by a member; fixed on invitations.';

revoke all on function private.check_role_scope_unit() from public;

create trigger role_assignments_scope_unit before insert or update of scope_unit_id, role_code
  on platform.role_assignments
  for each row execute function private.check_role_scope_unit();
create trigger invitations_scope_unit before insert or update of scope_unit_id on platform.invitations
  for each row execute function private.check_role_scope_unit();

-- A unit that is still a role's scope cannot be deleted (BR-ORG-c); deactivating it is allowed.
create or replace function private.check_department_role_scopes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_roles bigint;
  v_invitations bigint;
begin
  if not (old.deleted_at is null and new.deleted_at is not null) then
    return new;
  end if;
  select count(*) into v_roles
  from platform.role_assignments ra
  join platform.tenant_memberships m on m.tenant_id = ra.tenant_id and m.id = ra.membership_id
  where ra.tenant_id = new.tenant_id and ra.scope_unit_id = new.id and m.status <> 'revoked';
  select count(*) into v_invitations
  from platform.invitations i
  where i.tenant_id = new.tenant_id and i.scope_unit_id = new.id and i.status = 'pending';
  if v_roles > 0 or v_invitations > 0 then
    raise exception 'the unit is still the scope of % role assignment(s) and % pending invitation(s)', v_roles, v_invitations
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

comment on function private.check_department_role_scopes() is
  'SECURITY-RELEVANT (EP-ORG BR-ORG-c). A unit picked for a department-limited role (member or pending invitation) cannot be deleted.';

revoke all on function private.check_department_role_scopes() from public;

create trigger departments_until_role_scopes_moved before update of deleted_at on platform.departments
  for each row execute function private.check_department_role_scopes();

-- Acceptance gives the invitation's role WITH its unit (otherwise unchanged from 20261018100000).
grant insert (scope_unit_id) on platform.role_assignments to invitation_guard;

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
  returning i.id, i.tenant_id, i.person_id, i.email, i.primary_role, i.additional_roles, i.invited_by,
            i.scope_unit_id
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

  -- The unit of a department-limited custom role (EP-ORG, FR-IAM-08) comes with the role.
  insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary, scope_unit_id)
  values (v_inv.tenant_id, v_membership, v_inv.primary_role, true, v_inv.scope_unit_id);
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
