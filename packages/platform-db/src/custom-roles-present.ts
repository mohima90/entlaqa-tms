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

/**
 * Do the role-scope units exist yet (platform.role_assignments.scope_unit_id and
 * platform.invitations.scope_unit_id, migration 20261020090400; EP-ORG, T-M3-09)? Same deploy window as
 * customRolesExist: until then no assignment has a unit (department-limited roles grant nothing scoped).
 */
export async function roleScopeUnitsExist(tx: ClaimsTx): Promise<boolean> {
  return columnExists(tx, 'platform.role_assignments', 'scope_unit_id');
}

/** Does platform.departments.level_ordinal exist yet (migration 20261020090200; EP-ORG)? */
export async function departmentLevelsExist(tx: ClaimsTx): Promise<boolean> {
  return columnExists(tx, 'platform.departments', 'level_ordinal');
}

/** Do the structure levels exist yet (platform.structure_levels, migration 20261020090000; EP-ORG)? */
export async function structureLevelsExist(tx: ClaimsTx): Promise<boolean> {
  const [row] = await tx.execute<{ present: boolean }>(
    sql`select to_regclass('platform.structure_levels') is not null as present`,
  );
  return row?.present === true;
}

async function columnExists(tx: ClaimsTx, table: string, column: string): Promise<boolean> {
  const [row] = await tx.execute<{ present: boolean }>(sql`
    select exists (select 1 from pg_catalog.pg_attribute a
                   where a.attrelid = to_regclass(${table}) and a.attname = ${column}
                     and not a.attisdropped) as present`);
  return row?.present === true;
}
