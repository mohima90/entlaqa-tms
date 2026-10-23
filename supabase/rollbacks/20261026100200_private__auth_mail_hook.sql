-- Rollback of 20261026100200_private__auth_mail_hook.sql.
drop function private.audit_sign_in_code_refused(text, boolean);
drop function private.verify_sign_in_code(text, text);
drop function private.auth_mail_issue(uuid, text, text, text);
drop function private.audit_sign_in_code_sent(uuid, uuid);
drop function private.auth_mail_route(uuid);
drop function private.auth_mail_account(uuid);
drop function private.account_needs_platform_sender(uuid);
drop function private.account_sender_is_platform(uuid);
drop function private.sign_in_code_hmac(uuid, text);
drop table private.sign_in_codes;
drop table private.sign_in_code_secret;
revoke execute on function private.platform_admin_is_active(uuid) from account_mail_guard;
drop policy brand_assets_email_guard_read on platform.brand_assets;
revoke select (id, tenant_id, file_id) on platform.brand_assets from email_guard;
drop policy tenant_branding_email_guard_read on platform.tenant_branding;
revoke select (tenant_id, email_action_color, email_link_color, logo_file_id) on platform.tenant_branding from email_guard;
drop policy audit_events_account_mail_guard_insert on platform.audit_events;
revoke insert (tenant_id, actor_user_id, actor_person_id, action, entity_type, entity_id, data)
  on platform.audit_events from account_mail_guard;
