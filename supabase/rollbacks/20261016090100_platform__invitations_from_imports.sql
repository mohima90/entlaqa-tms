-- Rollback of 20261016090100_platform__invitations_from_imports.sql: invitations as in 20261009090000 (the
-- import columns, their rules and the schedule removed), the sign-in rule as in 20261011090100 and the
-- worker's step as in 20261016090000. Run 20261016090200's rollback first.
create or replace function private.user_import_step(p_tenant_id uuid, p_import_id uuid, p_status text,
                                                   p_review_expires_at timestamptz, p_finished_at timestamptz,
                                                   p_undone_at timestamptz, p_confirmed_at timestamptz,
                                                   p_data_purged_at timestamptz, p_file_status text)
returns text
language sql stable
set search_path = ''
as $$
  select case
    when p_data_purged_at is not null then null
    when p_status = any (private.user_import_draft_statuses()) and p_review_expires_at <= now()
      then 'expire'
    when p_status = 'uploaded'
         and p_file_status in ('clean', 'infected', 'rejected', 'error', 'deleted') then 'read'
    when p_status = 'validating' then 'validate'
    when p_status in ('queued', 'checking', 'importing', 'inviting') then 'run'
    when p_status = 'undoing' then 'undo'
    when p_status in ('rejected', 'cancelled', 'expired')
         or (p_status = 'failed' and p_confirmed_at is null) then 'purge'
    when p_status in ('finished', 'stopped', 'failed', 'undone')
         and greatest(p_finished_at, p_undone_at) <= now() - interval '7 days' then 'purge'
  end;
$$;

drop policy invitations_user_import_guard_read on platform.invitations;
revoke all on platform.invitations from user_import_guard;

grant membership_guard to current_user;
create or replace function private.account_sign_in_refused(p_user_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_user_id is null
      or (exists (select 1 from platform.tenant_memberships m where m.user_id = p_user_id)
          and not exists (
            select 1
            from platform.tenant_memberships m
            join platform.tenants t on t.id = m.tenant_id
            where m.user_id = p_user_id and m.status = 'active' and t.status in ('active', 'trial'))
          and not exists (
            select 1
            from private.auth_account_email a
            join platform.invitations i on i.email = lower(a.email)
            join platform.tenants t on t.id = i.tenant_id
            where a.id = p_user_id and i.status = 'pending' and i.expires_at > now()
              and t.status in ('active', 'trial')));
$$;
revoke select (mail_held) on platform.invitations from membership_guard;

drop function private.schedule_held_invitations(uuid[], interval);

drop policy invitations_import_revoke on platform.invitations;
drop policy invitations_import_insert on platform.invitations;
revoke select (import_id, mail_held, send_at) on platform.invitations from authenticated;
revoke insert (import_id, mail_held) on platform.invitations from authenticated;
revoke update (send_at, mail_held) on platform.invitations from authenticated;

create or replace function private.check_invitation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_user uuid;
  v_actor_roles text[];
  v_person_email text;
  v_person_status text;
  v_resend boolean;
  v_what text;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' or new.token_hash is not null or new.token_issued_at is not null
       or new.send_count <> 0 or new.accepted_at is not null or new.accepted_user_id is not null
       or new.revoked_at is not null or new.revoked_by is not null
       or new.resend_requested_at is not null or new.resend_requested_by is not null then
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

    if current_user = 'authenticated' then
      new.expires_at := now() + interval '7 days';
      v_user := private.request_user_id();
      new.invited_by := v_user;
      if new.tenant_id is distinct from private.current_tenant_id() then
        return new;  -- rejected by the restrictive tenant_isolation policy
      end if;
      if (private.request_claims() ->> 'role') is distinct from 'authenticated' or v_user is null then
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
    if found then  -- otherwise the composite foreign key rejects the row
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
      new.invited_by, new.created_at)
     is distinct from (old.id, old.tenant_id, old.person_id, old.email, old.locale, old.primary_role,
                       old.additional_roles, old.invited_by, old.created_at) then
    raise exception 'what an invitation is for cannot change' using errcode = 'check_violation';
  end if;
  if old.status <> 'pending' then
    raise exception 'an accepted or revoked invitation cannot change' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  v_resend := (new.resend_requested_at, new.resend_requested_by)
              is distinct from (old.resend_requested_at, old.resend_requested_by);
  if v_resend and new.status <> 'pending' then
    raise exception 'a resend request leaves the invitation pending' using errcode = 'check_violation';
  end if;

  -- Revoking and asking for a new e-mail on the request path: a user manager; an invitation with a
  -- privileged role only an Organization Admin (the rules of inviting).
  if current_user = 'authenticated' and (new.status = 'revoked' or v_resend) then
    v_what := case when new.status = 'revoked' then 'revoke' else 'resend' end;
    v_user := private.request_user_id();
    if (private.request_claims() ->> 'role') is distinct from 'authenticated' or v_user is null then
      raise exception 'only signed-in members %',
        case v_what when 'revoke' then 'revoke invitations' else 'ask for a new invitation e-mail' end
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
      if current_user = 'authenticated' and (private.request_claims() ->> 'role') is distinct from 'system' then
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
  if old.expires_at <= now() then
    raise exception 'an expired invitation cannot be accepted' using errcode = 'check_violation';
  end if;
  new.accepted_at := now();
  return new;
end
$$;

comment on function private.check_invitation() is
  'SECURITY-RELEVANT (FR-IAM-03, ADR 0003 §5). Lifecycle of platform.invitations and who may invite / revoke (same rules as the role guard).';

drop function private.user_import_inviter(uuid, uuid, text);

drop index platform.invitations_send_due_idx;
drop index platform.invitations_import_idx;
alter table platform.invitations
  drop constraint invitations_send_at_check,
  drop constraint invitations_mail_held_check,
  drop constraint invitations_import_fk;
alter table platform.invitations
  drop column send_at,
  drop column mail_held,
  drop column import_id;
