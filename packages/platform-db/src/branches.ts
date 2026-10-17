import 'server-only';
import { sql } from 'drizzle-orm';
import { pgError } from './user-admin';
import type { UserTx } from './with-user-tx';

/**
 * Branches of the organization (FR-ADM-04 core fields that exist in platform.branches: code, names, parent
 * branch, country, city, time zone, headquarters flag, status; GPS, working week and hours come with the
 * working calendars). Maintained by the HR Manager (`platform.org.manage`; PO 11 Oct 2026, T-M2-19); the
 * calling actions authorize and audit. The database checks the rest: a code unique among live branches, one
 * headquarters, a time zone it knows, the branch tree (no cycles, at most 10 levels), and no delete while
 * sub-branches, units or active people still belong to the branch. Writes take the organization's branch lock
 * (the advisory lock of private.check_tree on platform.branches) first.
 */
export type BranchStatus = 'active' | 'inactive';

export interface BranchRow {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly parentBranchId: string | null;
  readonly countryCode: string | null;
  readonly cityAr: string | null;
  readonly cityEn: string | null;
  readonly timezone: string;
  readonly isHeadquarters: boolean;
  readonly status: BranchStatus;
  readonly version: number;
  /** What keeps the branch from being deleted: live sub-branches, live units, active people. */
  readonly childCount: number;
  readonly unitCount: number;
  readonly peopleCount: number;
}

export interface BranchInput {
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly parentBranchId: string | null;
  readonly countryCode: string | null;
  readonly cityAr: string | null;
  readonly cityEn: string | null;
  readonly timezone: string;
  readonly isHeadquarters: boolean;
}

export type BranchRefusal =
  | 'not_found'
  | 'version_conflict'
  | 'code_taken'
  | 'timezone_unknown'
  | 'parent_not_found'
  | 'branch_tree'
  | 'branch_in_use';

export interface BranchUsage {
  readonly branches: number;
  readonly units: number;
  readonly people: number;
}

export type BranchOutcome =
  | { readonly ok: true; readonly before: BranchRow | null; readonly after: BranchRow | null }
  | { readonly ok: false; readonly refusal: BranchRefusal; readonly usage?: BranchUsage };

/** The live branches, headquarters first, then by Arabic name. */
export async function listBranches(tx: UserTx): Promise<readonly BranchRow[]> {
  const rows = await tx.execute<{
    id: string;
    code: string;
    name_ar: string;
    name_en: string | null;
    parent_branch_id: string | null;
    country_code: string | null;
    city_ar: string | null;
    city_en: string | null;
    timezone: string;
    is_headquarters: boolean;
    status: BranchStatus;
    version: number;
    child_count: number | string;
    unit_count: number | string;
    people_count: number | string;
  }>(sql`
    select b.id, b.code, b.name_ar, b.name_en, b.parent_branch_id, b.country_code, b.city_ar, b.city_en,
           b.timezone, b.is_headquarters, b.status, b.version,
           (select count(*) from platform.branches c
            where c.tenant_id = b.tenant_id and c.parent_branch_id = b.id and c.deleted_at is null) as child_count,
           (select count(*) from platform.departments d
            where d.tenant_id = b.tenant_id and d.branch_id = b.id and d.deleted_at is null) as unit_count,
           (select count(*) from platform.person_employment e
            join platform.persons p on p.tenant_id = e.tenant_id and p.id = e.person_id
            where e.tenant_id = b.tenant_id and e.branch_id = b.id and p.status = 'active') as people_count
    from platform.branches b
    where b.deleted_at is null
    order by b.is_headquarters desc, b.name_ar, b.id`);
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    nameAr: r.name_ar,
    nameEn: r.name_en,
    parentBranchId: r.parent_branch_id,
    countryCode: r.country_code === null ? null : r.country_code.trim(),
    cityAr: r.city_ar,
    cityEn: r.city_en,
    timezone: r.timezone,
    isHeadquarters: r.is_headquarters,
    status: r.status,
    version: r.version,
    childCount: Number(r.child_count),
    unitCount: Number(r.unit_count),
    peopleCount: Number(r.people_count),
  }));
}

/** Maps a database refusal of a branch write to a reason; rethrows anything else. */
export function branchRefusalOf(error: unknown): BranchRefusal {
  const pg = pgError(error);
  if (pg?.code === '23505' && pg.constraint === 'branches_tenant_code_uq') return 'code_taken';
  if (pg?.code === '23503') return 'parent_not_found';
  if (pg?.code === '23514') {
    if (pg.message.includes('unknown time zone')) return 'timezone_unknown';
    if (pg.message.includes('still')) return 'branch_in_use';
    if (pg.message.includes('deleted parent')) return 'parent_not_found';
    return 'branch_tree';
  }
  throw error;
}

