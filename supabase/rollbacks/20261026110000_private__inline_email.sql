-- Rollback of 20261026110000_private__inline_email.sql: e-mails are queued by jobs only again. The cluster-wide
-- role inline_mail_guard is kept (other databases may use it); its privileges here are removed.
drop function if exists private.inline_mail_tenants_to_rescue();
drop function if exists private.inline_mail_finish(uuid, bytea, text, text, text, text, text);
drop function if exists private.inline_mail_claim(uuid, bytea);
drop function if exists private.inline_mail_queue(text, uuid, text, integer, text, text, text, text, text, text, bytea);
drop function if exists private.inline_invitation_prepare(uuid);
drop function if exists private.inline_mail_caller();

revoke execute on function private.email_waiting_codes() from inline_mail_guard;
revoke execute on function private.auth_mail_route(uuid) from inline_mail_guard;
revoke execute on function private.invitation_codes(uuid[]) from inline_mail_guard;
revoke execute on function private.request_user_id() from inline_mail_guard;
revoke execute on function private.try_uuid(text) from inline_mail_guard;
revoke execute on function private.request_claims() from inline_mail_guard;
revoke execute on function private.current_tenant_id() from inline_mail_guard;

drop policy custom_roles_inline_mail_read on platform.custom_roles;
revoke select (tenant_id, code, name_ar, name_en) on platform.custom_roles from inline_mail_guard;
drop policy tenant_memberships_inline_mail_read on platform.tenant_memberships;
revoke select (id, tenant_id, user_id, person_id, status) on platform.tenant_memberships from inline_mail_guard;
drop policy tenants_inline_mail_read on platform.tenants;
revoke select (id, name_ar, name_en, status) on platform.tenants from inline_mail_guard;
drop policy persons_inline_mail_read on platform.persons;
revoke select (tenant_id, id, display_name_ar, display_name_en) on platform.persons from inline_mail_guard;
drop policy invitations_inline_mail_read on platform.invitations;
revoke select (tenant_id, id, person_id, email, locale, status, mail_held, send_count, primary_role, expires_at)
  on platform.invitations from inline_mail_guard;

drop policy message_deliveries_inline_update on platform.message_deliveries;
drop policy message_deliveries_inline_insert on platform.message_deliveries;
drop policy message_deliveries_inline_read on platform.message_deliveries;
revoke all on platform.message_deliveries from inline_mail_guard;

-- The lifecycle rules as 20261008090000 left them.
create or replace function private.check_message_delivery()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'queued' or new.attempts <> 0 or new.provider is not null or new.provider_message_id is not null
       or new.error_code is not null or new.sent_at is not null then
      raise exception 'a delivery starts queued, with no attempts or outcome' using errcode = 'check_violation';
    end if;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;
  if old.status in ('sent', 'failed', 'suppressed') then
    raise exception 'a finished delivery cannot change' using errcode = 'check_violation';
  end if;
  if (new.id, new.tenant_id, new.channel, new.template, new.template_version, new.locale, new.destination_masked, new.created_at)
       is distinct from (old.id, old.tenant_id, old.channel, old.template, old.template_version, old.locale, old.destination_masked, old.created_at)
     or new.recipient_person_id is distinct from old.recipient_person_id
     or new.source_event_id is distinct from old.source_event_id
     or (new.status in ('queued', 'sending')
         and (new.destination, new.subject, new.html_body, new.text_body)
             is distinct from (old.destination, old.subject, old.html_body, old.text_body)) then
    raise exception 'what a delivery sends and to whom cannot change' using errcode = 'check_violation';
  end if;
  if new.attempts < old.attempts then
    raise exception 'delivery attempts only grow' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end
$$;
revoke all on function private.check_message_delivery() from public;

drop index if exists platform.message_deliveries_inline_open_idx;
drop index if exists platform.message_deliveries_source_key_uq;
alter table platform.message_deliveries
  drop constraint message_deliveries_claim_hash_check,
  drop constraint message_deliveries_source_key_check,
  drop column rescued_at,
  drop column inline_claim_hash,
  drop column source_key;

revoke usage on schema platform, private from inline_mail_guard;
