import { sql } from 'drizzle-orm';

/**
 * The organization's time zone for calendar days (role validity, T-M2-14): the organization's own
 * (platform.tenant_settings, set on the profile page — T-M2-22), else its headquarters branch's, else
 * Asia/Riyadh. Branch-level rules (BR-ADM-3: branch → legal entity → organization) apply where a branch is
 * known; role validity is organization-wide.
 */
export const ORG_TIME_ZONE = sql`coalesce(
  (select s.timezone from platform.tenant_settings s where s.tenant_id = (select private.current_tenant_id())),
  (select b.timezone from platform.branches b
   where b.is_headquarters and b.deleted_at is null order by b.created_at limit 1),
  'Asia/Riyadh')`;
