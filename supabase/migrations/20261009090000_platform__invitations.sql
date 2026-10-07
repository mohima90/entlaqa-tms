-- Invitations (FR-IAM-03, T-M2-07; docs/engineering/invitations-contract.md §2). An Organization Admin or
-- HR Manager invites a person by e-mail; a background job mails a single-use link (only the SHA-256 of
-- its token is stored); the invitee opens the link (public page), signs up through the public Auth API
-- with the raw token in the sign-up metadata — admitted only by the before-user-created hook below —
-- and accepts it with the new session, which creates their ACTIVE membership and roles. The web app
-- holds no Auth secret key (ADR 0002 §7 note T-M2-07, security review H1). Class: T. PII: e-mail
-- (= the person's e-mail).
--
--   platform.invitations    tenant table (RLS forced, restrictive tenant_isolation). User managers create
--                           pending rows and revoke them; jobs (system claims) issue tokens; nobody reads
--                           token_hash on the request path (column grants) and nobody deletes.
--   invitation_guard        NOLOGIN owner of the link and acceptance functions below. No BYPASSRLS: it
--                           reaches exactly what they need through explicit grants and policies
--                           `to invitation_guard` (same pattern as tenant_guard, migration 20260930120100).
--   private.auth_user_email security-barrier view of auth.users (id, email, created_at) for invitation_guard
--                           only (same pattern as private.auth_session_validity).
--   private.invitation_by_token / accept_invitation_as_caller
--                           SECURITY DEFINER, owned by invitation_guard; app_server connections only.
--                           A link is usable only while its inviter still may give its roles (an ACTIVE
--                           Organization Admin, or HR Manager for ordinary roles): revoking, suspending or
--                           demoting the inviter stops their pending invitations (security review M1).
--   private.before_user_created_hook / invitation_allows_signup
--                           Supabase Auth "before user created" hook (supabase_auth_admin only): every
--                           new Auth user — whatever the endpoint — is refused unless it is an e-mail
--                           sign-up carrying a valid invitation token for that very e-mail.
--   private.refuse_auth_email_change (trigger on auth.users)
--                           An account's e-mail never changes through Auth (self-service PUT /user, its
--                           confirmation links, the admin API): the e-mail is the organization's (HR)
--                           record, and sign-ups are open (re-review N1).
--
-- Tenant and actor of the rows written on acceptance: there are no tenant claims (the invitee is not a
-- member yet), so the acceptance code writes tenant_id and the audit actor (the new member) EXPLICITLY,
-- taken from the invitation row it locked — never from the caller. It runs with request.jwt.claims
-- cleared (and put back on success): the [std] stamps (created_by/updated_by) then record a
-- platform operation instead of whatever person the caller's claims of ANOTHER organization carry, and
-- the outbox trigger records the new member as the event's actor (private.stamp_event_actor, below).

-- ---------------------------------------------------------------------------------------------------
-- Role invitation_guard (attribute policy as in 20260930120000)
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'invitation_guard') then
    create role invitation_guard nologin noinherit nobypassrls;
  end if;
end
$$;

do $$
declare
  r record;
begin
  select rolname, rolcanlogin, rolinherit, rolsuper, rolbypassrls, rolreplication, rolcreatedb, rolcreaterole
    into r from pg_roles where rolname = 'invitation_guard';
  if r.rolsuper or r.rolbypassrls or r.rolreplication then
    raise exception 'role invitation_guard must be NOSUPERUSER NOBYPASSRLS NOREPLICATION; fix it as a superuser first';
  end if;
  if r.rolinherit or r.rolcreatedb or r.rolcreaterole or r.rolcanlogin then
    alter role invitation_guard nologin noinherit nocreatedb nocreaterole;
  end if;
  if exists (select 1 from pg_auth_members m join pg_roles g on g.oid = m.roleid join pg_roles u on u.oid = m.member
             where g.rolname = 'invitation_guard' and (m.inherit_option or m.set_option)
               and not u.rolsuper and u.rolname <> current_user) then
    raise exception 'role invitation_guard must have no members besides the migration role';
  end if;
