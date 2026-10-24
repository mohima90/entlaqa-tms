import { type AppError, appError, err, ok } from '@jadarat/platform-core';
import {
  type CostCentreOption,
  type OrgUnitOption,
  type PersonOption,
  type StructureLevelRow,
  type StructureOutcome,
  type StructureUnitRow,
  type UnitMovePreview,
  type UserTx,
  addStructureLevel,
  createStructureUnit,
  deleteStructureUnit,
  listActivePersonOptions,
  listCostCentreOptions,
  listOrgUnitOptions,
  listStructureLevels,
  listStructureUnits,
  moveStructureUnit,
  previewStructureUnitMove,
  removeStructureLevel,
  renameStructureLevel,
  reorderStructureUnit,
  setStructureUnitStatus,
  structureLevelsLocked,
  updateStructureUnit,
} from '@jadarat/platform-db';
import { hasVisibleText } from '@jadarat/platform-i18n';
import { z } from 'zod';
import type { ActionDefinition } from '../define-action';
import type { QueryDefinition } from '../define-query';
import { platformPermissions } from '../platform-permissions';

/**
 * Organization → Structure (FR-ADM-05, BRD v3.2; T-M3-02; business flow
 * docs/business-flows/EP-ORG-organization-structure.md, PO 17 Oct 2026; Kawadir's Departments page): the
 * organization's own LEVELS and the TREE of units with a head per unit.
 *
 *   - The page: `platform.org.read` organization-wide (HR Manager, Organization Admin, L&D Manager, Training
 *     Coordinator, Department Head, custom roles with it) — view only unless `platform.org.manage`.
 *   - Changes: `platform.org.manage` organization-wide (the HR Manager; PO 11 Oct 2026, T-M2-19). Risk
 *     medium, no authenticator code (MFA is off by default since the D-IAM-01 reversal; PO, 17 Oct 2026).
 *   - The database repeats every rule (levels at the bottom, renamed any time, only the last unused level
 *     removed; a unit sits directly under the level above and never below the last level; a unit with units,
 *     active people or role scopes under it is not deleted — it can be deactivated) and the write policy of
 *     the levels (platform.org.manage).
 *   - Audited (BR-ORG-f): platform.org.level_added / level_renamed / level_removed and
 *     platform.org.unit_created / unit_updated (heads included) / unit_status_changed / unit_deleted, with the
 *     values before and after (names, codes and ids: no personal data beyond the head's person id).
 */
const p = platformPermissions;

const levelName = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .refine((value) => hasVisibleText(value), { message: 'invisible' });

const unitName = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((value) => hasVisibleText(value), { message: 'invisible' });

const optionalId = z
  .union([z.uuid(), z.literal('')])
  .transform((value) => (value === '' ? null : value));

/** platform.departments / platform.branches codes. */
export const ORG_CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

export const LevelInput = z.strictObject({ nameEn: levelName, nameAr: levelName });
export const RenameLevelInput = LevelInput.extend({
  id: z.uuid(),
  version: z.number().int().min(1),
});
export const LevelRefInput = z.strictObject({ id: z.uuid(), version: z.number().int().min(1) });

const unitFields = {
  code: z.string().trim().regex(ORG_CODE),
  nameEn: unitName,
  nameAr: unitName,
  branchId: optionalId,
  headPersonId: optionalId,
  // WP-HR-01: the cost centre people placed in the unit get when HR picks none.
  defaultCostCentreId: optionalId,
};
export const CreateUnitInput = z.strictObject({ parentId: optionalId, ...unitFields });
export const UpdateUnitInput = z.strictObject({
  id: z.uuid(),
  version: z.number().int().min(1),
  ...unitFields,
});
export const UnitStatusInput = z.strictObject({
  id: z.uuid(),
  version: z.number().int().min(1),
  status: z.enum(['active', 'inactive']),
});
export const UnitRefInput = z.strictObject({ id: z.uuid(), version: z.number().int().min(1) });
/** «Move to…» (WP-HR-01): the new parent (empty: the top), the preview first. */
export const MoveUnitPreviewInput = z.strictObject({ id: z.uuid(), parentId: optionalId });
export const MoveUnitInput = z.strictObject({
  id: z.uuid(),
  version: z.number().int().min(1),
  parentId: optionalId,
});
/** Drag-and-drop / «Move up» / «Move down»: the position among the units under the same parent (0 = first). */
export const ReorderUnitInput = z.strictObject({
  id: z.uuid(),
  version: z.number().int().min(1),
  position: z.number().int().min(0).max(10_000),
});

