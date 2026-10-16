-- Invitation codes (FR-IAM-03; PO decision 16 Oct 2026: "implement what is in Kawadir ATS for sign-in and
-- invitation exactly; no need to send e-mail — a copyable link like Kawadir"). An invitation now carries a
-- 12-character CODE (alphabet ABCDEFGHJKLMNPQRSTUVWXYZ23456789, 60 random bits; shown grouped XXXX-XXXX-XXXX
-- by the web app, stored and hashed as the 12 characters — security review H1) that the members who may
-- manage it can copy at any time, together with the link `/{locale}/sign-up#code=CODE`; e-mail is optional.
-- The code is the invitation's link secret: token_hash = SHA-256 of the code, so the sign-up gate
-- (private.before_user_created_hook → invitation_allows_signup), the link page (invitation_by_token) and
-- acceptance (accept_invitation_as_caller) work unchanged. Class: T.
--
--   invite_code           the current code (null until one is issued; held import invitations have none;
--                         cleared again when the invitation is accepted or revoked — token_hash stays, so
--                         the link still reads "used" / "revoked", security review L3). Unique among all
--                         invitations (and, through token_hash, against every code ever issued). NOT
--                         readable by `authenticated` (no column grant): an HR Manager sees an invitation
--                         with a privileged role on the list but must not copy its code (with "Confirm
--                         email" off, the code alone creates the invitee's account), so codes are read only
--                         through the functions below, which apply the rules of managing that very
--                         invitation. token_hash stays unreadable as before.
--   private.issue_invitation_code(id)
--                         SECURITY DEFINER (owner invitation_guard), app_server with valid user claims:
--                         generates a new code in the database, replaces the old one (the old link stops
--                         working), stamps token_issued_at, counts it (send_count + 1, at most 4: the first
--                         code and 3 new ones) and gives the link 7 more days. The actor must be an active
--                         Organization Admin, or an active HR Manager for an invitation without a
--                         privileged role (private.invitation_inviter_may_grant — the rules of inviting).
--                         Called when inviting (first code) and on «إعادة الإرسال» / Resend (new code).
--                         Copying a code changes nothing.
--   private.invitation_codes(ids)
--                         SECURITY DEFINER, app_server with valid user claims: the codes of the caller's
--                         pending, unexpired, sent (not held) invitations that the caller may manage (same
--                         rule, per row). The web app reads ONE code at a time, when a member copies it
--                         (an audited action, security review M2); the list only asks whether one exists.
--   private.invitation_code_for_mail(id)
--                         SECURITY DEFINER, app_worker with system claims: the code the invitation e-mail
--                         carries (the mailer issues no token any more).
--   private.new_invitation_code()
--                         a fresh random code (gen_random_uuid's strong random bytes; 256 % 32 = 0, so each
--                         byte maps evenly). SECURITY INVOKER, reads nothing.
--   private.unused_invitation_code()
--                         SECURITY DEFINER (owner invitation_guard): a fresh code that no invitation of ANY
--                         organization holds or held (its code or token hash) — the lifecycle trigger runs
--                         as the caller, whose row-level security hides the other organizations' rows.
--                         Retries a few draws; its error never names a code (security review L9).
--   check_invitation      (replaced) a code is issued only by issue_invitation_code (current_user
--                         invitation_guard), or by the trigger itself when the worker RELEASES a held import
--                         invitation (T-M2-12: «إرسال الدعوات (N)» — the release gets the first code and its 7
--                         days). The request path (users and system jobs) never writes invite_code or
--                         token_hash directly (column grants: UPDATE (token_hash) is revoked from
--                         authenticated). Platform operations (support, tests) may still set a bare token
--                         hash, which clears the code. Accepting or revoking clears the code.
--   invitation_allows_signup / before_user_created_hook
--                         (replaced) accept a code (12 characters of the alphabet, exact case: the web app
--                         removes the grouping and upper-cases what the invitee typed) as well as the
--                         43-character tokens of links e-mailed before this migration.
--
-- Rate limits: a code is guessable in principle (60 bits), so the web app limits link lookups per client
-- address and per code, and counts unknown codes per client (IPv6 by its /48) and for all clients together,
-- failing closed (packages/platform-identity auth-limits.ts); Auth's sign-up endpoint is limited by Auth
-- itself and the hook admits a code only together with its invitation's e-mail.

grant invitation_guard to current_user;

-- ---------------------------------------------------------------------------------------------------
-- The column
-- ---------------------------------------------------------------------------------------------------
alter table platform.invitations add column invite_code text;

alter table platform.invitations
  add constraint invitations_invite_code_check check (
    invite_code is null
    or (invite_code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$'
        and token_hash = pg_catalog.sha256(pg_catalog.convert_to(invite_code, 'UTF8'))));

comment on column platform.invitations.invite_code is
  'SECURITY-RELEVANT. The invitation''s current 12-character code (Kawadir alphabet; shown XXXX-XXXX-XXXX); token_hash is its SHA-256. Cleared on acceptance and revocation (token_hash stays). Not readable by authenticated: read through private.invitation_codes / invitation_code_for_mail (FR-IAM-03, PO 16 Oct 2026; security review H1).';

create unique index invitations_invite_code_uq on platform.invitations (invite_code) where invite_code is not null;

-- The request path never writes a token hash any more (a code brings its own).
revoke update (token_hash) on platform.invitations from authenticated;

-- issue_invitation_code (invitation_guard) replaces the code of a pending invitation that was sent.
create policy invitations_guard_issue on platform.invitations for update to invitation_guard
  using (status = 'pending' and not mail_held) with check (status = 'pending' and not mail_held);
grant update (invite_code) on platform.invitations to invitation_guard;

-- The definer functions validate the caller's claims (organization, session) like every request.
grant execute on function private.current_tenant_id() to invitation_guard;

-- ---------------------------------------------------------------------------------------------------
-- A fresh code
-- ---------------------------------------------------------------------------------------------------
-- 12 symbols of ABCDEFGHJKLMNPQRSTUVWXYZ23456789 (no 0/O, 1/I), one per random byte: 60 random bits
-- (security review H1). The bytes come from gen_random_uuid() (PostgreSQL's strong random source,
-- pg_strong_random; pgcrypto is not needed): bytes 0–5 and 10–15 of a version-4 UUID carry no version or
-- variant bits. Uniqueness is the unique indexes' job (private.unused_invitation_code draws again).
create or replace function private.new_invitation_code()
returns text
language plpgsql volatile
set search_path = ''
as $$
declare
  c_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := pg_catalog.uuid_send(pg_catalog.gen_random_uuid());
  v_code text := '';
  v_i integer;
begin
  foreach v_i in array array[0, 1, 2, 3, 4, 5, 10, 11, 12, 13, 14, 15] loop
    v_code := v_code || substr(c_alphabet, (pg_catalog.get_byte(v_bytes, v_i) % 32) + 1, 1);
  end loop;
  return v_code;
end
$$;

comment on function private.new_invitation_code() is
  'SECURITY-RELEVANT (FR-IAM-03). A random 12-character invitation code (Kawadir alphabet, 60 strong random bits). Reads nothing.';

revoke all on function private.new_invitation_code() from public;
-- authenticated: the lifecycle trigger gives a released import invitation its first code (system jobs).
grant execute on function private.new_invitation_code() to authenticated, invitation_guard;

-- A fresh code no invitation of any organization holds or held (its current code, or the token hash of a
-- code it had — accepted and revoked invitations keep their hash). SECURITY DEFINER (owner invitation_guard,
-- which reads every organization's invitations): the lifecycle trigger runs as its caller, whose row-level
-- security shows one organization only. A concurrent draw of the same code is left to the unique indexes
-- (callers that can retry do). The error never names a code (security review L9).
create or replace function private.unused_invitation_code()
returns text
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  for v_try in 1 .. 5 loop
    v_code := private.new_invitation_code();
    if not exists (select 1 from platform.invitations i
                   where i.invite_code = v_code
                      or i.token_hash = pg_catalog.sha256(pg_catalog.convert_to(v_code, 'UTF8'))) then
      return v_code;
    end if;
  end loop;
  raise exception 'no unused invitation code could be drawn' using errcode = 'JI006';
end
$$;

comment on function private.unused_invitation_code() is
  'SECURITY-RELEVANT (FR-IAM-03). A random invitation code that no invitation of any organization holds or held (code or token hash). Owner invitation_guard; reveals nothing about other invitations.';

-- ---------------------------------------------------------------------------------------------------
-- Lifecycle (as in 20261016090100, plus codes — header above)
-- ---------------------------------------------------------------------------------------------------
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
$$;

comment on function private.check_invitation() is
  'SECURITY-RELEVANT (FR-IAM-03, FR-IAM-04, ADR 0003 §5). Lifecycle of platform.invitations and who may invite / revoke / schedule / release / issue a code (same rules as the role guard; imports: T-M2-12; codes: 20261018090000 — cleared on acceptance and revocation).';

-- ---------------------------------------------------------------------------------------------------
-- Issuing and reading codes (owner invitation_guard)
-- ---------------------------------------------------------------------------------------------------
-- Errors (SQLSTATE → @jadarat/platform-db DomainError):
--   42501 wrong caller (not app_server, no valid user claims) or the actor may not manage this invitation
--                                                                               → ROLE_NOT_ALLOWED
--   JI004 all 4 codes were issued (the first and 3 new ones)                    → (resend) limit_reached
--   JI005 not a pending, sent invitation of the caller's organization          → (resend) not_pending

-- The caller's verified user and organization (request claims validated by private.current_tenant_id), or
-- a refusal. Runs as invitation_guard (called only by the functions below).
create or replace function private.invitation_code_caller(out o_user uuid, out o_tenant uuid)
language plpgsql stable
set search_path = ''
as $$
declare
  v_claims jsonb := private.request_claims();
begin
  if session_user <> 'app_server' or v_claims is null or coalesce(v_claims ->> 'role', '') <> 'authenticated' then
    raise exception 'invitation codes need a signed-in member' using errcode = 'insufficient_privilege';
  end if;
  o_user := private.request_user_id();
  o_tenant := private.current_tenant_id();
  if o_user is null or o_tenant is null then
    raise exception 'invitation codes need a signed-in member of the organization' using errcode = 'insufficient_privilege';
  end if;
end
$$;

comment on function private.invitation_code_caller() is
  'SECURITY-RELEVANT (FR-IAM-03). The verified user and organization of an app_server request, or 42501. invitation_guard only.';

-- Generates and stores a new code for a pending, sent invitation of the caller's organization and returns
-- it. The old code (link) stops working; the new one is valid 7 days. At most 4 codes per invitation.
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

comment on function private.issue_invitation_code(uuid) is
  'SECURITY-RELEVANT (FR-IAM-03, PO 16 Oct 2026). Issues a new invitation code (old link stops working; 7 days; at most 4) for an actor who may manage the invitation. app_server user claims only; owner invitation_guard.';

-- The codes of the caller's organization's pending, unexpired, sent invitations that the caller may manage
-- (an Organization Admin: all; an HR Manager: those without a privileged role), optionally only `p_ids`.
-- The web app reads one code when a member copies it (audited) and otherwise only whether one exists.
create or replace function private.invitation_codes(p_ids uuid[] default null)
returns table (invitation_id uuid, invite_code text)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_tenant uuid;
begin
  select c.o_user, c.o_tenant into v_user, v_tenant from private.invitation_code_caller() c;
  return query
    select i.id, i.invite_code
    from platform.invitations i
    where i.tenant_id = v_tenant and i.status = 'pending' and not i.mail_held and i.invite_code is not null
      and i.expires_at > now()
      and (p_ids is null or i.id = any (p_ids))
      and private.invitation_inviter_may_grant(v_tenant, v_user, array[i.primary_role] || i.additional_roles)
    order by i.created_at desc, i.id;
end
$$;

comment on function private.invitation_codes(uuid[]) is
  'SECURITY-RELEVANT (FR-IAM-03). Codes of pending, unexpired invitations the signed-in caller may manage (Kawadir: copy code / copy link). app_server user claims only; owner invitation_guard.';

-- The code the invitation e-mail carries: the worker's system claims of the invitation's organization.
create or replace function private.invitation_code_for_mail(p_invitation_id uuid)
returns text
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_code text;
begin
  if session_user <> 'app_worker' or coalesce(private.request_claims() ->> 'role', '') <> 'system' then
    raise exception 'invitation_code_for_mail is for the invitation mailer (system jobs)' using errcode = 'insufficient_privilege';
  end if;
  v_tenant := private.current_tenant_id();
  if v_tenant is null then
    raise exception 'invitation_code_for_mail needs the job''s organization' using errcode = 'insufficient_privilege';
  end if;
  select i.invite_code into v_code
  from platform.invitations i
  where i.id = p_invitation_id and i.tenant_id = v_tenant and i.status = 'pending' and not i.mail_held;
  return v_code;
end
$$;

comment on function private.invitation_code_for_mail(uuid) is
  'SECURITY-RELEVANT (FR-IAM-03). The current code of a pending invitation of the job''s organization, for its e-mail. app_worker system claims only; owner invitation_guard.';

-- ---------------------------------------------------------------------------------------------------
-- Sign-up gate (as in 20261009090000, plus codes)
-- ---------------------------------------------------------------------------------------------------
create or replace function private.invitation_allows_signup(p_email text, p_token text)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v record;
begin
  -- A code (12 characters, exact case, no grouping) or a token e-mailed before codes (43 base64url
  -- characters).
  if p_email is null or p_token is null
     or p_token !~ '^([A-Za-z0-9_-]{43}|[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12})$' then
    return false;
  end if;
  select l.state, l.email into v
  from private.invitation_link(pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8'))) l;
  -- Exactly the invitation's e-mail (stored lower-case and trimmed; Auth sends it lower-cased).
  return coalesce(v.state = 'valid' and v.email = p_email, false);
end
$$;

comment on function private.invitation_allows_signup(text, text) is
  'SECURITY-RELEVANT (FR-IAM-03, review H1). Is there a valid invitation for this e-mail and raw code (or legacy token)? supabase_auth_admin (the sign-up hook) only.';

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
    -- An invitation code (12 characters, exact case, no grouping) or a token e-mailed before codes (43
    -- characters).
    if v_email = '' or v_token is null
       or v_token !~ '^([A-Za-z0-9_-]{43}|[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12})$' then
      return v_deny;
    end if;
    if private.invitation_allows_signup(v_email, v_token) is true then
      return '{}'::jsonb;
    end if;
    return v_deny;
  exception when others then
    -- Refused, never admitted. Only the SQLSTATE is logged (no e-mail, no code).
    raise warning 'before_user_created_hook: sign-up refused after an error (SQLSTATE %)', sqlstate;
    return v_deny;
  end;
end
$$;

comment on function private.before_user_created_hook(jsonb) is
  'SECURITY-RELEVANT (FR-IAM-03, review H1). Supabase Auth before-user-created hook: only e-mail sign-ups with a valid invitation code (or legacy token) for that e-mail. supabase_auth_admin only. Fail-open hook API: every path returns the refusal explicitly.';

-- ---------------------------------------------------------------------------------------------------
-- Ownership and grants (hand-over as in 20261009090000)
-- ---------------------------------------------------------------------------------------------------
grant create on schema private to invitation_guard;
alter function private.invitation_code_caller() owner to invitation_guard;
alter function private.issue_invitation_code(uuid) owner to invitation_guard;
alter function private.invitation_codes(uuid[]) owner to invitation_guard;
alter function private.invitation_code_for_mail(uuid) owner to invitation_guard;
alter function private.unused_invitation_code() owner to invitation_guard;
revoke create on schema private from invitation_guard;

revoke all on function private.invitation_code_caller() from public;
revoke all on function private.issue_invitation_code(uuid) from public;
revoke all on function private.invitation_codes(uuid[]) from public;
revoke all on function private.invitation_code_for_mail(uuid) from public;
revoke all on function private.unused_invitation_code() from public;
-- The functions check the LOGIN role (app_server / app_worker) and the claims themselves.
grant execute on function private.issue_invitation_code(uuid) to authenticated;
grant execute on function private.invitation_codes(uuid[]) to authenticated;
grant execute on function private.invitation_code_for_mail(uuid) to authenticated;
-- The lifecycle trigger (release by the worker, as authenticated) and the issuer draw unused codes.
grant execute on function private.unused_invitation_code() to authenticated, invitation_guard;
-- (The replaced sign-up gate keeps its owner, invitation_guard, and its grants: supabase_auth_admin only.)

do $$
begin
  if exists (select 1 from pg_catalog.pg_proc p
             where p.oid in ('private.issue_invitation_code(uuid)'::regprocedure, 'private.invitation_codes(uuid[])'::regprocedure,
                             'private.invitation_code_for_mail(uuid)'::regprocedure,
                             'private.unused_invitation_code()'::regprocedure,
                             'private.invitation_allows_signup(text, text)'::regprocedure)
               and pg_catalog.pg_get_userbyid(p.proowner) <> 'invitation_guard') then
    raise exception 'the invitation code functions must be owned by invitation_guard';
  end if;
  if has_column_privilege('authenticated', 'platform.invitations', 'invite_code', 'select')
     or has_column_privilege('authenticated', 'platform.invitations', 'invite_code', 'update')
     or has_column_privilege('authenticated', 'platform.invitations', 'token_hash', 'update') then
    raise exception 'authenticated must neither read nor write invitation codes or token hashes';
  end if;
end
$$;
