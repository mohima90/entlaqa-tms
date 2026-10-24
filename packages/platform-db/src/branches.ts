import 'server-only';
import { sql } from 'drizzle-orm';
import { structureCompletionExists } from './custom-roles-present';
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

/** One working day of a branch's own week (WP-HR-01): 0 = Sunday … 6 = Saturday, hours as HH:MM. */
export interface BranchWorkingDay {
  readonly day: number;
  readonly startsAt: string;
  readonly endsAt: string;
}

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
  /** WP-HR-01 (null before the migration): the address, the typed location, … */
  readonly addressEn: string | null;
  readonly addressAr: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  /** … and the branch's own working week, by day; null = «Same as the organization». */
  readonly workingDays: readonly BranchWorkingDay[] | null;
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
  /** WP-HR-01: written only once the columns exist (deploy window). */
  readonly addressEn: string | null;
  readonly addressAr: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  /** Null: «Same as the organization» (the branch's own week removed). */
  readonly workingDays: readonly BranchWorkingDay[] | null;
}

export type BranchRefusal =
  | 'not_found'
  | 'version_conflict'
  | 'code_taken'
  | 'timezone_unknown'
  | 'parent_not_found'
  | 'branch_tree'
  | 'branch_in_use'
  /** WP-HR-01: both coordinates or neither, within range. */
  | 'location_invalid'
  /** WP-HR-01: a working day's end after its start, whole minutes. */
  | 'hours_invalid'
  | 'address_invalid';

export interface BranchUsage {
  readonly branches: number;
  readonly units: number;
  readonly people: number;
}

export type BranchOutcome =
  | {
      readonly ok: true;
      readonly before: BranchRow | null;
      readonly after: BranchRow | null;
      /** The branch that stopped being the headquarters because this one became it (C-9: audited). */
      readonly headquartersMovedFrom?: string | null;
    }
  | { readonly ok: false; readonly refusal: BranchRefusal; readonly usage?: BranchUsage };

