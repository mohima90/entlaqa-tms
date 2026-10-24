import 'server-only';
import { sql } from 'drizzle-orm';
import { structureCompletionExists } from './custom-roles-present';
import { pgError } from './user-admin';
import type { UserTx } from './with-user-tx';

/**
 * Cost centres (WP-HR-01; FR-ADM-05, FR-FIN-03; business flow EP-ORG-structure-completion.md §3 A, PO 24 Oct
 * 2026): the finance codes that pay for training. Kept by the HR Manager (`platform.org.manage`); each person has
 * one (person_employment.cost_centre_id), a unit may give a default to people placed in it. The calling actions
 * authorize and audit; the database repeats the rules (unique codes, active when picked, no delete while in use)
 * and the write policy (migration 20261103100000).
 */
export type CostCentreStatus = 'active' | 'inactive';

export interface CostCentreRow {
  readonly id: string;
  readonly code: string;
  readonly nameEn: string | null;
  readonly nameAr: string | null;
  readonly status: CostCentreStatus;
  readonly version: number;
  /** Active people with this cost centre … */
  readonly peopleCount: number;
  /** … and live units giving it as their default (with deactivated people: what keeps it from being deleted). */
  readonly unitCount: number;
}

/** A cost centre as a choice (person form, unit form, import). */
export interface CostCentreOption {
  readonly id: string;
  readonly code: string;
  readonly nameEn: string | null;
  readonly nameAr: string | null;
  readonly active: boolean;
}

export interface CostCentreInput {
  readonly code: string;
  readonly nameEn: string | null;
  readonly nameAr: string | null;
  readonly status: CostCentreStatus;
}

export type CostCentreRefusal = 'not_found' | 'version_conflict' | 'code_taken' | 'in_use';

export type CostCentreOutcome =
  | {
      readonly ok: true;
      readonly before: CostCentreRow | null;
      readonly after: CostCentreRow | null;
    }
  | {
      readonly ok: false;
      readonly refusal: CostCentreRefusal;
      readonly usage?: { readonly people: number; readonly units: number };
    };

/** The organization's cost centres by code (none before migration 20261103100000). */
export async function listCostCentres(tx: UserTx): Promise<readonly CostCentreRow[]> {
  if (!(await structureCompletionExists(tx))) return [];
  const rows = await tx.execute<{
    id: string;
    code: string;
    name_en: string | null;
    name_ar: string | null;
    status: CostCentreStatus;
    version: number;
    people_count: number | string;
    unit_count: number | string;
  }>(sql`
    select c.id, c.code, c.name_en, c.name_ar, c.status, c.version,
           (select count(*) from platform.person_employment e
            join platform.persons p on p.tenant_id = e.tenant_id and p.id = e.person_id
            where e.tenant_id = c.tenant_id and e.cost_centre_id = c.id and p.status = 'active') as people_count,
           (select count(*) from platform.departments d
            where d.tenant_id = c.tenant_id and d.default_cost_centre_id = c.id and d.deleted_at is null) as unit_count
    from platform.cost_centres c
    order by lower(c.code), c.id`);
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    nameEn: r.name_en,
    nameAr: r.name_ar,
    status: r.status,
    version: r.version,
    peopleCount: Number(r.people_count),
    unitCount: Number(r.unit_count),
  }));
}

/** The cost centres as choices (active and inactive: forms offer active ones, names show both). */
export async function listCostCentreOptions(tx: UserTx): Promise<readonly CostCentreOption[]> {
  if (!(await structureCompletionExists(tx))) return [];
  const rows = await tx.execute<{
    id: string;
    code: string;
    name_en: string | null;
    name_ar: string | null;
    status: CostCentreStatus;
  }>(sql`
    select c.id, c.code, c.name_en, c.name_ar, c.status from platform.cost_centres c order by lower(c.code), c.id`);
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    nameEn: r.name_en,
    nameAr: r.name_ar,
    active: r.status === 'active',
  }));
}

/** Maps a database refusal of a cost-centre write to a reason; rethrows anything else. */
export function costCentreRefusalOf(error: unknown): CostCentreRefusal {
  const pg = pgError(error);
  if (pg?.code === '23505' && pg.constraint === 'cost_centres_tenant_code_uq') return 'code_taken';
  // A delete refused by a person's or a unit's reference (deactivated people count too).
  if (pg?.code === '23503') return 'in_use';
  throw error;
}

async function costCentreById(tx: UserTx, id: string): Promise<CostCentreRow | null> {
  return (await listCostCentres(tx)).find((row) => row.id === id) ?? null;
}

export async function createCostCentre(
  tx: UserTx,
  input: CostCentreInput,
): Promise<CostCentreOutcome> {
  let id: string;
  try {
    const [row] = await tx.execute<{ id: string }>(sql`
      insert into platform.cost_centres (code, name_en, name_ar, status)
      values (${input.code}, ${input.nameEn}, ${input.nameAr}, ${input.status})
      returning id`);
    if (!row) throw new Error('createCostCentre: no row returned');
    id = row.id;
  } catch (error) {
    return { ok: false, refusal: costCentreRefusalOf(error) };
  }
  return { ok: true, before: null, after: await costCentreById(tx, id) };
}

/** Changes a cost centre's code, names and status (a deactivated one stays on the people who have it). */
export async function updateCostCentre(
  tx: UserTx,
  id: string,
  version: number,
  input: CostCentreInput,
): Promise<CostCentreOutcome> {
  const before = await costCentreById(tx, id);
  if (!before) return { ok: false, refusal: 'not_found' };
  if (before.version !== version) return { ok: false, refusal: 'version_conflict' };
  try {
    const rows = await tx.execute(sql`update platform.cost_centres
      set code = ${input.code}, name_en = ${input.nameEn}, name_ar = ${input.nameAr}, status = ${input.status}
      where id = ${id}::uuid and version = ${version}
      returning id`);
    if (rows.length === 0) return { ok: false, refusal: 'version_conflict' };
  } catch (error) {
    return { ok: false, refusal: costCentreRefusalOf(error) };
  }
  return { ok: true, before, after: await costCentreById(tx, id) };
}

/** Deletes a cost centre nobody has and no unit gives (else: deactivate it). */
export async function deleteCostCentre(
  tx: UserTx,
  id: string,
  version: number,
): Promise<CostCentreOutcome> {
  const before = await costCentreById(tx, id);
  if (!before) return { ok: false, refusal: 'not_found' };
  if (before.version !== version) return { ok: false, refusal: 'version_conflict' };
  const usage = { people: before.peopleCount, units: before.unitCount };
  if (usage.people + usage.units > 0) return { ok: false, refusal: 'in_use', usage };
  try {
    const rows = await tx.execute(
      sql`delete from platform.cost_centres where id = ${id}::uuid and version = ${version} returning id`,
    );
    if (rows.length === 0) return { ok: false, refusal: 'version_conflict' };
  } catch (error) {
    const refusal = costCentreRefusalOf(error);
    return refusal === 'in_use' ? { ok: false, refusal, usage } : { ok: false, refusal };
  }
  return { ok: true, before, after: null };
}
