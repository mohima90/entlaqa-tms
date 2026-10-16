-- Rollback of 20261018090000_platform__invitation_codes.sql: invitations without codes — the lifecycle
-- trigger as in 20261016090100, the sign-up gate as in 20261009090000 (43-character tokens only) and the
-- request path's UPDATE (token_hash) for the mailer job back. Links with a code stop working at once
-- (the gate no longer takes codes): resend those invitations after the rollback (the mailer of the
-- previous release issues tokens again).
grant invitation_guard to current_user;

drop function private.issue_invitation_code(uuid);
drop function private.invitation_codes(uuid[]);
drop function private.invitation_code_for_mail(uuid);
drop function private.invitation_code_caller();
drop function private.unused_invitation_code();

create or replace function private.check_invitation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_user uuid;
  v_kind text := private.request_claims() ->> 'role';
  v_actor_roles text[];
  v_person_email text;
  v_person_status text;
  v_resend boolean;
  v_release boolean;
  v_schedule boolean;
  v_importer uuid;
  v_undo_by uuid;
  v_what text;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' or new.token_hash is not null or new.token_issued_at is not null
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
    if exists (select 1 from unnest(new.additional_roles) r
               where not exists (select 1 from platform.ref_roles x where x.code = r)) then
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
      if exists (select 1 from platform.ref_roles r
                 where r.code = any (array[new.primary_role] || new.additional_roles) and r.is_privileged) then
        raise exception 'privileged roles are never given by import' using errcode = 'insufficient_privilege';
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
      v_actor_roles := private.actor_role_codes(new.tenant_id, v_user);
      if not (v_actor_roles && array['tenant_admin', 'hr_manager']) then
        raise exception 'only an Organization Admin or an HR Manager can invite people'
          using errcode = 'insufficient_privilege';
      end if;
      if not ('tenant_admin' = any (v_actor_roles))
         and exists (select 1 from platform.ref_roles r
                     where r.code = any (array[new.primary_role] || new.additional_roles) and r.is_privileged) then
        raise exception 'only an Organization Admin can invite with a privileged role'
          using errcode = 'insufficient_privilege';
      end if;
    end if;

    select p.email, p.status into v_person_email, v_person_status
    from platform.persons p where p.tenant_id = new.tenant_id and p.id = new.person_id;
    -- Under claims the person must be one the caller sees: the foreign key alone is not enough, because it
    -- ignores RLS — a person removed by an import undo (hidden from user claims, migration
    -- 20261016090150) still satisfies it (re-review Low 2). Platform operations rely on the key.
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
  if new.released_at is distinct from old.released_at and not v_release then
    raise exception 'only sending a held invitation stamps when it was sent' using errcode = 'check_violation';
  end if;
  v_resend := (new.resend_requested_at, new.resend_requested_by)
              is distinct from (old.resend_requested_at, old.resend_requested_by);
  if v_resend and new.status <> 'pending' then
    raise exception 'a resend request leaves the invitation pending' using errcode = 'check_violation';
  end if;
  if old.mail_held and not v_release and (v_resend or new.token_hash is distinct from old.token_hash) then
    raise exception 'a held invitation is sent before it gets a token or a resend' using errcode = 'check_violation';
  end if;
  if (v_release or v_schedule)
     and (new.status <> 'pending' or v_resend or new.token_hash is distinct from old.token_hash) then
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
       or (new.token_hash, new.token_issued_at, new.send_count, new.expires_at)
          is distinct from (old.token_hash, old.token_issued_at, old.send_count, old.expires_at) then
      raise exception 'revoking an invitation changes nothing else' using errcode = 'check_violation';
    end if;
    new.send_at := null;
    new.revoked_at := now();
    new.revoked_by := v_undo_by;
    return new;
  end if;

  -- Releasing (system jobs only): a held invitation whose time has come, while the member it is sent for —
  -- who asked to send it, else its inviter (the importer) — may still invite (integration review M2). The
  -- mailer then gives it a token and its 7 days.
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
    v_actor_roles := private.actor_role_codes(new.tenant_id, v_user);
    if not (v_actor_roles && array['tenant_admin', 'hr_manager']) then
      raise exception 'only an Organization Admin or an HR Manager can % invitations', v_what
        using errcode = 'insufficient_privilege';
    end if;
    if not ('tenant_admin' = any (v_actor_roles))
       and exists (select 1 from platform.ref_roles r
                   where r.code = any (array[new.primary_role] || new.additional_roles) and r.is_privileged) then
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
      if new.token_hash is distinct from old.token_hash then
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
    if new.token_hash is distinct from old.token_hash then
      if new.token_hash is null then
        raise exception 'an invitation token cannot be removed' using errcode = 'check_violation';
      end if;
      -- Request path: only system jobs (the mailer) issue tokens; users ask for a resend instead.
      if current_user = 'authenticated' and v_kind is distinct from 'system' then
        raise exception 'only the invitation mailer issues tokens' using errcode = 'insufficient_privilege';
      end if;
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

  if (new.token_hash, new.token_issued_at, new.send_count, new.expires_at)
     is distinct from (old.token_hash, old.token_issued_at, old.send_count, old.expires_at) then
    raise exception 'the token of an invitation changes only while it is pending' using errcode = 'check_violation';
  end if;

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
$$;

