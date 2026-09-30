-- Rollback of 20260930120200_platform__tenancy_core.sql. Drops all tenancy data — never in production
-- without a verified backup and PO approval (migration-conventions.md §6).
revoke usage on schema platform from supabase_auth_admin;
drop table platform.session_context;
drop table platform.tenant_memberships;
drop function private.check_membership_status_transition();
drop table platform.persons;
drop table platform.tenant_domains;
drop table platform.tenants;
