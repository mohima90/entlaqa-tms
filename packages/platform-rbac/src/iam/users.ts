import { EMPTY_PERSON_SCOPE, appError, err, isEmptyPersonScope, ok } from '@jadarat/platform-core';
import {
  type MemberSignInLock,
  type OrgUnitOptions,
  type StructureLevelLabel,
  type UserList,
  type UserProfile,
  type UserTx,
  getUserProfile,
  hasUnitsBelowFirstLevel,
  listOrgUnitOptions,
  listStructureLevelLabels,
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
import { type LifecycleOffer, NO_LIFECYCLE_OFFER, lifecycleOffer } from './deactivation';
import { ROLE_CODE } from './edit-roles';
import { type RoleChoice, loadRoleChoices } from './role-catalogue';
import { NO_SCOPE_UNITS, type ScopeUnitChoices, loadScopeUnitChoices } from './scope-units';
import { type PersonRecordView, loadPersonRecordView } from './person-record';
import { type AccountLockBudget, signInLockForProfile } from './sign-in-lock';

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
  // A standard or custom role code (EP-ROLES); an unknown one simply matches nobody.
  role: z.string().max(40).regex(ROLE_CODE).optional(),
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
  /**
   * The organization's own level names (FR-ADM-05): unit fields and columns say them instead of a fixed
   * «Department» (guided-test feedback #3, PO 17 Oct 2026). One read per page.
   */
  readonly levels: readonly StructureLevelLabel[];
  /**
   * The organization has a live unit below the first level: unit columns then say «Unit» and each unit's
   * level — decided for the organization, so the header is the same on every page of the list.
   */
  readonly unitsBelowFirstLevel: boolean;
  /** «دعوة مستخدم» and the invitations on the `invited` tab (T-M2-07): `platform.user.invite`. */
  readonly canInvite: boolean;
  /**
   * Deactivate / reactivate (T-M2-09): `platform.user.deactivate`. On the deactivated tab the rows then say
   * whether the member may manage each person (`mayManage`) and whether the person holds a privileged role
   * (`privileged`), for «إعادة التفعيل».
   */
  readonly canDeactivate: boolean;
  /**
   * Reactivating a privileged member (`platform.role.assign_privileged`, the Organization Admin): allowed,
   * or not at all (null; also without `canDeactivate`).
   */
  readonly privilegedReactivation: 'allowed' | null;
  /**
   * The roles (standard and custom) for the role filter and names — with `platform.role.read` — each with
   * whether the member may give it; null otherwise.
   */
  readonly roles: readonly RoleChoice[] | null;
  /**
   * «تعديل الدور» on the team list (EP-ROLES, Kawadir): `platform.role.assign`. The rows then say whether
   * the member may manage each person (`mayManage`) and whether the person is privileged (`privileged`).
   */
  readonly canAssignRoles: boolean;
  /** The unit picker of the edit-role dialog for department-limited roles (EP-ORG; with role.assign). */
  readonly scopeUnits: ScopeUnitChoices;
  /** Privileged roles may be given here (the Organization Admin). */
  readonly canAssignPrivileged: boolean;
  /**
   * «Edit details» in the row menu (redesign package 3): `platform.user.update`. The rows then say whether
   * the member may manage each person (`mayManage`); the edit panel checks again (editUserQuery).
   */
  readonly canEditDetails: boolean;
  /** The signed-in member's own person (nobody changes their own role: no ⋯ menu on that row). */
  readonly selfPersonId: string | null;
}

function privilegedAccess(ctx: ActionContext<UserTx>): 'allowed' | null {
  return ctx.can(p['platform.role.assign_privileged'], 'tenant') ? 'allowed' : null;
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
      const canAssignRoles = canReadRoles && ctx.can(p['platform.role.assign'], 'tenant');
      const canEditDetails = ctx.can(p['platform.user.update'], 'tenant');
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
        // The row menu (redesign package 3) offers edit, role and deactivation per manageable person.
        ...(canDeactivate || canAssignRoles || canEditDetails ? { includeManageable: true } : {}),
      });
      return ok({
        list,
        page: input.page,
        pageSize: USERS_PAGE_SIZE,
        canReadRoles,
        orgUnits,
        levels: await listStructureLevelLabels(ctx.tx),
        unitsBelowFirstLevel: await hasUnitsBelowFirstLevel(ctx.tx),
        canInvite: ctx.can(p['platform.user.invite'], 'tenant'),
        canDeactivate,
        privilegedReactivation: canDeactivate ? privilegedAccess(ctx) : null,
        roles: canReadRoles ? await loadRoleChoices(ctx) : null,
        canAssignRoles,
        scopeUnits: canAssignRoles ? await loadScopeUnitChoices(ctx) : NO_SCOPE_UNITS,
        canAssignPrivileged: ctx.can(p['platform.role.assign_privileged'], 'tenant'),
        canEditDetails,
        selfPersonId: ctx.actor.personId ?? null,
      });
    },
  };
}

export const UserProfileInput = z.object({ personId: z.uuid() });

export interface UserProfileView {
  readonly profile: UserProfile;
  /**
   * The organization's own level names (FR-ADM-05): unit fields and columns say them instead of a fixed
   * «Department» (guided-test feedback #3, PO 17 Oct 2026). One read per page.
   */
  readonly levels: readonly StructureLevelLabel[];
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
  /**
   * The member's sign-in lock (T-M2-11), for a viewer who may end it (`platform.user.unlock_sign_in`:
   * Organization Admin) — null for anyone else and for a person without an account here. «إلغاء إيقاف
   * تسجيل الدخول» is shown only while `locked`.
   */
  readonly signInLock: MemberSignInLock | null;
  /**
   * The grade and the HR-only card as THIS viewer may see them (WP-ADM-04): `null` sections are not rendered
   * and carry nothing — the database gives the viewer no row (HR-only fields: the person themself and
   * `platform.person.hr_details` holders only; the grade: HR, the Organization Admin, the person, their
   * managers and unit heads).
   */
  readonly record: PersonRecordView;
}

/**
 * One person's profile, authorized against that person (out of scope → NOT_FOUND). Roles need
 * `platform.role.read` and the recent activity `platform.audit.read`, both for this person; the sign-in
 * lock `platform.user.unlock_sign_in` (`accountLockBudget`: the account budget sign-in applies).
 */
export function userProfileQueryDefinition(
  accountLockBudget?: AccountLockBudget,
): QueryDefinition<typeof UserProfileInput, UserProfileView, UserTx> {
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
      const signInLock = await signInLockForProfile(
        ctx.tx,
        person.id,
        {
          canUnlock:
            ctx.can(p['platform.user.unlock_sign_in'], person) &&
            (await mayManagePerson(ctx.tx, person.id, 'platform.user.unlock_sign_in')),
          tenantId: ctx.actor.tenantId,
          // Active members only (security review T-M2-11 M1): revoked, suspended or invited is not ours.
          hasAccount: profile.membershipStatus === 'active',
        },
        accountLockBudget,
      );
      return ok({
        profile,
        levels: await listStructureLevelLabels(ctx.tx),
        canOpenManager,
        canEdit,
        canEditRoles,
        lifecycle,
        signInLock,
        record: await loadPersonRecordView(ctx, person.id),
      });
    },
  };
}
