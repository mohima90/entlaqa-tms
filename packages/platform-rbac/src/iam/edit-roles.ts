import { type AppError, appError, err, ok } from '@jadarat/platform-core';
import {
  type EditableRole,
  type RoleRefusal,
  type UnitHead,
  type UserTx,
  clearHeadedUnits,
  getEditableRole,
  getOwnUnitId,
  insertAuditEvent,
  listHeadedUnitIds,
  listStructureUnitOptions,
  listUnitHeads,
  lockTenantRoles,
  lockUnitHeadChange,
  replaceMemberRole,
  setUnitHead,
} from '@jadarat/platform-db';
import { z } from 'zod';
import type { ActionContext, ActionDefinition } from '../define-action';
import type { QueryDefinition } from '../define-query';
import type { PermissionDefinition } from '../permissions';
import { platformPermissions } from '../platform-permissions';
import { SYSTEM_ROLES } from '../system-roles';
import { DEPARTMENT_HEAD_ROLE, EMPLOYEE_ROLE } from './head-role';
import { type RoleChoice, canGive, findRole, loadRoleChoices } from './role-catalogue';
import {
  type ScopeUnitChoices,
  ScopeUnitField,
  loadScopeUnitChoices,
  scopeUnitProblem,
} from './scope-units';

/**
 * Changing a member's role (T-M2-14, FR-IAM-07, BR-IAM-3; EP-ROLES, PO 17 Oct 2026: ONE role per person,
 * Kawadir's «تعديل الدور» dialog on Team members). The role is a standard role or a custom role of the
 * organization. Ordinary roles: `platform.role.assign` (HR Manager, Organization Admin) — every one of
 * them (who can give what, PO 17 Oct 2026); privileged roles (standard, or custom with a high-risk or
 * user / role management permission): `platform.role.assign_privileged` — the Organization Admin. Nobody changes their own role; a privileged
 * member's role only an Organization Admin (database guard); the last Organization Admin stays. Audited
 * with the role before and after.
 */
const p = platformPermissions;

/** Codes of the privileged standard roles (custom roles: computed from their permissions). */
export const PRIVILEGED_ROLE_CODES: readonly string[] = SYSTEM_ROLES.filter(
  (r) => r.privileged,
).map((r) => r.code);

export type RolesBlock = 'own_roles' | 'no_account' | 'revoked';

export interface EditRolesView {
  readonly role: EditableRole;
  /** Why the role cannot be changed here at all, if so. */
  readonly blocked: RolesBlock | null;
  /** Privileged roles of this member: allowed (the Organization Admin) or not for this member. */
  readonly privilegedAccess: 'allowed' | 'denied';
  /** The roles to choose from, with whether this member may give each. */
  readonly choices: readonly RoleChoice[];
  /** The unit picker of department-limited custom roles (EP-ORG, T-M3-09). */
  readonly scopeUnits: ScopeUnitChoices;
  /** «Head of which department?» for the Department Head role (WP-FIX-03). */
  readonly headUnits: HeadUnitChoices;
}

/**
 * What the Department Head role needs to say which department the person heads (WP-FIX-03; PO, 12 Nov
 * 2026: «when I add the role Department Head, he becomes the manager of the department according to what
 * his department is»): the person's own department (the default), the units they head now, who heads every
 * other unit, and whether the signed-in member may set the head with the role — a structure manager
 * (`platform.org.manage`) or anyone who may give the Department Head role (the HR Manager and the
 * Organization Admin alike; the database decides the same way, migration 20261112100400). The units
 * themselves are `scopeUnits`.
 */
export interface HeadUnitChoices {
  readonly canPick: boolean;
  /** The person's own department (their record), live and active; null: none, or a new person. */
  readonly ownUnitId: string | null;
  readonly headedUnitIds: readonly string[];
  readonly heads: readonly UnitHead[];
}

export const NO_HEAD_UNITS: HeadUnitChoices = {
  canPick: false,
  ownUnitId: null,
  headedUnitIds: [],
  heads: [],
};

/** The permissions of a user manager, as the database reads them (private.actor_manages_users). */
const USER_MANAGER_PERMISSIONS = [
  p['platform.user.invite'],
  p['platform.user.update'],
  p['platform.user.deactivate'],
] as const;

