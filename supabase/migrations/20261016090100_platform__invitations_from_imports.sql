-- Invitations from a bulk user import (FR-IAM-04, FR-IAM-03; T-M2-12; PO decisions 9 Oct 2026):
--   * import_id   the user import that created the invitation (null: invited by hand, T-M2-07).
--   * mail_held   the invitation exists but no e-mail went out yet: the users list shows «لم تُرسل الدعوة»
--                 (invitation not sent). A held invitation has no token, so no link exists for it: the
--                 mailer never mails it, the sign-up gate never admits it, and it does not let a login
--                 that belongs nowhere sign in (private.account_sign_in_refused, below). It is RELEASED
--                 (sent) when its sending time comes; the mailer's first token then gives the link its 7
--                 days, so the 7 days start when it is sent (PO decision 6).
--   * send_at     when a held invitation may be sent, at the earliest (null: held until someone sends it).
--                 Thousands of invitations go out gradually: an import's invitations are scheduled one after
--                 the other at a fixed pace (private.schedule_held_invitations), and the worker releases
--                 those due — one at a time, platform-wide, at the pace of the send clock below, and at most
--                 a daily number per organization (private.user_import_release_next, migration
--                 20261016090200; security review M2). Overdue invitations (e.g. after the worker was down)
--                 are therefore spaced out again instead of going out in a burst.
--   * released_at when a held invitation was sent (released); stamped by the trigger. The organization's
--                 daily number of import invitations counts them.
--
-- Who may do what (private.check_invitation, replaced below; everything else as in 20261009090000 and
-- 20261010090000):
--   insert by system jobs (new): ONLY for a user import that is adding people right now (status
--          `importing`) in this organization, held, from its importer (invited_by), who must still be an
--          active Organization Admin or HR Manager — the rules of inviting one person, read again for
--          every row — and NEVER with a privileged role (PO decision 3: privileged roles are never given
--          by import, for anyone). BR-IAM-4 (Organization Admin held alone) is checked by the existing
--          trigger invitations_separation_of_duties for every writer.
--   insert by users: as before; they can neither link an invitation to an import nor hold it.
--   schedule (send_at of a held invitation): users who may manage the invitation (the rules of a resend),
--          or system jobs for an import sending its invitations (status `inviting`) whose importer may
--          still invite. System jobs may also clear the schedule (the importer may no longer invite).
--   release (mail_held → false, when due): system jobs only, while the importer (invited_by) may still
--          invite; released_at stamped. Never held again. A held invitation gets no token and no resend
--          request.
--   revoke by system jobs (new): only an import's invitation while that import is being undone (status
--          `undoing`); recorded as revoked by the member who asked for the undo.
-- The mailer (platform-identity invitation-mailer) mails a released invitation on its
-- `invitation.released` event (system actor) only while its inviter may still manage it.

alter table platform.invitations
  add column import_id uuid,
  add column mail_held boolean not null default false,
  add column send_at timestamptz,
  add column released_at timestamptz;

alter table platform.invitations
  add constraint invitations_import_fk foreign key (tenant_id, import_id) references platform.user_imports (tenant_id, id),
  -- Held: nothing was sent, so there is no token yet; only an import holds invitations.
  add constraint invitations_mail_held_check check (
    not mail_held or (token_hash is null and send_count = 0 and import_id is not null)),
  add constraint invitations_send_at_check check (send_at is null or (mail_held and status = 'pending')),
  -- Sent by the worker after being held: an import's invitation that is no longer held.
  add constraint invitations_released_check check (released_at is null or (import_id is not null and not mail_held));

comment on column platform.invitations.import_id is 'The user import that created this invitation (T-M2-12); null when invited by hand.';
comment on column platform.invitations.mail_held is
  'SECURITY-RELEVANT. Not sent yet («لم تُرسل الدعوة», T-M2-12): no token, no e-mail, no sign-in until released; the 7 days start when it is sent.';
comment on column platform.invitations.send_at is 'When a held invitation may be sent at the earliest (T-M2-12); null: held until someone sends it.';
comment on column platform.invitations.released_at is 'When a held import invitation was sent (T-M2-12): the organization''s daily number counts them.';

