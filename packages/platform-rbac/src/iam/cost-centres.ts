import { type AppError, appError, err, ok } from '@jadarat/platform-core';
import {
  type CostCentreOutcome,
  type CostCentreRow,
  type UserTx,
  createCostCentre,
  deleteCostCentre,
  listCostCentres,
  updateCostCentre,
} from '@jadarat/platform-db';
import { hasVisibleText } from '@jadarat/platform-i18n';
import { z } from 'zod';
import type { ActionDefinition } from '../define-action';
import type { QueryDefinition } from '../define-query';
import { platformPermissions } from '../platform-permissions';
import { ORG_CODE } from './structure';

/**
 * Structure → Cost centres (WP-HR-01; FR-ADM-05, FR-FIN-03; business flow EP-ORG-structure-completion.md §3 A,
 * PO 24 Oct 2026: the finance codes that pay; each person has one). Read with `platform.org.read`, changed with
 * `platform.org.manage` (the HR Manager), as the rest of the structure. The database checks the codes, the names
 * and that one in use is not deleted. Audited: platform.org.cost_centre_created / cost_centre_updated /
 * cost_centre_deleted (codes and names before and after; no personal data).
 */
const p = platformPermissions;

const optionalName = z
  .string()
  .trim()
  .max(120)
  .refine((value) => value === '' || hasVisibleText(value), { message: 'invisible' })
  .transform((value) => (value === '' ? null : value));

const fields = {
  code: z.string().trim().regex(ORG_CODE),
  nameEn: optionalName,
  nameAr: optionalName,
  status: z.enum(['active', 'inactive']),
};

const someName = (value: { nameEn: string | null; nameAr: string | null }) =>
  value.nameEn !== null || value.nameAr !== null;

export const CostCentreInput = z
  .strictObject(fields)
  .refine(someName, { message: 'name_required', path: ['nameEn'] });
export const UpdateCostCentreInput = z
  .strictObject({ id: z.uuid(), version: z.number().int().min(1), ...fields })
  .refine(someName, { message: 'name_required', path: ['nameEn'] });
export const CostCentreRefInput = z.strictObject({
  id: z.uuid(),
  version: z.number().int().min(1),
});

export interface CostCentresPageView {
  readonly costCentres: readonly CostCentreRow[];
  readonly canManage: boolean;
}

export const CostCentresPageInput = z.strictObject({});

export function costCentresPageQueryDefinition(): QueryDefinition<
  typeof CostCentresPageInput,
  CostCentresPageView,
  UserTx
> {
  return {
    permission: p['platform.org.read'],
    input: CostCentresPageInput,
    handler: async ({ ctx }) =>
      ok({
        costCentres: await listCostCentres(ctx.tx),
        canManage: ctx.can(p['platform.org.manage'], 'tenant'),
      }),
  };
}

function refusalError(outcome: Extract<CostCentreOutcome, { ok: false }>): AppError {
  switch (outcome.refusal) {
    case 'not_found':
      return appError('NOT_FOUND');
    case 'version_conflict':
      return appError('CONFLICT_VERSION');
    case 'code_taken':
      return appError('VALIDATION_FAILED', { fieldErrors: [{ path: 'code', code: 'CODE_TAKEN' }] });
    case 'in_use':
      return appError('VALIDATION_FAILED', {
        fieldErrors: [{ path: 'costCentre', code: 'COST_CENTRE_IN_USE' }],
        ...(outcome.usage
          ? { params: { people: outcome.usage.people, units: outcome.usage.units } }
          : {}),
      });
  }
}

function costCentreAudit(row: CostCentreRow | null) {
  return row
    ? { code: row.code, nameEn: row.nameEn, nameAr: row.nameAr, status: row.status }
    : null;
}

export interface CostCentreSaved {
  readonly id: string;
  readonly before: CostCentreRow | null;
  readonly after: CostCentreRow | null;
}

function result(outcome: CostCentreOutcome) {
  if (!outcome.ok) return err(refusalError(outcome));
  const row = outcome.after ?? outcome.before;
  if (!row) throw new Error('cost centre outcome without a row');
  return ok({ id: row.id, before: outcome.before, after: outcome.after });
}

/** «Add cost centre». */
export function createCostCentreActionDefinition(): ActionDefinition<
  typeof CostCentreInput,
  CostCentreSaved,
  UserTx
> {
  return {
    permission: p['platform.org.manage'],
    input: CostCentreInput,
    handler: async ({ ctx, input }) => result(await createCostCentre(ctx.tx, input)),
    audit: (_input, output) => ({
      action: 'platform.org.cost_centre_created',
      entityType: 'cost_centre',
      entityId: output.id,
      data: { before: null, after: costCentreAudit(output.after) },
    }),
  };
}

/** «Save cost centre»: code, names, active / inactive. */
export function updateCostCentreActionDefinition(): ActionDefinition<
  typeof UpdateCostCentreInput,
  CostCentreSaved,
  UserTx
> {
  return {
    permission: p['platform.org.manage'],
    input: UpdateCostCentreInput,
    handler: async ({ ctx, input }) => {
      const { id, version, ...fields } = input;
      return result(await updateCostCentre(ctx.tx, id, version, fields));
    },
    audit: (_input, output) => ({
      action: 'platform.org.cost_centre_updated',
      entityType: 'cost_centre',
      entityId: output.id,
      data: { before: costCentreAudit(output.before), after: costCentreAudit(output.after) },
    }),
  };
}

/** «Delete»: only one nobody has and no unit gives (else deactivate it). */
export function deleteCostCentreActionDefinition(): ActionDefinition<
  typeof CostCentreRefInput,
  CostCentreSaved,
  UserTx
> {
  return {
    permission: p['platform.org.manage'],
    input: CostCentreRefInput,
    handler: async ({ ctx, input }) =>
      result(await deleteCostCentre(ctx.tx, input.id, input.version)),
    audit: (_input, output) => ({
      action: 'platform.org.cost_centre_deleted',
      entityType: 'cost_centre',
      entityId: output.id,
      data: { before: costCentreAudit(output.before), after: null },
    }),
  };
}
