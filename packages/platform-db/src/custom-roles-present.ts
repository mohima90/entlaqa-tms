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

/**
 * The catalog condition «a person may have no Arabic display name» (platform.persons.display_name_ar lost
 * NOT NULL in migration 20261021090000; FR-IAM-01, PO 17 Oct 2026). Before that migration the column refuses
 * NULL (and, by its inline check, an empty name). Safe without the table (false).
 */
export const ENGLISH_ONLY_NAMES_SQL = sql`coalesce((select not a.attnotnull from pg_catalog.pg_attribute a
            where a.attrelid = to_regclass('platform.persons') and a.attname = 'display_name_ar'
              and not a.attisdropped), false)`;

/** Once seen true, it stays true: migrations only go forward (expand-first), so it is asked once per process. */
let englishOnlyNamesSeen = false;

/**
 * May a person be saved without an Arabic display name yet (migration 20261021090000)? Previews share the
 * production database and the app deploys in parallel with it (CLAUDE.md; migration conventions §6), so new
 * code can run minutes before the migration: until then the writers store the English display name in the
 * Arabic slot (as the code of the previous release did with what it was given), and the import keeps
 * requiring the Arabic names (the database's mapping rule of that time). Cached once true.
 */
export async function englishOnlyNamesExist(tx: ClaimsTx): Promise<boolean> {
  if (englishOnlyNamesSeen) return true;
  const [row] = await tx.execute<{ present: boolean }>(
    sql`select ${ENGLISH_ONLY_NAMES_SQL} as present`,
  );
  englishOnlyNamesSeen = row?.present === true;
  return englishOnlyNamesSeen;
}

/**
 * The Arabic display name to store with `displayNameEn`: the Arabic one given; else none (null) — or, while
 * the database still requires an Arabic display name (englishOnlyNamesExist false), the English one.
 */
export async function storableArabicDisplayName(
  tx: ClaimsTx,
  displayNameAr: string | null,
  displayNameEn: string | null,
): Promise<string | null> {
  if (displayNameAr !== null && displayNameAr !== '') return displayNameAr;
  if (displayNameEn === null || displayNameEn === '') return null;
  return (await englishOnlyNamesExist(tx)) ? null : displayNameEn;
}

/** Once seen, platform.structure_levels stays (expand-first): asked once per process by the labels read. */
let structureLevelsSeen = false;

/** structureLevelsExist, cached once true (the level labels are read on many pages). */
export async function structureLevelsExistCached(tx: ClaimsTx): Promise<boolean> {
  if (structureLevelsSeen) return true;
  structureLevelsSeen = await structureLevelsExist(tx);
  return structureLevelsSeen;
}

/** Tests only: forget what was seen (each test file may simulate the database before the migration). */
export function forgetSchemaPresenceForTests(): void {
  englishOnlyNamesSeen = false;
  structureLevelsSeen = false;
}

async function columnExists(tx: ClaimsTx, table: string, column: string): Promise<boolean> {
  const [row] = await tx.execute<{ present: boolean }>(sql`
    select exists (select 1 from pg_catalog.pg_attribute a
                   where a.attrelid = to_regclass(${table}) and a.attname = ${column}
                     and not a.attisdropped) as present`);
  return row?.present === true;
}