export interface StructurePageView {
  readonly levels: readonly StructureLevelRow[];
  readonly units: readonly StructureUnitRow[];
  /** The organization's branches (unit form). */
  readonly branches: readonly OrgUnitOption[];
  /** Active people as head choices (only for members who change the structure). */
  readonly people: readonly PersonOption[];
  /** Cost centres as default choices (only for members who change the structure; WP-HR-01). */
  readonly costCentres: readonly CostCentreOption[];
  /** People are placed in units: levels are no longer added or removed, only renamed (WP-HR-01). */
  readonly levelsLocked: boolean;
  /** `platform.org.manage` organization-wide: add, edit, deactivate and delete. */
  readonly canManage: boolean;
}

export const StructurePageInput = z.strictObject({});

/** The levels, the tree and what the forms offer. */
export function structurePageQueryDefinition(): QueryDefinition<
  typeof StructurePageInput,
  StructurePageView,
  UserTx
> {
  return {
    permission: p['platform.org.read'],
    input: StructurePageInput,
    handler: async ({ ctx }) => {
      const canManage = ctx.can(p['platform.org.manage'], 'tenant');
      return ok({
        levels: await listStructureLevels(ctx.tx),
        units: await listStructureUnits(ctx.tx),
        branches: canManage ? (await listOrgUnitOptions(ctx.tx)).branches : [],
        people: canManage ? await listActivePersonOptions(ctx.tx) : [],
        costCentres: canManage ? await listCostCentreOptions(ctx.tx) : [],
        levelsLocked: await structureLevelsLocked(ctx.tx),
        canManage,
      });
    },
  };
}

function validation(path: string, code: string, params?: Record<string, number>): AppError {
  return appError('VALIDATION_FAILED', {
    fieldErrors: [{ path, code }],
    ...(params ? { params } : {}),
  });
}

/** A refusal as the client shows it: a field error (with counts) or a platform error. */
function refusalError(outcome: Extract<StructureOutcome<unknown>, { ok: false }>): AppError {
  switch (outcome.refusal) {
    case 'not_found':
      return appError('NOT_FOUND');
    case 'version_conflict':
      return appError('CONFLICT_VERSION');
    case 'name_en_taken':
      return validation('nameEn', 'NAME_TAKEN');
    case 'name_ar_taken':
      return validation('nameAr', 'NAME_TAKEN');
    case 'too_many_levels':
      return validation('level', 'TOO_MANY_LEVELS');
    case 'not_last_level':
      return validation('level', 'NOT_LAST_LEVEL');
    case 'only_level':
      return validation('level', 'ONLY_LEVEL');
    case 'level_in_use':
      return validation(
        'level',
        'LEVEL_IN_USE',
        outcome.usage ? { units: outcome.usage.units } : undefined,
      );
    case 'code_taken':
      return validation('code', 'CODE_TAKEN');
    case 'parent_not_found':
      return validation('parentId', 'PARENT_NOT_FOUND');
    case 'below_last_level':
      return validation('parentId', 'BELOW_LAST_LEVEL');
    case 'head_not_active':
      return validation('headPersonId', 'HEAD_NOT_ACTIVE');
    case 'branch_not_found':
      return validation('branchId', 'BRANCH_NOT_FOUND');
    case 'levels_locked':
      return validation('level', 'LEVELS_LOCKED');
    case 'level_changes':
      return validation('parentId', 'LEVEL_CHANGES');
    case 'move_into_itself':
      return validation('parentId', 'MOVE_INTO_ITSELF');
    case 'cost_centre_inactive':
      return validation('defaultCostCentreId', 'COST_CENTRE_INACTIVE');
    case 'unit_in_use':
      return validation(
        'unit',
        'UNIT_IN_USE',
        outcome.usage
          ? { units: outcome.usage.units, people: outcome.usage.people, roles: outcome.usage.roles }
          : undefined,
      );
  }
}

/** What the audit log keeps of a level (names: no personal data). */
function levelAudit(row: StructureLevelRow | null) {
  return row ? { ordinal: row.ordinal, nameEn: row.nameEn, nameAr: row.nameAr } : null;
}

