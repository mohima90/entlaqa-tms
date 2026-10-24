import 'server-only';
import { sql } from 'drizzle-orm';
import {
  departmentLevelsExist,
  roleScopeUnitsExist,
  structureCompletionExists,
  structureLevelsExist,
  structureLevelsExistCached,
} from './custom-roles-present';
import { pgError } from './user-admin';
import type { UserTx } from './with-user-tx';

/**
 * The organization's structure (FR-ADM-05, BRD v3.2; T-M3-02; business flow
 * docs/business-flows/EP-ORG-organization-structure.md, PO 17 Oct 2026): its own LEVELS
 * (platform.structure_levels, migration 20261020090000) and the UNITS of the tree (platform.departments; a unit's
 * level is its depth, computed by the database, 20261020090200). The calling actions authorize
 * (`platform.org.read` to read, `platform.org.manage` to change) and audit; the database has the final word on
 * every rule (levels at the bottom only, the last unused one removed, no unit below the last level, a unit with
 * units, active people or role scopes not deleted). Row-level security keeps every read and write in the
 * caller's organization. Writes take the organization's hierarchy lock first (the advisory lock of
 * private.check_tree), so what they read stays true until they commit (READ COMMITTED).
 */

export interface StructureLevelRow {
  readonly id: string;
  /** 1 = the top level. */
  readonly ordinal: number;
  readonly nameEn: string;
  readonly nameAr: string;
  readonly version: number;
  /** Live units at this level. */
  readonly unitCount: number;
}

export type UnitStatus = 'active' | 'inactive';

export interface StructureUnitRow {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly parentId: string | null;
  /** The unit's level (= its depth; null only before the backfill of 20261020090300). */
  readonly levelOrdinal: number | null;
  readonly branchId: string | null;
  readonly headPersonId: string | null;
  readonly headNameAr: string | null;
  readonly headNameEn: string | null;
  /** The cost centre people placed in the unit get when HR picks none (WP-HR-01; null before the migration). */
  readonly defaultCostCentreId: string | null;
  readonly status: UnitStatus;
  readonly sortOrder: number;
  readonly version: number;
  /** What keeps the unit from being deleted (BR-ORG-c): live units under it, … */
  readonly childCount: number;
  /** … active people placed in it, … */
  readonly peopleCount: number;
  /** … and role assignments (membership not revoked) or pending invitations whose unit it is (T-M3-09). */
  readonly roleScopeCount: number;
}

/** A unit as a choice (the unit picker of department-limited roles, T-M3-09). */
export interface StructureUnitOption {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly parentId: string | null;
  readonly levelOrdinal: number | null;
  readonly active: boolean;
}

/** A level as a label (Arabic, English names) by ordinal. */
export interface StructureLevelLabel {
  readonly ordinal: number;
  readonly nameEn: string;
  readonly nameAr: string;
}

/** An active person as a head choice (names and employee number only). */
export interface PersonOption {
  readonly id: string;
  /** Null for a person with an English name only (PO 17 Oct 2026). */
  readonly nameAr: string | null;
  readonly nameEn: string | null;
  readonly employeeNumber: string | null;
}

function count(value: number | string | null | undefined): number {
  return Number(value ?? 0);
}

/** `d.level_ordinal`, or null before its column exists (deploy window, expand-first). */
async function levelColumn(tx: UserTx) {
  return (await departmentLevelsExist(tx)) ? sql`d.level_ordinal` : sql`null::smallint`;
}

/** The organization's levels in order, with the number of live units at each (none before the migration). */
export async function listStructureLevels(tx: UserTx): Promise<readonly StructureLevelRow[]> {
  if (!(await structureLevelsExist(tx))) return [];
  // The units' levels once their column exists (deploy window, expand-first).
  const used = (await departmentLevelsExist(tx))
    ? sql`(select count(*) from platform.departments d
           where d.tenant_id = l.tenant_id and d.deleted_at is null and d.level_ordinal = l.ordinal)`
    : sql`0`;
  const rows = await tx.execute<{
    id: string;
    ordinal: number;
    name_en: string;
    name_ar: string;
    version: number;
    unit_count: number | string;
  }>(sql`
    select l.id, l.ordinal, l.name_en, l.name_ar, l.version, ${used} as unit_count
    from platform.structure_levels l
    order by l.ordinal`);
  return rows.map((r) => ({
    id: r.id,
    ordinal: r.ordinal,
    nameEn: r.name_en,
    nameAr: r.name_ar,
    version: r.version,
    unitCount: count(r.unit_count),
  }));
}

