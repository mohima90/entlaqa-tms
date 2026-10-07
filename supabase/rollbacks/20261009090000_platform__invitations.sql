-- Rollback of 20261009090000_platform__invitations.sql. The cluster-wide role invitation_guard is kept
-- (other databases may use it); its privileges in this database are removed.
-- Disable the "before user created" hook in Auth configuration BEFORE running this, and turn sign-ups
-- off first (docs/engineering/db-deploy.md): without the function Auth refuses every sign-up with an
-- error, and with the hook disabled sign-ups would be open.
-- The e-mail change guard on auth.users (re-review N1): only the table's owner (Supabase Auth) may DROP
-- TRIGGER, so the function is dropped with CASCADE, which removes the trigger with it.
drop function private.refuse_auth_email_change() cascade;
drop function private.before_user_created_hook(jsonb);
drop function private.invitation_allows_signup(text, text);
drop function private.accept_invitation_as_caller(bytea, text, text);
drop function private.apply_invitation_acceptance(bytea, uuid, text, text);
drop function private.invitation_by_token(bytea);
drop function private.invitation_link(bytea);
drop function private.invitation_inviter_may_grant(uuid, uuid, text[]);
drop view private.auth_user_email;

-- The outbox actor stamp as in 20261007090000.
create or replace function private.stamp_event_actor()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_kind text := private.request_claims() ->> 'role';
begin
  new.created_at := now();
  new.dispatched_at := null;
  new.actor_id := null;
  new.actor_job := null;
  if current_user <> 'authenticated' then
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

revoke execute on function private.try_uuid(text) from invitation_guard;
revoke execute on function private.request_claims() from invitation_guard;
revoke execute on function private.request_user_id() from invitation_guard;
revoke execute on function private.request_person_id() from invitation_guard;
revoke execute on function private.lock_tenant_roles(uuid) from invitation_guard;
revoke execute on function private.has_visible_text(text) from invitation_guard;
revoke execute on function private.user_session_is_valid(uuid, uuid) from invitation_guard;

drop policy event_outbox_invitation_guard_insert on platform.event_outbox;
revoke all on platform.event_outbox from invitation_guard;
drop policy audit_events_invitation_guard_insert on platform.audit_events;
revoke all on platform.audit_events from invitation_guard;
drop policy ref_roles_invitation_guard_read on platform.ref_roles;
revoke all on platform.ref_roles from invitation_guard;
drop policy role_assignments_invitation_guard_read on platform.role_assignments;
drop policy role_assignments_invitation_guard_insert on platform.role_assignments;
revoke all on platform.role_assignments from invitation_guard;
drop policy tenant_memberships_invitation_guard_insert on platform.tenant_memberships;
drop policy tenant_memberships_invitation_guard_read on platform.tenant_memberships;
revoke all on platform.tenant_memberships from invitation_guard;
drop policy persons_invitation_guard_names on platform.persons;
drop policy persons_invitation_guard_read on platform.persons;
revoke all on platform.persons from invitation_guard;
drop policy tenants_invitation_guard_read on platform.tenants;
revoke all on platform.tenants from invitation_guard;

drop table platform.invitations;
drop function private.check_invitation();

revoke usage on schema platform, private from invitation_guard;
revoke invitation_guard from current_user;
