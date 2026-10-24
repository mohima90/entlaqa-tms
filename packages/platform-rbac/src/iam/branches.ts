import { type AppError, appError, err, ok } from '@jadarat/platform-core';
import {
  type BranchOutcome,
  type BranchRow,
  type UserTx,
  createBranch,
  deleteBranch,
  getOrganizationProfile,
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

/** HH:MM, whole minutes (platform.branch_working_days). */
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/** Decimal degrees typed in (no map, PO 24 Oct 2026); empty = none. */
const coordinate = (limit: number) =>
  z
    .union([
      z.literal(''),
      z
        .string()
        .trim()
        .regex(/^-?\d{1,3}(\.\d{1,6})?$/),
    ])
    .transform((value) => (value === '' ? null : Number(value)))
    .refine((value) => value === null || Math.abs(value) <= limit, { message: 'range' });

/**
 * The branch's own working week (WP-HR-01; FR-ADM-04 working week with half-days and hours): one block per day,
 * the end after the start; null = «Same as the organization». At least one day when given.
 */
export const BranchWorkingDays = z
  .array(z.strictObject({ day: z.number().int().min(0).max(6), startsAt: time, endsAt: time }))
  .min(1)
  .max(7)
  .refine((days) => new Set(days.map((d) => d.day)).size === days.length, {
    message: 'duplicate_day',
  })
  .refine((days) => days.every((d) => d.endsAt > d.startsAt), { message: 'hours' })
  .nullable();

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
  // WP-HR-01: address, typed location (both or neither), own working week.
  addressEn: optionalText(300),
  addressAr: optionalText(300),
  latitude: coordinate(90),
  longitude: coordinate(180),
  workingDays: BranchWorkingDays,
};

const bothOrNeither = (value: { latitude: number | null; longitude: number | null }) =>
  (value.latitude === null) === (value.longitude === null);

export const BranchInput = z
  .strictObject(branchFields)
  .refine(bothOrNeither, { message: 'location', path: ['longitude'] });
export const UpdateBranchInput = z
  .strictObject({
    id: z.uuid(),
    version: z.number().int().min(1),
    ...branchFields,
  })
  .refine(bothOrNeither, { message: 'location', path: ['longitude'] });
export const BranchStatusInput = z.strictObject({
  id: z.uuid(),
  version: z.number().int().min(1),
  status: z.enum(['active', 'inactive']),
});
export const BranchRefInput = z.strictObject({ id: z.uuid(), version: z.number().int().min(1) });

/** The organization's working week (organization profile): what a branch without its own week follows. */
export interface OrganizationWeek {
  readonly days: readonly number[];
  readonly startsAt: string;
  readonly endsAt: string;
}

export interface BranchesPageView {
  readonly branches: readonly BranchRow[];
  /** null when the organization has no profile row (the branch form then starts from an empty week). */
  readonly organizationWeek: OrganizationWeek | null;
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
    handler: async ({ ctx }) => {
      const branches = await listBranches(ctx.tx);
      const profile = await getOrganizationProfile(ctx.tx);
      return ok({
        branches,
        organizationWeek: profile
          ? {
              days: profile.workingDays,
              startsAt: profile.workStartsAt,
              endsAt: profile.workEndsAt,
            }
          : null,
        canManage: ctx.can(p['platform.org.manage'], 'tenant'),
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
    case 'location_invalid':
      return validation('longitude', 'LOCATION_INVALID');
    case 'hours_invalid':
      return validation('workingDays', 'HOURS_INVALID');
    case 'address_invalid':
      return validation('addressEn', 'ADDRESS_INVALID');
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
        addressEn: row.addressEn,
        addressAr: row.addressAr,
        latitude: row.latitude,
        longitude: row.longitude,
        workingDays: row.workingDays,
        status: row.status,
      }
    : null;
}

export interface BranchSaved {
  readonly id: string;
  readonly before: BranchRow | null;
  readonly after: BranchRow | null;
  /** The previous headquarters, whose flag this change cleared (C-9), or null. */
  readonly headquartersMovedFrom: string | null;
}

function result(outcome: BranchOutcome) {
  if (!outcome.ok) return err(refusalError(outcome));
  const row = outcome.after ?? outcome.before;
  if (!row) throw new Error('branch outcome without a row');
  return ok({
    id: row.id,
    before: outcome.before,
    after: outcome.after,
    headquartersMovedFrom: outcome.headquartersMovedFrom ?? null,
  });
}

/** The previous headquarters' flag change, recorded with the change that moved it (C-9). */
function headquartersMove(output: BranchSaved) {
  return output.headquartersMovedFrom
    ? {
        headquartersMovedFrom: {
          branchId: output.headquartersMovedFrom,
          before: { isHeadquarters: true },
          after: { isHeadquarters: false },
        },
      }
    : {};
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
      data: { before: null, after: branchAudit(output.after), ...headquartersMove(output) },
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
      data: {
        before: branchAudit(output.before),
        after: branchAudit(output.after),
        ...headquartersMove(output),
      },
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