/**
 * The levels' names only (labels of unit columns, fields and pickers, read on many pages): one query, no
 * unit counts — the table's presence is asked once per process (structureLevelsExistCached).
 */
export async function listStructureLevelLabels(
  tx: UserTx,
): Promise<readonly StructureLevelLabel[]> {
  if (!(await structureLevelsExistCached(tx))) return [];
  const rows = await tx.execute<{ ordinal: number; name_en: string; name_ar: string }>(sql`
    select l.ordinal, l.name_en, l.name_ar from platform.structure_levels l order by l.ordinal`);
  return rows.map((r) => ({ ordinal: r.ordinal, nameEn: r.name_en, nameAr: r.name_ar }));
}

/**
 * Has the organization any live unit below the first level? Then a column holding units of any level is
 * labelled «Unit» with each unit's level, else with the first level's name — the same on every page of a
 * list (guided-test feedback #3; WP-FIX-01 review). A unit below the first level is one with a parent (its
 * level is its depth), so this needs no level column (deploy window).
 */
export async function hasUnitsBelowFirstLevel(tx: UserTx): Promise<boolean> {
  const [row] = await tx.execute<{ deeper: boolean }>(sql`
    select exists (select 1 from platform.departments d
                   where d.deleted_at is null and d.parent_id is not null) as deeper`);
  return row?.deeper === true;
}

/**
 * The live units of the organization (the tree), with their head's names and what keeps each from being
 * deleted. Ordered by parent, then sort order and Arabic name (the page builds the tree).
 */
export async function listStructureUnits(tx: UserTx): Promise<readonly StructureUnitRow[]> {
  // Only roles still limited to a department count (C-M1, as the database's delete guard does).
  const scopes = (await roleScopeUnitsExist(tx))
    ? sql`(select count(*) from platform.role_assignments ra
           join platform.tenant_memberships m on m.tenant_id = ra.tenant_id and m.id = ra.membership_id
           join platform.custom_roles cr on cr.tenant_id = ra.tenant_id and cr.code = ra.role_code
           where ra.tenant_id = d.tenant_id and ra.scope_unit_id = d.id and m.status <> 'revoked'
             and cr.data_scope = 'departments')
          + (select count(*) from platform.invitations i
             join platform.custom_roles cr on cr.tenant_id = i.tenant_id and cr.code = i.primary_role
             where i.tenant_id = d.tenant_id and i.scope_unit_id = d.id and i.status = 'pending'
               and cr.data_scope = 'departments')`
    : sql`0`;
  const level = await levelColumn(tx);
  const costCentre = (await structureCompletionExists(tx))
    ? sql`d.default_cost_centre_id`
    : sql`null::uuid`;
  const rows = await tx.execute<{
    id: string;
    code: string;
    name_ar: string;
    name_en: string | null;
    parent_id: string | null;
    level_ordinal: number | null;
    branch_id: string | null;
    head_person_id: string | null;
    default_cost_centre_id: string | null;
    head_name_ar: string | null;
    head_name_en: string | null;
    status: UnitStatus;
    sort_order: number;
    version: number;
    child_count: number | string;
    people_count: number | string;
    role_scope_count: number | string;
  }>(sql`
    select d.id, d.code, d.name_ar, d.name_en, d.parent_id, ${level} as level_ordinal, d.branch_id, d.head_person_id,
           ${costCentre} as default_cost_centre_id,
           h.display_name_ar as head_name_ar, h.display_name_en as head_name_en, d.status, d.sort_order, d.version,
           (select count(*) from platform.departments c
            where c.tenant_id = d.tenant_id and c.parent_id = d.id and c.deleted_at is null) as child_count,
           (select count(*) from platform.person_employment e
            join platform.persons p on p.tenant_id = e.tenant_id and p.id = e.person_id
            where e.tenant_id = d.tenant_id and e.department_id = d.id and p.status = 'active') as people_count,
           ${scopes} as role_scope_count
    from platform.departments d
    left join platform.persons h on h.tenant_id = d.tenant_id and h.id = d.head_person_id
    where d.deleted_at is null
    order by d.parent_id nulls first, d.sort_order, d.name_ar, d.id`);
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    nameAr: r.name_ar,
    nameEn: r.name_en,
    parentId: r.parent_id,
    levelOrdinal: r.level_ordinal,
    branchId: r.branch_id,
    headPersonId: r.head_person_id,
    headNameAr: r.head_name_ar,
    headNameEn: r.head_name_en,
    defaultCostCentreId: r.default_cost_centre_id,
    status: r.status,
    sortOrder: r.sort_order,
    version: r.version,
    childCount: count(r.child_count),
    peopleCount: count(r.people_count),
    roleScopeCount: count(r.role_scope_count),
  }));
}

