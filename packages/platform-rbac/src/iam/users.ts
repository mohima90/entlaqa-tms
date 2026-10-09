import { EMPTY_PERSON_SCOPE, appError, err, isEmptyPersonScope, ok } from '@jadarat/platform-core';
import {
  type OrgUnitOptions,
  type UserList,
  type UserProfile,
  type UserTx,
  getUserProfile,
  listOrgUnitOptions,
  listUsers,
  loadPersonResourceFacts,
  mayManagePerson,
} from '@jadarat/platform-db';
import { normalizeDigits } from '@jadarat/platform-i18n';
import { z } from 'zod';
import type { ActionContext } from '../define-action';
import type { QueryDefinition } from '../define-query';
import { personResourceAttributes, personScopeFromGrants } from '../person-scope';
import { platformPermissions } from '../platform-permissions';
import { SYSTEM_ROLE_CODES } from '../system-roles';
import { type LifecycleOffer, NO_LIFECYCLE_OFFER, lifecycleOffer } from './deactivation';

/**
 * Reads behind the users screens (T-M2-04, FR-IAM-01; screens 1 and 3). Kept as definitions so they
 * can be tested with a fake runtime; the app binds them with `defineQuery`.
 */
const p = platformPermissions;

export const USERS_PAGE_SIZE = 25;

