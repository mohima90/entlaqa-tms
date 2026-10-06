import { ok } from '@jadarat/platform-core';
import { type UserTx, countMembersByRole } from '@jadarat/platform-db';
import { z } from 'zod';
import type { QueryDefinition } from '../define-query';
import { platformPermissions } from '../platform-permissions';

/**
 * Roles & permissions page (T-M2-05, FR-IAM-07; approved screen 5): the 14 system roles with their
 * permission matrix (static: SYSTEM_ROLES, ROLE_MATRIX) and how many members hold each role. Needs a
 * tenant-wide `platform.role.read`; the member counts and the link to the users list also need a
 * tenant-wide `platform.user.read` (every role with the first has the second today).
 */
const p = platformPermissions;

export interface RolesPageView {
  /** Members per role code (invited to deactivated, role in force); null without user.read. */
  readonly memberCounts: Readonly<Record<string, number>> | null;
}

export const RolesPageInput = z.strictObject({});

export function rolesPageQueryDefinition(): QueryDefinition<
  typeof RolesPageInput,
  RolesPageView,
  UserTx
> {
  return {
    permission: p['platform.role.read'],
    input: RolesPageInput,
    handler: async ({ ctx }) =>
      ok({
        memberCounts: ctx.can(p['platform.user.read'], 'tenant')
          ? await countMembersByRole(ctx.tx)
          : null,
      }),
  };
}