/** The live units as choices (active and inactive: the picker offers active ones, names show both). */
export async function listStructureUnitOptions(
  tx: UserTx,
): Promise<readonly StructureUnitOption[]> {
  const level = await levelColumn(tx);
  const rows = await tx.execute<{
    id: string;
    code: string;
    name_ar: string;
    name_en: string | null;
    parent_id: string | null;
    level_ordinal: number | null;
    status: UnitStatus;
  }>(sql`
    select d.id, d.code, d.name_ar, d.name_en, d.parent_id, ${level} as level_ordinal, d.status
    from platform.departments d
    where d.deleted_at is null
    order by d.parent_id nulls first, d.sort_order, d.name_ar, d.id`);
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    nameAr: r.name_ar,
    nameEn: r.name_en,
    parentId: r.parent_id,
    levelOrdinal: r.level_ordinal,
    active: r.status === 'active',
  }));
}

/** Active people as head choices (any active person record, with or without an account; FR-ADM-05). */
export async function listActivePersonOptions(tx: UserTx): Promise<readonly PersonOption[]> {
  const rows = await tx.execute<{
    id: string;
    display_name_ar: string | null;
    display_name_en: string | null;
    employee_number: string | null;
  }>(sql`
    select p.id, p.display_name_ar, p.display_name_en, p.employee_number
    from platform.persons p
    where p.status = 'active'
    order by coalesce(p.display_name_ar, p.display_name_en), p.id`);
  return rows.map((r) => ({
    id: r.id,
    nameAr: r.display_name_ar,
    nameEn: r.display_name_en,
    employeeNumber: r.employee_number,
  }));
}

// ---------------------------------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------------------------------

/** Why the database (or the read under the lock) refused a structure change. */
export type StructureRefusal =
  | 'not_found'
  | 'version_conflict'
  | 'name_en_taken'
  | 'name_ar_taken'
  | 'too_many_levels'
  | 'not_last_level'
  | 'only_level'
  | 'level_in_use'
  | 'code_taken'
  | 'parent_not_found'
  | 'below_last_level'
  | 'head_not_active'
  | 'branch_not_found'
  | 'unit_in_use'
  /** WP-HR-01: no level added or removed once people are placed in units (JO004). */
  | 'levels_locked'
  /** WP-HR-01: a moved unit keeps its level (JO003; also a parent of another level picked in the move). */
  | 'level_changes'
  /** WP-HR-01: a unit never moves under itself or a unit below it. */
  | 'move_into_itself'
  /** WP-HR-01: the default cost centre is not an active cost centre of the organization. */
  | 'cost_centre_inactive';

/** What still points at a unit (the refusal of a delete says it). */
export interface UnitUsage {
  readonly units: number;
  readonly people: number;
  readonly roles: number;
}

export type StructureOutcome<T> =
  | { readonly ok: true; readonly before: T | null; readonly after: T | null }
  | {
      readonly ok: false;
      readonly refusal: StructureRefusal;
      /** With `level_in_use`: the units at the level; with `unit_in_use`: what points at the unit. */
      readonly usage?: UnitUsage;
    };

/** Ten levels at most (platform.structure_levels_ordinal_check). */
export const MAX_STRUCTURE_LEVELS = 10;

