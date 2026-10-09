-- Rollback of 20261013090000_private__rate_limiter.sql. The cluster-wide role rate_limit_guard is kept
-- (other databases may use it); its privileges in this database are removed.
-- Roll the web app back first: without these functions every limited flow fails closed (sign-in answers
-- a generic error; docs/engineering/sign-in-protection.md). Roll back 20261013090100 before this one.
drop function private.rotate_rate_limit_keys();
drop function private.unlock_member_sign_in(uuid);
drop function private.member_sign_in_lock(uuid, integer);
drop function private.rate_limit_sign_in_reset(bytea);
drop function private.rate_limit_sign_in_succeeded(bytea, bytea, bytea, boolean, integer);
drop function private.rate_limit_sign_in_check(bytea, bytea, bytea, integer, integer, integer, integer, integer, integer, integer, integer);
drop function private.rate_limit_clear(text, bytea);
drop function private.rate_limit_peek(text, bytea, integer);
drop function private.rate_limit_hit(text, bytea, integer, integer);
drop function private.rate_limit_member_account_key(uuid);
drop function private.rate_limit_lock_account_devices(bytea);
drop function private.rate_limit_account_subject(text);
drop function private.rate_limit_purge();
drop function private.rate_limit_refund(text, bytea);
drop function private.rate_limit_count(text, bytea, integer, integer, boolean);
drop function private.rate_limit_check_call(text, bytea);
drop function private.rate_limit_ref(bytea);
drop function private.rate_limit_key(bytea);
drop function private.rate_limit_generate_keys();

drop policy tenant_memberships_rate_limit_guard_read on platform.tenant_memberships;
drop policy role_assignments_rate_limit_guard_read on platform.role_assignments;
revoke select (id, tenant_id, user_id, person_id, status) on platform.tenant_memberships from rate_limit_guard;
revoke select (tenant_id, membership_id, role_code, valid_from, valid_until) on platform.role_assignments
  from rate_limit_guard;
revoke all on private.auth_user_email from rate_limit_guard;
revoke execute on function private.try_uuid(text) from rate_limit_guard;
revoke execute on function private.request_claims() from rate_limit_guard;
revoke execute on function private.request_user_id() from rate_limit_guard;
revoke execute on function private.current_tenant_id() from rate_limit_guard;
revoke execute on function private.actor_role_codes(uuid, uuid) from rate_limit_guard;

drop table private.sign_in_trusted_devices;
drop table private.rate_limit_counters;
drop table private.rate_limit_secret;

revoke usage on schema platform, private from rate_limit_guard;
revoke rate_limit_guard from current_user;
