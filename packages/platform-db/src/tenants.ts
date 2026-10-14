import 'server-only';
import { sql } from 'drizzle-orm';
import { TENANT_DATE_DISPLAYS, type TenantDateDisplay } from './tenant-settings';
import type { UserTx } from './with-user-tx';

/**
 * How the organization's members see dates and what new people get (T-M2-22, platform.tenant_settings):
 * read on every page (the shell formats dates with it), read-only for members.
 */
export interface TenantRegional {
  readonly dateDisplay: TenantDateDisplay;
  readonly timeZone: string;
  readonly defaultLocale: 'ar' | 'en';
}

/** What the app did before organizations had settings (and the database's defaults). */
export const DEFAULT_TENANT_REGIONAL: TenantRegional = {
  dateDisplay: 'gregorian',
  timeZone: 'Asia/Riyadh',
  defaultLocale: 'en',
};

/** The organization the current claims act in (RLS returns only that tenant), or null. */
export interface CurrentTenant {
  readonly tenantId: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  /** Its sign-in session inactivity limit (T-M2-10): the page warns before it ends. */
  readonly sessionIdleMinutes: number | null;
  readonly regional: TenantRegional;
}

export async function getCurrentTenant(tx: UserTx): Promise<CurrentTenant | null> {
  const rows = await tx.execute<{
    id: string;
    name_ar: string;
    name_en: string | null;
    session_idle_minutes: number | string | null;
    date_display: string | null;
    timezone: string | null;
    default_locale: string | null;
  }>(
    sql`select t.id, t.name_ar, t.name_en, p.session_idle_minutes, s.date_display, s.timezone, s.default_locale
        from platform.tenants t
        left join platform.security_policies p on p.tenant_id = t.id
        left join platform.tenant_settings s on s.tenant_id = t.id
        where t.id = (select private.current_tenant_id())`,
  );
  const row = rows[0];
  return row
    ? {
        tenantId: row.id,
        nameAr: row.name_ar,
        nameEn: row.name_en,
        sessionIdleMinutes:
          row.session_idle_minutes === null ? null : Number(row.session_idle_minutes),
        regional: {
          dateDisplay: TENANT_DATE_DISPLAYS.find((d) => d === row.date_display) ?? 'gregorian',
          timeZone: row.timezone ?? DEFAULT_TENANT_REGIONAL.timeZone,
          defaultLocale: row.default_locale === 'ar' ? 'ar' : 'en',
        },
      }
    : null;
}
