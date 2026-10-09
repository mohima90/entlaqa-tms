-- Data backfill for platform.security_policies (T-M2-10; separate from the schema change, conventions §2):
-- every existing organization gets the default policy — MFA off with the Organization Admin prompt (PO
-- decisions 1 Oct and 9 Oct 2026), passwords of 12+ characters, lockout after 5 attempts for 15 minutes,
-- sign-in sessions ending after 30 minutes of inactivity or 12 hours, at most 3 devices (screen 6).
-- Runs without user claims (platform operation). New organizations get theirs from the trigger.
insert into platform.security_policies (tenant_id)
select t.id from platform.tenants t
where not exists (select 1 from platform.security_policies p where p.tenant_id = t.id);