/**
 * May the member write the head that goes with the Department Head role? Structure managers; and whoever
 * may give that role (who can give what: `platform.role.assign` gives it, it is not privileged), manages
 * people (the database asks the same: private.actor_may_manage_person) and sees the structure
 * (`platform.org.read`: the forms name the department, its present head and the departments left without
 * one — a member who cannot see them is never asked and sets nothing). In the standard roles: the HR
 * Manager and the Organization Admin. Used for exactly the two writes of the role forms — set / replace a
 * head, clear the units of a head made an Employee — and nothing else that asks for
 * `platform.org.manage`. The database holds the line for the role-giver (migration 20261112100400: only
 * `head_person_id`, only for a Department Head / a head made an Employee, never the member themselves).
 */
export async function maySetRoleHeads(
  ctx: Pick<ActionContext<UserTx>, 'can' | 'tx'>,
): Promise<boolean> {
  if (ctx.can(p['platform.org.manage'], 'tenant')) return true;
  if (!ctx.can(p['platform.org.read'], 'tenant')) return false;
  if (!USER_MANAGER_PERMISSIONS.some((permission) => ctx.can(permission, 'tenant'))) return false;
  const departmentHead = await findRole(ctx.tx, DEPARTMENT_HEAD_ROLE);
  return departmentHead !== null && canGive(ctx, departmentHead);
}

/** The choices; the heads only for a member who sees the structure. */
export async function loadHeadUnitChoices(
  ctx: Pick<ActionContext<UserTx>, 'can' | 'tx'>,
  personId: string | null,
): Promise<HeadUnitChoices> {
  if (!ctx.can(p['platform.org.read'], 'tenant')) return NO_HEAD_UNITS;
  return {
    canPick: await maySetRoleHeads(ctx),
    ownUnitId: personId === null ? null : await getOwnUnitId(ctx.tx, personId),
    headedUnitIds: personId === null ? [] : await listHeadedUnitIds(ctx.tx, personId),
    heads: await listUnitHeads(ctx.tx),
  };
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
      const role = await getEditableRole(ctx.tx, input.personId);
      if (!role) return err(appError('NOT_FOUND'));
      const blocked: RolesBlock | null = role.isSelf
        ? 'own_roles'
        : role.membershipId === null
          ? 'no_account'
          : role.membershipStatus === 'revoked'
            ? 'revoked'
            : null;
      // A privileged member's record and role: Organization Admin only (same rule as the guards).
      if (blocked === null && !role.mayManage) return err(appError('FORBIDDEN'));
      return ok({
        role,
        blocked,
        privilegedAccess: ctx.can(p['platform.role.assign_privileged'], ctx.resource ?? 'tenant')
          ? 'allowed'
          : 'denied',
        choices: await loadRoleChoices(ctx),
        scopeUnits: await loadScopeUnitChoices(ctx),
        headUnits: await loadHeadUnitChoices(ctx, input.personId),
      });
    },
  };
}

/** `role_code:row id:row version` (getEditableRole), or empty for no role. */
export const VERSION_TOKEN = /^[a-z0-9_]+:[0-9a-f-]{36}:[0-9]+$|^$/;

/** A standard role code or a custom role code (`custom_` + 12 hex). */
export const ROLE_CODE = /^[a-z][a-z_]{1,39}$|^custom_[0-9a-f]{12}$/;

export const EditRolesInput = z.strictObject({
  personId: z.uuid(),
  version: z.string().max(200).regex(VERSION_TOKEN),
  role: z.string().max(40).regex(ROLE_CODE),
  // The unit of a custom role limited to «A department» (EP-ORG, T-M3-09); empty for every other role.
  scopeUnitId: ScopeUnitField.default(null),
  // The unit a Department Head heads from now on (WP-FIX-03). Empty for every other role, for a Department
  // Head who keeps the units they head, and for «their own department» (the default, PO 12 Nov 2026): the
  // action then uses the department of the person's record.
  headUnitId: ScopeUnitField.default(null),
  // The unit has another head: the form asked, the member confirmed the replacement.
  replaceHead: z.boolean().default(false),
  // The Department Head role is taken away from someone who heads units: the form warned which units
  // are left without a head, the member confirmed.
  clearHeads: z.boolean().default(false),
});

function fieldError(code: string, path = 'role'): AppError {
  return appError('VALIDATION_FAILED', { fieldErrors: [{ path, code }] });
}

function refusalError(refusal: RoleRefusal): AppError {
  switch (refusal) {
    case 'not_found':
    case 'no_account':
      return appError('NOT_FOUND');
    case 'own_role':
    case 'not_allowed':
    case 'membership_revoked':
    case 'privileged_change':
      return appError('FORBIDDEN');
    case 'version_conflict':
      return appError('CONFLICT_VERSION');
    case 'last_admin':
      return fieldError('LAST_ADMIN');
    case 'unknown_role':
      return fieldError('ROLE_UNKNOWN');
    case 'unit_not_allowed':
      return fieldError('UNIT_NOT_ALLOWED', 'scopeUnitId');
  }
}

