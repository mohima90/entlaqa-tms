import { sql } from 'drizzle-orm';

/**
 * The organization's time zone for calendar days (role validity, T-M2-14): its headquarters branch,
 * else Asia/Riyadh. Organizations have no time zone of their own yet; branches do.
 */
export const ORG_TIME_ZONE = sql`coalesce((select b.timezone from platform.branches b
  where b.is_headquarters and b.deleted_at is null order by b.created_at limit 1), 'Asia/Riyadh')`;