/** What the audit log keeps of a unit (names, code, ids; the head as a person id only). */
function unitAudit(row: StructureUnitRow | null) {
  return row
    ? {
        code: row.code,
        nameEn: row.nameEn,
        nameAr: row.nameAr,
        parentId: row.parentId,
        levelOrdinal: row.levelOrdinal,
        branchId: row.branchId,
        headPersonId: row.headPersonId,
        defaultCostCentreId: row.defaultCostCentreId,
        status: row.status,
      }
    : null;
}

export interface StructureSaved<T> {
  readonly id: string;
  readonly before: T | null;
  readonly after: T | null;
}

function saved<T extends { readonly id: string }>(
  outcome: Extract<StructureOutcome<T>, { ok: true }>,
): StructureSaved<T> {
  const row = outcome.after ?? outcome.before;
  if (!row) throw new Error('structure outcome without a row');
  return { id: row.id, before: outcome.before, after: outcome.after };
}

function result<T extends { readonly id: string }>(outcome: StructureOutcome<T>) {
  return outcome.ok ? ok(saved(outcome)) : err(refusalError(outcome));
}

// ---------------------------------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------------------------------

/** «Add level»: below the last one, at most ten. */
export function addStructureLevelActionDefinition(): ActionDefinition<
  typeof LevelInput,
  StructureSaved<StructureLevelRow>,
  UserTx
> {
  return {
    permission: p['platform.org.manage'],
    input: LevelInput,
    handler: async ({ ctx, input }) => result(await addStructureLevel(ctx.tx, input)),
    audit: (_input, output) => ({
      action: 'platform.org.level_added',
      entityType: 'structure_level',
      entityId: output.id,
      data: { before: null, after: levelAudit(output.after) },
    }),
  };
}

/** «Rename»: at any time. */
export function renameStructureLevelActionDefinition(): ActionDefinition<
  typeof RenameLevelInput,
  StructureSaved<StructureLevelRow>,
  UserTx
> {
  return {
    permission: p['platform.org.manage'],
    input: RenameLevelInput,
    handler: async ({ ctx, input }) =>
      result(
        await renameStructureLevel(ctx.tx, input.id, input.version, {
          nameEn: input.nameEn,
          nameAr: input.nameAr,
        }),
      ),
    audit: (_input, output) => ({
      action: 'platform.org.level_renamed',
      entityType: 'structure_level',
      entityId: output.id,
      data: { before: levelAudit(output.before), after: levelAudit(output.after) },
    }),
  };
}

/** «Remove»: the last level only, while no unit uses it (never the only one). */
export function removeStructureLevelActionDefinition(): ActionDefinition<
  typeof LevelRefInput,
  StructureSaved<StructureLevelRow>,
  UserTx
> {
  return {
    permission: p['platform.org.manage'],
    input: LevelRefInput,
    handler: async ({ ctx, input }) =>
      result(await removeStructureLevel(ctx.tx, input.id, input.version)),
    audit: (_input, output) => ({
      action: 'platform.org.level_removed',
      entityType: 'structure_level',
      entityId: output.id,
      data: { before: levelAudit(output.before), after: null },
    }),
  };
}

// ---------------------------------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------------------------------

/** «Add <first level>» (no parent) or «Add <next level>» under a unit. */
export function createStructureUnitActionDefinition(): ActionDefinition<
  typeof CreateUnitInput,
  StructureSaved<StructureUnitRow>,
  UserTx
> {
  return {
    permission: p['platform.org.manage'],
    input: CreateUnitInput,
    handler: async ({ ctx, input }) => {
      const { parentId, ...fields } = input;
      return result(await createStructureUnit(ctx.tx, parentId, fields));
    },
    audit: (_input, output) => ({
      action: 'platform.org.unit_created',
      entityType: 'structure_unit',
      entityId: output.id,
      data: { before: null, after: unitAudit(output.after) },
    }),
  };
}

/** «Edit»: names, code, branch and head. */
export function updateStructureUnitActionDefinition(): ActionDefinition<
  typeof UpdateUnitInput,
  StructureSaved<StructureUnitRow>,
  UserTx