async function lockBranches(tx: UserTx): Promise<void> {
  // The organization's branch lock (private.check_tree on platform.branches), then its unit lock: the order
  // every other writer of both takes (person_employment, departments → branches) is departments first.
  await tx.execute(sql`select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('platform.departments:' || private.current_tenant_id()::text, 0))`);
  await tx.execute(sql`select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('platform.branches:' || private.current_tenant_id()::text, 0))`);
}

async function branchById(tx: UserTx, id: string): Promise<BranchRow | null> {
  return (await listBranches(tx)).find((branch) => branch.id === id) ?? null;
}

/** The headquarters flag moves: an organization has one headquarters (branches_tenant_headquarters_uq). */
async function clearHeadquarters(tx: UserTx, except: string | null): Promise<void> {
  await tx.execute(sql`update platform.branches set is_headquarters = false
    where is_headquarters and deleted_at is null and (${except}::uuid is null or id <> ${except}::uuid)`);
}

export async function createBranch(tx: UserTx, input: BranchInput): Promise<BranchOutcome> {
  await lockBranches(tx);
  let id: string;
  try {
    if (input.isHeadquarters) await clearHeadquarters(tx, null);
    const [row] = await tx.execute<{ id: string }>(sql`
      insert into platform.branches (code, name_ar, name_en, parent_branch_id, country_code, city_ar, city_en,
                                     timezone, is_headquarters)
      values (${input.code}, ${input.nameAr}, ${input.nameEn}, ${input.parentBranchId}::uuid, ${input.countryCode},
              ${input.cityAr}, ${input.cityEn}, ${input.timezone}, ${input.isHeadquarters})
      returning id`);
    if (!row) throw new Error('createBranch: no row returned');
    id = row.id;
  } catch (error) {
    return { ok: false, refusal: branchRefusalOf(error) };
  }
  return { ok: true, before: null, after: await branchById(tx, id) };
}

async function writeBranch(
  tx: UserTx,
  id: string,
  version: number,
  change: (before: BranchRow) => Promise<readonly unknown[]>,
): Promise<BranchOutcome> {
  await lockBranches(tx);
  const before = await branchById(tx, id);
  if (!before) return { ok: false, refusal: 'not_found' };
  if (before.version !== version) return { ok: false, refusal: 'version_conflict' };
  try {
    if ((await change(before)).length === 0) return { ok: false, refusal: 'version_conflict' };
  } catch (error) {
    return { ok: false, refusal: branchRefusalOf(error) };
  }
  return { ok: true, before, after: await branchById(tx, id) };
}

export function updateBranch(
  tx: UserTx,
  id: string,
  version: number,
  input: BranchInput,
): Promise<BranchOutcome> {
  return writeBranch(tx, id, version, async () => {
    if (input.isHeadquarters) await clearHeadquarters(tx, id);
    return tx.execute(sql`update platform.branches
      set code = ${input.code}, name_ar = ${input.nameAr}, name_en = ${input.nameEn},
          parent_branch_id = ${input.parentBranchId}::uuid, country_code = ${input.countryCode},
          city_ar = ${input.cityAr}, city_en = ${input.cityEn}, timezone = ${input.timezone},
          is_headquarters = ${input.isHeadquarters}
      where id = ${id}::uuid and version = ${version} and deleted_at is null
      returning id`);
  });
}

export function setBranchStatus(
  tx: UserTx,
  id: string,
  version: number,
  status: BranchStatus,
): Promise<BranchOutcome> {
  return writeBranch(tx, id, version, () =>
    tx.execute(sql`update platform.branches set status = ${status}
      where id = ${id}::uuid and version = ${version} and deleted_at is null
      returning id`),
  );
}

/** Deletes (soft) a branch nothing belongs to any more; the refusal carries the numbers. */
export async function deleteBranch(
  tx: UserTx,
  id: string,
  version: number,
): Promise<BranchOutcome> {
  await lockBranches(tx);
  const before = await branchById(tx, id);
  if (!before) return { ok: false, refusal: 'not_found' };
  if (before.version !== version) return { ok: false, refusal: 'version_conflict' };
  const usage: BranchUsage = {
    branches: before.childCount,
    units: before.unitCount,
    people: before.peopleCount,
  };
  if (usage.branches + usage.units + usage.people > 0) {
    return { ok: false, refusal: 'branch_in_use', usage };
  }
  try {
    const rows = await tx.execute(sql`update platform.branches set deleted_at = now()
      where id = ${id}::uuid and version = ${version} and deleted_at is null
      returning id`);
    if (rows.length === 0) return { ok: false, refusal: 'version_conflict' };
  } catch (error) {
    const refusal = branchRefusalOf(error);
    return refusal === 'branch_in_use' ? { ok: false, refusal, usage } : { ok: false, refusal };
  }
  return { ok: true, before, after: null };
}