/** Query-string input of the users list. Unknown or malformed values fail validation (no SQL error). */
export const UsersListInput = z.object({
  tab: z.enum(['all', 'active', 'invited', 'deactivated']).default('all'),
  q: z
    .string()
    .max(100)
    .transform((value) => normalizeDigits(value).trim())
    .optional(),
  role: z.enum(SYSTEM_ROLE_CODES).optional(),
  department: z.uuid().optional(),
  branch: z.uuid().optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

export interface UsersListView {
  readonly list: UserList;
  readonly page: number;
  readonly pageSize: number;
  /** Roles are shown (and filterable) only with `platform.role.read`. */
  readonly canReadRoles: boolean;
  /** Department and branch filters, only with a tenant-wide `platform.org.read`. */
  readonly orgUnits: OrgUnitOptions | null;
  /** «دعوة مستخدم» and the invitations on the `invited` tab (T-M2-07): `platform.user.invite`. */
  readonly canInvite: boolean;
  /**
   * Deactivate / reactivate (T-M2-09): `platform.user.deactivate`. On the deactivated tab the rows then say
   * whether the member may manage each person (`mayManage`) and whether the person holds a privileged role
   * (`privileged`), for «إعادة التفعيل».
   */
  readonly canDeactivate: boolean;
  /**
   * Reactivating a privileged member (`platform.role.assign_privileged`): allowed now, after an
   * authenticator code, or not at all (null; also without `canDeactivate`).
   */
  readonly privilegedReactivation: 'allowed' | 'step_up_required' | null;
}

function privilegedAccess(ctx: ActionContext<UserTx>): 'allowed' | 'step_up_required' | null {
  const access = ctx.access(p['platform.role.assign_privileged'], 'tenant');
  return access === 'denied' ? null : access;
}

/**
 * The people the member may see (`platform.user.read`, scoped): an Organization Admin sees everyone, a
 * department head their departments, a line manager their team, a learner only themselves.
 */
export function usersListQueryDefinition(): QueryDefinition<
  typeof UsersListInput,
  UsersListView,
  UserTx
> {
  return {
    permission: p['platform.user.read'],
    input: UsersListInput,
    scoped: true,
    handler: async ({ ctx, input }) => {
      // Roles per row only for the people role.read covers (it can be narrower than user.read, e.g.
      // a Line Manager + Learner reads their own record but not their own roles).
      const rolesScope = personScopeFromGrants(
        ctx.grantsFor(p['platform.role.read']),
        p['platform.role.read'],
      );
      const canReadRoles = !isEmptyPersonScope(rolesScope);
      const orgUnits = ctx.can(p['platform.org.read'], 'tenant')
        ? await listOrgUnitOptions(ctx.tx)
        : null;
      const canDeactivate = ctx.can(p['platform.user.deactivate'], 'tenant');
      const list = await listUsers(ctx.tx, {
        scope: personScopeFromGrants(ctx.grants, p['platform.user.read']),
        actorPersonId: ctx.actor.personId,
        tab: input.tab,
        rolesScope: canReadRoles ? rolesScope : EMPTY_PERSON_SCOPE,
        ...(input.q ? { search: input.q } : {}),
        ...(input.role && canReadRoles ? { roleCode: input.role } : {}),
        ...(input.department && orgUnits ? { departmentId: input.department } : {}),
        ...(input.branch && orgUnits ? { branchId: input.branch } : {}),
        limit: USERS_PAGE_SIZE,
        offset: (input.page - 1) * USERS_PAGE_SIZE,
        ...(canDeactivate && input.tab === 'deactivated' ? { includeManageable: true } : {}),
      });
      return ok({
        list,
        page: input.page,
        pageSize: USERS_PAGE_SIZE,
        canReadRoles,
        orgUnits,
        canInvite: ctx.can(p['platform.user.invite'], 'tenant'),
        canDeactivate,
        privilegedReactivation: canDeactivate ? privilegedAccess(ctx) : null,
      });
    },
  };
}

export const UserProfileInput = z.object({ personId: z.uuid() });

export interface UserProfileView {
  readonly profile: UserProfile;
  /** The direct manager's profile may be opened by the member (else the name is plain text). */
  readonly canOpenManager: boolean;
  /** The member may edit this person's details (T-M2-13): user.update + the manage rule. */
  readonly canEdit: boolean;
  /**
   * The member may change this person's roles (T-M2-14): role.assign + the manage rule, the person has
   * a membership that is not revoked, and it is not the member's own.
   */
  readonly canEditRoles: boolean;
  /** Deactivate / reactivate (T-M2-09): user.deactivate + the manage rule, never one's own account. */
  readonly lifecycle: LifecycleOffer;
}

/**
 * One person's profile, authorized against that person (out of scope → NOT_FOUND). Roles need
 * `platform.role.read` and the recent activity `platform.audit.read`, both for this person.
 */
export function userProfileQueryDefinition(): QueryDefinition<
  typeof UserProfileInput,
  UserProfileView,
  UserTx
> {
  return {
    permission: p['platform.user.read'],
    input: UserProfileInput,
    resource: (input) => ({ type: 'person', id: input.personId }),
    handler: async ({ ctx, input }) => {
      const person = ctx.resource;
      if (!person) return err(appError('NOT_FOUND'));
      const profile = await getUserProfile(ctx.tx, input.personId, {
        includeRoles: ctx.can(p['platform.role.read'], person),
        includeActivity: ctx.can(p['platform.audit.read'], person),
      });
      if (!profile) return err(appError('NOT_FOUND'));
      const managerFacts = profile.manager
        ? await loadPersonResourceFacts(ctx.tx, profile.manager.personId)
        : null;
      const canOpenManager =
        managerFacts !== null &&
        ctx.can(p['platform.user.read'], personResourceAttributes(managerFacts));
      const mayManage = await mayManagePerson(ctx.tx, person.id);
      const canEdit = mayManage && ctx.can(p['platform.user.update'], person);
      const canEditRoles =
        mayManage &&
        profile.roles !== null &&
        ctx.can(p['platform.role.assign'], person) &&
        profile.membershipStatus !== null &&
        profile.membershipStatus !== 'revoked' &&
        person.id !== ctx.actor.personId;
      const lifecycle =
        mayManage &&
        ctx.can(p['platform.user.deactivate'], person) &&
        (profile.membershipStatus === 'active' || profile.membershipStatus === 'suspended') &&
        person.id !== ctx.actor.personId
          ? await lifecycleOffer(ctx, person.id)
          : NO_LIFECYCLE_OFFER;
      return ok({ profile, canOpenManager, canEdit, canEditRoles, lifecycle });
    },
  };
}
