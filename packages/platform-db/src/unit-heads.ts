import 'server-only';
import { sql } from 'drizzle-orm';
import type { UserTx } from './with-user-tx';

/**
 * A unit's «Head» as the role forms need it (WP-FIX-03, PO 12 Nov 2026: the Department Head role and a
 * unit's head set each other — «either door does both»; FR-ADM-05, FR-IAM-03/04). Reads and the two narrow
 * writes of platform.departments.head_person_id the role forms make; the database keeps the last word
 * (private.check_department_writer: `platform.org.manage` organization-wide; private.check_department_refs:
 * the head is an active person).
 */
export interface UnitHead {
  readonly unitId: string;
  readonly personId: string;
  /** Null for a person with an English name only, or a name the member may not read. */
  readonly nameAr: string | null;
  readonly nameEn: string | null;
}

/** The head of every live unit that has one. */
export async function listUnitHeads(tx: UserTx): Promise<readonly UnitHead[]> {
  const rows = await tx.execute<{
    id: string;
    head_person_id: string;
    name_ar: string | null;
    name_en: string | null;
  }>(sql`
    select d.id, d.head_person_id, p.display_name_ar as name_ar, p.display_name_en as name_en
    from platform.departments d
    left join platform.persons p on p.tenant_id = d.tenant_id and p.id = d.head_person_id
    where d.deleted_at is null and d.head_person_id is not null
    order by d.id`);
  return rows.map((r) => ({
    unitId: r.id,
    personId: r.head_person_id,
    nameAr: r.name_ar,
    nameEn: r.name_en,
  }));
}

/** The live units a person heads (ids, in a stable order). */
export async function listHeadedUnitIds(tx: UserTx, personId: string): Promise<readonly string[]> {
  const rows = await tx.execute<{ id: string }>(sql`
    select d.id from platform.departments d
    where d.head_person_id = ${personId}::uuid and d.deleted_at is null
    order by d.sort_order, d.name_ar, d.id`);
  return rows.map((r) => r.id);
}

/**
 * Before a role change that also changes a unit's head (WP-FIX-03): the per-organization locks in the
 * global order — departments → (branches) → person_employment → role_assignments (migration
 * 20261011090000) — so it never waits for a structure change, a deactivation or a new direct manager that
 * waits for it. Call BEFORE the role lock (lockTenantRoles); both locks are re-entrant and end with the
 * transaction.
 */
export async function lockUnitHeadChange(tx: UserTx): Promise<void> {
  await tx.execute(sql`select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('platform.departments:' || private.current_tenant_id()::text, 0))`);
  await tx.execute(sql`select private.lock_person_employment(private.current_tenant_id())`);
}

export type SetUnitHeadOutcome =
  | {
      readonly ok: true;
      readonly unitId: string;
      /** The head before (null: none); equal to the new head when nothing changed. */
      readonly before: string | null;
      readonly changed: boolean;
    }
  | {
      readonly ok: false;
      readonly refusal: 'unit_not_found' | 'unit_inactive' | 'person_not_active' | 'head_taken';
      /** `head_taken`: who heads the unit now. */
      readonly headPersonId?: string;
    };

/**
 * Makes an active person the head of a live, active unit. A unit that has another head is changed only
 * with `replace` (the form asked first). Every rule is read before the write, under the row lock, so a
 * refusal never aborts the caller's transaction.
 */
export async function setUnitHead(
  tx: UserTx,
  unitId: string,
  personId: string,
  options: { readonly replace: boolean },
): Promise<SetUnitHeadOutcome> {
  const [unit] = await tx.execute<{ status: string; head_person_id: string | null }>(sql`
    select d.status, d.head_person_id from platform.departments d
    where d.id = ${unitId}::uuid and d.deleted_at is null
    for update`);
  if (!unit) return { ok: false, refusal: 'unit_not_found' };
  if (unit.status !== 'active') return { ok: false, refusal: 'unit_inactive' };
  if (unit.head_person_id === personId) {
    return { ok: true, unitId, before: personId, changed: false };
  }
  const [person] = await tx.execute<{ active: boolean }>(sql`
    select p.status = 'active' as active from platform.persons p where p.id = ${personId}::uuid`);
  if (person?.active !== true) return { ok: false, refusal: 'person_not_active' };
  if (unit.head_person_id !== null && !options.replace) {
    return { ok: false, refusal: 'head_taken', headPersonId: unit.head_person_id };
  }
  const written = await tx.execute<{ id: string }>(sql`
    update platform.departments set head_person_id = ${personId}::uuid
    where id = ${unitId}::uuid and deleted_at is null
    returning id`);
  // A row the actor may read but not write is filtered by the update policy without an error: never
  // report a head that was not written (review M5).
  if (written.length === 0) return { ok: false, refusal: 'unit_not_found' };
  return { ok: true, unitId, before: unit.head_person_id, changed: true };
}

/** Leaves every live unit the person heads without a head; returns their ids. */
export async function clearHeadedUnits(tx: UserTx, personId: string): Promise<readonly string[]> {
  const rows = await tx.execute<{ id: string }>(sql`
    update platform.departments set head_person_id = null
    where head_person_id = ${personId}::uuid and deleted_at is null
    returning id`);
  return rows.map((r) => r.id).sort();
}
