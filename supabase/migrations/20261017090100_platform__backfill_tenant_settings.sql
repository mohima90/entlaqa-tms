-- Data backfill for platform.tenant_settings (T-M2-22; separate from the schema change, conventions §2):
-- every existing organization gets the default settings — Saudi riyal, Asia/Riyadh, Sunday–Thursday
-- 08:00–16:00, fiscal year from January, Arabic for new people, Gregorian dates: what the app did before
-- (so nothing changes for its members until the Organization Admin saves the profile). Industry and
-- country stay empty: provisioning never asked for them, so none is guessed (the profile page asks).
-- Runs without user claims (platform operation). New organizations get theirs from the trigger.
insert into platform.tenant_settings (tenant_id)
select t.id from platform.tenants t
where not exists (select 1 from platform.tenant_settings s where s.tenant_id = t.id);
