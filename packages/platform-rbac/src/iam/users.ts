import { appError, err, ok } from '@jadarat/platform-core';
import {
  type OrgUnitOptions,
  type UserList,
  type UserProfile,
  type UserTx,
  getUserProfile,
  listOrgUnitOptions,
  listUsers,
} from '@jadarat/platform-db';
import { normalizeDigits } from '@jadarat/platform-i18n';
import { z } from 'zod';
import type { QueryDefinition } from '../define-query';
import { personScopeFromGrants } from '../person-scope';
import { platformPermissions } from '../platform-permissions';
import { SYSTEM_ROLE_CODES } from '../system-roles';

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
      // System roles give role.read with the same scope as user.read, so "any scope" matches the rows.
      const canReadRoles = ctx.can(p['platform.role.read'], 'any');
      const orgUnits = ctx.can(p['platform.org.read'], 'tenant')
        ? await listOrgUnitOptions(ctx.tx)
        : null;
      const list = await listUsers(ctx.tx, {
        scope: personScopeFromGrants(ctx.grants, p['platform.user.read']),
        actorPersonId: ctx.actor.personId,
        tab: input.tab,
        includeRoles: canReadRoles,
        ...(input.q ? { search: input.q } : {}),
        ...(input.role && canReadRoles ? { roleCode: input.role } : {}),
        ...(input.department && orgUnits ? { departmentId: input.department } : {}),
        ...(input.branch && orgUnits ? { branchId: input.branch } : {}),
        limit: USERS_PAGE_SIZE,
        offset: (input.page - 1) * USERS_PAGE_SIZE,
      });
      return ok({ list, page: input.page, pageSize: USERS_PAGE_SIZE, canReadRoles, orgUnits });
    },
  };
}

export const UserProfileInput = z.object({ personId: z.uuid() });

/**
 * One person's profile, authorized against that person (out of scope → NOT_FOUND). Roles need
 * `platform.role.read` and the recent activity `platform.audit.read`, both for this person.
 */
export function userProfileQueryDefinition(): QueryDefinition<
  typeof UserProfileInput,
  UserProfile,
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
      return profile ? ok(profile) : err(appError('NOT_FOUND'));
    },
  };
}
