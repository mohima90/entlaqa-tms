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
  /** Offered for new cycles; a switched-off form is listed only as a cycle's current form (C-6). */
  readonly active: boolean;
}

interface Row extends Record<string, unknown> {
  id: string;
  name_ar: string;
  name_en: string | null;
  is_default: boolean;
  is_active: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The active forms, plus `current` (the cycle's own form) even when it has been switched off since, so the
 * set-up page still shows — and keeps — what the cycle uses (code review C-6).
 */
export async function listNeedsFormOptions(
  tx: UserTx,
  current: string | null = null,
): Promise<readonly NeedsFormOption[]> {
  const include = current !== null && UUID_RE.test(current) ? current : null;
  const rows = await tx.execute<Row>(sql`
    select id, name_ar, name_en, is_default, is_active from tms.needs_forms
    where is_active or id = ${include}::uuid
    order by is_default desc, is_active desc, lower(name_en), id`);
  return rows.map((row) => ({
    id: row.id,
    name: { ar: row.name_ar, en: row.name_en },
    isDefault: row.is_default,
    active: row.is_active,
  }));
}
