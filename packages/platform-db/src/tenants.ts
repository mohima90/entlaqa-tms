import 'server-only';
import { sql } from 'drizzle-orm';
import type { UserTx } from './with-user-tx';

/** The organization the current claims act in (RLS returns only that tenant), or null. */
export interface CurrentTenant {
  readonly tenantId: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  /** Its sign-in session inactivity limit (T-M2-10): the page warns before it ends. */
  readonly sessionIdleMinutes: number | null;
}

export async function getCurrentTenant(tx: UserTx): Promise<CurrentTenant | null> {
  const rows = await tx.execute<{
    id: string;
    name_ar: string;
    name_en: string | null;
    session_idle_minutes: number | string | null;
  }>(
    sql`select t.id, t.name_ar, t.name_en, p.session_idle_minutes
        from platform.tenants t
        left join platform.security_policies p on p.tenant_id = t.id
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
      }
    : null;
}