/** Maps a database refusal of a structure write to a reason; rethrows anything else. */
export function structureRefusalOf(error: unknown): StructureRefusal {
  const pg = pgError(error);
  if (pg?.code === 'JO001') return 'below_last_level';
  if (pg?.code === 'JO002') return 'level_in_use';
  if (pg?.code === 'JO003') return 'level_changes';
  if (pg?.code === 'JO004') return 'levels_locked';
  if (pg?.code === '23505') {
    if (pg.constraint === 'structure_levels_tenant_name_en_uq') return 'name_en_taken';
    if (pg.constraint === 'structure_levels_tenant_name_ar_uq') return 'name_ar_taken';
    if (pg.constraint === 'departments_tenant_code_uq') return 'code_taken';
    // Two members added a level at the same place at once.
    if (pg.constraint === 'structure_levels_tenant_id_ordinal_key') return 'version_conflict';
  }
  if (pg?.code === '23514') {
    if (pg.constraint === 'structure_levels_ordinal_check') return 'too_many_levels';
    if (pg.message.includes('must be an active person')) return 'head_not_active';
    if (pg.message.includes('cost centre must be active')) return 'cost_centre_inactive';
    if (pg.message.includes('deleted branch')) return 'branch_not_found';
    if (pg.message.includes('deleted parent')) return 'parent_not_found';
    if (pg.message.includes('only the last level')) return 'not_last_level';
    if (pg.message.includes('at least one level')) return 'only_level';
    // A soft delete refused: units under it, active people, or role scopes (counted before; a race).
    if (pg.message.includes('still')) return 'unit_in_use';
  }
  // A parent, branch or head of another organization (or unknown): the composite foreign keys.
  if (pg?.code === '23503') {
    if (pg.constraint === 'departments_tenant_id_branch_id_fkey') return 'branch_not_found';
    if (pg.constraint === 'departments_tenant_id_head_person_id_fkey') return 'head_not_active';
    if (pg.constraint === 'departments_default_cost_centre_fkey') return 'cost_centre_inactive';
    return 'parent_not_found';
  }
  throw error;
}

async function lockStructure(tx: UserTx): Promise<void> {
  // The organization's hierarchy lock (private.check_tree): every level and unit change is serialised.
  await tx.execute(sql`select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('platform.departments:' || private.current_tenant_id()::text, 0))`);
}

/**
 * Are the levels locked (WP-HR-01, PO 24 Oct 2026)? Once any person is placed in a unit, levels are no longer added
 * or removed — renamed only (the database refuses it too: JO004).
 */
export async function structureLevelsLocked(tx: UserTx): Promise<boolean> {
  const [row] = await tx.execute<{ locked: boolean }>(sql`
    select exists (select 1 from platform.person_employment e where e.department_id is not null) as locked`);
  return row?.locked === true;
}

async function levelById(tx: UserTx, id: string): Promise<StructureLevelRow | null> {
  return (await listStructureLevels(tx)).find((level) => level.id === id) ?? null;
}

export interface LevelNames {
  readonly nameEn: string;
  readonly nameAr: string;
}

/** Adds a level below the last one (BR-ORG-b). */
export async function addStructureLevel(
  tx: UserTx,
  names: LevelNames,
): Promise<StructureOutcome<StructureLevelRow>> {
  await lockStructure(tx);
  if (await structureLevelsLocked(tx)) return { ok: false, refusal: 'levels_locked' };
  const levels = await listStructureLevels(tx);
  const ordinal = (levels.at(-1)?.ordinal ?? 0) + 1;
  if (ordinal > MAX_STRUCTURE_LEVELS) return { ok: false, refusal: 'too_many_levels' };
  let id: string;
  try {
    const [row] = await tx.execute<{ id: string }>(sql`
      insert into platform.structure_levels (ordinal, name_en, name_ar)
      values (${ordinal}, ${names.nameEn}, ${names.nameAr})
      returning id`);
    if (!row) throw new Error('addStructureLevel: no row returned');
    id = row.id;
  } catch (error) {
    return { ok: false, refusal: structureRefusalOf(error) };
  }
  return { ok: true, before: null, after: await levelById(tx, id) };
}

/** Renames a level (its place never changes). */
export async function renameStructureLevel(
  tx: UserTx,
  id: string,
  version: number,
  names: LevelNames,
): Promise<StructureOutcome<StructureLevelRow>> {
  await lockStructure(tx);
  const before = await levelById(tx, id);
  if (!before) return { ok: false, refusal: 'not_found' };
  if (before.version !== version) return { ok: false, refusal: 'version_conflict' };
  try {
    const rows = await tx.execute(sql`update platform.structure_levels
      set name_en = ${names.nameEn}, name_ar = ${names.nameAr}
      where id = ${id}::uuid and version = ${version}
      returning id`);
    if (rows.length === 0) return { ok: false, refusal: 'version_conflict' };
  } catch (error) {
    return { ok: false, refusal: structureRefusalOf(error) };
  }
  return { ok: true, before, after: await levelById(tx, id) };
}

