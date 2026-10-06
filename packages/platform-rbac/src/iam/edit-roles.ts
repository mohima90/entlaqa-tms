import { type AppError, appError, err, ok } from '@jadarat/platform-core';
import {
  type AssignedRole,
  type EditableRoles,
  type RolesRefusal,
  type UserTx,
  getEditableRoles,
  replaceMemberRoles,
} from '@jadarat/platform-db';
import { z } from 'zod';
import type { ActionDefinition, PermissionAccess } from '../define-action';
import type { QueryDefinition } from '../define-query';
import type { PermissionDefinition } from '../permissions';
import { platformPermissions } from '../platform-permissions';
import { SYSTEM_ROLES, SYSTEM_ROLE_CODES, type SystemRoleCode } from '../system-roles';

/**
 * Changing a member's roles from their profile (T-M2-14, FR-IAM-07, BR-IAM-1, BR-IAM-3; screen 3
 * «تعديل الأدوار», role choice of screen 2). One primary role plus optional additional roles with
 * optional first/last days. Ordinary roles: `platform.role.assign` (HR Manager, Organization Admin);
 * privileged roles: `platform.role.assign_privileged` — Organization Admin with an authenticator code
 * (AAL2, PO decision D-IAM-01, 6 Oct 2026). Nobody changes their own roles; a privileged member's roles
 * only an Organization Admin (database guard). Audited with the roles before and after.
 */
const p = platformPermissions;

const PRIVILEGED: ReadonlySet<string> = new Set(
  SYSTEM_ROLES.filter((r) => r.privileged).map((r) => r.code),
);

export const PRIVILEGED_ROLE_CODES: readonly SystemRoleCode[] = SYSTEM_ROLES.filter(
  (r) => r.privileged,
).map((r) => r.code);

export type RolesBlock = 'own_roles' | 'no_account' | 'revoked';

export interface EditRolesView {
  readonly roles: EditableRoles;
  /** Why the roles cannot be changed here at all, if so. */
  readonly blocked: RolesBlock | null;
  /** Privileged roles of this member: allowed, needs an authenticator code, or not for this member. */
  readonly privilegedAccess: PermissionAccess;
}

export const EditRolesQueryInput = z.strictObject({ personId: z.uuid() });

export function editRolesQueryDefinition(): QueryDefinition<
  typeof EditRolesQueryInput,
  EditRolesView,
  UserTx
> {
  return {
    permission: p['platform.role.assign'],
    input: EditRolesQueryInput,
    resource: (input) => ({ type: 'person', id: input.personId }),
    handler: async ({ ctx, input }) => {
      const roles = await getEditableRoles(ctx.tx, input.personId);
      if (!roles) return err(appError('NOT_FOUND'));
      const blocked: RolesBlock | null = roles.isSelf
        ? 'own_roles'
        : roles.membershipId === null
          ? 'no_account'
          : roles.membershipStatus === 'revoked'
            ? 'revoked'
            : null;
      // A privileged member's record and roles: Organization Admin only (same rule as the guards).
      if (blocked === null && !roles.mayManage) return err(appError('FORBIDDEN'));
      return ok({
        roles,
        blocked,
        privilegedAccess: ctx.access(
          p['platform.role.assign_privileged'],
          ctx.resource ?? 'tenant',
        ),
      });
    },
  };
}

const day = z
  .union([
    z.iso.date().refine((value) => value >= '2000-01-01' && value <= '2100-12-31', {
      message: 'range',
    }),
    z.literal(''),
  ])
  .transform((value) => (value === '' ? null : value));