end
$$;

-- The migration role must be able to hand function ownership to invitation_guard.
grant invitation_guard to current_user;
grant usage on schema platform, private to invitation_guard;

-- ---------------------------------------------------------------------------------------------------
-- platform.invitations
-- ---------------------------------------------------------------------------------------------------
create table platform.invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default private.current_tenant_id() references platform.tenants (id),
  person_id uuid not null,
  email text not null,
  locale text not null,
  primary_role text not null references platform.ref_roles (code),
  additional_roles text[] not null default '{}',
  status text not null default 'pending',
  -- SHA-256 of the current token (the raw token exists only in the e-mail); null until the first e-mail.
  token_hash bytea,
  token_issued_at timestamptz,
  expires_at timestamptz not null default now() + interval '7 days',
  send_count smallint not null default 0,
  -- Last request for a new e-mail (resend) and who asked: stamped by the trigger, actor-checked like a
  -- revocation; the mailer acts on the resend event only while that member still may manage it (M2).
  resend_requested_at timestamptz,
  resend_requested_by uuid,
  -- Auth user id of the inviter (from the verified claims). No FK: the record outlives the account.
  invited_by uuid not null,
  accepted_at timestamptz,
  accepted_user_id uuid,
  revoked_at timestamptz,
  revoked_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, person_id) references platform.persons (tenant_id, id),
  constraint invitations_email_check
    check (email = lower(btrim(email)) and char_length(email) between 3 and 320 and email ~ '^[^@\s]+@[^@\s]+$'),
  constraint invitations_locale_check check (locale in ('ar', 'en')),
  constraint invitations_additional_roles_check check (
    cardinality(additional_roles) <= 20
    and (cardinality(additional_roles) = 0 or array_ndims(additional_roles) = 1)
    and array_position(additional_roles, null) is null
    and not (primary_role = any (additional_roles))),
  constraint invitations_status_check check (status in ('pending', 'accepted', 'revoked')),
  constraint invitations_token_check check (
    (token_hash is null) = (token_issued_at is null)
    and (token_hash is null or octet_length(token_hash) = 32)
    and (token_hash is null) = (send_count = 0)),
  constraint invitations_send_count_check check (send_count between 0 and 4),
  constraint invitations_lifecycle_check check (
    (status = 'pending' and accepted_at is null and accepted_user_id is null and revoked_at is null and revoked_by is null)
    or (status = 'accepted' and accepted_at is not null and accepted_user_id is not null and token_hash is not null
        and revoked_at is null and revoked_by is null)
    or (status = 'revoked' and revoked_at is not null and accepted_at is null and accepted_user_id is null))
);
comment on table platform.invitations is
  'Invitations to join an organization (FR-IAM-03). Owner: platform. Class: T. Single-use links: SHA-256 of the token only.';
comment on column platform.invitations.email is 'pii:direct. The invitee''s login e-mail (= persons.email, lowercase).';
comment on column platform.invitations.token_hash is
  'SECURITY-RELEVANT. SHA-256 of the current invitation token. Never readable on the request path (column grants).';

create unique index invitations_token_hash_uq on platform.invitations (token_hash) where token_hash is not null;
-- One open invitation per person and per e-mail address in an organization.
create unique index invitations_pending_person_uq on platform.invitations (tenant_id, person_id) where status = 'pending';
create unique index invitations_pending_email_uq on platform.invitations (tenant_id, email) where status = 'pending';
create index invitations_tenant_created_idx on platform.invitations (tenant_id, created_at desc);

