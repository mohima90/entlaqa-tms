import { type AppError, appError, err, ok } from '@jadarat/platform-core';
import {
  type CustomRoleOutcome,
  type CustomRoleRow,
  type UserTx,
  createCustomRole,
  deleteCustomRole,
  updateCustomRole,
} from '@jadarat/platform-db';
import { hasVisibleText } from '@jadarat/platform-i18n';
import { z } from 'zod';
import {
  CUSTOM_ROLE_PERMISSIONS,
  CUSTOM_ROLE_SCOPES,
  customRolePermissionProblems,
} from '../custom-roles';
import type { ActionContext, ActionDefinition } from '../define-action';
import { platformPermissions } from '../platform-permissions';
import { heldCataloguePermissions } from './roles-page';

/**
 * Custom roles (FR-IAM-07, EP-ROLES; PO 17 Oct 2026): the Organization Admin (`platform.role.manage`,
 * high risk: the session is confirmed with Auth) creates, changes and deletes the organization's own roles.
 * The rules are checked here first (field errors for the form) and again by the database guards: names
 * unique in the organization (Arabic and English), permissions from the catalogue only and held by the
 * Organization Admin, administrative ones only with the whole organization as scope, and a role still held
 * (members or pending invitations) is not deleted. Changes apply at the holders' next request. Audited with
 * the role before and after (codes, names and permission codes — no personal data).
 */
const p = platformPermissions;

const CATALOGUE: readonly string[] = CUSTOM_ROLE_PERMISSIONS.map((e) => e.permission.code);

const roleName = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((value) => hasVisibleText(value), { message: 'invisible' });

export const CustomRoleInput = z.strictObject({
  nameEn: roleName,
  nameAr: roleName,
  description: z
    .string()
    .trim()
    .max(500)
    .transform((value) => (value === '' ? null : value)),
  dataScope: z.enum(CUSTOM_ROLE_SCOPES),
  permissions: z
    .array(z.string().refine((code) => CATALOGUE.includes(code), { message: 'unknown' }))
    .max(CATALOGUE.length)
    .refine((codes) => new Set(codes).size === codes.length, { message: 'twice' }),
});

export const UpdateCustomRoleInput = CustomRoleInput.extend({
  id: z.uuid(),
  version: z.number().int().min(1),
});

export const DeleteCustomRoleInput = z.strictObject({
  id: z.uuid(),
  version: z.number().int().min(1),
});

function validation(
  fieldErrors: { path: string; code: string }[],
  params?: Record<string, number>,
) {
  return appError('VALIDATION_FAILED', { fieldErrors, ...(params ? { params } : {}) });
}

/** The builder's rules (same as the database): field errors on `permissions`, or null. */
function permissionErrors(
  ctx: Pick<ActionContext<UserTx>, 'can'>,
  input: z.output<typeof CustomRoleInput>,
): AppError | null {
  const problems = customRolePermissionProblems(
    input.permissions,
    input.dataScope,
    new Set(heldCataloguePermissions(ctx)),
  );
  if (problems.length === 0) return null;
  return validation(
    problems.map((problem) => ({
      path: 'permissions',
      code:
        problem.reason === 'needs_organization_scope'
          ? 'NEEDS_ORGANIZATION_SCOPE'
          : problem.reason === 'not_held'
            ? 'PERMISSION_NOT_HELD'
            : 'PERMISSION_UNKNOWN',
    })),
  );
}

function refusal(outcome: Extract<CustomRoleOutcome, { ok: false }>): AppError {
  switch (outcome.refusal) {
    case 'not_found':
      return appError('NOT_FOUND');
    case 'version_conflict':
      return appError('CONFLICT_VERSION');
    case 'not_allowed':
      return appError('FORBIDDEN');
    case 'name_en_taken':
      return validation([{ path: 'nameEn', code: 'NAME_TAKEN' }]);
    case 'name_ar_taken':
      return validation([{ path: 'nameAr', code: 'NAME_TAKEN' }]);
    case 'needs_organization_scope':
      return validation([{ path: 'dataScope', code: 'NEEDS_ORGANIZATION_SCOPE' }]);
    case 'in_use':
      return validation(
        [{ path: 'role', code: 'ROLE_IN_USE' }],
        outcome.holders
          ? { members: outcome.holders.members, invitations: outcome.holders.invitations }
          : undefined,
      );
  }
}

/** What the audit log keeps of a role: code, names, scope, permissions (no personal data). */
function auditShape(row: CustomRoleRow | null) {
  return row
    ? {
        code: row.code,
        nameEn: row.nameEn,
        nameAr: row.nameAr,
        dataScope: row.dataScope,
        permissions: row.permissions,
      }
    : null;
}

export interface CustomRoleSaved {
  readonly id: string;
  readonly code: string;
  readonly before: CustomRoleRow | null;
  readonly after: CustomRoleRow | null;
}

function saved(outcome: Extract<CustomRoleOutcome, { ok: true }>): CustomRoleSaved {
  const row = outcome.after ?? outcome.before;
  if (!row) throw new Error('custom role outcome without a row');
  return { id: row.id, code: row.code, before: outcome.before, after: outcome.after };
}

export function createCustomRoleActionDefinition(): ActionDefinition<
  typeof CustomRoleInput,
  CustomRoleSaved,
  UserTx
> {
  return {
    permission: p['platform.role.manage'],
    input: CustomRoleInput,
    handler: async ({ ctx, input }) => {
      const problem = permissionErrors(ctx, input);
      if (problem) return err(problem);
      const outcome = await createCustomRole(ctx.tx, input);
      return outcome.ok ? ok(saved(outcome)) : err(refusal(outcome));
    },
    audit: (_input, output) => ({
      action: 'platform.role.created',
      entityType: 'custom_role',
      entityId: output.id,
      data: { before: null, after: auditShape(output.after) },
    }),
  };
}

export function updateCustomRoleActionDefinition(): ActionDefinition<
  typeof UpdateCustomRoleInput,
  CustomRoleSaved,
  UserTx
> {
  return {
    permission: p['platform.role.manage'],
    input: UpdateCustomRoleInput,
    handler: async ({ ctx, input }) => {
      const problem = permissionErrors(ctx, input);
      if (problem) return err(problem);
      const outcome = await updateCustomRole(ctx.tx, input.id, input.version, input);
      return outcome.ok ? ok(saved(outcome)) : err(refusal(outcome));
    },
    audit: (_input, output) => ({
      action: 'platform.role.updated',
      entityType: 'custom_role',
      entityId: output.id,
      data: { before: auditShape(output.before), after: auditShape(output.after) },
    }),
  };
}

export function deleteCustomRoleActionDefinition(): ActionDefinition<
  typeof DeleteCustomRoleInput,
  CustomRoleSaved,
  UserTx
> {
  return {
    permission: p['platform.role.manage'],
    input: DeleteCustomRoleInput,
    handler: async ({ ctx, input }) => {
      const outcome = await deleteCustomRole(ctx.tx, input.id, input.version);
      return outcome.ok ? ok(saved(outcome)) : err(refusal(outcome));
    },
    audit: (_input, output) => ({
      action: 'platform.role.deleted',
      entityType: 'custom_role',
      entityId: output.id,
      data: { before: auditShape(output.before), after: null },
    }),
  };
}
