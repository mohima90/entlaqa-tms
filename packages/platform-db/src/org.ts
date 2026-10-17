import 'server-only';
import { type SQL, sql } from 'drizzle-orm';
import type { UserTx } from './with-user-tx';
import { levelOrdinalOf } from './level-ordinal';

/** A department or branch as a filter choice (T-M2-04 users list; FR-ADM-04/05 subset). */
export interface OrgUnitOption {
  readonly id: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  /**
   * A unit's level (platform.structure_levels ordinal; its name labels the field, guided-test feedback #3);
   * null for a branch.
   */
  readonly levelOrdinal: number | null;
}

export interface OrgUnitOptions {
  readonly departments: readonly OrgUnitOption[];
  readonly branches: readonly OrgUnitOption[];
}

/**
 * Departments and branches of the current organization that are not deleted (inactive ones are kept:
 * people may still sit in them). The caller holds `platform.org.read`; RLS limits rows to the tenant.
 */
export async function listOrgUnitOptions(tx: UserTx): Promise<OrgUnitOptions> {
  const read = async (query: SQL): Promise<OrgUnitOption[]> => {
    const rows = await tx.execute<{
      id: string;
      name_ar: string;
      name_en: string | null;
      level_ordinal: number | null;
    }>(query);
    return rows.map((r) => ({
      id: r.id,
      nameAr: r.name_ar,
      nameEn: r.name_en,
      levelOrdinal: levelOrdinalOf(r.level_ordinal),
    }));
  };
  const departments = await read(sql`
    select id, name_ar, name_en, level_ordinal from platform.departments
    where deleted_at is null order by sort_order, name_ar, id`);
  const branches = await read(sql`
    select id, name_ar, name_en, null::smallint as level_ordinal from platform.branches
    where deleted_at is null order by is_headquarters desc, name_ar, id`);
  return { departments, branches };
}