/** Removes the last level when no live unit uses it (never the only one). */
export async function removeStructureLevel(
  tx: UserTx,
  id: string,
  version: number,
): Promise<StructureOutcome<StructureLevelRow>> {
  await lockStructure(tx);
  const levels = await listStructureLevels(tx);
  const before = levels.find((level) => level.id === id) ?? null;
  if (!before) return { ok: false, refusal: 'not_found' };
  if (before.version !== version) return { ok: false, refusal: 'version_conflict' };
  if (await structureLevelsLocked(tx)) return { ok: false, refusal: 'levels_locked' };
  if (before.ordinal === 1) return { ok: false, refusal: 'only_level' };
  if (before.ordinal !== levels.at(-1)?.ordinal) return { ok: false, refusal: 'not_last_level' };
  // Units at this level or deeper (none deeper: this is the last level).
  if (before.unitCount > 0) {
    return {
      ok: false,
      refusal: 'level_in_use',
      usage: { units: before.unitCount, people: 0, roles: 0 },
    };
  }
  try {
    const rows = await tx.execute(
      sql`delete from platform.structure_levels where id = ${id}::uuid and version = ${version} returning id`,
    );
    if (rows.length === 0) return { ok: false, refusal: 'version_conflict' };
  } catch (error) {
    return { ok: false, refusal: structureRefusalOf(error) };
  }
  return { ok: true, before, after: null };
}

export interface UnitInput {
  readonly code: string;
  readonly nameEn: string;
  readonly nameAr: string;
  readonly branchId: string | null;
  readonly headPersonId: string | null;
  /** WP-HR-01: written only once the column exists (deploy window). */
  readonly defaultCostCentreId: string | null;
}

async function unitById(tx: UserTx, id: string): Promise<StructureUnitRow | null> {
  return (await listStructureUnits(tx)).find((unit) => unit.id === id) ?? null;
}

/** Creates a unit at the top (parentId null) or under a unit (one level below it). */
export async function createStructureUnit(
  tx: UserTx,
  parentId: string | null,
  input: UnitInput,
): Promise<StructureOutcome<StructureUnitRow>> {
  await lockStructure(tx);
  const units = await listStructureUnits(tx);
  if (parentId !== null && !units.some((unit) => unit.id === parentId)) {
    return { ok: false, refusal: 'parent_not_found' };
  }
  const siblings = units.filter((unit) => unit.parentId === parentId);
  const sortOrder = siblings.reduce((max, unit) => Math.max(max, unit.sortOrder + 1), 0);
  // The default cost centre once its column exists (deploy window, expand-first).
  const completed = await structureCompletionExists(tx);
  const costCentreColumn = completed ? sql`, default_cost_centre_id` : sql``;
  const costCentreValue = completed ? sql`, ${input.defaultCostCentreId}::uuid` : sql``;
  let id: string;
  try {
    const [row] = await tx.execute<{ id: string }>(sql`
      insert into platform.departments (code, name_ar, name_en, parent_id, branch_id, head_person_id, sort_order
                                        ${costCentreColumn})
      values (${input.code}, ${input.nameAr}, ${input.nameEn}, ${parentId}::uuid, ${input.branchId}::uuid,
              ${input.headPersonId}::uuid, ${sortOrder} ${costCentreValue})
      returning id`);
    if (!row) throw new Error('createStructureUnit: no row returned');
    id = row.id;
  } catch (error) {
    return { ok: false, refusal: structureRefusalOf(error) };
  }
  return { ok: true, before: null, after: await unitById(tx, id) };
}

async function writeUnit(
  tx: UserTx,
  id: string,
  version: number,
  change: () => Promise<readonly unknown[]>,
): Promise<StructureOutcome<StructureUnitRow>> {
  await lockStructure(tx);
  const before = await unitById(tx, id);
  if (!before) return { ok: false, refusal: 'not_found' };
  if (before.version !== version) return { ok: false, refusal: 'version_conflict' };
  try {
    // Zero rows: changed meanwhile by a write that does not take the lock (e.g. a head handed over).
    if ((await change()).length === 0) return { ok: false, refusal: 'version_conflict' };
  } catch (error) {
    return { ok: false, refusal: structureRefusalOf(error) };
  }
  return { ok: true, before, after: await unitById(tx, id) };
}