-- Lifecycle and who may do what (SECURITY INVOKER; runs as the writing role):
--   insert   pending, no token, no outcome; roles exist, do not repeat; the person is active, has this
--            e-mail and no membership yet. Request path (user claims): the inviter is stamped from the
--            claims and must be an active Organization Admin or HR Manager; a privileged role (primary or
--            additional) only by an Organization Admin — same rules as private.check_role_assignment_actor.
--            System jobs never invite (policy). The link is valid for 7 days from creation.
--   update   what the invitation is for never changes; accepted / revoked are final;
--            pending → pending: a new token (send_count + 1, issued now, valid 7 more days) — on the
--            request path by system jobs (the mailer) only; or a resend request (resend_requested_at,
--            stamped) by a user manager (privileged roles: Organization Admin) while fewer than 4
--            e-mails went out — never both at once;
--            pending → revoked: by a user manager (privileged roles: Organization Admin) — stamped;
--            pending → accepted: never on the request path — only the reviewed acceptance functions
--            (invitation_guard) or platform operations, before the link expires.
-- Platform operations (migrations, provisioning, tests) are not subject to the actor rules but follow the
-- lifecycle; they may also set expires_at (support: end or extend a link).
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

revoke all on function private.check_invitation() from public;

create trigger invitations_check before insert or update on platform.invitations
  for each row execute function private.check_invitation();

alter table platform.invitations enable row level security;
alter table platform.invitations force row level security;

create policy tenant_isolation on platform.invitations
  as restrictive for all to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
-- Read: user managers (Organization Admin, HR Manager — the platform.user.invite holders) and jobs.
create policy invitations_read on platform.invitations for select to authenticated
  using ((select private.request_claims() ->> 'role') = 'system'
         or (select private.actor_manages_users((select private.current_tenant_id()))));
