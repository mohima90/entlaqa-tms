import 'server-only';
import { sql } from 'drizzle-orm';
import type { UserTx } from './with-user-tx';

/** The organization the current claims act in (RLS returns only that tenant), or null. */
export interface CurrentTenant {
  readonly tenantId: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
}

export async function getCurrentTenant(tx: UserTx): Promise<CurrentTenant | null> {
  const rows = await tx.execute<{ id: string; name_ar: string; name_en: string | null }>(
    sql`select id, name_ar, name_en from platform.tenants where id = (select private.current_tenant_id())`,
  );
  const row = rows[0];
  return row ? { tenantId: row.id, nameAr: row.name_ar, nameEn: row.name_en } : null;
}
