-- Rollback of 20261022100100_private__email_sending.sql: no e-mail settings in the product (the worker then
-- falls back to its environment's installation sender, or waits). The cluster-wide role email_guard is kept
-- (other databases may use it); its privileges here are removed.
drop function if exists private.invitation_mail_skipped_ids();
drop function if exists private.note_invitation_mail_skipped(uuid);
drop function if exists private.sweep_email_deliveries(integer);
drop function if exists private.email_tenants_waiting();
drop function if exists private.finish_email_test(uuid, integer, boolean, text);
drop function if exists private.claim_email_tests(integer);
drop function if exists private.email_route();
drop function if exists private.set_tenant_email_enabled(boolean, integer);
drop function if exists private.request_tenant_email_test(text);
drop function if exists private.save_tenant_email_settings(text, jsonb, text, text, text, text, integer);
drop function if exists private.tenant_email_failures(integer);
drop function if exists private.tenant_email_settings_view();
drop function if exists private.platform_save_email_settings(text, jsonb, text, text, text, text, integer);
drop function if exists private.platform_email_settings_view();
drop function if exists private.email_credentials_public_key();
drop function if exists private.publish_email_credentials_key(text, text);
drop function if exists private.email_job_tenant(boolean);
drop function if exists private.email_member_tenant(boolean);
drop function if exists private.email_waiting_codes();

drop table if exists private.invitation_mail_skips;
drop table if exists private.tenant_email_settings;
drop table if exists private.platform_email_settings;
drop table if exists private.email_credentials_key;

drop function if exists private.email_smtp_server_changed(text, jsonb, jsonb);
drop function if exists private.email_sender_name_is_valid(text);
drop function if exists private.email_address_masked(text);
drop function if exists private.email_address_is_valid(text);

drop policy if exists tenants_email_guard_read on platform.tenants;
drop policy if exists tenant_settings_email_guard_read on platform.tenant_settings;
drop policy if exists message_deliveries_email_guard_read on platform.message_deliveries;
drop policy if exists message_deliveries_email_guard_sweep on platform.message_deliveries;
drop policy if exists message_deliveries_email_guard_purge on platform.message_deliveries;
drop policy if exists invitations_email_guard_read on platform.invitations;
drop policy if exists tenant_memberships_email_guard_read on platform.tenant_memberships;
drop policy if exists role_assignments_email_guard_read on platform.role_assignments;
drop policy if exists custom_roles_email_guard_read on platform.custom_roles;
drop policy if exists custom_role_permissions_email_guard_read on platform.custom_role_permissions;
drop policy if exists ref_permissions_email_guard_read on platform.ref_permissions;
drop policy if exists ref_role_permissions_email_guard_read on platform.ref_role_permissions;
drop policy if exists platform_audit_events_email_guard_insert on private.platform_audit_events;
drop policy if exists audit_events_email_guard_insert on platform.audit_events;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'email_guard') then
    revoke all on platform.tenants, platform.tenant_settings, platform.message_deliveries, platform.invitations,
                  platform.tenant_memberships, platform.role_assignments, platform.custom_roles,
                  platform.custom_role_permissions, platform.ref_permissions, platform.ref_role_permissions,
                  platform.audit_events, private.platform_audit_events
      from email_guard;
    revoke execute on function private.try_uuid(text), private.request_claims(), private.request_user_id(),
                               private.request_person_id(), private.current_tenant_id(),
                               private.user_session_is_valid(uuid, uuid), private.platform_admin_is_active(uuid),
                               private.member_permissions(uuid, uuid), private.member_has_permission(uuid, uuid, text),
                               private.platform_admin_caller()
      from email_guard;
    revoke usage on schema platform, private from email_guard;
  end if;
end
$$;
