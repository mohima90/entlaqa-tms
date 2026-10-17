import { type AppError, appError, err, ok } from '@jadarat/platform-core';
import {
  type BranchOutcome,
  type BranchRow,
  type UserTx,
  createBranch,
  deleteBranch,
  listBranches,
  setBranchStatus,
  updateBranch,
} from '@jadarat/platform-db';
import { hasVisibleText } from '@jadarat/platform-i18n';
import { z } from 'zod';
import type { ActionDefinition } from '../define-action';
import type { QueryDefinition } from '../define-query';
import { platformPermissions } from '../platform-permissions';
import { ORG_CODE } from './structure';

/**
 * Organization → Branches (FR-ADM-04 core fields of platform.branches; T-M3-02, EP-ORG; Kawadir list in a card
 * with a dialog form). Read with `platform.org.read`, changed with `platform.org.manage` (the HR Manager; PO
 * 11 Oct 2026). The database checks the code, the single headquarters (the flag moves to the new one), the
 * time zone, the branch tree and the delete rules (no sub-branches, units or active people left). Audited:
 * platform.org.branch_created / branch_updated / branch_status_changed / branch_deleted (before/after; no
 * personal data).
 */
const p = platformPermissions;

const name = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((value) => hasVisibleText(value), { message: 'invisible' });

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((value) => value === '' || hasVisibleText(value), { message: 'invisible' })
    .transform((value) => (value === '' ? null : value));

const branchFields = {
  code: z.string().trim().regex(ORG_CODE),
  nameEn: name,
  nameAr: name,
  parentBranchId: z
    .union([z.uuid(), z.literal('')])
    .transform((value) => (value === '' ? null : value)),
  countryCode: z
    .union([z.string().regex(/^[A-Z]{2}$/), z.literal('')])
    .transform((value) => (value === '' ? null : value)),
  cityAr: optionalText(120),
  cityEn: optionalText(120),
  // The shape only; the database checks it against its own list (unknown → TIMEZONE_UNKNOWN).
  timezone: z
    .string()
    .max(64)
    .regex(/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/),
  isHeadquarters: z.boolean(),
};

export const BranchInput = z.strictObject(branchFields);
export const UpdateBranchInput = z.strictObject({
  id: z.uuid(),
  version: z.number().int().min(1),
  ...branchFields,
});
export const BranchStatusInput = z.strictObject({
  id: z.uuid(),
  version: z.number().int().min(1),
  status: z.enum(['active', 'inactive']),
});
export const BranchRefInput = z.strictObject({ id: z.uuid(), version: z.number().int().min(1) });

export interface BranchesPageView {
  readonly branches: readonly BranchRow[];
  readonly canManage: boolean;
}

export const BranchesPageInput = z.strictObject({});

export function branchesPageQueryDefinition(): QueryDefinition<
  typeof BranchesPageInput,
  BranchesPageView,
  UserTx
> {
  return {
    permission: p['platform.org.read'],
    input: BranchesPageInput,
    handler: async ({ ctx }) =>
      ok({
        branches: await listBranches(ctx.tx),
        canManage: ctx.can(p['platform.org.manage'], 'tenant'),
      }),
  };
}

function validation(path: string, code: string, params?: Record<string, number>): AppError {
  return appError('VALIDATION_FAILED', {
    fieldErrors: [{ path, code }],
    ...(params ? { params } : {}),
  });
}

function refusalError(outcome: Extract<BranchOutcome, { ok: false }>): AppError {
  switch (outcome.refusal) {
    case 'not_found':
      return appError('NOT_FOUND');
    case 'version_conflict':
      return appError('CONFLICT_VERSION');
    case 'code_taken':
      return validation('code', 'CODE_TAKEN');
    case 'timezone_unknown':
      return validation('timezone', 'TIMEZONE_UNKNOWN');
    case 'parent_not_found':
      return validation('parentBranchId', 'PARENT_NOT_FOUND');
    case 'branch_tree':
      return validation('parentBranchId', 'BRANCH_TREE');
    case 'branch_in_use':
      return validation(
        'branch',
        'BRANCH_IN_USE',
        outcome.usage
          ? {
              branches: outcome.usage.branches,
              units: outcome.usage.units,
              people: outcome.usage.people,
            }
          : undefined,
      );
  }
}

function branchAudit(row: BranchRow | null) {
  return row
    ? {
        code: row.code,
        nameEn: row.nameEn,
        nameAr: row.nameAr,
        parentBranchId: row.parentBranchId,
        countryCode: row.countryCode,
        cityEn: row.cityEn,
        cityAr: row.cityAr,
        timezone: row.timezone,
        isHeadquarters: row.isHeadquarters,
        status: row.status,
      }
    : null;
}

export interface BranchSaved {
  readonly id: string;
  readonly before: BranchRow | null;
  readonly after: BranchRow | null;
}

function result(outcome: BranchOutcome) {
  if (!outcome.ok) return err(refusalError(outcome));
  const row = outcome.after ?? outcome.before;
  if (!row) throw new Error('branch outcome without a row');
  return ok({ id: row.id, before: outcome.before, after: outcome.after });
}

export function createBranchActionDefinition(): ActionDefinition<
  typeof BranchInput,
  BranchSaved,
  UserTx
> {
  return {
    permission: p['platform.org.manage'],
    input: BranchInput,
    handler: async ({ ctx, input }) => result(await createBranch(ctx.tx, input)),
    audit: (_input, output) => ({
      action: 'platform.org.branch_created',
      entityType: 'branch',
      entityId: output.id,
      data: { before: null, after: branchAudit(output.after) },
    }),
  };
}

export function updateBranchActionDefinition(): ActionDefinition<
  typeof UpdateBranchInput,
  BranchSaved,
  UserTx
> {
  return {
    permission: p['platform.org.manage'],
    input: UpdateBranchInput,
    handler: async ({ ctx, input }) => {
      const { id, version, ...fields } = input;
      if (fields.parentBranchId === id) return err(validation('parentBranchId', 'BRANCH_TREE'));
      return result(await updateBranch(ctx.tx, id, version, fields));
    },
    audit: (_input, output) => ({
      action: 'platform.org.branch_updated',
      entityType: 'branch',
      entityId: output.id,
      data: { before: branchAudit(output.before), after: branchAudit(output.after) },
    }),
  };
}

export function setBranchStatusActionDefinition(): ActionDefinition<
  typeof BranchStatusInput,
  BranchSaved,
  UserTx
> {
  return {
    permission: p['platform.org.manage'],
    input: BranchStatusInput,
    handler: async ({ ctx, input }) =>
      result(await setBranchStatus(ctx.tx, input.id, input.version, input.status)),
    audit: (_input, output) => ({
      action: 'platform.org.branch_status_changed',
      entityType: 'branch',
      entityId: output.id,
      data: {
        before: output.before ? output.before.status : null,
        after: output.after ? output.after.status : null,
      },
    }),
  };
}

export function deleteBranchActionDefinition(): ActionDefinition<
  typeof BranchRefInput,
  BranchSaved,
  UserTx
> {
  return {
    permission: p['platform.org.manage'],
    input: BranchRefInput,
    handler: async ({ ctx, input }) => result(await deleteBranch(ctx.tx, input.id, input.version)),
    audit: (_input, output) => ({
      action: 'platform.org.branch_deleted',
      entityType: 'branch',
      entityId: output.id,
      data: { before: branchAudit(output.before), after: null },
    }),
  };
}
