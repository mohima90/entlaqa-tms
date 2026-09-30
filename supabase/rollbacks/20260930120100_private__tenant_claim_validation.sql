-- Rollback of 20260930120100_private__tenant_claim_validation.sql.
drop function private.set_updated_at();
revoke select (id, user_id, not_after) on auth.sessions from tenant_guard;
revoke usage on schema auth from tenant_guard;
drop function private.switch_active_tenant(uuid);
drop function private.current_tenant_id();
drop function private.has_active_membership(uuid, uuid);
drop function private.user_session_is_valid(uuid, uuid);
drop function private.request_user_id();
drop function private.request_claims();
drop function private.try_uuid(text);
