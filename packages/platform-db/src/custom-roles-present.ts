import { sql } from 'drizzle-orm';
import type { ClaimsTx } from './claims-tx';

/**
 * Does platform.custom_roles exist yet? The app and the worker deploy in parallel with the database
 * (expand-first, EP-ROLES review M3): until migration 20261019090100 runs, reads that name custom roles
 * read none. A catalog lookup, never a failing query — an error would abort the transaction.
 */
export async function customRolesExist(tx: ClaimsTx): Promise<boolean> {
  const [row] = await tx.execute<{ present: boolean }>(
    sql`select to_regclass('platform.custom_roles') is not null as present`,
  );
  return row?.present === true;
}