export const EditRolesInput = z
  .strictObject({
    personId: z.uuid(),
    version: z
      .string()
      .max(2000)
      .regex(/^[a-z_]+:[0-9]+(,[a-z_]+:[0-9]+)*$|^$/),
    primary: z.enum(SYSTEM_ROLE_CODES),
    additional: z
      .array(
        z.strictObject({
          roleCode: z.enum(SYSTEM_ROLE_CODES),
          validFrom: day,
          validUntil: day,
        }),
      )
      .max(SYSTEM_ROLE_CODES.length - 1),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>([value.primary]);
    value.additional.forEach((role, index) => {
      if (seen.has(role.roleCode)) {
        ctx.addIssue({ code: 'custom', path: ['additional', index, 'roleCode'], message: 'twice' });
      }
      seen.add(role.roleCode);
      if (role.validFrom !== null && role.validUntil !== null && role.validUntil < role.validFrom) {
        ctx.addIssue({
          code: 'custom',
          path: ['additional', index, 'validUntil'],
          message: 'before_start',
        });
      }
    });
  });

function desiredRoles(input: z.output<typeof EditRolesInput>): AssignedRole[] {
  return [
    { roleCode: input.primary, isPrimary: true, validFrom: null, validUntil: null },
    ...input.additional.map((r) => ({ ...r, isPrimary: false })),
  ];
}

function refusalError(refusal: RolesRefusal): AppError {
  switch (refusal) {
    case 'not_found':
    case 'no_account':
      return appError('NOT_FOUND');
    case 'own_roles':
    case 'not_allowed':
    case 'membership_revoked':
      return appError('FORBIDDEN');
    case 'version_conflict':
      return appError('CONFLICT_VERSION');
    case 'last_admin':
      return appError('VALIDATION_FAILED', {
        fieldErrors: [{ path: 'primary', code: 'LAST_ADMIN' }],
      });
    case 'privileged_change':
      return appError('FORBIDDEN');
    case 'dates_invalid':
      return appError('VALIDATION_FAILED', {
        fieldErrors: [{ path: 'additional', code: 'DATES' }],
      });
  }
}

export interface RolesSaved {
  readonly personId: string;
  readonly changed: boolean;
  readonly before: readonly AssignedRole[];
  readonly after: readonly AssignedRole[];
}

function rolesAction(
  permission: PermissionDefinition,
  privileged: boolean,
): ActionDefinition<typeof EditRolesInput, RolesSaved, UserTx> {
  return {
    permission,
    input: EditRolesInput,
    resource: (input) => ({ type: 'person', id: input.personId }),
    handler: async ({ ctx, input }) => {
      // Ordinary path: a change that touches a privileged role must go through the privileged action
      // (AAL2, strict session check). Checked after the role lock against the stored roles.
      const outcome = await replaceMemberRoles(
        ctx.tx,
        input.personId,
        input.version,
        desiredRoles(input),
        privileged ? {} : { lockedCodes: PRIVILEGED },
      );
      if (!outcome.ok && outcome.refusal === 'privileged_change') {
        const access = ctx.access(p['platform.role.assign_privileged'], ctx.resource ?? 'tenant');
        return err(appError(access === 'step_up_required' ? 'STEP_UP_REQUIRED' : 'FORBIDDEN'));
      }
      if (!outcome.ok) return err(refusalError(outcome.refusal));
      return ok({
        personId: input.personId,
        changed: outcome.changed,
        before: outcome.before,
        after: outcome.after,
      });
    },
    audit: (_input, output) =>
      output.changed
        ? {
            action: 'platform.user.roles_changed',
            entityType: 'person',
            entityId: output.personId,
            // Role codes and validity days (BR-IAM-3: before and after; no personal data).
            data: { before: output.before, after: output.after },
          }
        : null,
  };
}

/** Ordinary roles only (HR Manager, Organization Admin). */
export function updateMemberRolesActionDefinition() {
  return rolesAction(p['platform.role.assign'], false);
}

/** Any role, privileged ones included: Organization Admin with an authenticator code (AAL2). */
export function updateMemberPrivilegedRolesActionDefinition() {
  return rolesAction(p['platform.role.assign_privileged'], true);
}
