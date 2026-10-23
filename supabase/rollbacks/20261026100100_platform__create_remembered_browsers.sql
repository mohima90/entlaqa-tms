-- Rollback of 20261026100100_platform__create_remembered_browsers.sql.
drop trigger tenant_memberships_forget_remembered on platform.tenant_memberships;
drop function private.forget_remembered_browsers_of_inactive_member();
drop function private.forget_member_remembered_browsers(uuid);
drop function private.remember_browser(bytea, text);
drop function private.remembered_browser_ok(uuid, bytea);
drop policy audit_events_account_mail_guard_insert on platform.audit_events;
revoke insert (tenant_id, actor_user_id, actor_person_id, action, entity_type, entity_id, data)
  on platform.audit_events from account_mail_guard;
drop table platform.remembered_browsers;