export interface RolesSaved {
  readonly personId: string;
  readonly changed: boolean;
  readonly before: string | null;
  readonly after: string;
  /** The unit of a department-limited role before and after (EP-ORG), or null. */
  readonly beforeUnit: string | null;
  readonly afterUnit: string | null;
  /**
   * The stored role's version token after the change (redesign package 3): «Undo» in the toast puts the
   * previous role back through this same action, against this version.
   */
  readonly version: string;
  /** The unit the person heads from now on (WP-FIX-03), and whom they replaced there. */
  readonly headSet: { readonly unitId: string; readonly replaced: string | null } | null;
  /** The units left without a head because the Department Head role was taken away. */
  readonly headsCleared: readonly string[];
}

/** A unit's head changed with a role (BR-ORG-f): ids only, and why. */
function headAudit(unitId: string, before: string | null, after: string | null) {
  return {
    action: 'platform.org.unit_updated',
    entityType: 'structure_unit',
    entityId: unitId,
    data: {
      before: { headPersonId: before },
      after: { headPersonId: after },
      reason: 'department_head_role',
    },
  };
}

function roleAction(
  permission: PermissionDefinition,
  privileged: boolean,
): ActionDefinition<typeof EditRolesInput, RolesSaved, UserTx> {
  return {
    permission,
    input: EditRolesInput,
    resource: (input) => ({ type: 'person', id: input.personId }),
    handler: async ({ ctx, input }) => {
      // A change that also touches a unit's head takes the structure's locks first (the global lock order:
      // departments → person_employment → role_assignments; WP-FIX-03).
      // The Department Head role always may: its holder becomes the head of their own department.
      if (input.role === DEPARTMENT_HEAD_ROLE || input.headUnitId !== null || input.clearHeads) {
        await lockUnitHeadChange(ctx.tx);
      }
      // Everything below is decided under the organization's role lock (security review L5): a custom role
      // changed or deleted at the same time is read as it is after that change.
      await lockTenantRoles(ctx.tx);
      const wanted = await findRole(ctx.tx, input.role);
      if (!wanted) return err(fieldError('ROLE_UNKNOWN'));
      // Ordinary path: neither the new nor the current role may be privileged (the privileged action,
      // with its strict session check, gives those); every ordinary role (who can give what).
      if (!privileged && (wanted.privileged || !canGive(ctx, wanted))) {
        return err(fieldError('ROLE_NOT_ALLOWED'));
      }
      // One unit for a department-limited custom role, none for any other (EP-ORG BR-ORG-d).
      const unitProblem = scopeUnitProblem(
        wanted.dataScope,
        wanted.kind,
        input.scopeUnitId,
        input.scopeUnitId === null ? [] : await listStructureUnitOptions(ctx.tx),
      );
      if (unitProblem) return err(fieldError(unitProblem, 'scopeUnitId'));
      const current = await getEditableRole(ctx.tx, input.personId);
      const currentRole = current?.roleCode ? await findRole(ctx.tx, current.roleCode) : null;
      // «Either door does both» (WP-FIX-03): the Department Head role and the units the person heads.
      // Every rule is checked before the first write. Whoever gives the role sets the head with it — the
      // HR Manager or the Organization Admin (PO, 12 Nov 2026; `maySetRoleHeads`).
      const becomesHead = wanted.code === DEPARTMENT_HEAD_ROLE;
      const managesUnits = await maySetRoleHeads(ctx);
      const headed = current ? await listHeadedUnitIds(ctx.tx, input.personId) : [];
      if (input.headUnitId !== null && (!becomesHead || !managesUnits)) {
        return err(fieldError('UNIT_NOT_ALLOWED', 'headUnitId'));
      }
      // The department they head from now on: the one picked, else — for someone who heads nothing yet —
      // THEIR OWN department, as their record has it (PO, 12 Nov 2026: «he becomes the manager of the
      // department according to what his department is»); the question is asked only of a person who
      // has no department.
      let headUnitId = input.headUnitId;
      if (becomesHead && managesUnits && headUnitId === null && headed.length === 0) {
        headUnitId = await getOwnUnitId(ctx.tx, input.personId);
        if (headUnitId === null) return err(fieldError('HEAD_UNIT_REQUIRED', 'headUnitId'));
      }
      // A head keeps their units with any role but Employee (PO, 12 Nov 2026: the head of a department
      // enters its needs whatever their role — e.g. the HR Manager who heads Human Resources). Making a
      // head an Employee is the one change that means «no longer the head»: an Employee who heads a unit
      // is a Department Head (head-role.ts), so the form asks and the units are left without a head.
      const leavesUnits = wanted.code === EMPLOYEE_ROLE && headed.length > 0;
      // Never an Employee who silently stays a head (second look M1): a member who could not clear the
      // units (one who does not see the structure) is refused before anything is written, and told why.
      if (leavesUnits && !managesUnits) return err(fieldError('HEADS_NOT_YOURS'));
      if (leavesUnits && !input.clearHeads) {
        return err(
          appError('VALIDATION_FAILED', {
            fieldErrors: [{ path: 'role', code: 'HEADS_LEFT' }],
            params: { units: headed.length },
          }),
        );
      }
      const outcome = await replaceMemberRole(
        ctx.tx,
        input.personId,
        input.version,
        input.role,
        privileged
          ? {}
          : {
              // Read under the role lock, against the stored role (unknown roles count as privileged).
              isLocked: (code) =>
                code === wanted.code ? wanted.privileged : (currentRole?.privileged ?? true),
            },
        input.scopeUnitId,
      );
      if (!outcome.ok) return err(refusalError(outcome.refusal));
      let headSet: RolesSaved['headSet'] = null;
      if (becomesHead && headUnitId !== null) {
        const set = await setUnitHead(ctx.tx, headUnitId, input.personId, {
          replace: input.replaceHead,
        });
        if (!set.ok) {
          // Nothing is kept: the action's transaction is rolled back with the role change.
          return err(
            fieldError(
              set.refusal === 'head_taken'
                ? 'HEAD_TAKEN'
                : set.refusal === 'person_not_active'
                  ? 'HEAD_NOT_ACTIVE'
                  : set.refusal === 'not_allowed'
                    ? // The database's refusal: this head is not this member's to change.
                      'HEAD_NOT_YOURS'
                    : 'UNIT_NOT_ALLOWED',
              'headUnitId',
            ),
          );
        }
        if (set.changed) {
          headSet = { unitId: set.unitId, replaced: set.before };
          await insertAuditEvent(
            ctx.tx,
            ctx.actor,
            headAudit(set.unitId, set.before, input.personId),
          );
        }
      }
      let headsCleared: readonly string[] = [];
      if (leavesUnits) {
        const cleared = await clearHeadedUnits(ctx.tx, input.personId);
        // Refused by the database, or fewer units than the person headed (a row this member cannot write):
        // nothing is kept — the action's transaction is rolled back with the role change (second look
        // L10), never «saved» with an Employee still stored as a head.
        if (cleared === null || cleared.length < headed.length) {
          return err(fieldError('HEADS_NOT_YOURS'));
        }
        headsCleared = cleared;
        for (const unitId of headsCleared) {
          await insertAuditEvent(ctx.tx, ctx.actor, headAudit(unitId, input.personId, null));
        }
      }
      const saved = await getEditableRole(ctx.tx, input.personId);
      return ok({
        personId: input.personId,
        changed: outcome.changed,
        before: outcome.before,
        after: outcome.after,
        beforeUnit: outcome.beforeUnit,
        afterUnit: outcome.afterUnit,
        version: saved?.version ?? input.version,
        headSet,
        headsCleared,
      });
    },
    audit: (_input, output) =>
      output.changed
        ? {
            action: 'platform.user.roles_changed',
            entityType: 'person',
            entityId: output.personId,
            // Role codes (BR-IAM-3: before and after; no personal data), and the unit of a department-limited
            // role (EP-ORG BR-ORG-f) when there is one.
            data: {
              before: output.before,
              after: output.after,
              ...(output.beforeUnit !== null || output.afterUnit !== null
                ? { beforeUnit: output.beforeUnit, afterUnit: output.afterUnit }
                : {}),
            },
          }
        : null,
  };
}

/** Ordinary roles only (HR Manager, Organization Admin). */
export function updateMemberRolesActionDefinition() {
  return roleAction(p['platform.role.assign'], false);
}

/** Any role, privileged ones included: the Organization Admin. */
export function updateMemberPrivilegedRolesActionDefinition() {
  return roleAction(p['platform.role.assign_privileged'], true);
}
