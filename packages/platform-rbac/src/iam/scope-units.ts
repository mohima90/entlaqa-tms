import {
  type StructureLevelLabel,
  type StructureUnitOption,
  type UserTx,
  listStructureLevelLabels,
  listStructureUnitOptions,
} from '@jadarat/platform-db';
import { z } from 'zod';
import { type CustomRoleScope, scopeNeedsUnit } from '../custom-roles';
import type { ActionContext } from '../define-action';
import { platformPermissions } from '../platform-permissions';

/**
 * The unit of a department-limited custom role (FR-IAM-08 R1 note; T-M3-09; business flow EP-ORG BR-ORG-d,
 * PO 17 Oct 2026): when a custom role whose data scope is «A department» is given (invite, Team members → Edit
 * role), the giver picks ONE unit of the structure, at any level; the holder sees it and everything under it.
 * Any other role takes no unit. The database repeats the rule (platform.role_assignments / invitations
 * scope_unit_id, migration 20261020090400) and checks the unit is a live, active unit of the organization.
 */

/** The unit field of the forms: a unit id, or empty for none. */
export const ScopeUnitField = z
  .union([z.uuid(), z.literal('')])
  .transform((value) => (value === '' ? null : value));

/** What the unit picker offers: the live units (active ones can be picked) and the level names. */
export interface ScopeUnitChoices {
  readonly units: readonly StructureUnitOption[];
  readonly levels: readonly StructureLevelLabel[];
}

export const NO_SCOPE_UNITS: ScopeUnitChoices = { units: [], levels: [] };

/** The picker's choices; nothing without `platform.org.read` organization-wide (the structure's names). */
export async function loadScopeUnitChoices(
  ctx: Pick<ActionContext<UserTx>, 'can' | 'tx'>,
): Promise<ScopeUnitChoices> {
  if (!ctx.can(platformPermissions['platform.org.read'], 'tenant')) return NO_SCOPE_UNITS;
  return {
    units: await listStructureUnitOptions(ctx.tx),
    levels: await listStructureLevelLabels(ctx.tx),
  };
}

/** Why a unit cannot go with a role: required and missing, or not allowed (other role, unknown, inactive). */
export type ScopeUnitProblem = 'UNIT_REQUIRED' | 'UNIT_NOT_ALLOWED';

/**
 * Checks the unit given with a role against its data scope and the organization's units (read in the same
 * transaction): a department-limited role needs one live, active unit; every other role none.
 */
export function scopeUnitProblem(
  dataScope: CustomRoleScope,
  kind: 'standard' | 'custom',
  unitId: string | null,
  units: readonly StructureUnitOption[],
): ScopeUnitProblem | null {
  const needsUnit = kind === 'custom' && scopeNeedsUnit(dataScope);
  if (!needsUnit) return unitId === null ? null : 'UNIT_NOT_ALLOWED';
  if (unitId === null) return 'UNIT_REQUIRED';
  return units.some((unit) => unit.id === unitId && unit.active) ? null : 'UNIT_NOT_ALLOWED';
}