comment on function private.check_invitation() is
  'SECURITY-RELEVANT (FR-IAM-03, FR-IAM-04, ADR 0003 §5). Lifecycle of platform.invitations and who may invite / revoke / schedule / release (same rules as the role guard; imports: T-M2-12).';

create or replace function private.invitation_allows_signup(p_email text, p_token text)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v record;
begin
  if p_email is null or p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return false;
  end if;
  select l.state, l.email into v
  from private.invitation_link(pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8'))) l;
  -- Exactly the invitation's e-mail (stored lower-case and trimmed; Auth sends it lower-cased).
  return coalesce(v.state = 'valid' and v.email = p_email, false);
end
$$;

comment on function private.invitation_allows_signup(text, text) is
  'SECURITY-RELEVANT (FR-IAM-03, review H1). Is there a valid invitation for this e-mail and raw token? supabase_auth_admin (the sign-up hook) only.';

create or replace function private.before_user_created_hook(event jsonb)
returns jsonb
language plpgsql stable
set search_path = ''
set lock_timeout = '2s'
as $$
declare
  v_deny constant jsonb := '{"error": {"http_code": 403, "message": "Sign-up is by invitation only."}}';
  v_user jsonb;
  v_email text;
  v_token text;
begin
  begin
    v_user := event -> 'user';
    if jsonb_typeof(v_user) is distinct from 'object' then
      return v_deny;
    end if;
    -- E-mail sign-ups only: provider exactly 'email', explicitly not anonymous, no phone number.
    if (v_user -> 'app_metadata' ->> 'provider') is distinct from 'email'
       or (v_user -> 'is_anonymous') is distinct from 'false'::jsonb
       or coalesce(v_user ->> 'phone', '') <> '' then
      return v_deny;
    end if;
    -- As Auth sends it (lower-cased by Auth): never normalised here, the account gets this address.
    v_email := coalesce(v_user ->> 'email', '');
    v_token := case when jsonb_typeof(v_user -> 'user_metadata' -> 'invitation') = 'string'
                    then v_user -> 'user_metadata' ->> 'invitation' end;
    if v_email = '' or v_token is null or v_token !~ '^[A-Za-z0-9_-]{43}$' then
      return v_deny;
    end if;
    if private.invitation_allows_signup(v_email, v_token) is true then
      return '{}'::jsonb;
    end if;
    return v_deny;
  exception when others then
    -- Refused, never admitted. Only the SQLSTATE is logged (no e-mail, no token).
    raise warning 'before_user_created_hook: sign-up refused after an error (SQLSTATE %)', sqlstate;
    return v_deny;
  end;
end
$$;

comment on function private.before_user_created_hook(jsonb) is
  'SECURITY-RELEVANT (FR-IAM-03, review H1). Supabase Auth before-user-created hook: only e-mail sign-ups with a valid invitation token for that e-mail. supabase_auth_admin only. Fail-open hook API: every path returns the refusal explicitly.';

drop policy invitations_guard_issue on platform.invitations;
revoke update (invite_code) on platform.invitations from invitation_guard;
revoke execute on function private.current_tenant_id() from invitation_guard;
grant update (token_hash) on platform.invitations to authenticated;

-- The column, its check and its unique index (the trigger above no longer reads it).
alter table platform.invitations drop column invite_code;
drop function private.new_invitation_code();