/** Changes a unit's names, code, branch and head (its place and level stay). */
export function updateStructureUnit(
  tx: UserTx,
  id: string,
  version: number,
  input: UnitInput,
): Promise<StructureOutcome<StructureUnitRow>> {
  return writeUnit(tx, id, version, async () => {
    const costCentre = (await structureCompletionExists(tx))
      ? sql`, default_cost_centre_id = ${input.defaultCostCentreId}::uuid`
      : sql``;
    return tx.execute(sql`update platform.departments
      set code = ${input.code}, name_ar = ${input.nameAr}, name_en = ${input.nameEn},
          branch_id = ${input.branchId}::uuid, head_person_id = ${input.headPersonId}::uuid ${costCentre}
      where id = ${id}::uuid and version = ${version} and deleted_at is null
      returning id`);
  });
}

/** Activates or deactivates a unit (a deactivated unit keeps its people; a role limited to it grants nothing). */
export function setStructureUnitStatus(
  tx: UserTx,
  id: string,
  version: number,
  status: UnitStatus,
): Promise<StructureOutcome<StructureUnitRow>> {
  return writeUnit(tx, id, version, () =>
    tx.execute(sql`update platform.departments set status = ${status}
      where id = ${id}::uuid and version = ${version} and deleted_at is null
      returning id`),
  );
}

/**
 * Deletes (soft) a unit nothing points at any more: no live units under it, no active people placed in it,
 * no role scope (BR-ORG-c). The refusal carries the numbers.
 */
export async function deleteStructureUnit(
  tx: UserTx,
  id: string,
  version: number,
): Promise<StructureOutcome<StructureUnitRow>> {
  await lockStructure(tx);
  const before = await unitById(tx, id);
  if (!before) return { ok: false, refusal: 'not_found' };
  if (before.version !== version) return { ok: false, refusal: 'version_conflict' };
  const usage: UnitUsage = {
    units: before.childCount,
    people: before.peopleCount,
    roles: before.roleScopeCount,
  };
  if (usage.units + usage.people + usage.roles > 0) {
    return { ok: false, refusal: 'unit_in_use', usage };
  }
  try {
    const rows = await tx.execute(sql`update platform.departments set deleted_at = now()
      where id = ${id}::uuid and version = ${version} and deleted_at is null
      returning id`);
    if (rows.length === 0) return { ok: false, refusal: 'version_conflict' };
  } catch (error) {
    const refusal = structureRefusalOf(error);
    return refusal === 'unit_in_use' ? { ok: false, refusal, usage } : { ok: false, refusal };
  }
  return { ok: true, before, after: null };
}

// ---------------------------------------------------------------------------------------------------
// Moving and ordering units (WP-HR-01; business flow EP-ORG-structure-completion.md §3 B, C)
// ---------------------------------------------------------------------------------------------------

/** The unit and every live unit below it. */
function subtreeIds(units: readonly StructureUnitRow[], id: string): readonly string[] {
  const out: string[] = [id];
  for (let at = 0; at < out.length; at += 1) {
    for (const unit of units) if (unit.parentId === out[at]) out.push(unit.id);
  }
  return out;
}

/** A unit and its ancestors, nearest first (none for null). */
function ancestorIds(units: readonly StructureUnitRow[], id: string | null): readonly string[] {
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const out: string[] = [];
  for (let at = id; at !== null && out.length < 20; at = byId.get(at)?.parentId ?? null) {
    if (!byId.has(at)) break;
    out.push(at);
  }
  return out;
}

/**
 * Why a move cannot be made, read before the database is asked (it refuses the same: JO003, cycles): the unit or
 * the parent is missing, the parent is the unit or below it, or the parent's level is not the old parent's.
 */
function moveRefusal(
  units: readonly StructureUnitRow[],
  unit: StructureUnitRow,
  parentId: string | null,
): StructureRefusal | null {
  if (parentId === null) return unit.parentId === null ? null : 'level_changes';
  const parent = units.find((candidate) => candidate.id === parentId);
  if (!parent) return 'parent_not_found';
  if (subtreeIds(units, unit.id).includes(parentId)) return 'move_into_itself';
  const oldParent = units.find((candidate) => candidate.id === unit.parentId);
  if (!oldParent || oldParent.levelOrdinal !== parent.levelOrdinal) return 'level_changes';
  return null;
}

