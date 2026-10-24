import 'server-only';
import { sql } from 'drizzle-orm';
import { structureCompletionExists } from './custom-roles-present';
import { listStructureLevels, listStructureUnits, structureRefusalOf } from './structure';
import type { StructureRefusal } from './structure';
import type { UserTx } from './with-user-tx';

/**
 * Importing units of the structure from a file (WP-HR-01; FR-ADM-05 CSV import; business flow
 * EP-ORG-structure-completion.md §3 D, PO 24 Oct 2026). What the check needs to know about the organization, and
 * applying the good rows in one transaction under the organization's hierarchy lock. A row with a new code creates
 * a unit; an existing code updates its names, branch, default cost centre and head — the import never moves,
 * deactivates or deletes a unit (BR-ORG-k). The calling action authorizes (`platform.org.manage`) and audits; the
 * database repeats every rule.
 */
export interface UnitImportContext {
  readonly levels: readonly {
    readonly ordinal: number;
    readonly nameEn: string;
    readonly nameAr: string;
  }[];
  readonly units: readonly {
    readonly id: string;
    readonly code: string;
    readonly parentId: string | null;
    readonly levelOrdinal: number | null;
    readonly version: number;
  }[];
  readonly branches: readonly { readonly id: string; readonly code: string }[];
  readonly costCentres: readonly {
    readonly id: string;
    readonly code: string;
    readonly active: boolean;
  }[];
  /** Active people found by the e-mails the file names (lower case). */
  readonly people: readonly { readonly id: string; readonly email: string }[];
  /** The cost-centre column exists (deploy window). */
  readonly costCentresAvailable: boolean;
}

export async function loadUnitImportContext(
  tx: UserTx,
  emails: readonly string[],
): Promise<UnitImportContext> {
  const levels = await listStructureLevels(tx);
  const units = await listStructureUnits(tx);
  const branches = await tx.execute<{ id: string; code: string }>(sql`
    select b.id, b.code from platform.branches b where b.deleted_at is null`);
  const costCentresAvailable = await structureCompletionExists(tx);
  const costCentres = costCentresAvailable
    ? await tx.execute<{ id: string; code: string; status: string }>(sql`
        select c.id, c.code, c.status from platform.cost_centres c`)
    : [];
  const wanted = [...new Set(emails.map((email) => email.toLowerCase()))].slice(0, 5_000);
  const people =
    wanted.length === 0
      ? []
      : await tx.execute<{ id: string; email: string }>(sql`
          select p.id, lower(p.email) as email from platform.persons p
          where p.status = 'active' and lower(p.email) in (${sql.join(
            wanted.map((email) => sql`${email}`),
            sql`, `,
          )})`);
  return {
    levels: levels.map((l) => ({ ordinal: l.ordinal, nameEn: l.nameEn, nameAr: l.nameAr })),
    units: units.map((u) => ({
      id: u.id,
      code: u.code,
      parentId: u.parentId,
      levelOrdinal: u.levelOrdinal,
      version: u.version,
    })),
    branches: branches.map((b) => ({ id: b.id, code: b.code })),
    costCentres: costCentres.map((c) => ({
      id: c.id,
      code: c.code,
      active: c.status === 'active',
    })),
    people: people.map((p) => ({ id: p.id, email: p.email })),
    costCentresAvailable,
  };
}

/** One checked row to write: a new unit (its parent by id, or by the code of a unit created earlier) or an update. */
export type UnitImportOperation =
  | {
      readonly kind: 'create';
      readonly row: number;
      readonly code: string;
      readonly nameEn: string;
      readonly nameAr: string;
      /** An existing unit's id, … */
      readonly parentId: string | null;
      /** … or the code of a unit this import creates in an earlier row. */
      readonly parentCode: string | null;
      readonly branchId: string | null;
      readonly defaultCostCentreId: string | null;
      readonly headPersonId: string | null;
    }
  | {
      readonly kind: 'update';
      readonly row: number;
      readonly id: string;
      readonly version: number;
      readonly nameEn: string;
      readonly nameAr: string;
      /** undefined: the unit keeps its value (the column is not in the file, or the head was not found). */
      readonly branchId: string | null | undefined;
      readonly defaultCostCentreId: string | null | undefined;
      readonly headPersonId: string | null | undefined;
    };