> {
  return {
    permission: p['platform.org.manage'],
    input: UpdateUnitInput,
    handler: async ({ ctx, input }) => {
      const { id, version, ...fields } = input;
      return result(await updateStructureUnit(ctx.tx, id, version, fields));
    },
    audit: (_input, output) => ({
      action: 'platform.org.unit_updated',
      entityType: 'structure_unit',
      entityId: output.id,
      data: { before: unitAudit(output.before), after: unitAudit(output.after) },
    }),
  };
}

/** «Deactivate» / «Activate» (people stay; a department-limited role on it grants nothing meanwhile). */
export function setStructureUnitStatusActionDefinition(): ActionDefinition<
  typeof UnitStatusInput,
  StructureSaved<StructureUnitRow>,
  UserTx
> {
  return {
    permission: p['platform.org.manage'],
    input: UnitStatusInput,
    handler: async ({ ctx, input }) =>
      result(await setStructureUnitStatus(ctx.tx, input.id, input.version, input.status)),
    audit: (_input, output) => ({
      action: 'platform.org.unit_status_changed',
      entityType: 'structure_unit',
      entityId: output.id,
      data: {
        before: output.before ? output.before.status : null,
        after: output.after ? output.after.status : null,
      },
    }),
  };
}

/** «Delete»: refused while units, active people or role scopes point at it (the refusal counts them). */
export function deleteStructureUnitActionDefinition(): ActionDefinition<
  typeof UnitRefInput,
  StructureSaved<StructureUnitRow>,
  UserTx
> {
  return {
    permission: p['platform.org.manage'],
    input: UnitRefInput,
    handler: async ({ ctx, input }) =>
      result(await deleteStructureUnit(ctx.tx, input.id, input.version)),
    audit: (_input, output) => ({
      action: 'platform.org.unit_deleted',
      entityType: 'structure_unit',
      entityId: output.id,
      data: { before: unitAudit(output.before), after: null },
    }),
  };
}

// ---------------------------------------------------------------------------------------------------
// Moving and ordering units (WP-HR-01; business flow EP-ORG-structure-completion.md §3 B, C)
// ---------------------------------------------------------------------------------------------------

/**
 * The preview of «Move to…»: what moves and who sees more or less (TM-0004 SR-STE02-04). Changes nothing, so it
 * is not audited; asked with `platform.org.manage` (it names role holders and heads).
 */
export function previewStructureUnitMoveActionDefinition(): ActionDefinition<
  typeof MoveUnitPreviewInput,
  UnitMovePreview,
  UserTx
> {
  return {
    permission: p['platform.org.manage'],
    input: MoveUnitPreviewInput,
    handler: async ({ ctx, input }) => {
      const outcome = await previewStructureUnitMove(ctx.tx, input.id, input.parentId);
      return outcome.ok ? ok(outcome.preview) : err(refusalError(outcome));
    },
  };
}

/** «Move»: under a unit of the same level as the old parent; everything below moves with it (BR-ORG-i, e). */
export function moveStructureUnitActionDefinition(): ActionDefinition<
  typeof MoveUnitInput,
  StructureSaved<StructureUnitRow>,
  UserTx
> {
  return {
    permission: p['platform.org.manage'],
    input: MoveUnitInput,
    handler: async ({ ctx, input }) =>
      result(await moveStructureUnit(ctx.tx, input.id, input.version, input.parentId)),
    audit: (_input, output) => ({
      action: 'platform.org.unit_moved',
      entityType: 'structure_unit',
      entityId: output.id,
      data: {
        before: output.before ? { parentId: output.before.parentId } : null,
        after: output.after ? { parentId: output.after.parentId } : null,
      },
    }),
  };
}

/** Drag-and-drop, «Move up» / «Move down»: the unit's place among the units under the same parent. */
export function reorderStructureUnitActionDefinition(): ActionDefinition<
  typeof ReorderUnitInput,
  StructureSaved<StructureUnitRow>,
  UserTx
> {
  return {
    permission: p['platform.org.manage'],
    input: ReorderUnitInput,
    handler: async ({ ctx, input }) =>
      result(await reorderStructureUnit(ctx.tx, input.id, input.version, input.position)),
    audit: (input, output) => ({
      action: 'platform.org.unit_reordered',
      entityType: 'structure_unit',
      entityId: output.id,
      data: {
        before: output.before ? { sortOrder: output.before.sortOrder } : null,
        after: { position: input.position },
      },
    }),
  };
}
