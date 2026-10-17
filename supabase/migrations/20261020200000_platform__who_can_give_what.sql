-- Who can give what (FR-IAM-07, EP-ROLES; PO decision 17 Oct 2026, BRD v3.2 revision row 3.2 item (6);
-- business flow docs/business-flows/EP-ROLES-roles-and-custom-roles.md header and §5). Class: G rows of the
-- permission catalogue (custom_role_use only) + new versions of four reviewed functions. PII: none.
--
-- The rule "nobody gives a permission they do not hold" (migrations 20261019090100 / 20261019090200) is
-- REPLACED by:
--   1. Building custom roles: only the Organization Admin (platform.role.manage, unchanged) creates, changes
--      and deletes custom roles, and may put in them ANY permission of the catalogue whose custom_role_use
--      is not 'none' — also training permissions the Organization Admin does not hold itself (BR-IAM-4: it
--      holds none). Administrative permissions (custom_role_use = organization_only) still need the whole
--      organization as the role's scope. Never in a custom role (custom_role_use = 'none'): role management
--      (platform.role.manage), privileged role assignment (platform.role.assign_privileged) and — from this
--      migration — the organization structure (platform.org.manage: the HR Manager's, PO 11 Oct 2026; it was
--      kept out until now only because the Organization Admin does not hold it).
--   2. Giving roles (invite, change a role, user import, invitation link and acceptance): the holder of
--      platform.role.assign_privileged (the Organization Admin) gives every role; the holder of
--      platform.role.assign (the HR Manager, or a custom role with it) gives every ORDINARY role — any
--      standard or custom role that is not privileged (L&D Manager, Training Coordinator, Department Head,
--      Employee, ordinary custom roles). Privileged roles (private.role_is_privileged: any permission marked
--      privileged — high-risk ones and user / role / structure management — and the Organization Admin and
--      HR Manager standard roles) only by the Organization Admin. The check "the giver holds every permission
--      of the role" is gone. Unchanged: one role per person, the Organization Admin held alone (BR-IAM-4),
--      the last Organization Admin kept, the unit rules of department-limited roles, tenant checks, audit.
--
-- Why it is safe (threat note docs/security/threat-models/TM-0003 addendum): the Organization Admin is the
-- top privilege of an organization already (it gives every role, the HR Manager's included); privileged
-- roles stay Organization-Admin-only to give, and ordinary roles hold no user, role, structure, settings,
-- security or audit permission, so the HR Manager cannot raise anyone above an ordinary role; the HR Manager
-- still cannot build or change roles.
--
-- Needs forms (T-M3-10): tms.needs_form.read / manage were kept out of custom roles (custom_role_use
-- 'none') only because of the old rule. They become usable: read 'organization' (the organization's form
-- library, no personal data — like tms.course.read), manage 'organization_only' (designing forms changes
-- organization-wide set-up — like tms.course.manage; the database guard of tms.needs_forms asks for it
-- organization-wide, private.member_permissions). Neither is privileged (unchanged).
--
-- Functions (CREATE OR REPLACE; signatures, owners, grants and other behaviour unchanged):
--   private.member_may_give_roles          role.assign_privileged: every role; role.assign: no privileged
--                                          role — used by the role-assignment guard, the invitation
--                                          guard (signed-in and import paths), invitation_actor_may_send
--                                          and invitation_inviter_may_grant → invitation_issuer_may_grant
--                                          (the link state and acceptance re-check)
--   private.check_custom_role_permission   catalogue rule (custom_role_use <> 'none'), actor, organization
--                                          scope for administrative permissions — no "held" check
--   private.check_role_assignment_actor    comment only (the rule is member_may_give_roles')
--   private.check_invitation               the refusal for an inviter without role.assign now says so
--                                          (it said "permissions they do not hold")
-- Synced with packages/platform-rbac (custom-roles.ts catalogue and customRolePermissionProblems,
-- role-grants.ts canAssignRole, iam/role-catalogue.ts canGive) by the drift tests (custom-roles.test.ts).

-- ---------------------------------------------------------------------------------------------------
-- Catalogue: how a custom role may use three permissions
-- ---------------------------------------------------------------------------------------------------
update platform.ref_permissions set custom_role_use = 'none' where code = 'platform.org.manage';
update platform.ref_permissions set custom_role_use = 'organization' where code = 'tms.needs_form.read';
update platform.ref_permissions set custom_role_use = 'organization_only' where code = 'tms.needs_form.manage';

-- No custom role can have held the structure permission (the Organization Admin, the only builder, never
-- held it); a row a platform operation may have written goes, so the catalogue rule holds for every row.
delete from platform.custom_role_permissions where permission_code = 'platform.org.manage';

-- ---------------------------------------------------------------------------------------------------
-- Who may give which roles
-- ---------------------------------------------------------------------------------------------------
create or replace function private.member_may_give_roles(p_tenant_id uuid, p_user_id uuid, p_roles text[])
returns boolean
language plpgsql stable
set search_path = ''
as $$
declare
  v_held text[];
begin
  if p_user_id is null then
    return false;
  end if;
  v_held := private.member_permissions(p_tenant_id, p_user_id);
  if 'platform.role.assign_privileged' = any (v_held) then
    return true;
  end if;
  -- Who can give what (PO, 17 Oct 2026): platform.role.assign gives every ORDINARY role; a privileged role
  -- (or an unknown code: private.role_is_privileged fails closed) only with role.assign_privileged.
  return 'platform.role.assign' = any (v_held) and not private.roles_include_privileged(p_tenant_id, p_roles);
end
$$;

comment on function private.member_may_give_roles(uuid, uuid, text[]) is
  'SECURITY-RELEVANT (ADR 0003 §5, EP-ROLES; who can give what, PO 17 Oct 2026). Who may give which roles: platform.role.assign_privileged (the Organization Admin) every role; platform.role.assign (the HR Manager) every role that is not privileged.';

-- ---------------------------------------------------------------------------------------------------
-- Permissions of custom roles
-- ---------------------------------------------------------------------------------------------------
create or replace function private.check_custom_role_permission()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_row platform.custom_role_permissions := case when tg_op = 'DELETE' then old else new end;
  v_use text;
  v_scope text;
begin
  -- The catalogue rule holds for every writer, platform operations included (security review L3): the
  -- permissions marked 'none' (role management, privileged role assignment, the organization structure)
  -- are never part of a custom role — on a rewrite too (confirmation pass Low 2).
  if tg_op in ('INSERT', 'UPDATE') then
    select p.custom_role_use into v_use from platform.ref_permissions p where p.code = new.permission_code;
    if v_use is null or v_use = 'none' then
      raise exception 'permission % cannot be part of a custom role', new.permission_code
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  -- Only the Organization Admin (platform.role.manage) changes a role's permissions; removing one never
  -- gives anything; a deleted role takes its permissions with it (cascade).
  if not private.check_custom_role_actor(v_row.tenant_id) then
    return v_row;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  -- Who can give what (PO, 17 Oct 2026): any permission of the catalogue, also one the Organization Admin
  -- does not hold itself (training permissions); administrative ones only organization-wide.
  select cr.data_scope into v_scope from platform.custom_roles cr
  where cr.tenant_id = new.tenant_id and cr.id = new.custom_role_id;
  if v_use = 'organization_only' and v_scope is distinct from 'organization' then
    raise exception 'administrative permissions need the whole organization as the role''s scope'
      using errcode = 'JR003';
  end if;
  new.created_at := now();
  new.created_by := private.request_person_id();
  return new;
end
$$;

comment on function private.check_custom_role_permission() is
  'SECURITY-RELEVANT (FR-IAM-07, EP-ROLES; who can give what, PO 17 Oct 2026). Permissions of custom roles: catalogue only (never custom_role_use none), written by the Organization Admin, administrative ones organization-wide only.';

-- ---------------------------------------------------------------------------------------------------
-- The role-assignment and invitation guards (versions of 20261019090200; only the lines named above change)
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.check_role_assignment_actor()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_row platform.role_assignments := case when tg_op = 'DELETE' then old else new end;
  v_kind text := private.request_claims() ->> 'role';
  v_user uuid := private.request_user_id();
  v_admin boolean;
  v_privileged boolean;
  v_status text;
begin
  perform private.lock_tenant_roles(v_row.tenant_id);

  if tg_op = 'INSERT' then
    select m.status into v_status from platform.tenant_memberships m
    where m.tenant_id = v_row.tenant_id and m.id = v_row.membership_id;
    if v_status = 'revoked' then
      raise exception 'roles cannot be given to a revoked membership' using errcode = 'check_violation';
    end if;
  end if;

  if current_user <> 'authenticated' then
    return v_row;  -- platform operation
  end if;
  -- Rows of another tenant: the restrictive tenant_isolation policy rejects them (tested per table in
  -- 20_isolation.sql and its exact form in 10_catalog.sql / verify-deployment.sql).
  if v_row.tenant_id is distinct from private.current_tenant_id() then
    return v_row;
  end if;

  v_privileged := private.role_is_privileged(v_row.tenant_id, v_row.role_code);

  -- System jobs (sync from HR systems, LMS, …) handle outside data: they may never give or remove a
  -- privileged role.
  if v_kind = 'system' then
    if v_privileged then
      raise exception 'system jobs cannot give or remove the role %', v_row.role_code
        using errcode = 'insufficient_privilege';
    end if;
    return v_row;
  end if;
  if v_kind is distinct from 'authenticated' or v_user is null then
    raise exception 'unexpected claims for a role change' using errcode = 'insufficient_privilege';
  end if;

  if exists (select 1 from platform.tenant_memberships m
             where m.tenant_id = v_row.tenant_id and m.id = v_row.membership_id and m.user_id = v_user) then
    raise exception 'members cannot change their own roles' using errcode = 'insufficient_privilege';
  end if;

  -- By permission (EP-ROLES): the Organization Admin's platform.role.assign_privileged gives every role.
  v_admin := private.member_has_permission(v_row.tenant_id, v_user, 'platform.role.assign_privileged');
  -- A member who holds a privileged role is managed by an Organization Admin only — every role of theirs,
  -- not just the privileged ones (same rule as their record and membership, T-M2-14).
  if not v_admin
     and private.membership_is_privileged(v_row.tenant_id, v_row.membership_id) then
    raise exception 'only an Organization Admin can change the roles of a member who holds a privileged role'
      using errcode = 'insufficient_privilege';
  end if;
  if v_privileged and not v_admin then
    raise exception 'only an Organization Admin can give or remove the role %', v_row.role_code
      using errcode = 'insufficient_privilege';
  end if;
  -- Ordinary roles: platform.role.assign gives every one of them (who can give what, PO 17 Oct 2026 —
  -- no longer "only roles whose permissions the actor holds"; migration 20261020200000).
  if not v_privileged and not private.member_may_give_roles(v_row.tenant_id, v_user, array[v_row.role_code]) then
    raise exception 'only an Organization Admin or an HR Manager can give or remove roles'
      using errcode = 'insufficient_privilege';
  end if;
  return v_row;
end
$function$

;

CREATE OR REPLACE FUNCTION private.check_invitation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_user uuid;
  v_kind text := private.request_claims() ->> 'role';
  v_person_email text;
  v_person_status text;
  v_resend boolean;
  v_release boolean;
  v_schedule boolean;
  v_code boolean;
  v_importer uuid;
  v_undo_by uuid;
  v_what text;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' or new.token_hash is not null or new.token_issued_at is not null
       or new.invite_code is not null
       or new.send_count <> 0 or new.accepted_at is not null or new.accepted_user_id is not null
       or new.revoked_at is not null or new.revoked_by is not null
       or new.resend_requested_at is not null or new.resend_requested_by is not null or new.send_at is not null
       or new.released_at is not null or new.send_requested_by is not null then
      raise exception 'an invitation starts pending, with no token and no outcome' using errcode = 'check_violation';
    end if;
    new.created_at := now();
    new.updated_at := now();
    if exists (select 1 from unnest(new.additional_roles) r group by r having count(*) > 1) then
      raise exception 'additional roles must not repeat' using errcode = 'check_violation';
    end if;
    -- A standard role or a custom role of the organization (EP-ROLES; no foreign key since 20261019090100).
    -- Read under the organization's role lock (security review L4): a custom role deleted at the same time
    -- is either gone here or still held by this invitation when its delete checks the holders.
    if current_user = 'authenticated' then
      perform private.lock_tenant_roles(new.tenant_id);
    end if;
    if not private.role_is_assignable(new.tenant_id, new.primary_role) then
      raise exception 'unknown role' using errcode = 'foreign_key_violation';
    end if;
    if exists (select 1 from unnest(new.additional_roles) r
               where not private.role_is_assignable(new.tenant_id, r)) then
      raise exception 'unknown role in additional roles' using errcode = 'foreign_key_violation';
    end if;

    if current_user = 'authenticated' and new.tenant_id is distinct from private.current_tenant_id() then
      return new;  -- rejected by the restrictive tenant_isolation policy
    end if;
    if current_user = 'authenticated' and v_kind = 'system' and new.import_id is not null then
      -- System jobs invite only for a user import adding people now, held, as its importer (T-M2-12); any
      -- other invitation by a job is refused below (only signed-in members invite).
      if not new.mail_held then
        raise exception 'system jobs invite only for a user import, held until it is sent'
          using errcode = 'insufficient_privilege';
      end if;
      perform private.lock_tenant_roles(new.tenant_id);
      v_importer := private.user_import_inviter(new.tenant_id, new.import_id, 'importing');
      if v_importer is null then
        raise exception 'the import is not adding people, or its importer may no longer invite'
          using errcode = 'insufficient_privilege';
      end if;
      -- An import invites as its importer.
      new.invited_by := v_importer;
      if private.roles_include_privileged(new.tenant_id, array[new.primary_role] || new.additional_roles) then
        raise exception 'privileged roles are never given by import' using errcode = 'insufficient_privilege';
      end if;
      if not private.member_may_give_roles(new.tenant_id, v_importer, array[new.primary_role] || new.additional_roles) then
        raise exception 'the importer may not give these roles' using errcode = 'insufficient_privilege';
      end if;
      new.expires_at := now() + interval '7 days';
    elsif current_user = 'authenticated' then
      if new.import_id is not null or new.mail_held then
        raise exception 'only a user import creates invitations held for later' using errcode = 'insufficient_privilege';
      end if;
      new.expires_at := now() + interval '7 days';
      v_user := private.request_user_id();
      new.invited_by := v_user;
      if v_kind is distinct from 'authenticated' or v_user is null then
        raise exception 'only signed-in members invite people' using errcode = 'insufficient_privilege';
      end if;
      perform private.lock_tenant_roles(new.tenant_id);
      -- By permission (EP-ROLES): platform.user.invite, and roles the inviter may give — who can give what
      -- (PO, 17 Oct 2026; migration 20261020200000): privileged roles only with role.assign_privileged,
      -- every ordinary role with role.assign.
      if not private.member_has_permission(new.tenant_id, v_user, 'platform.user.invite') then
        raise exception 'only an Organization Admin or an HR Manager can invite people'
          using errcode = 'insufficient_privilege';
      end if;
      if not private.member_may_give_roles(new.tenant_id, v_user, array[new.primary_role] || new.additional_roles) then
        if private.roles_include_privileged(new.tenant_id, array[new.primary_role] || new.additional_roles) then
          raise exception 'only an Organization Admin can invite with a privileged role'
            using errcode = 'insufficient_privilege';
        end if;
        raise exception 'only an Organization Admin or an HR Manager can give roles'
          using errcode = 'insufficient_privilege';
      end if;
    end if;

    select p.email, p.status into v_person_email, v_person_status
    from platform.persons p where p.tenant_id = new.tenant_id and p.id = new.person_id;
    -- Under claims the person must be one the caller sees (re-review Low 2, migration 20261016090100).
    if not found and current_user = 'authenticated' then
      raise exception 'the person to invite does not exist' using errcode = 'foreign_key_violation';
    end if;
    if found then  -- platform operations: otherwise the composite foreign key rejects the row
      if v_person_email is distinct from new.email then
        raise exception 'the invitation e-mail must be the person''s e-mail' using errcode = 'check_violation';
      end if;
      if v_person_status <> 'active' then
        raise exception 'only active people can be invited' using errcode = 'check_violation';
      end if;
      if exists (select 1 from platform.tenant_memberships m
                 where m.tenant_id = new.tenant_id and m.person_id = new.person_id) then
        raise exception 'the person already has a membership in this organization' using errcode = 'check_violation';
      end if;
    end if;
    return new;
  end if;

  -- UPDATE
  if (new.id, new.tenant_id, new.person_id, new.email, new.locale, new.primary_role, new.additional_roles,
      new.invited_by, new.created_at, new.import_id)
     is distinct from (old.id, old.tenant_id, old.person_id, old.email, old.locale, old.primary_role,
                       old.additional_roles, old.invited_by, old.created_at, old.import_id) then
    raise exception 'what an invitation is for cannot change' using errcode = 'check_violation';
  end if;
  -- Who asked to send it is stamped by the schedule below (integration review M2), never written directly.
  if new.send_requested_by is distinct from old.send_requested_by
     and new.send_at is not distinct from old.send_at and current_user = 'authenticated' then
    raise exception 'who asked to send an invitation is recorded by sending it' using errcode = 'check_violation';
  end if;
  if old.status <> 'pending' then
    raise exception 'an accepted or revoked invitation cannot change' using errcode = 'check_violation';
  end if;
  if new.mail_held and not old.mail_held then
    raise exception 'an invitation that was sent is never held again' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  v_release := old.mail_held and not new.mail_held;
  v_schedule := new.send_at is distinct from old.send_at and not v_release;
  v_code := new.invite_code is distinct from old.invite_code;
  if new.released_at is distinct from old.released_at and not v_release then
    raise exception 'only sending a held invitation stamps when it was sent' using errcode = 'check_violation';
  end if;
  v_resend := (new.resend_requested_at, new.resend_requested_by)
              is distinct from (old.resend_requested_at, old.resend_requested_by);
  if v_resend and new.status <> 'pending' then
    raise exception 'a resend request leaves the invitation pending' using errcode = 'check_violation';
  end if;
  if old.mail_held and not v_release
     and (v_resend or v_code or new.token_hash is distinct from old.token_hash) then
    raise exception 'a held invitation is sent before it gets a token or a resend' using errcode = 'check_violation';
  end if;
  if (v_release or v_schedule)
     and (new.status <> 'pending' or v_resend or v_code or new.token_hash is distinct from old.token_hash) then
    raise exception 'scheduling or releasing a held invitation changes nothing else' using errcode = 'check_violation';
  end if;

  -- System jobs revoke only the invitations of an import being undone (T-M2-12); any other revocation by
  -- a job is refused below (only signed-in members revoke).
  if current_user = 'authenticated' and v_kind = 'system' and new.status = 'revoked' and old.import_id is not null then
    select i.undo_requested_by into v_undo_by
    from platform.user_imports i
    where i.tenant_id = old.tenant_id and i.id = old.import_id and i.status = 'undoing';
    if v_undo_by is null then
      raise exception 'system jobs revoke only the invitations of an import being undone'
        using errcode = 'insufficient_privilege';
    end if;
    if v_resend or v_release
       or (new.token_hash, new.token_issued_at, new.send_count, new.expires_at, new.invite_code)
          is distinct from (old.token_hash, old.token_issued_at, old.send_count, old.expires_at, old.invite_code) then
      raise exception 'revoking an invitation changes nothing else' using errcode = 'check_violation';
    end if;
    new.send_at := null;
    new.revoked_at := now();
    new.revoked_by := v_undo_by;
    -- The code goes; its token hash stays, so the link reads "revoked" (security review L3).
    new.invite_code := null;
    return new;
  end if;

  -- Releasing (system jobs only): a held invitation whose time has come, while the member it is sent for —
  -- who asked to send it, else its inviter (the importer) — may still invite (integration review M2). It
  -- gets its first code here (FR-IAM-03, PO 16 Oct 2026) and its 7 days; the mailer e-mails that code.
  if v_release then
    if current_user = 'authenticated' and v_kind is distinct from 'system' then
      raise exception 'held invitations are sent by the worker' using errcode = 'insufficient_privilege';
    end if;
    if new.send_requested_by is distinct from old.send_requested_by then
      raise exception 'sending an invitation keeps who asked for it' using errcode = 'check_violation';
    end if;
    if current_user = 'authenticated' then
      perform private.lock_tenant_roles(new.tenant_id);
      if old.send_at is null or old.send_at > now()
         or not private.invitation_actor_may_send(old.tenant_id, coalesce(old.send_requested_by, old.invited_by),
                                                  old.primary_role, old.additional_roles) then
        raise exception 'only a due invitation, for a member who may still invite, is sent'
          using errcode = 'insufficient_privilege';
      end if;
    end if;
    new.send_at := null;
    new.released_at := now();
    -- A code no other invitation holds or held (the caller sees one organization only; L9).
    new.invite_code := private.unused_invitation_code();
    new.token_hash := pg_catalog.sha256(pg_catalog.convert_to(new.invite_code, 'UTF8'));
    new.token_issued_at := now();
    new.send_count := old.send_count + 1;
    new.expires_at := now() + interval '7 days';
    return new;
  end if;

  -- Scheduling a held invitation (or clearing its schedule).
  if v_schedule then
    if not old.mail_held then
      raise exception 'only a held invitation is scheduled' using errcode = 'check_violation';
    end if;
    if current_user = 'authenticated' and v_kind = 'system' then
      perform private.lock_tenant_roles(new.tenant_id);
      if new.send_at is not null
         and private.user_import_inviter(old.tenant_id, old.import_id, 'inviting') is distinct from old.invited_by then
        raise exception 'system jobs schedule only the invitations of an import sending them'
          using errcode = 'insufficient_privilege';
      end if;
      -- The import sends its own invitations (for its importer); a cleared schedule asks for nobody.
      new.send_requested_by := null;
      return new;
    end if;
    -- Users: see the actor rules below (the rules of a resend).
  end if;

  -- Revoking, asking for a new e-mail and scheduling a held one on the request path: a user manager; an
  -- invitation with a privileged role only an Organization Admin (the rules of inviting).
  if current_user = 'authenticated' and (new.status = 'revoked' or v_resend or v_schedule) then
    v_what := case when new.status = 'revoked' then 'revoke' when v_schedule then 'send' else 'resend' end;
    v_user := private.request_user_id();
    if v_kind is distinct from 'authenticated' or v_user is null then
      raise exception 'only signed-in members %',
        case v_what when 'revoke' then 'revoke invitations' when 'send' then 'send held invitations'
                    else 'ask for a new invitation e-mail' end
        using errcode = 'insufficient_privilege';
    end if;
    perform private.lock_tenant_roles(new.tenant_id);
    if not private.member_has_permission(new.tenant_id, v_user, 'platform.user.invite') then
      raise exception 'only an Organization Admin or an HR Manager can % invitations', v_what
        using errcode = 'insufficient_privilege';
    end if;
    if not private.member_has_permission(new.tenant_id, v_user, 'platform.role.assign_privileged')
       and private.roles_include_privileged(new.tenant_id, array[new.primary_role] || new.additional_roles) then
      raise exception 'only an Organization Admin can % an invitation with a privileged role', v_what
        using errcode = 'insufficient_privilege';
    end if;
    if v_schedule then
      -- Members ask for the e-mail once; the pace (send_at) comes from private.schedule_held_invitations.
      if new.send_at is null or old.send_at is not null then
        raise exception 'a held invitation is scheduled once, and not unscheduled, by a member'
          using errcode = 'check_violation';
      end if;
      -- It is sent for this member (integration review M2): checked again when it is released.
      new.send_requested_by := v_user;
      return new;
    end if;
  elsif v_schedule then
    return new;  -- platform operation (support)
  end if;

  if new.status = 'pending' then
    if v_resend then
      if v_code or new.token_hash is distinct from old.token_hash then
        raise exception 'a resend request and a new token are separate changes' using errcode = 'check_violation';
      end if;
      if current_user = 'invitation_guard' then
        raise exception 'invitations are not resent on acceptance' using errcode = 'insufficient_privilege';
      end if;
      if old.send_count >= 4 then
        raise exception 'the invitation has had all its e-mails' using errcode = 'check_violation';
      end if;
      new.resend_requested_at := now();
      if current_user = 'authenticated' then
        new.resend_requested_by := v_user;
      end if;
    end if;
    if v_code then
      -- A new code (and with it the link's token hash): only private.issue_invitation_code, which runs as
      -- invitation_guard and checks the actor, or a platform operation.
      if new.invite_code is null then
        raise exception 'an invitation code cannot be removed' using errcode = 'check_violation';
      end if;
      if current_user = 'authenticated' then
        raise exception 'invitation codes are issued by the invitation functions only' using errcode = 'insufficient_privilege';
      end if;
      if new.token_hash is distinct from old.token_hash then
        raise exception 'a new invitation code brings its own token' using errcode = 'check_violation';
      end if;
      new.token_hash := pg_catalog.sha256(pg_catalog.convert_to(new.invite_code, 'UTF8'));
      new.token_issued_at := now();
      new.send_count := old.send_count + 1;
      new.expires_at := now() + interval '7 days';
    elsif new.token_hash is distinct from old.token_hash then
      if new.token_hash is null then
        raise exception 'an invitation token cannot be removed' using errcode = 'check_violation';
      end if;
      -- A bare token hash (no code): platform operations only (support, links e-mailed before codes).
      if current_user in ('authenticated', 'invitation_guard') then
        raise exception 'invitation tokens come with a code issued by the invitation functions'
          using errcode = 'insufficient_privilege';
      end if;
      new.invite_code := null;
      new.token_issued_at := now();
      new.send_count := old.send_count + 1;
      new.expires_at := now() + interval '7 days';
    elsif (new.token_issued_at, new.send_count) is distinct from (old.token_issued_at, old.send_count)
          or (new.expires_at is distinct from old.expires_at
              and current_user in ('authenticated', 'invitation_guard')) then
      raise exception 'the token, send count and expiry change only with a new token' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if (new.token_hash, new.token_issued_at, new.send_count, new.expires_at, new.invite_code)
     is distinct from (old.token_hash, old.token_issued_at, old.send_count, old.expires_at, old.invite_code) then
    raise exception 'the token of an invitation changes only while it is pending' using errcode = 'check_violation';
  end if;
  -- Accepted or revoked: the code is no longer needed (nobody copies it any more); its token hash stays,
  -- so the link still reads "used" or "revoked" (security review L3).
  new.invite_code := null;

  if new.status = 'revoked' then
    if current_user = 'invitation_guard' then
      raise exception 'invitations are not revoked on acceptance' using errcode = 'insufficient_privilege';
    end if;
    new.send_at := null;
    new.revoked_at := now();
    if current_user = 'authenticated' then
      new.revoked_by := v_user;  -- actor checked above
    end if;
    return new;
  end if;

  -- pending → accepted
  if current_user = 'authenticated' then
    raise exception 'invitations are accepted through the invitation link only' using errcode = 'insufficient_privilege';
  end if;
  if old.mail_held then
    raise exception 'a held invitation has no link to accept' using errcode = 'check_violation';
  end if;
  if old.expires_at <= now() then
    raise exception 'an expired invitation cannot be accepted' using errcode = 'check_violation';
  end if;
  new.accepted_at := now();
  return new;
end
$function$

;
