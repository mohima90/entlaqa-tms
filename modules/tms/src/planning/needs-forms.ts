import type { UserTx } from '@jadarat/platform-db';
import { sql } from 'drizzle-orm';

/**
 * The needs forms a planning cycle can use (T-M3-04 × T-M3-10): the organization's ACTIVE forms from the
 * needs forms library (`tms.needs_forms`, migration 20261020180200), the default form first, then by English
 * name. A new cycle starts with the default form (preselected on the set-up page; the database sets it when
 * none is chosen), and the launch locks the cycle's form in its transaction (migration 20261020190000).
 * Row-level security keeps the list to the caller's organization.
 */
export interface NeedsFormOption {
  readonly id: string;
  readonly name: { readonly ar: string; readonly en: string | null };
  readonly isDefault: boolean;
}

interface Row extends Record<string, unknown> {
  id: string;
  name_ar: string;
  name_en: string | null;
  is_default: boolean;
}

export async function listNeedsFormOptions(tx: UserTx): Promise<readonly NeedsFormOption[]> {
  const rows = await tx.execute<Row>(sql`
    select id, name_ar, name_en, is_default from tms.needs_forms
    where is_active
    order by is_default desc, lower(name_en), id`);
  return rows.map((row) => ({
    id: row.id,
    name: { ar: row.name_ar, en: row.name_en },
    isDefault: row.is_default,
  }));
}
