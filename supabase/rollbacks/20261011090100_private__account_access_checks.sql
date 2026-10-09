-- Rollback of 20261011090100_private__account_access_checks.sql. Accounts the worker banned stay banned in
-- Auth: unban them first (the private.account_bans rows list them) — docs/engineering/background-jobs.md,
-- "Account access (Auth bans)".
drop trigger invitations_access_check on platform.invitations;
drop trigger tenant_memberships_access_check on platform.tenant_memberships;

drop function private.retry_account_access_check(uuid);
drop function private.finish_account_access_check(uuid, timestamptz, text);
drop function private.claim_account_access_check();
drop function private.invitation_access_changed();
drop function private.membership_access_changed();
drop function private.queue_account_access_check(uuid);
drop function private.account_should_be_banned(uuid);

drop index platform.invitations_pending_email_idx;
drop policy invitations_membership_guard_read on platform.invitations;
revoke all on platform.invitations from membership_guard;
drop policy tenants_membership_guard_read on platform.tenants;
revoke all on platform.tenants from membership_guard;

drop view private.auth_account_access;
drop table private.account_bans;
drop table private.account_access_checks;
