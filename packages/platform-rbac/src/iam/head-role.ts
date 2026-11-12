import {
  type UserTx,
  getEditableRole,
  insertAuditEvent,
  lockTenantRoles,
  replaceMemberRole,
} from '@jadarat/platform-db';
import type { ActionContext } from '../define-action';
import { platformPermissions } from '../platform-permissions';
import { SYSTEM_ROLES } from '../system-roles';

/**
 * «Either door does both» (WP-FIX-03; PO, 12 Nov 2026 — test feedback #1): a unit's head and the
 * Department Head role set each other. This file is the first door, the structure's side: when a person
 * becomes the head of a unit (Departments form, unit import, the hand-over of a leaver's units), they are
 * given the Department Head role in the same transaction — within ONE role per person (EP-ROLES, PO
 * 17 Oct 2026):
 *
 *   - a member who holds the Employee role, or no role yet, becomes a Department Head (`given`);
 *   - a member who holds any other role keeps it (`kept`): a person holds one role, and nobody loses
 *     HR Manager, L&D Manager, … by being picked as a head. The form says so;
 *   - a person without a sign-in account here has no role to change (`no_account`);
 *   - the change is made only when the signed-in member could make it in Team members (`not_allowed`
 *     otherwise): `platform.role.assign` organization-wide, a person they may manage, never themselves —
 *     the same rules as Edit role, and the database guard (private.check_role_assignment_actor) has the
 *     last word. A refusal there is rolled back to a savepoint: the unit's change is never lost.
 *
 * Audited as `platform.user.roles_changed` with the reason and the unit (role codes and ids only). The
 * second door — giving the role asks «Head of which department?» — is in edit-roles.ts / invitations.ts.
 */
const p = platformPermissions;

export const DEPARTMENT_HEAD_ROLE = 'department_head';
/** The role a head is moved up from (the least a member holds). */
export const EMPLOYEE_ROLE = 'learner';

export type HeadRoleOutcome =
  | { readonly kind: 'given'; readonly personId: string; readonly before: string | null }
  | { readonly kind: 'already'; readonly personId: string }
  | { readonly kind: 'kept'; readonly personId: string; readonly roleCode: string }
  | { readonly kind: 'no_account'; readonly personId: string }
  | { readonly kind: 'not_allowed'; readonly personId: string; readonly roleCode: string | null };

const PRIVILEGED = new Set<string>(SYSTEM_ROLES.filter((r) => r.privileged).map((r) => r.code));

class RoleRefused extends Error {}

/**
 * Gives the Department Head role to a person who has just become the head of `unitIds`, when the rules
 * above allow it; says what happened either way (the forms tell the member).
 */
export async function giveHeadRole(
  ctx: Pick<ActionContext<UserTx>, 'can' | 'tx' | 'actor'>,
  personId: string,
  unitIds: readonly string[],
  reason: 'unit_head' | 'unit_import' | 'head_hand_over',
): Promise<HeadRoleOutcome> {
  await lockTenantRoles(ctx.tx);
  const role = await getEditableRole(ctx.tx, personId);
  if (!role) return { kind: 'no_account', personId };
  if (role.membershipId === null || role.membershipStatus === 'revoked') {
    return { kind: 'no_account', personId };
  }
  if (role.roleCode === DEPARTMENT_HEAD_ROLE) return { kind: 'already', personId };
  if (role.roleCode !== null && role.roleCode !== EMPLOYEE_ROLE) {
    return { kind: 'kept', personId, roleCode: role.roleCode };
  }
  if (role.isSelf || !role.mayManage || !ctx.can(p['platform.role.assign'], 'tenant')) {
    return { kind: 'not_allowed', personId, roleCode: role.roleCode };
  }
  try {
    // In a savepoint: a refusal of the database guard aborts only this step.
    await ctx.tx.transaction(async (savepoint) => {
      const outcome = await replaceMemberRole(
        savepoint,
        personId,
        role.version,
        DEPARTMENT_HEAD_ROLE,
        { isLocked: (code) => PRIVILEGED.has(code) },
      );
      if (!outcome.ok) throw new RoleRefused(outcome.refusal);
    });
  } catch (error) {
    if (error instanceof RoleRefused) {
      return { kind: 'not_allowed', personId, roleCode: role.roleCode };
    }
    throw error;
  }
  await insertAuditEvent(ctx.tx, ctx.actor, {
    action: 'platform.user.roles_changed',
    entityType: 'person',
    entityId: personId,
    data: {
      before: role.roleCode,
      after: DEPARTMENT_HEAD_ROLE,
      automatic: true,
      reason,
      unitIds: [...unitIds].sort(),
    },
  });
  return { kind: 'given', personId, before: role.roleCode };
}