-- Create: user claims only (the trigger checks the actor's roles).
create policy invitations_insert on platform.invitations for insert to authenticated
  with check ((select private.request_claims() ->> 'role') = 'authenticated'
              and (select private.actor_manages_users((select private.current_tenant_id())))
              and status = 'pending' and token_hash is null);
-- Revoke: user claims, pending → revoked only.
create policy invitations_revoke on platform.invitations for update to authenticated
  using ((select private.request_claims() ->> 'role') = 'authenticated'
         and (select private.actor_manages_users((select private.current_tenant_id())))
         and status = 'pending')
  with check ((select private.request_claims() ->> 'role') = 'authenticated' and status = 'revoked');
-- Resend request: user claims, pending stays pending (the trigger lets users change only
-- resend_requested_at, checks the actor like a revocation, and takes a new token from system jobs only).
create policy invitations_resend on platform.invitations for update to authenticated
  using ((select private.request_claims() ->> 'role') = 'authenticated'
         and (select private.actor_manages_users((select private.current_tenant_id())))
         and status = 'pending')
  with check ((select private.request_claims() ->> 'role') = 'authenticated' and status = 'pending');
-- Issue a token: system claims, pending rows only (the trigger allows nothing else for them).
create policy invitations_jobs_issue on platform.invitations for update to authenticated
  using ((select private.request_claims() ->> 'role') = 'system' and status = 'pending')
  with check ((select private.request_claims() ->> 'role') = 'system' and status = 'pending');

revoke all on platform.invitations from public, anon;
-- Every column except token_hash: the request path can never read a token hash (or match one).
grant select (id, tenant_id, person_id, email, locale, primary_role, additional_roles, status, token_issued_at,
              expires_at, send_count, resend_requested_at, resend_requested_by, invited_by, accepted_at,
              accepted_user_id, revoked_at, revoked_by, created_at, updated_at)
  on platform.invitations to authenticated;
grant insert (tenant_id, person_id, email, locale, primary_role, additional_roles) on platform.invitations to authenticated;
-- status: revoke (users); resend_requested_at: ask for a new e-mail (users); token_hash: a new token
-- (jobs). Everything else is stamped by the trigger.
grant update (status, resend_requested_at, token_hash) on platform.invitations to authenticated;

-- Acceptance (invitation_guard): reads invitations, marks a pending one accepted.
create policy invitations_guard_read on platform.invitations for select to invitation_guard using (true);
create policy invitations_guard_accept on platform.invitations for update to invitation_guard
  using (status = 'pending') with check (status = 'accepted');
grant select on platform.invitations to invitation_guard;
grant update (status, accepted_user_id) on platform.invitations to invitation_guard;

-- ---------------------------------------------------------------------------------------------------
-- What acceptance may reach in the other tables (explicit grants + policies `to invitation_guard`)
-- ---------------------------------------------------------------------------------------------------
create policy tenants_invitation_guard_read on platform.tenants for select to invitation_guard using (true);
grant select (id, status, name_ar, name_en) on platform.tenants to invitation_guard;

-- The invitee's person: read (state of the link), display names (chosen on the acceptance page).
create policy persons_invitation_guard_read on platform.persons for select to invitation_guard using (true);
create policy persons_invitation_guard_names on platform.persons for update to invitation_guard
  using (true) with check (true);
grant select (id, tenant_id, email, status, display_name_ar, display_name_en) on platform.persons to invitation_guard;
grant update (display_name_ar, display_name_en) on platform.persons to invitation_guard;

-- The ACTIVE membership created on acceptance (request-path code can only create invited ones).
create policy tenant_memberships_invitation_guard_read on platform.tenant_memberships for select to invitation_guard
  using (true);
create policy tenant_memberships_invitation_guard_insert on platform.tenant_memberships for insert to invitation_guard
  with check (status = 'active');
grant select (id, tenant_id, user_id, person_id, status) on platform.tenant_memberships to invitation_guard;
grant insert (tenant_id, user_id, person_id, status) on platform.tenant_memberships to invitation_guard;

-- The roles named in the invitation; and the inviter's current roles (may they still give them? M1).
create policy role_assignments_invitation_guard_insert on platform.role_assignments for insert to invitation_guard
  with check (true);
grant insert (tenant_id, membership_id, role_code, is_primary) on platform.role_assignments to invitation_guard;
create policy role_assignments_invitation_guard_read on platform.role_assignments for select to invitation_guard
  using (true);
grant select (tenant_id, membership_id, role_code, valid_from, valid_until) on platform.role_assignments
  to invitation_guard;
create policy ref_roles_invitation_guard_read on platform.ref_roles for select to invitation_guard using (true);
grant select (code, is_privileged) on platform.ref_roles to invitation_guard;

-- Its audit record and domain event, nothing else.
create policy audit_events_invitation_guard_insert on platform.audit_events for insert to invitation_guard
  with check (action = 'platform.invitation.accepted' and actor_user_id is not null and impersonator_user_id is null);
grant insert (tenant_id, actor_user_id, actor_person_id, action, entity_type, entity_id, data)
  on platform.audit_events to invitation_guard;

create policy event_outbox_invitation_guard_insert on platform.event_outbox for insert to invitation_guard
  with check (type = 'com.entlaqa.platform.invitation.accepted');
grant insert (id, tenant_id, type, subject, data, actor_id) on platform.event_outbox to invitation_guard;

-- Helpers the touched tables' triggers, checks and the functions below call.
grant execute on function private.try_uuid(text) to invitation_guard;
grant execute on function private.request_claims() to invitation_guard;
grant execute on function private.request_user_id() to invitation_guard;
grant execute on function private.request_person_id() to invitation_guard;
grant execute on function private.lock_tenant_roles(uuid) to invitation_guard;
grant execute on function private.has_visible_text(text) to invitation_guard;
grant execute on function private.user_session_is_valid(uuid, uuid) to invitation_guard;

-- Outbox actor: rows written by the acceptance functions (current_user = invitation_guard) carry the new
-- member as actor, which that reviewed code sets explicitly (there are no user claims to take it from).
-- Everything else as in 20261007090000.
create or replace function private.stamp_event_actor()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_kind text := private.request_claims() ->> 'role';
  v_guard_actor uuid := new.actor_id;
begin
  new.created_at := now();
  new.dispatched_at := null;
  new.actor_id := null;
  new.actor_job := null;
  if current_user = 'invitation_guard' then
    new.actor_type := 'user';  -- invitation acceptance: the new member (set by the acceptance code)
    new.actor_id := v_guard_actor;
  elsif current_user <> 'authenticated' then
    new.actor_type := 'platform';  -- migrations, provisioning: no user claims
  elsif v_kind = 'system' then
    new.actor_type := 'system';
    new.actor_job := left(private.request_claims() ->> 'job_id', 200);
  else
    new.actor_type := 'user';
    new.actor_id := private.request_user_id();
  end if;
  return new;
end
$$;
revoke all on function private.stamp_event_actor() from public;

-- ---------------------------------------------------------------------------------------------------
-- Auth users for invitation_guard (pattern of private.auth_session_validity, ADR 0002 §6a rev. 2): the
-- e-mail of the accepting account (accept_invitation_as_caller compares it with the invitation's).
-- ---------------------------------------------------------------------------------------------------
create or replace view private.auth_user_email
with (security_barrier = true)  -- defensive only: the view has no WHERE clause
as select u.id, u.email from auth.users u;

comment on view private.auth_user_email is
  'SECURITY-RELEVANT (FR-IAM-03): auth.users (id, email) for invitation_guard only. Owned by the migration role.';

revoke all on private.auth_user_email from public;
grant select on private.auth_user_email to invitation_guard;

do $$
declare
  v_owner name := (select pg_get_userbyid(relowner) from pg_class where oid = 'private.auth_user_email'::regclass);
begin
  if not (has_schema_privilege(v_owner, 'auth', 'usage')
          and has_column_privilege(v_owner, 'auth.users', 'id', 'select')
          and has_column_privilege(v_owner, 'auth.users', 'email', 'select')) then
    raise exception 'role % (owner of private.auth_user_email) cannot read auth.users (id, email)', v_owner;
  end if;
  if not has_table_privilege('invitation_guard', 'private.auth_user_email', 'select') then
    raise exception 'invitation_guard cannot read private.auth_user_email';
  end if;
end
$$;

-- ---------------------------------------------------------------------------------------------------
-- Link and acceptance functions (owner invitation_guard)
-- ---------------------------------------------------------------------------------------------------
-- Errors (SQLSTATE → @jadarat/platform-db DomainError):
--   JI001 the invitation is not valid (unknown, used, revoked, expired; organization not active; the
--         person was deactivated, changed e-mail or got a membership since; the inviter no longer may
--         give its roles)                                                   → INVITATION_NOT_VALID
--   JI002 the caller is already a member of the organization                 → ALREADY_MEMBER
--   JI003 the account does not match the invitation (its Auth e-mail is another)
--                                                                            → INVITATION_ACCOUNT_MISMATCH
--   42501 wrong caller (not an app_server connection, or no signed-in user with a valid session)

-- May the inviter still give these roles (security review M1)? An ACTIVE member of the tenant who is an
-- Organization Admin, or an HR Manager when none of the roles is privileged — the rules of inviting,
-- applied again whenever the link is used: revoking, suspending or demoting the inviter stops their
-- pending invitations. Runs as invitation_guard (called only by the functions below).
create or replace function private.invitation_inviter_may_grant(p_tenant_id uuid, p_invited_by uuid, p_roles text[])
returns boolean
language sql stable
set search_path = ''
as $$
  with inviter as (
    select coalesce(array_agg(ra.role_code), '{}') as codes
    from platform.role_assignments ra
    join platform.tenant_memberships m on m.tenant_id = ra.tenant_id and m.id = ra.membership_id
    where ra.tenant_id = p_tenant_id and m.user_id = p_invited_by and m.status = 'active'
      and (ra.valid_from is null or ra.valid_from <= now())
      and (ra.valid_until is null or ra.valid_until > now()))
  select 'tenant_admin' = any (i.codes)
         or ('hr_manager' = any (i.codes)
             and not exists (select 1 from platform.ref_roles r where r.code = any (p_roles) and r.is_privileged))
  from inviter i;
$$;

comment on function private.invitation_inviter_may_grant(uuid, uuid, text[]) is
  'SECURITY-RELEVANT (FR-IAM-03, review M1). Does the inviter still hold the authority to give these roles? invitation_guard only.';

-- State of a link, with what screen 8 shows for a valid one. The ONE definition of "valid" — the link
-- page (invitation_by_token) and the sign-up gate (invitation_allows_signup) both read it. Runs as
-- invitation_guard (called only by those definer functions: nobody else may execute it).
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

comment on function private.invitation_link(bytea) is
  'SECURITY-RELEVANT (FR-IAM-03). State of an invitation link by token hash (valid|expired|revoked|used|invalid); details for a valid one only. invitation_guard only.';

-- State of a link (screens 8, 9) for the public page. Details only for a valid link; never ids.
create or replace function private.invitation_by_token(p_token_hash bytea)
returns table (state text, tenant_name_ar text, tenant_name_en text, email text, display_name_ar text,
               display_name_en text, locale text)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if session_user <> 'app_server' then
    return;
  end if;
  return query select * from private.invitation_link(p_token_hash);
end
$$;

comment on function private.invitation_by_token(bytea) is
  'SECURITY-RELEVANT (FR-IAM-03). State of an invitation link by token hash (valid|expired|revoked|used|invalid); details for a valid one only. app_server only.';

-- The effects of an acceptance. Runs as invitation_guard (called only from accept_invitation_as_caller:
-- nobody else may execute it) with request.jwt.claims cleared for its duration: cleared on entry, put back
-- before the successful return. (A function-level `SET request.jwt.claims` would do the same, but a
-- non-superuser — hosted Supabase's migration role — may not attach a custom setting to a function.) Any
-- error aborts the (sub)transaction, which also reverts the setting.
-- Locks the invitation by turning it accepted first (single use: a concurrent second acceptance waits,
-- then finds it no longer pending); any later refusal rolls everything back. The invitation is checked
-- again here in full: the sign-up gate (before_user_created_hook) ran in Auth's own transaction, before
-- the account existed, and anything may have changed since.
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

comment on function private.apply_invitation_acceptance(bytea, uuid, text, text) is
  'SECURITY-RELEVANT (FR-IAM-03). Effects of accepting an invitation; executable by invitation_guard only (called by accept_invitation_as_caller).';

-- The signed-in caller accepts (their Auth e-mail must be the invitation's): the account just created
-- through the hook-gated sign-up — which may set the display names chosen on the page — or an existing
-- account after "sign in to accept". There is no other way to accept.
create or replace function private.accept_invitation_as_caller(
  p_token_hash bytea, p_display_name_ar text default null, p_display_name_en text default null)
returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_claims jsonb := private.request_claims();
  v_user uuid;
begin
  if session_user <> 'app_server' or v_claims is null or coalesce(v_claims ->> 'role', '') <> 'authenticated' then
    raise exception 'accept_invitation_as_caller needs a signed-in user' using errcode = 'insufficient_privilege';
  end if;
  v_user := private.try_uuid(v_claims ->> 'sub');
  if not private.user_session_is_valid(v_user, private.try_uuid(v_claims ->> 'session_id')) then
    raise exception 'accept_invitation_as_caller needs a valid session' using errcode = 'insufficient_privilege';
  end if;
  return private.apply_invitation_acceptance(p_token_hash, v_user, p_display_name_ar, p_display_name_en);
end
$$;

comment on function private.accept_invitation_as_caller(bytea, text, text) is
  'SECURITY-RELEVANT (FR-IAM-03). Accepts an invitation as the signed-in caller (valid session; Auth e-mail = invitation e-mail; not yet a member). app_server only.';

-- ---------------------------------------------------------------------------------------------------
-- Sign-up gate: Supabase Auth "before user created" hook (security review H1)
-- ---------------------------------------------------------------------------------------------------
-- Sign-ups are open in Auth (the public /signup endpoint, publishable key) so that an invitee can create
-- their own account; this hook admits ONLY an e-mail sign-up that carries, in its user metadata, the raw
-- token of a VALID invitation (private.invitation_link) for that same e-mail. Everything else is refused:
-- anonymous, phone, OAuth/SSO, magic-link or invite sign-ups without such a token, a malformed token, an
-- e-mail other than the invitation's. Configure: supabase/config.toml [auth.hook.before_user_created];
-- self-hosted GOTRUE_HOOK_BEFORE_USER_CREATED_*; hosted: Authentication → Hooks (db-deploy.md).
--
-- Facts the design rests on (spike on GoTrue v2.197.0, 7 Oct 2026):
--   * Auth runs the hook as supabase_auth_admin in its own transaction, BEFORE inserting the user, and
--     commits that transaction even when the hook refuses: the hook must have no side effects.
--   * FAIL-OPEN: a NULL result, '{}' or an error object without a message ADMITS the user. So every path
--     below returns the explicit refusal unless the one allowed shape matched; errors are caught and
--     refused (a raised error would also reach the client as a 500 with the PostgreSQL message).
--   * user_metadata is chosen by the caller (sign-up `data`), app_metadata is not; the e-mail arrives
--     lower-cased (GoTrue validateEmail) and is compared EXACTLY as sent (not trimmed or lower-cased
--     again: the account gets that very address, so it must be the invitation's — re-review N5).
--     The payload does not say which endpoint created the user (/signup and /otp look the same).
--     The metadata is copied to auth.users, the identity and every access token: the client
--     sends the RAW token (never a stored hash, so nothing in Auth can be replayed against the database)
--     and the web app removes it after acceptance.
--   * Admin user creation (POST /admin/users: operator provisioning, create-user.mjs) does not run the
--     hook. With sign-ups disabled Auth refuses /signup before the hook runs.
--   * The check is not atomic with the user insert: accept_invitation_as_caller checks everything again.
--   * The hook runs only for a NEW user. With "Confirm email" off, /otp and magic links create the user
--     confirmed (random password), so /signup for that e-mail answers user_already_exists. But /signup
--     for an EXISTING UNCONFIRMED user confirms it and returns a session without any password and
--     without the hook (re-review N3, spike): no unconfirmed e-mail user may exist while sign-ups are
--     open (db-deploy.md § Auth sign-up gate; operators create users confirmed).
--   * Timeouts: Auth runs `set local statement_timeout = 2000` (ms) before calling the hook (GoTrue
--     hookspgfunc); a cancellation is not caught below (WHEN OTHERS does not catch query_canceled), so
--     Auth answers 500 and creates no user. The function sets lock_timeout only: a function-level
--     statement_timeout would not bound the statement already running (re-review N5, checked on
--     PostgreSQL: SET statement_timeout = 1s on a function, pg_sleep(2.5) inside it ran 2.5 s).

-- Does a valid invitation exist for this e-mail and this raw token? Answers yes or no only (never ids or
-- hashes). Hashes the token itself (sha256 of its UTF-8 bytes, as hashInvitationToken does).
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

-- The hook. SECURITY INVOKER (runs as supabase_auth_admin, which may execute only the yes/no check
-- above: it reads no table itself). One indexed lookup; lock_timeout keeps a locked invitation row from
-- holding Auth's request (the error is caught: refused).
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

-- Ownership hand-over as in migration 20260930120100 (non-superuser migration role on hosted Supabase).
-- The hook itself stays with the migration role (like custom_access_token_hook).
grant create on schema private to invitation_guard;
alter function private.invitation_inviter_may_grant(uuid, uuid, text[]) owner to invitation_guard;
alter function private.invitation_link(bytea) owner to invitation_guard;
alter function private.invitation_by_token(bytea) owner to invitation_guard;
alter function private.apply_invitation_acceptance(bytea, uuid, text, text) owner to invitation_guard;
alter function private.accept_invitation_as_caller(bytea, text, text) owner to invitation_guard;
alter function private.invitation_allows_signup(text, text) owner to invitation_guard;
revoke create on schema private from invitation_guard;

revoke all on function private.invitation_inviter_may_grant(uuid, uuid, text[]) from public;
revoke all on function private.invitation_link(bytea) from public;
revoke all on function private.invitation_by_token(bytea) from public;
revoke all on function private.apply_invitation_acceptance(bytea, uuid, text, text) from public;
revoke all on function private.accept_invitation_as_caller(bytea, text, text) from public;
revoke all on function private.invitation_allows_signup(text, text) from public, anon, authenticated, service_role;
revoke all on function private.before_user_created_hook(jsonb) from public, anon, authenticated, service_role;
grant execute on function private.invitation_by_token(bytea) to authenticated;
grant execute on function private.accept_invitation_as_caller(bytea, text, text) to authenticated;
-- Auth (supabase_auth_admin; USAGE on schema private since migration 20260930120400): the hook and its
-- yes/no check, nothing else.
grant execute on function private.before_user_created_hook(jsonb) to supabase_auth_admin;
grant execute on function private.invitation_allows_signup(text, text) to supabase_auth_admin;

-- ---------------------------------------------------------------------------------------------------
-- Auth e-mail addresses never change through Auth (re-review N1)
-- ---------------------------------------------------------------------------------------------------
-- An account's e-mail is its owner's identity for invitations ("sign in to accept" compares it with
-- the invitation's) and it is the organization's (HR) record: no product path changes it. Auth would
-- let any signed-in account ask for another address (PUT /auth/v1/user {"email"}) and apply it once
-- the confirmation link e-mailed to that address is opened (spike on GoTrue v2.197.0, 7 Oct 2026: not
-- applied at once for a confirmed account, also with "Confirm email" off — but one click by the
-- address's owner on an unexpected "Confirm your new email address" message hands the address, e.g. a
-- future invitee's, to the requesting account; an anonymous account would get it at once). This
-- trigger refuses, for every role, a new e-mail and a requested change (email_change); Auth then answers
-- 500 and keeps the address. Sign-up, sign-in, token refresh, password and metadata updates are not
-- affected. Operators (support, a corrected address) change it in SQL, in one transaction:
--   set local jadarat.allow_auth_email_change = 'on'; update auth.users set email = … where id = …;
-- (and the e-mail identity's identity_data). SECURITY INVOKER; it reads nothing but its rows and the
-- setting. auth.users belongs to Supabase Auth: the migration role needs the TRIGGER privilege on it
-- (hosted Supabase grants it to postgres — supabase/postgres 17.11.0.003: postgres=ar*wdDxtm on
-- auth.users; the hosted simulation grants exactly that) and cannot DROP the trigger later (owner only):
-- the rollback drops the function with CASCADE.
create or replace function private.refuse_auth_email_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_catalog.current_setting('jadarat.allow_auth_email_change', true) is not distinct from 'on' then
    return new;
  end if;
  if new.email is distinct from old.email
     or (coalesce(new.email_change, '') <> '' and new.email_change is distinct from old.email_change) then
    raise exception 'the e-mail address of an account is managed by the organization and cannot be changed here'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

comment on function private.refuse_auth_email_change() is
  'SECURITY-RELEVANT (FR-IAM-03, re-review N1). Trigger on auth.users: no e-mail change through Auth (self-service or admin API); operators set jadarat.allow_auth_email_change = on for the transaction.';

revoke all on function private.refuse_auth_email_change() from public;

do $$
begin
  if not has_table_privilege(current_user, 'auth.users', 'trigger') then
    raise exception 'role % cannot create triggers on auth.users (TRIGGER privilege): the e-mail change guard (re-review N1) is required before sign-ups are opened', current_user;
  end if;
end
$$;

create trigger jadarat_refuse_email_change
  before update of email, email_change on auth.users
  for each row execute function private.refuse_auth_email_change();
