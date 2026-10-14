-- Data backfill for platform.tenant_settings (T-M2-22; separate from the schema change, conventions §2):
-- every existing organization gets the default settings — Saudi riyal, Sunday–Thursday 08:00–16:00,
-- fiscal year from January, English for new people (PO decision, 14 Oct 2026), Gregorian dates — and as
-- its time zone the one the app
-- already used for its calendar days: its headquarters branch's (ORG_TIME_ZONE before T-M2-22), else
-- Asia/Riyadh (review M2), so dates do not change for its members until the Organization Admin saves the
-- profile. A branch zone PostgreSQL no longer knows falls back to Asia/Riyadh (the trigger would refuse
-- it). Industry and country stay empty: provisioning never asked for them, so none is guessed.
-- Runs without user claims (platform operation). New organizations get theirs from the trigger: they have
-- no branch yet, so Asia/Riyadh — the same rule.
insert into platform.tenant_settings (tenant_id, timezone)
select t.id,
       coalesce((select b.timezone from platform.branches b
                 where b.tenant_id = t.id and b.is_headquarters and b.deleted_at is null
                   and exists (select 1 from pg_catalog.pg_timezone_names z where z.name = b.timezone)
                 order by b.created_at limit 1),
                'Asia/Riyadh')
from platform.tenants t
where not exists (select 1 from platform.tenant_settings s where s.tenant_id = t.id);