/** Someone whose view of the moved units changes: a department-limited role holder or a unit head. */
export interface MoveVisibilityChange {
  readonly personId: string;
  readonly nameAr: string | null;
  readonly nameEn: string | null;
  /** `role`: a department-limited custom role on `unitId`; `head`: the head of `unitId`. */
  readonly kind: 'role' | 'head';
  readonly roleNameEn: string | null;
  readonly roleNameAr: string | null;
  /** The unit their role or headship is on. */
  readonly unitId: string;
  readonly change: 'gains' | 'loses';
}

/** What a move would change (the preview, before anything is written). */
export interface UnitMovePreview {
  readonly unitId: string;
  readonly fromParentId: string | null;
  readonly toParentId: string | null;
  /** The unit and the live units below it (they all move). */
  readonly unitIds: readonly string[];
  /** Active people placed in those units. */
  readonly peopleCount: number;
  readonly changes: readonly MoveVisibilityChange[];
  /** Open planning cycles that include any of the moved units (their approvals follow the new place). */
  readonly openCycles: readonly { readonly nameEn: string; readonly nameAr: string }[];
}

export type MovePreviewOutcome =
  | { readonly ok: true; readonly preview: UnitMovePreview }
  | { readonly ok: false; readonly refusal: StructureRefusal };

/**
 * The preview of moving a unit under another (or to the top): how many units and people move, and who sees more
 * or less — holders of a department-limited role on a unit above the old place but not the new one lose the moved
 * units; above the new place but not the old one gain them; the same for unit heads (TM-0004 SR-STE02-04).
 */
export async function previewStructureUnitMove(
  tx: UserTx,
  id: string,
  parentId: string | null,
): Promise<MovePreviewOutcome> {
  const units = await listStructureUnits(tx);
  const unit = units.find((candidate) => candidate.id === id);
  if (!unit) return { ok: false, refusal: 'not_found' };
  if (unit.parentId === parentId) return { ok: false, refusal: 'parent_not_found' };
  const refusal = moveRefusal(units, unit, parentId);
  if (refusal) return { ok: false, refusal };

  const moved = subtreeIds(units, id);
  const oldAbove = ancestorIds(units, unit.parentId);
  const newAbove = ancestorIds(units, parentId);
  const loses = oldAbove.filter((unitId) => !newAbove.includes(unitId));
  const gains = newAbove.filter((unitId) => !oldAbove.includes(unitId));
  const peopleCount = moved.reduce(
    (sum, unitId) => sum + (units.find((candidate) => candidate.id === unitId)?.peopleCount ?? 0),
    0,
  );
  const changes: MoveVisibilityChange[] = [];
  const affected = [...loses, ...gains];
  if (affected.length > 0) {
    const ids = sql.join(
      affected.map((unitId) => sql`${unitId}::uuid`),
      sql`, `,
    );
    const roles = (await roleScopeUnitsExist(tx))
      ? await tx.execute<{
          person_id: string;
          name_ar: string | null;
          name_en: string | null;
          role_name_en: string | null;
          role_name_ar: string | null;
          unit_id: string;
        }>(sql`
          select p.id as person_id, p.display_name_ar as name_ar, p.display_name_en as name_en,
                 cr.name_en as role_name_en, cr.name_ar as role_name_ar, ra.scope_unit_id as unit_id
          from platform.role_assignments ra
          join platform.tenant_memberships m on m.tenant_id = ra.tenant_id and m.id = ra.membership_id
          join platform.persons p on p.tenant_id = m.tenant_id and p.id = m.person_id
          join platform.custom_roles cr on cr.tenant_id = ra.tenant_id and cr.code = ra.role_code
          where ra.scope_unit_id in (${ids}) and m.status <> 'revoked' and cr.data_scope = 'departments'
            and (ra.valid_until is null or ra.valid_until > now())
          order by coalesce(p.display_name_en, p.display_name_ar), p.id`)
      : [];
    for (const row of roles) {
      changes.push({
        personId: row.person_id,
        nameAr: row.name_ar,
        nameEn: row.name_en,
        kind: 'role',
        roleNameEn: row.role_name_en,
        roleNameAr: row.role_name_ar,
        unitId: row.unit_id,
        change: loses.includes(row.unit_id) ? 'loses' : 'gains',
      });
    }
    for (const unitId of affected) {
      const above = units.find((candidate) => candidate.id === unitId);
      if (!above?.headPersonId) continue;
      changes.push({
        personId: above.headPersonId,
        nameAr: above.headNameAr,
        nameEn: above.headNameEn,
        kind: 'head',
        roleNameEn: null,
        roleNameAr: null,
        unitId,
        change: loses.includes(unitId) ? 'loses' : 'gains',
      });
    }
  }
  return {
    ok: true,
    preview: {
      unitId: id,
      fromParentId: unit.parentId,
      toParentId: parentId,
      unitIds: moved,
      peopleCount,
      changes,
      openCycles: await unitsInOpenPlanCycles(tx, moved),
    },
  };
}

