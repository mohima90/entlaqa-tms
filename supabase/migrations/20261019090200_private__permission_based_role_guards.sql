-- The role guards decide by PERMISSION (EP-ROLES, FR-IAM-07; PO 17 Oct 2026): every database rule that
-- asked "is the actor an Organization Admin / an HR Manager?" now asks whether the actor holds the matching
-- permission organization-wide (private.member_permissions, migration 20261019090100), so custom roles work
-- in the database exactly as in the application — and the standard roles keep exactly the rights they had
-- (ref_role_permissions mirrors system-roles.ts). Messages and error codes are unchanged.
--
--   who                                         before                    now (permission, organization-wide)
--   give / remove a privileged role             tenant_admin              platform.role.assign_privileged
--   give / remove an ordinary role              tenant_admin, hr_manager  platform.role.assign + every permission
--                                                                         of the role held (nobody gives a
--                                                                         permission they do not hold), or the above
--   change a member holding a privileged role   tenant_admin              platform.role.assign_privileged
--   invite (+ resend, revoke, send held ones)   tenant_admin, hr_manager  platform.user.invite + may give the roles
--   suspend / revoke / reactivate a member      tenant_admin, hr_manager  platform.user.deactivate
--   user manager (people records, imports' and
--   invitations' visibility)                    tenant_admin, hr_manager  platform.user.invite / update / deactivate
--   organization profile, security policy       tenant_admin              platform.tenant.manage / security.manage
--   reset an authenticator app, unlock sign-in  tenant_admin              platform.user.reset_mfa / unlock_sign_in
--   import people                               tenant_admin, hr_manager  platform.user.invite + role.assign
--   (an import touching privileged members)     tenant_admin              platform.role.assign_privileged
-- A member holds a privileged role when a standard privileged role or a custom role with a high-risk
-- permission is in force (private.membership_is_privileged). Invitations name a standard or custom role
-- (private.role_is_assignable); an import never gives additional roles any more (one role per person).
-- Rules about the Organization Admin ROLE itself stay on its code: held alone (BR-IAM-4), the last one kept,
-- its MFA rules, the platform console.

grant invitation_guard to current_user;
grant membership_guard to current_user;
grant tenant_guard to current_user;
grant rate_limit_guard to current_user;

CREATE OR REPLACE FUNCTION private.membership_is_privileged(p_tenant_id uuid, p_membership_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from platform.role_assignments ra
    where ra.tenant_id = p_tenant_id and ra.membership_id = p_membership_id
      and private.role_is_privileged(ra.tenant_id, ra.role_code)
      and (ra.valid_until is null or ra.valid_until > now()));
$function$;

CREATE OR REPLACE FUNCTION private.actor_manages_users(p_tenant_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  -- A user manager: invites, edits or deactivates people organization-wide (EP-ROLES: by permission, so a
  -- custom role holding one of them counts like the Organization Admin and the HR Manager always did).
  select private.member_permissions(p_tenant_id, private.request_user_id())
         && array['platform.user.invite', 'platform.user.update', 'platform.user.deactivate']::text[];
$function$;

CREATE OR REPLACE FUNCTION private.actor_may_manage_person(p_tenant_id uuid, p_person_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select private.actor_manages_users(p_tenant_id)
     and (private.member_has_permission(p_tenant_id, private.request_user_id(), 'platform.role.assign_privileged')
          or not exists (select 1 from platform.tenant_memberships m
                         where m.tenant_id = p_tenant_id and m.person_id = p_person_id
                           and private.membership_is_privileged(m.tenant_id, m.id)));
$function$;

CREATE OR REPLACE FUNCTION private.actor_may_manage_tenant(p_tenant_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select private.member_has_permission(p_tenant_id, private.request_user_id(), 'platform.tenant.manage');
$function$;

CREATE OR REPLACE FUNCTION private.actor_may_change_security_policy(p_tenant_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select private.member_has_permission(p_tenant_id, private.request_user_id(), 'platform.security.manage');
$function$;

CREATE OR REPLACE FUNCTION private.invitation_actor_may_send(p_tenant_id uuid, p_user_id uuid, p_primary_role text, p_additional_roles text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select p_user_id is not null
         and private.member_has_permission(p_tenant_id, p_user_id, 'platform.user.invite')
         and private.member_may_give_roles(p_tenant_id, p_user_id, array[p_primary_role] || p_additional_roles);
$function$;

CREATE OR REPLACE FUNCTION private.invitation_inviter_may_grant(p_tenant_id uuid, p_invited_by uuid, p_roles text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select private.member_has_permission(p_tenant_id, p_invited_by, 'platform.user.invite')
         and private.member_may_give_roles(p_tenant_id, p_invited_by, p_roles)
         -- BR-IAM-4: nobody may give the Organization Admin role with another role (T-M2-16).
         and not private.roles_include_conflict(p_roles);
$function$;

CREATE OR REPLACE FUNCTION private.user_import_actor_may_import(p_tenant_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  -- Invites people and gives roles organization-wide (the default role is never privileged).
  select p_user_id is not null
         and private.member_has_permission(p_tenant_id, p_user_id, 'platform.user.invite')
         and private.member_permissions(p_tenant_id, p_user_id)
             && array['platform.role.assign', 'platform.role.assign_privileged']::text[];
$function$;

CREATE OR REPLACE FUNCTION private.user_import_actor_may_undo(p_tenant_id uuid, p_user_id uuid, p_importer uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select p_user_id is not null
         and case when p_user_id = p_importer then private.user_import_actor_may_import(p_tenant_id, p_user_id)
                  else private.member_has_permission(p_tenant_id, p_user_id, 'platform.role.assign_privileged') end;
$function$;

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
  -- Ordinary roles: platform.role.assign, and only roles whose permissions the actor holds.
  if not v_privileged and not private.member_may_give_roles(v_row.tenant_id, v_user, array[v_row.role_code]) then
    raise exception 'only an Organization Admin or an HR Manager can give or remove roles'
      using errcode = 'insufficient_privilege';
  end if;
  return v_row;
end
$function$;

CREATE OR REPLACE FUNCTION private.check_membership_change_actor()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_kind text := private.request_claims() ->> 'role';
  v_user uuid := private.request_user_id();
  v_privileged boolean;
begin
  if current_user <> 'authenticated' then
    return new;  -- platform operation (provisioning, invitation acceptance via reviewed definer functions)
  end if;
  if new.tenant_id is distinct from private.current_tenant_id() then
    return new;  -- row-level security rejects it
  end if;
  perform private.lock_tenant_roles(new.tenant_id);
  v_privileged := tg_op = 'UPDATE' and private.membership_is_privileged(new.tenant_id, new.id);

  if v_kind = 'system' then
    if v_privileged then
      raise exception 'system jobs cannot change a member who holds a privileged role'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;
  if v_kind is distinct from 'authenticated' or v_user is null then
    raise exception 'unexpected claims for a membership change' using errcode = 'insufficient_privilege';
  end if;
  if new.user_id = v_user then
    raise exception 'members cannot change their own membership' using errcode = 'insufficient_privilege';
  end if;

  if v_privileged and not private.member_has_permission(new.tenant_id, v_user, 'platform.role.assign_privileged') then
    raise exception 'only an Organization Admin can change a member who holds a privileged role'
      using errcode = 'insufficient_privilege';
  end if;
  -- Inviting needs platform.user.invite, a status change platform.user.deactivate (EP-ROLES).
  if not private.member_has_permission(new.tenant_id, v_user,
                                       case when tg_op = 'INSERT' then 'platform.user.invite'
                                            else 'platform.user.deactivate' end) then
    raise exception 'only an Organization Admin or an HR Manager can invite or change members'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$function$;

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
      -- By permission (EP-ROLES): platform.user.invite, and roles the inviter may give.
      if not private.member_has_permission(new.tenant_id, v_user, 'platform.user.invite') then
        raise exception 'only an Organization Admin or an HR Manager can invite people'
          using errcode = 'insufficient_privilege';
      end if;
      if not private.member_may_give_roles(new.tenant_id, v_user, array[new.primary_role] || new.additional_roles) then
        if private.roles_include_privileged(new.tenant_id, array[new.primary_role] || new.additional_roles) then
          raise exception 'only an Organization Admin can invite with a privileged role'
            using errcode = 'insufficient_privilege';
        end if;
        raise exception 'nobody can give a role with permissions they do not hold'
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
$function$;

CREATE OR REPLACE FUNCTION private.reactivate_membership(p_person_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_claims jsonb := private.request_claims();
  v_tenant uuid;
  v_actor uuid;
  v_membership record;
begin
  if session_user <> 'app_server' or v_claims is null or coalesce(v_claims ->> 'role', '') <> 'authenticated' then
    raise exception 'reactivate_membership needs a signed-in member' using errcode = 'insufficient_privilege';
  end if;
  -- Validates the session, the caller's own ACTIVE membership and the session's organization.
  v_tenant := private.current_tenant_id();
  v_actor := private.request_user_id();
  if v_tenant is null or v_actor is null or p_person_id is null then
    raise exception 'reactivate_membership needs a signed-in member of an organization' using errcode = 'insufficient_privilege';
  end if;
  -- Serialised with every role and membership change of the organization (READ COMMITTED: the rows
  -- below are read after the lock is granted).
  perform private.lock_tenant_roles(v_tenant);

  select m.id, m.user_id, m.status into v_membership
  from platform.tenant_memberships m
  where m.tenant_id = v_tenant and m.person_id = p_person_id;
  if not found then
    raise exception 'the person has no membership in this organization' using errcode = 'JM001';
  end if;
  if v_membership.user_id = v_actor then
    raise exception 'members cannot change their own membership' using errcode = 'insufficient_privilege';
  end if;
  if v_membership.status <> 'suspended' then
    raise exception 'the membership is not deactivated' using errcode = 'JM002';
  end if;

  if not private.member_has_permission(v_tenant, v_actor, 'platform.user.deactivate') then
    raise exception 'only an Organization Admin or an HR Manager can reactivate members'
      using errcode = 'insufficient_privilege';
  end if;
  if private.membership_is_privileged(v_tenant, v_membership.id) then
    if not private.member_has_permission(v_tenant, v_actor, 'platform.role.assign_privileged') then
      raise exception 'only an Organization Admin can reactivate a member who holds a privileged role'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  if not exists (select 1 from platform.persons p
                 where p.tenant_id = v_tenant and p.id = p_person_id and p.status = 'active') then
    raise exception 'the person must be active before the membership' using errcode = 'JM004';
  end if;

  update platform.tenant_memberships m set status = 'active'
  where m.id = v_membership.id and m.tenant_id = v_tenant and m.status = 'suspended';
  if not found then
    raise exception 'the membership is not deactivated' using errcode = 'JM002';
  end if;
  return v_membership.id;
end
$function$;

CREATE OR REPLACE FUNCTION private.reset_member_mfa(p_person_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid := private.current_tenant_id();
  v_actor uuid := private.request_user_id();
  v_member uuid;
begin
  if v_tenant is null or v_actor is null
     or not private.member_has_permission(v_tenant, v_actor, 'platform.user.reset_mfa') then
    raise exception 'only an Organization Admin resets authenticator apps'
      using errcode = 'insufficient_privilege';
  end if;
  if p_person_id is null or not private.actor_may_manage_person(v_tenant, p_person_id) then
    raise exception 'not a member this administrator may manage' using errcode = 'insufficient_privilege';
  end if;
  select m.user_id into v_member from platform.tenant_memberships m
  where m.tenant_id = v_tenant and m.person_id = p_person_id and m.user_id is not null;
  if v_member is null then
    return 'not_found';
  end if;
  if v_member = v_actor then
    return 'self';
  end if;
  if exists (select 1 from platform.tenant_memberships m join platform.tenants t on t.id = m.tenant_id
             where m.user_id = v_member and m.tenant_id <> v_tenant and m.status = 'active'
               and t.status in ('active', 'trial')) then
    return 'other_organization';
  end if;
  if private.remove_account_factors(v_member, null) = 0 then
    return 'no_app';
  end if;
  perform private.end_all_account_sessions(v_member, v_tenant, v_actor);
  perform private.queue_mfa_mail('mfa_factor_removed', v_member, null, 'admin_reset', v_tenant);
  return 'reset';
end
$function$;

CREATE OR REPLACE FUNCTION private.rate_limit_member_account(p_person_id uuid, OUT o_account_key bytea, OUT o_user_id uuid)
 RETURNS record
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid;
  v_actor uuid;
  v_email text;
  v_user uuid;
begin
  if session_user <> 'app_server' or coalesce(private.request_claims() ->> 'role', '') <> 'authenticated' then
    raise exception 'reserved to signed-in members of the web app' using errcode = 'insufficient_privilege';
  end if;
  v_tenant := private.current_tenant_id();
  v_actor := private.request_user_id();
  if v_tenant is null or v_actor is null
     or not private.member_has_permission(v_tenant, v_actor, 'platform.user.unlock_sign_in') then
    raise exception 'only an Organization Admin' using errcode = 'insufficient_privilege';
  end if;
  select e.email, m.user_id into v_email, v_user
  from platform.tenant_memberships m
  join private.auth_user_email e on e.id = m.user_id
  where m.tenant_id = v_tenant and m.person_id = p_person_id and m.status = 'active';
  if v_email is not null then
    o_account_key := private.rate_limit_key(private.rate_limit_account_subject(v_email));
    o_user_id := v_user;
  end if;
end
$function$;

CREATE OR REPLACE FUNCTION private.user_import_apply_batch(p_import_id uuid, p_limit integer)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid := private.user_import_job_tenant();
  v_import record;
  v_mode text;
  v_default_role text;
  v_admin boolean;
  v_importer_person uuid;
  v_row platform.user_import_rows;
  d jsonb;
  v_count integer := 0;
  v_last integer;
  v_person uuid;
  v_invitation uuid;
  v_manager uuid;
  v_department uuid;
  v_branch uuid;
  v_primary text;
  v_additional text[];
  v_warnings jsonb;
  v_values jsonb;
  v_before jsonb;
  v_versions jsonb;
  v_member text;
  v_state text;
  v_constraint text;
  v_message text;
  v_detail text;
  v_code text;
  v_locale text;
begin
  select i.id, i.status, i.options, i.created_by, i.checkpoint into v_import
  from platform.user_imports i where i.id = p_import_id for update;
  if not found or v_import.status <> 'importing' then
    raise exception 'the import is not adding people' using errcode = 'check_violation';
  end if;
  perform private.user_import_lock_tenant(v_tenant);
  if not private.user_import_actor_may_import(v_tenant, v_import.created_by) then
    raise exception 'the importer may no longer import people' using errcode = 'JU001';
  end if;
  v_mode := v_import.options ->> 'existing';
  v_default_role := v_import.options ->> 'defaultRole';
  v_admin := private.member_has_permission(v_tenant, v_import.created_by, 'platform.role.assign_privileged');
  select m.person_id into v_importer_person
  from platform.tenant_memberships m where m.tenant_id = v_tenant and m.user_id = v_import.created_by;
  -- The language of new people without one in the file (T-M2-22).
  select s.default_locale into v_locale from platform.tenant_settings s where s.tenant_id = v_tenant;
  v_locale := coalesce(v_locale, 'en');

  for v_row in
    select r.* from platform.user_import_rows r
    where r.tenant_id = v_tenant and r.import_id = p_import_id and r.apply_order > v_import.checkpoint
      and r.review_kind in ('new', 'existing') and r.result is null
    order by r.apply_order
    limit greatest(1, least(coalesce(p_limit, 500), 1000))
  loop
    v_count := v_count + 1;
    v_last := v_row.apply_order;
    d := v_row.data;
    -- The review's warnings stay with the row (the error report lists them).
    v_warnings := coalesce((select jsonb_agg(i) from jsonb_array_elements(v_row.issues) i where i ->> 's' = 'w'),
                           '[]'::jsonb);
    begin
      if v_row.review_kind = 'new' and v_mode = 'update_only' then
        update platform.user_import_rows r
        set result = 'skipped', result_issues = private.user_import_issue('NEW_SKIPPED_UPDATE_ONLY', 'k')
        where r.tenant_id = v_tenant and r.import_id = p_import_id and r.row_number = v_row.row_number;
      elsif v_row.review_kind = 'existing' and v_mode = 'skip' then
        update platform.user_import_rows r
        set result = 'skipped', result_issues = private.user_import_issue('EXISTING_SKIPPED', 'k')
        where r.tenant_id = v_tenant and r.import_id = p_import_id and r.row_number = v_row.row_number;
      else
        -- References as they are now: the manager added by an earlier row, units not deleted since, a
        -- manager still active. A reference that no longer holds is left empty (warning).
        v_manager := v_row.manager_person_id;
        if v_row.manager_row is not null then
          select m.person_id into v_manager from platform.user_import_rows m
          where m.tenant_id = v_tenant and m.import_id = p_import_id and m.row_number = v_row.manager_row
            and m.result in ('added', 'updated');
        end if;
        if v_manager is not null and not exists (select 1 from platform.persons p
                                                 where p.tenant_id = v_tenant and p.id = v_manager and p.status = 'active') then
          v_manager := null;
        end if;
        if v_manager is null and (v_row.manager_row is not null or v_row.manager_person_id is not null) then
          v_warnings := v_warnings || private.user_import_issue('MANAGER_NOT_FOUND', 'w', 'manager_email',
                                                                jsonb_build_object('email', d ->> 'manager_email'));
        end if;
        v_department := v_row.department_id;
        if v_department is not null and not exists (select 1 from platform.departments x
                                                     where x.tenant_id = v_tenant and x.id = v_department and x.deleted_at is null) then
          v_department := null;
          v_warnings := v_warnings || private.user_import_issue('DEPARTMENT_NOT_FOUND', 'w', 'department',
                                                                jsonb_build_object('name', d ->> 'department'));
        end if;
        v_branch := v_row.branch_id;
        if v_branch is not null and not exists (select 1 from platform.branches x
                                                where x.tenant_id = v_tenant and x.id = v_branch and x.deleted_at is null) then
          v_branch := null;
          v_warnings := v_warnings || private.user_import_issue('BRANCH_NOT_FOUND', 'w', 'branch',
                                                                jsonb_build_object('name', d ->> 'branch'));
        end if;

        if v_row.review_kind = 'new' then
          v_primary := coalesce(d ->> 'primary_role', v_default_role);
          -- One role per person (EP-ROLES, PO 17 Oct 2026): additional roles of a file are not given.
          v_additional := '{}'::text[];
          if v_row.target_person_id is null then
            -- Fresh check: nobody has this e-mail now (e.g. invited by hand since the review).
            if exists (select 1 from platform.persons p where p.tenant_id = v_tenant and p.email = d ->> 'email'
                                                         and p.removed_at is null) then
              raise exception 'changed since the review' using errcode = 'JU002', detail = 'CHANGED_SINCE_REVIEW';
            end if;
            insert into platform.persons (display_name_ar, display_name_en, first_name_ar, father_name_ar,
                                          grandfather_name_ar, family_name_ar, first_name_en, father_name_en,
                                          grandfather_name_en, family_name_en, email, employee_number, mobile_e164,
                                          preferred_locale)
            values (concat_ws(' ', d ->> 'first_name_ar', d ->> 'father_name_ar', d ->> 'grandfather_name_ar', d ->> 'family_name_ar'),
                    nullif(concat_ws(' ', d ->> 'first_name_en', d ->> 'father_name_en', d ->> 'grandfather_name_en', d ->> 'family_name_en'), ''),
                    d ->> 'first_name_ar', d ->> 'father_name_ar', d ->> 'grandfather_name_ar', d ->> 'family_name_ar',
                    d ->> 'first_name_en', d ->> 'father_name_en', d ->> 'grandfather_name_en', d ->> 'family_name_en',
                    d ->> 'email', d ->> 'employee_number', d ->> 'mobile', coalesce(d ->> 'language', v_locale))
            returning id into v_person;
            insert into platform.person_employment (person_id, department_id, branch_id, manager_person_id, job_title_ar,
                                                    job_title_en, hire_on, source)
            values (v_person, v_department, v_branch, v_manager, d ->> 'job_title_ar', d ->> 'job_title_en',
                    (d ->> 'hire_date')::date, 'import');
            v_before := null;
            v_versions := null;
          else
            -- A person without account or invitation (e.g. whose invitation was revoked by hand; never one
            -- removed by an undo — those are not matched): invited again, the record updated from the file
            -- and made active; undo restores it.
            perform 1 from platform.persons p where p.tenant_id = v_tenant and p.id = v_row.target_person_id for update;
            select m.status into v_member from platform.tenant_memberships m
            where m.tenant_id = v_tenant and m.person_id = v_row.target_person_id;
            if v_member is not null
               or exists (select 1 from platform.invitations i
                          where i.tenant_id = v_tenant and i.person_id = v_row.target_person_id and i.status = 'pending')
               or not exists (select 1 from platform.persons p
                              where p.tenant_id = v_tenant and p.id = v_row.target_person_id and p.email = d ->> 'email') then
              raise exception 'changed since the review' using errcode = 'JU002', detail = 'CHANGED_SINCE_REVIEW';
            end if;
            v_person := v_row.target_person_id;
            v_values := private.user_import_person_before(v_tenant, v_person, d, v_department, v_branch, v_manager);
            v_before := v_values || jsonb_build_object('status', (select p.status from platform.persons p
                                                                   where p.tenant_id = v_tenant and p.id = v_person));
            select coalesce(jsonb_object_agg(k.key, case k.key
                     when 'mobile_e164' then d -> 'mobile' when 'hire_on' then d -> 'hire_date'
                     when 'department_id' then to_jsonb(v_department) when 'branch_id' then to_jsonb(v_branch)
                     when 'manager_person_id' then to_jsonb(v_manager) else d -> k.key end), '{}'::jsonb)
              into v_values
            from jsonb_object_keys(v_values) k(key)
            where k.key not like 'display\_name\_%';
            v_versions := private.user_import_write_person(v_tenant, v_person, v_values, 'active');
          end if;
          -- The trigger makes the importer the inviter (checked: may still invite; no privileged role).
          insert into platform.invitations (person_id, email, locale, primary_role, additional_roles, import_id, mail_held)
          values (v_person, d ->> 'email',
                  coalesce(d ->> 'language', (select p.preferred_locale from platform.persons p
                                              where p.tenant_id = v_tenant and p.id = v_person), v_locale),
                  v_primary, v_additional, p_import_id, true)
          returning id into v_invitation;
          insert into platform.audit_events (action, entity_type, entity_id, data)
          values ('platform.invitation.created', 'invitation', v_invitation::text,
                  jsonb_build_object('personId', v_person, 'primaryRole', v_primary, 'additionalRoles', to_jsonb(v_additional),
                                     'importId', p_import_id, 'held', true, 'reinvited', v_row.target_person_id is not null,
                                     'job', private.request_claims() ->> 'job_id'));
          update platform.user_import_rows r
          set result = 'added', result_issues = v_warnings, person_id = v_person, invitation_id = v_invitation,
              before = v_before, after_versions = v_versions
          where r.tenant_id = v_tenant and r.import_id = p_import_id and r.row_number = v_row.row_number;
        else
          -- An existing member: their data only (never e-mail, roles or account status: PO decisions 4, 5).
          v_person := v_row.target_person_id;
          perform 1 from platform.persons p where p.tenant_id = v_tenant and p.id = v_person for update;
          select m.status into v_member from platform.tenant_memberships m
          where m.tenant_id = v_tenant and m.person_id = v_person;
          if v_member is distinct from 'active' then
            raise exception 'changed since the review' using errcode = 'JU002', detail = 'CHANGED_SINCE_REVIEW';
          end if;
          if v_person = v_importer_person then
            raise exception 'own record' using errcode = 'JU002', detail = 'OWN_ROW';
          end if;
          -- An HR Manager never changes the record of a member holding a privileged role (TM-0003
          -- T-IAM-18; as «تعديل البيانات»): skipped.
          if not v_admin and exists (select 1 from platform.tenant_memberships m
                                     where m.tenant_id = v_tenant and m.person_id = v_person
                                       and private.membership_is_privileged(m.tenant_id, m.id)) then
            update platform.user_import_rows r
            set result = 'skipped', result_issues = private.user_import_issue('PRIVILEGED_MEMBER', 'k')
            where r.tenant_id = v_tenant and r.import_id = p_import_id and r.row_number = v_row.row_number;
          else
            v_before := private.user_import_person_before(v_tenant, v_person, d, v_department, v_branch, v_manager);
            if v_before = '{}'::jsonb then
              update platform.user_import_rows r
              set result = 'skipped', result_issues = private.user_import_issue('NO_CHANGES', 'k') || v_warnings
              where r.tenant_id = v_tenant and r.import_id = p_import_id and r.row_number = v_row.row_number;
            else
              select coalesce(jsonb_object_agg(k.key, case k.key
                       when 'mobile_e164' then d -> 'mobile' when 'hire_on' then d -> 'hire_date'
                       when 'department_id' then to_jsonb(v_department) when 'branch_id' then to_jsonb(v_branch)
                       when 'manager_person_id' then to_jsonb(v_manager) else d -> k.key end), '{}'::jsonb)
                into v_values
              from jsonb_object_keys(v_before) k(key)
              where k.key not like 'display\_name\_%';
              v_versions := private.user_import_write_person(v_tenant, v_person, v_values, null);
              insert into platform.audit_events (action, entity_type, entity_id, data)
              values ('platform.user.updated', 'person', v_person::text,
                      jsonb_build_object('changed', (select jsonb_agg(k order by k) from jsonb_object_keys(v_before) k
                                                     where k not like 'display\_name\_%'),
                                         'importId', p_import_id, 'job', private.request_claims() ->> 'job_id'));
              update platform.user_import_rows r
              set result = 'updated', result_issues = v_warnings, person_id = v_person, before = v_before,
                  after_versions = v_versions
              where r.tenant_id = v_tenant and r.import_id = p_import_id and r.row_number = v_row.row_number;
            end if;
          end if;
        end if;
      end if;
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_constraint = constraint_name, v_message = message_text,
                              v_detail = pg_exception_detail;
      v_code := case
        when v_state = 'JU002' then coalesce(nullif(v_detail, ''), 'CHANGED_SINCE_REVIEW')
        when v_state = '23505' and v_constraint = 'persons_tenant_employee_number_uq' then 'EMPLOYEE_NUMBER_TAKEN'
        when v_state = '23505' then 'CHANGED_SINCE_REVIEW'
        when v_state = 'JR001' then 'ROLE_ORG_ADMIN'
        when v_state = '23514' and v_message like '%manager chain%' then 'MANAGER_LOOP'
        when v_state = '23514' and v_message like '%direct manager must be an active person%' then 'MANAGER_NOT_FOUND'
        when v_state = '42501' then 'NOT_ALLOWED'
        else 'WRITE_FAILED'
      end;
      update platform.user_import_rows r
      set result = case when v_code = 'OWN_ROW' then 'skipped' else 'failed' end,
          result_issues = private.user_import_issue(v_code, case when v_code = 'OWN_ROW' then 'k' else 'e' end)
      where r.tenant_id = v_tenant and r.import_id = p_import_id and r.row_number = v_row.row_number;
    end;
  end loop;

  if v_count > 0 then
    update platform.user_imports i
    set checkpoint = v_last, rows_done = least(i.rows_total, i.rows_done + v_count)
    where i.id = p_import_id;
  end if;
  return v_count;
end
$function$;

CREATE OR REPLACE FUNCTION private.user_import_undo_batch(p_import_id uuid, p_limit integer)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid := private.user_import_job_tenant();
  v_import record;
  v_admin boolean;
  v_row platform.user_import_rows;
  v_count integer := 0;
  v_result text;
  v_status text;
  v_versions jsonb;
  v_restore jsonb;
begin
  select i.id, i.status, i.created_by, i.undo_requested_by into v_import
  from platform.user_imports i where i.id = p_import_id for update;
  if not found or v_import.status <> 'undoing' then
    raise exception 'the import is not being undone' using errcode = 'check_violation';
  end if;
  perform private.user_import_lock_tenant(v_tenant);
  if not private.user_import_actor_may_undo(v_tenant, v_import.undo_requested_by, v_import.created_by) then
    return -1;
  end if;
  v_admin := private.member_has_permission(v_tenant, v_import.undo_requested_by, 'platform.role.assign_privileged');
  for v_row in
    select r.* from platform.user_import_rows r
    where r.tenant_id = v_tenant and r.import_id = p_import_id and r.result in ('added', 'updated')
      and r.undo_result is null
    order by r.apply_order desc
    limit greatest(1, least(coalesce(p_limit, 500), 1000))
  loop
    v_count := v_count + 1;
    begin
      v_versions := null;
      if v_row.person_id is not null then
        select jsonb_build_object('person', p.version, 'employment', e.version) into v_versions
        from platform.persons p
        left join platform.person_employment e on e.tenant_id = p.tenant_id and e.person_id = p.id
        where p.tenant_id = v_tenant and p.id = v_row.person_id
        for update of p;
      end if;
      if v_row.result = 'added' then
        select i.status into v_status from platform.invitations i
        where i.tenant_id = v_tenant and i.id = v_row.invitation_id for update;
        if v_status is distinct from 'pending'
           or exists (select 1 from platform.tenant_memberships m
                      where m.tenant_id = v_tenant and m.person_id = v_row.person_id) then
          v_result := 'kept_accepted';
        elsif exists (select 1 from platform.person_employment e
                      join platform.persons p on p.tenant_id = e.tenant_id and p.id = e.person_id and p.status = 'active'
                      where e.tenant_id = v_tenant and e.manager_person_id = v_row.person_id
                        and e.person_id <> v_row.person_id)
              or exists (select 1 from platform.departments x
                         where x.tenant_id = v_tenant and x.head_person_id = v_row.person_id and x.deleted_at is null) then
          v_result := 'kept_referenced';
        elsif v_row.before is not null and v_versions is distinct from v_row.after_versions then
          -- Invited again by the import, and the record changed since: kept as it is (invitation included).
          v_result := 'kept_changed';
        else
          update platform.invitations i set status = 'revoked'
          where i.tenant_id = v_tenant and i.id = v_row.invitation_id;
          if v_row.before is null then
            -- Created by this import: removed, as if never added (migration 20261016090150) — kept inactive for
            -- the audit trail and referential integrity only, invisible to user claims.
            update platform.persons p set status = 'inactive', removed_by_import_id = p_import_id
            where p.tenant_id = v_tenant and p.id = v_row.person_id;
          else
            perform private.user_import_write_person(v_tenant, v_row.person_id, v_row.before - 'status',
                                                     coalesce(v_row.before ->> 'status', 'inactive'));
          end if;
          insert into platform.audit_events (action, entity_type, entity_id, data)
          values ('platform.invitation.revoked', 'invitation', v_row.invitation_id::text,
                  jsonb_build_object('personId', v_row.person_id, 'importId', p_import_id, 'undo', true,
                                     'job', private.request_claims() ->> 'job_id'));
          v_result := 'removed';
        end if;
      elsif not v_admin and exists (select 1 from platform.tenant_memberships m
                                    where m.tenant_id = v_tenant and m.person_id = v_row.person_id
                                      and private.membership_is_privileged(m.tenant_id, m.id)) then
        v_result := 'kept_privileged';
      elsif v_versions is distinct from v_row.after_versions then
        v_result := 'kept_changed';
      else
        v_restore := v_row.before;
        perform private.user_import_write_person(v_tenant, v_row.person_id, v_restore, null);
        insert into platform.audit_events (action, entity_type, entity_id, data)
        values ('platform.user.updated', 'person', v_row.person_id::text,
                jsonb_build_object('changed', (select jsonb_agg(k order by k) from jsonb_object_keys(v_restore) k
                                               where k not like 'display\_name\_%'),
                                   'importId', p_import_id, 'undo', true, 'job', private.request_claims() ->> 'job_id'));
        v_result := 'restored';
      end if;
    exception when others then
      v_result := 'kept_error';
    end;
    update platform.user_import_rows r set undo_result = v_result
    where r.tenant_id = v_tenant and r.import_id = p_import_id and r.row_number = v_row.row_number;
  end loop;
  return v_count;
end
$function$;