export type UnitImportOutcome =
  | {
      readonly ok: true;
      readonly created: number;
      readonly updated: number;
      /** The codes written (the audit names them). */
      readonly createdCodes: readonly string[];
      readonly updatedIds: readonly string[];
    }
  | { readonly ok: false; readonly row: number; readonly refusal: StructureRefusal };

/**
 * Writes the checked rows in order, under the hierarchy lock taken first. Any refusal (the structure changed since
 * the check) stops the import: the caller rolls the whole transaction back and the HR Manager checks the file again.
 */
/**
 * The organization's hierarchy lock (the same as every structure write), taken before «Import» checks the file
 * again so the check and the writes see the same structure. Held until the transaction ends.
 */
export async function lockUnitImport(tx: UserTx): Promise<void> {
  await tx.execute(sql`select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('platform.departments:' || private.current_tenant_id()::text, 0))`);
}

export async function applyUnitImport(
  tx: UserTx,
  operations: readonly UnitImportOperation[],
): Promise<UnitImportOutcome> {
  await lockUnitImport(tx);
  const created = new Map<string, string>();
  const nextOrder = new Map<string, number>();
  const orderOf = async (parentId: string | null): Promise<number> => {
    const key = parentId ?? '';
    const known = nextOrder.get(key);
    if (known !== undefined) {
      nextOrder.set(key, known + 1);
      return known;
    }
    const [row] = await tx.execute<{ next: number | string }>(sql`
      select coalesce(max(d.sort_order) + 1, 0) as next from platform.departments d
      where d.deleted_at is null and d.parent_id is not distinct from ${parentId}::uuid`);
    const next = Number(row?.next ?? 0);
    nextOrder.set(key, next + 1);
    return next;
  };
  // The default cost centre once its column exists (deploy window).
  const completed = await structureCompletionExists(tx);
  const createdCodes: string[] = [];
  const updatedIds: string[] = [];
  for (const op of operations) {
    try {
      if (op.kind === 'create') {
        const parentId =
          op.parentId ??
          (op.parentCode === null ? null : (created.get(op.parentCode.toLowerCase()) ?? null));
        if (op.parentCode !== null && parentId === null) {
          return { ok: false, row: op.row, refusal: 'parent_not_found' };
        }
        const sortOrder = await orderOf(parentId);
        const costCentreColumn = completed ? sql`, default_cost_centre_id` : sql``;
        const costCentreValue = completed ? sql`, ${op.defaultCostCentreId}::uuid` : sql``;
        const [row] = await tx.execute<{ id: string }>(sql`
          insert into platform.departments (code, name_ar, name_en, parent_id, branch_id, head_person_id, sort_order
                                            ${costCentreColumn})
          values (${op.code}, ${op.nameAr}, ${op.nameEn}, ${parentId}::uuid, ${op.branchId}::uuid,
                  ${op.headPersonId}::uuid, ${sortOrder} ${costCentreValue})
          returning id`);
        if (!row) throw new Error('applyUnitImport: no row returned');
        created.set(op.code.toLowerCase(), row.id);
        createdCodes.push(op.code);
      } else {
        // Only what the file gives: a value left undefined is kept.
        const sets = [sql`name_ar = ${op.nameAr}`, sql`name_en = ${op.nameEn}`];
        if (op.branchId !== undefined) sets.push(sql`branch_id = ${op.branchId}::uuid`);
        if (op.headPersonId !== undefined)
          sets.push(sql`head_person_id = ${op.headPersonId}::uuid`);
        if (completed && op.defaultCostCentreId !== undefined) {
          sets.push(sql`default_cost_centre_id = ${op.defaultCostCentreId}::uuid`);
        }
        const rows = await tx.execute(sql`update platform.departments
          set ${sql.join(sets, sql`, `)}
          where id = ${op.id}::uuid and version = ${op.version} and deleted_at is null
          returning id`);
        if (rows.length === 0) return { ok: false, row: op.row, refusal: 'version_conflict' };
        updatedIds.push(op.id);
      }
    } catch (error) {
      return { ok: false, row: op.row, refusal: structureRefusalOf(error) };
    }
  }
  return {
    ok: true,
    created: createdCodes.length,
    updated: updatedIds.length,
    createdCodes,
    updatedIds,
  };
}