/**
 * The open planning cycles that include any of these units (private.units_in_open_plan_cycles, migration
 * 20261103100300: the HR Manager reads no cycle otherwise). None before the migration (deploy window).
 */
async function unitsInOpenPlanCycles(
  tx: UserTx,
  unitIds: readonly string[],
): Promise<readonly { readonly nameEn: string; readonly nameAr: string }[]> {
  if (unitIds.length === 0) return [];
  const [present] = await tx.execute<{ present: boolean }>(sql`
    select to_regprocedure('private.units_in_open_plan_cycles(uuid[])') is not null as present`);
  if (present?.present !== true) return [];
  const ids = sql.join(
    unitIds.map((unitId) => sql`${unitId}::uuid`),
    sql`, `,
  );
  const rows = await tx.execute<{ name_en: string; name_ar: string }>(sql`
    select c.name_en, c.name_ar from private.units_in_open_plan_cycles(array[${ids}]::uuid[]) c`);
  return rows.map((r) => ({ nameEn: r.name_en, nameAr: r.name_ar }));
}

/**
 * Moves a unit (and everything below it) under another unit of its parent's level, or keeps a top unit at the top
 * (BR-ORG-i): last among its new siblings. What people see follows at once (EP-ORG BR-ORG-e).
 */
export async function moveStructureUnit(
  tx: UserTx,
  id: string,
  version: number,
  parentId: string | null,
): Promise<StructureOutcome<StructureUnitRow>> {
  await lockStructure(tx);
  const units = await listStructureUnits(tx);
  const before = units.find((candidate) => candidate.id === id) ?? null;
  if (!before) return { ok: false, refusal: 'not_found' };
  if (before.version !== version) return { ok: false, refusal: 'version_conflict' };
  if (before.parentId === parentId) return { ok: false, refusal: 'parent_not_found' };
  const refusal = moveRefusal(units, before, parentId);
  if (refusal) return { ok: false, refusal };
  const sortOrder = units
    .filter((unit) => unit.parentId === parentId)
    .reduce((max, unit) => Math.max(max, unit.sortOrder + 1), 0);
  try {
    const rows = await tx.execute(sql`update platform.departments
      set parent_id = ${parentId}::uuid, sort_order = ${sortOrder}
      where id = ${id}::uuid and version = ${version} and deleted_at is null
      returning id`);
    if (rows.length === 0) return { ok: false, refusal: 'version_conflict' };
  } catch (error) {
    return { ok: false, refusal: structureRefusalOf(error) };
  }
  return { ok: true, before, after: await unitById(tx, id) };
}

/**
 * Puts a unit at a position among the units under the same parent (drag-and-drop; «Move up» / «Move down» are
 * the position before or after). The order is the same for everyone: tree, pickers and lists.
 */
export async function reorderStructureUnit(
  tx: UserTx,
  id: string,
  version: number,
  position: number,
): Promise<StructureOutcome<StructureUnitRow>> {
  await lockStructure(tx);
  const units = await listStructureUnits(tx);
  const before = units.find((candidate) => candidate.id === id) ?? null;
  if (!before) return { ok: false, refusal: 'not_found' };
  if (before.version !== version) return { ok: false, refusal: 'version_conflict' };
  // Siblings in their current order (listStructureUnits: sort order, then Arabic name).
  const siblings = units.filter((unit) => unit.parentId === before.parentId && unit.id !== id);
  const at = Math.max(0, Math.min(position, siblings.length));
  const ordered = [...siblings.slice(0, at), before, ...siblings.slice(at)];
  for (const [index, unit] of ordered.entries()) {
    if (unit.sortOrder === index) continue;
    await tx.execute(sql`update platform.departments set sort_order = ${index}
      where id = ${unit.id}::uuid and deleted_at is null`);
  }
  return { ok: true, before, after: await unitById(tx, id) };
}