/** The live branches, headquarters first, then by Arabic name. */
export async function listBranches(tx: UserTx): Promise<readonly BranchRow[]> {
  const completed = await structureCompletionExists(tx);
  const details = completed
    ? sql`b.address_en, b.address_ar, b.latitude::text as latitude, b.longitude::text as longitude,
          (select jsonb_agg(jsonb_build_object('day', w.day, 'startsAt', to_char(w.starts_at, 'HH24:MI'),
                                               'endsAt', to_char(w.ends_at, 'HH24:MI')) order by w.day)
           from platform.branch_working_days w
           where w.tenant_id = b.tenant_id and w.branch_id = b.id) as working_days`
    : sql`null::text as address_en, null::text as address_ar, null::text as latitude, null::text as longitude,
          null::jsonb as working_days`;
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
    address_en: string | null;
    address_ar: string | null;
    latitude: string | null;
    longitude: string | null;
    working_days: BranchWorkingDay[] | null;
    status: BranchStatus;
    version: number;
    child_count: number | string;
    unit_count: number | string;
    people_count: number | string;
  }>(sql`
    select b.id, b.code, b.name_ar, b.name_en, b.parent_branch_id, b.country_code, b.city_ar, b.city_en,
           b.timezone, b.is_headquarters, ${details}, b.status, b.version,
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
    addressEn: r.address_en,
    addressAr: r.address_ar,
    latitude: r.latitude === null ? null : Number(r.latitude),
    longitude: r.longitude === null ? null : Number(r.longitude),
    workingDays: r.working_days,
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
    if (pg.constraint === 'branches_location_check') return 'location_invalid';
    if (pg.constraint === 'branches_address_check') return 'address_invalid';
    if (pg.constraint?.startsWith('branch_working_days_') === true) return 'hours_invalid';
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

/** Writes a branch's address, location and own working week (WP-HR-01), once the columns exist. */
async function writeBranchDetails(tx: UserTx, id: string, input: BranchInput): Promise<void> {
  if (!(await structureCompletionExists(tx))) return;
  await tx.execute(sql`update platform.branches
    set address_en = ${input.addressEn}, address_ar = ${input.addressAr},
        latitude = ${input.latitude}::numeric, longitude = ${input.longitude}::numeric
    where id = ${id}::uuid and deleted_at is null
      and (address_en, address_ar, latitude, longitude) is distinct from
          (${input.addressEn}, ${input.addressAr}, ${input.latitude}::numeric, ${input.longitude}::numeric)`);
  const days = input.workingDays ?? [];
  // «Same as the organization» (null) removes every day of the branch's own week; `not in (null)` would
  // match nothing.
  const dropped =
    days.length > 0
      ? sql`and day not in (${sql.join(
          days.map((d) => sql`${d.day}::smallint`),
          sql`, `,
        )})`
      : sql``;
  await tx.execute(sql`delete from platform.branch_working_days
    where branch_id = ${id}::uuid ${dropped}`);
  for (const d of days) {
    await tx.execute(sql`insert into platform.branch_working_days (branch_id, day, starts_at, ends_at)
      values (${id}::uuid, ${d.day}, ${d.startsAt}::time, ${d.endsAt}::time)
      on conflict (tenant_id, branch_id, day) do update
        set starts_at = excluded.starts_at, ends_at = excluded.ends_at
        where (platform.branch_working_days.starts_at, platform.branch_working_days.ends_at)
              is distinct from (excluded.starts_at, excluded.ends_at)`);
  }
}

async function branchById(tx: UserTx, id: string): Promise<BranchRow | null> {
  return (await listBranches(tx)).find((branch) => branch.id === id) ?? null;
}

/** The headquarters flag moves: an organization has one headquarters (branches_tenant_headquarters_uq). */
async function clearHeadquarters(tx: UserTx, except: string | null): Promise<string | null> {
  const rows = await tx.execute<{
    id: string;
  }>(sql`update platform.branches set is_headquarters = false
    where is_headquarters and deleted_at is null and (${except}::uuid is null or id <> ${except}::uuid)
    returning id`);
  return rows[0]?.id ?? null;
}

export async function createBranch(tx: UserTx, input: BranchInput): Promise<BranchOutcome> {
  await lockBranches(tx);
  let id: string;
  let movedFrom: string | null = null;
  try {
    if (input.isHeadquarters) movedFrom = await clearHeadquarters(tx, null);
    const [row] = await tx.execute<{ id: string }>(sql`
      insert into platform.branches (code, name_ar, name_en, parent_branch_id, country_code, city_ar, city_en,
                                     timezone, is_headquarters)
      values (${input.code}, ${input.nameAr}, ${input.nameEn}, ${input.parentBranchId}::uuid, ${input.countryCode},
              ${input.cityAr}, ${input.cityEn}, ${input.timezone}, ${input.isHeadquarters})
      returning id`);
    if (!row) throw new Error('createBranch: no row returned');
    id = row.id;
    await writeBranchDetails(tx, id, input);
  } catch (error) {
    return { ok: false, refusal: branchRefusalOf(error) };
  }
  return {
    ok: true,
    before: null,
    after: await branchById(tx, id),
    headquartersMovedFrom: movedFrom,
  };
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
  let movedFrom: string | null = null;
  const written = writeBranch(tx, id, version, async () => {
    if (input.isHeadquarters) movedFrom = await clearHeadquarters(tx, id);
    return tx
      .execute(
        sql`update platform.branches
      set code = ${input.code}, name_ar = ${input.nameAr}, name_en = ${input.nameEn},
          parent_branch_id = ${input.parentBranchId}::uuid, country_code = ${input.countryCode},
          city_ar = ${input.cityAr}, city_en = ${input.cityEn}, timezone = ${input.timezone},
          is_headquarters = ${input.isHeadquarters}
      where id = ${id}::uuid and version = ${version} and deleted_at is null
      returning id`,
      )
      .then(async (rows) => {
        if (rows.length > 0) await writeBranchDetails(tx, id, input);
        return rows;
      });
  });
  return written.then((outcome) =>
    outcome.ok && movedFrom !== null ? { ...outcome, headquartersMovedFrom: movedFrom } : outcome,
  );
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