create index invitations_import_idx on platform.invitations (tenant_id, import_id) where import_id is not null;
-- Held invitations due for sending (the worker's claim and release).
create index invitations_send_due_idx on platform.invitations (import_id, send_at) where send_at is not null;
-- Import invitations sent today in the organization (the daily number, private.user_import_release_next).
create index invitations_released_idx on platform.invitations (tenant_id, released_at)
  where released_at is not null;

-- The importer of an import in the given status, if they may still invite people (Organization Admin or HR
-- Manager in force), or null. SECURITY INVOKER (jobs and user managers read their tenant's imports).
create or replace function private.user_import_inviter(p_tenant_id uuid, p_import_id uuid, p_status text)
returns uuid
language sql stable
set search_path = ''
as $$
  select i.created_by
  from platform.user_imports i
  where i.tenant_id = p_tenant_id and i.id = p_import_id and i.status = p_status
    and private.user_import_actor_may_import(i.tenant_id, i.created_by);
$$;

comment on function private.user_import_inviter(uuid, uuid, text) is
  'SECURITY-RELEVANT (T-M2-12). The importer of an import in the given status who may still invite, or null.';

revoke all on function private.user_import_inviter(uuid, uuid, text) from public;
grant execute on function private.user_import_inviter(uuid, uuid, text) to authenticated;

-- As in 20261009090000, plus import invitations (header above).
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
       or new.released_at is not null then
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

  -- Releasing (system jobs only): a held invitation whose time has come, while its inviter (the importer)
  -- may still invite. The mailer then gives it a token and its 7 days.
  if v_release then
    if current_user = 'authenticated' and v_kind is distinct from 'system' then
      raise exception 'held invitations are sent by the worker' using errcode = 'insufficient_privilege';
    end if;
    if current_user = 'authenticated' then
      perform private.lock_tenant_roles(new.tenant_id);
      if old.send_at is null or old.send_at > now()
         or not private.user_import_actor_may_import(old.tenant_id, old.invited_by) then
        raise exception 'only a due invitation of an importer who may still invite is sent'
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

-- System jobs create import invitations (the trigger checks the import, the importer and the roles).
create policy invitations_import_insert on platform.invitations for insert to authenticated
  with check ((select private.request_claims() ->> 'role') = 'system'
              and import_id is not null and mail_held and status = 'pending' and token_hash is null);
-- System jobs revoke the invitations of an import being undone (the trigger checks the import).
create policy invitations_import_revoke on platform.invitations for update to authenticated
  using ((select private.request_claims() ->> 'role') = 'system' and status = 'pending' and import_id is not null)
  with check ((select private.request_claims() ->> 'role') = 'system' and status = 'revoked');
-- (Scheduling and releasing stay pending → pending: the users' resend policy and the jobs' issue policy
-- of 20261009090000 cover them; the trigger decides who may.)

grant select (import_id, mail_held, send_at, released_at) on platform.invitations to authenticated;
-- (invited_by stays out of the grant: the trigger stamps the importer — for users, themselves.)
grant insert (import_id, mail_held) on platform.invitations to authenticated;
-- send_at: schedule a held invitation (users: «إرسال الدعوة»; jobs: the import's sending phase);
-- mail_held: release a due one (jobs only, by the trigger).
grant update (send_at, mail_held) on platform.invitations to authenticated;

-- Schedules held invitations one after the other, `p_interval` apart, after the organization's last
-- scheduled one (so that two imports, or an import and a manual «إرسال الدعوات», do not send at once).
-- Only pending, held, unscheduled invitations among `p_ids`; returns how many were scheduled. Runs as the
-- caller (users or system jobs); the trigger decides who may schedule which invitation.
create or replace function private.schedule_held_invitations(p_ids uuid[], p_interval interval)
returns integer
language plpgsql volatile
set search_path = ''
as $$
declare
  v_tenant uuid := private.current_tenant_id();
  v_base timestamptz;
  v_count integer;
begin
  if v_tenant is null then
    raise exception 'no organization' using errcode = 'insufficient_privilege';
  end if;
  if p_interval is null or p_interval < interval '0 seconds' or p_interval > interval '1 minute' then
    raise exception 'invalid sending pace' using errcode = 'invalid_parameter_value';
  end if;
  perform private.lock_tenant_roles(v_tenant);
  select greatest(now(), coalesce(max(i.send_at), now())) into v_base
  from platform.invitations i
  where i.tenant_id = v_tenant and i.mail_held and i.send_at is not null and i.status = 'pending';
  with due as (
    select i.id, row_number() over (order by i.created_at, i.id) as n
    from platform.invitations i
    where i.tenant_id = v_tenant and i.id = any (p_ids) and i.mail_held and i.send_at is null
      and i.status = 'pending')
  update platform.invitations i
  set send_at = v_base + (d.n - 1) * p_interval
  from due d
  where i.id = d.id;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

comment on function private.schedule_held_invitations(uuid[], interval) is
  'Schedules held invitations (T-M2-12) one after the other at the given pace, after the organization''s last scheduled one. The invitation trigger checks who may.';

revoke all on function private.schedule_held_invitations(uuid[], interval) from public;
grant execute on function private.schedule_held_invitations(uuid[], interval) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- The send clock (security review M2): import invitations go out one at a time, platform-wide
-- ---------------------------------------------------------------------------------------------------
-- The e-mail provider limits the sending rate of the whole platform (docs/engineering/email.md), and the
-- imports of every organization share it. One row: the earliest time the next import invitation may be
-- released. private.take_invitation_send_slot takes the slot when it has come (and moves the clock on by
-- the pace) or says when it comes; the row lock serialises the workers of every organization, and a
-- release that rolls back gives its slot back. No burst: invitations due long ago go out at the pace too.
-- Nothing of a tenant is stored here.
create table private.invitation_send_clock (
  id boolean primary key default true,
  next_slot timestamptz not null default now(),
  constraint invitation_send_clock_one_row_check check (id)
);
comment on table private.invitation_send_clock is
  'SECURITY-RELEVANT (T-M2-12, security review M2). The platform-wide pace of import invitations: when the next one may be sent. One row; only user_import_guard''s slot function reaches it.';
insert into private.invitation_send_clock (id, next_slot) values (true, now());

alter table private.invitation_send_clock enable row level security;
alter table private.invitation_send_clock force row level security;
create policy invitation_send_clock_guard on private.invitation_send_clock for all to user_import_guard
  using (true) with check (true);
revoke all on private.invitation_send_clock from public;
grant select (id, next_slot), update (next_slot) on private.invitation_send_clock to user_import_guard;

-- Takes the next send slot: null when it was taken (the caller releases ONE invitation in this
-- transaction), or the time the next slot comes (the caller waits; nothing changed). `p_interval`: the
-- pace (0.1 to 60 seconds; the worker's setting). Worker system claims only (app_worker); a job of any
-- organization takes from the same clock.
grant user_import_guard to current_user;
create or replace function private.take_invitation_send_slot(p_interval interval)
returns timestamptz
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_next timestamptz;
begin
  perform private.user_import_worker_check();
  if p_interval is null or p_interval < interval '100 milliseconds' or p_interval > interval '1 minute' then
    raise exception 'invalid sending pace' using errcode = 'invalid_parameter_value';
  end if;
  select c.next_slot into v_next from private.invitation_send_clock c where c.id for update;
  if not found then
    raise exception 'the send clock is missing' using errcode = 'no_data_found';
  end if;
  if v_next > clock_timestamp() then
    return v_next;
  end if;
  update private.invitation_send_clock c set next_slot = clock_timestamp() + p_interval where c.id;
  return null;
end
$$;

comment on function private.take_invitation_send_slot(interval) is
  'SECURITY-RELEVANT (T-M2-12, security review M2). Worker: takes the platform-wide slot to send one import invitation now (null), or returns when the next slot comes. app_worker system claims only; owner user_import_guard.';

grant create on schema private to user_import_guard;
alter function private.take_invitation_send_slot(interval) owner to user_import_guard;
revoke create on schema private from user_import_guard;
revoke all on function private.take_invitation_send_slot(interval) from public;
-- The function checks the LOGIN role (app_worker) and the system claims itself.
grant execute on function private.take_invitation_send_slot(interval) to authenticated;

do $$
begin
  if pg_catalog.pg_get_userbyid((select p.proowner from pg_catalog.pg_proc p
       where p.oid = 'private.take_invitation_send_slot(interval)'::regprocedure)) <> 'user_import_guard' then
    raise exception 'private.take_invitation_send_slot must stay owned by user_import_guard';
  end if;
end
$$;

-- ---------------------------------------------------------------------------------------------------
-- Sign-in rule (T-M2-09): a held invitation is not an invitation to accept yet
-- ---------------------------------------------------------------------------------------------------
-- As in 20261011090100, except that held invitations (not sent: no link) do not let a login that belongs
-- nowhere sign in — only an invitation that was sent does ("sign in to accept", T-M2-07).
grant membership_guard to current_user;
grant select (mail_held) on platform.invitations to membership_guard;

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
            where a.id = p_user_id and i.status = 'pending' and not i.mail_held and i.expires_at > now()
              and t.status in ('active', 'trial')));
$$;

do $$
begin
  if pg_catalog.pg_get_userbyid((select p.proowner from pg_catalog.pg_proc p
       where p.oid = 'private.account_sign_in_refused(uuid)'::regprocedure)) <> 'membership_guard' then
    raise exception 'private.account_sign_in_refused must stay owned by membership_guard';
  end if;
end
$$;

-- ---------------------------------------------------------------------------------------------------
-- The worker's claim: imports with invitations due for sending
-- ---------------------------------------------------------------------------------------------------
create policy invitations_user_import_guard_read on platform.invitations for select to user_import_guard
  using (true);
grant select (tenant_id, import_id, status, mail_held, send_at) on platform.invitations to user_import_guard;

-- As in 20261016090000, plus `send`: held invitations of the import whose sending time has come (and that
-- are not being undone) — also after the import's data was deleted: people kept «لم تُرسل الدعوة» can be
-- sent their invitation from the users list at any time.
create or replace function private.user_import_step(p_tenant_id uuid, p_import_id uuid, p_status text,
                                                   p_review_expires_at timestamptz, p_finished_at timestamptz,
                                                   p_undone_at timestamptz, p_confirmed_at timestamptz,
                                                   p_data_purged_at timestamptz, p_file_status text,
                                                   p_upload_due_at timestamptz)
returns text
language sql stable
set search_path = ''
as $$
  select case
    when p_data_purged_at is not null then
      case when exists (select 1 from platform.invitations v
                        where v.tenant_id = p_tenant_id and v.import_id = p_import_id and v.mail_held
                          and v.status = 'pending' and v.send_at <= now()) then 'send' end
    when p_status = any (private.user_import_draft_statuses()) and p_review_expires_at <= now()
      then 'expire'
    when private.user_import_upload_abandoned(p_status, p_upload_due_at) then 'expire'
    when p_status = 'uploaded'
         and p_file_status in ('clean', 'infected', 'rejected', 'error', 'deleted') then 'read'
    when p_status = 'validating' then 'validate'
    when p_status in ('queued', 'checking', 'importing', 'inviting') then 'run'
    when p_status = 'undoing' then 'undo'
    when exists (select 1 from platform.invitations v
                 where v.tenant_id = p_tenant_id and v.import_id = p_import_id and v.mail_held
                   and v.status = 'pending' and v.send_at <= now()) then 'send'
    when p_status in ('rejected', 'cancelled', 'expired')
         or (p_status = 'failed' and p_confirmed_at is null) then 'purge'
    when p_status in ('finished', 'stopped', 'failed', 'undone')
         and greatest(p_finished_at, p_undone_at) <= now() - interval '7 days' then 'purge'
  end;
$$;

-- As in 20261016090000, but the imports with work also include those whose held invitations are due —
-- also after their data was deleted (the step above). Scheduled invitations are few at any time (their
-- partial index), so the candidates stay cheap to find.
grant user_import_guard to current_user;
create or replace function private.claim_user_import_work()
returns table (tenant_id uuid, import_id uuid, step text, lease_token uuid)
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_step text;
  v_token uuid := gen_random_uuid();
begin
  perform private.user_import_worker_check();
  with candidates as (
    select i.id from platform.user_imports i where i.data_purged_at is null
    union
    select v.import_id from platform.invitations v where v.send_at <= now() and v.import_id is not null)
  select i.id, private.user_import_step(i.tenant_id, i.id, i.status, i.review_expires_at, i.finished_at, i.undone_at,
                                        i.confirmed_at, i.data_purged_at, f.status, i.upload_due_at)
    into v_id, v_step
  from platform.user_imports i
  join candidates c on c.id = i.id
  join platform.tenants t on t.id = i.tenant_id and t.status in ('active', 'trial')
  left join platform.files f on f.tenant_id = i.tenant_id and f.id = i.file_id
  where i.next_attempt_at <= now()
    and (i.lease_until is null or i.lease_until <= now())
    and private.user_import_step(i.tenant_id, i.id, i.status, i.review_expires_at, i.finished_at, i.undone_at,
                                 i.confirmed_at, i.data_purged_at, f.status, i.upload_due_at) is not null
  order by i.next_attempt_at, i.updated_at, i.id
  limit 1
  for update of i skip locked;
  if v_id is null then
    return;
  end if;
  update platform.user_imports i
  set lease_until = now() + interval '15 minutes', lease_token = v_token
  where i.id = v_id;
  return query select i.tenant_id, i.id, v_step, v_token from platform.user_imports i where i.id = v_id;
end
$$;

do $$
begin
  if pg_catalog.pg_get_userbyid((select p.proowner from pg_catalog.pg_proc p
       where p.oid = 'private.claim_user_import_work()'::regprocedure)) <> 'user_import_guard' then
    raise exception 'private.claim_user_import_work must stay owned by user_import_guard';
  end if;
end
$$;
